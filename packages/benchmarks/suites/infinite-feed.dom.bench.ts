
import { bench, describe } from "vitest";
import { createReactRelayApp } from "../src/ui/react-relay-infinite-feed-app";
import { createVueApolloApp } from "../src/ui/vue-apollo-infinite-feed-app";
import { createVueCachebayApp } from "../src/ui/vue-cachebay-infinite-feed-app";
import { createVueUrqlApp } from "../src/ui/vue-urql-infinite-feed-app";

const DEBUG = process.env.DEBUG === 'true';
const PAGES_TO_LOAD = 100;

const serverUrl = process.env.BENCH_SERVER_URL || 'http://127.0.0.1:4000/graphql';

if (DEBUG) {
  console.log(`Using server at: ${serverUrl}`);
}

async function runScenario(appType: "cachebay" | "apollo" | "urql" | "relay") {
  try {
    let app;

    switch (appType) {
      case "cachebay":
        app = createVueCachebayApp(serverUrl);
        break;
      case "apollo":
        app = createVueApolloApp(serverUrl);
        break;
      case "urql":
        app = createVueUrqlApp(serverUrl);
        break;
      case "relay":
        app = createReactRelayApp(serverUrl);
        break;
      default:
        throw new Error(`Unknown app type: ${appType}`);
    }

    app.mount();

    if (DEBUG) {
      console.log(`\n[${appType}] Starting benchmark...`);
    }

    const pageTimes: number[] = [];
    const totalPages = 1 + PAGES_TO_LOAD;

    // Load initial page + extra pages
    for (let i = 0; i < totalPages; i++) {
      try {
        const pageStart = performance.now();
        await app.loadNextPage();
        const pageEnd = performance.now();

        const pageTime = pageEnd - pageStart;
        pageTimes.push(pageTime);

        if (DEBUG && (i < 5 || i % 50 === 0 || i === totalPages - 1)) {
          const count = app.getCount();
          console.log(`[${appType}] Page ${i + 1}/${totalPages}: ${pageTime.toFixed(1)}ms | Total posts: ${count}`);
        }
      } catch (error) {
        console.error(`Error loading page ${i + 1}:`, error);
      }
    }

    const totalRenderTime = app.getTotalRenderTime();
    const totalPageTime = pageTimes.reduce((a, b) => a + b, 0);
    const finalCount = app.getCount();

    if (DEBUG) {
      console.log(`[${appType}] Summary:`);
      console.log(`  Total time (UX): ${totalPageTime.toFixed(1)}ms`);
      console.log(`  Render time (cache): ${totalRenderTime.toFixed(1)}ms`);
      console.log(`  Network time: ${(totalPageTime - totalRenderTime).toFixed(1)}ms`);
      console.log(`  Final post count: ${finalCount}`);
      console.log(`  Avg per page: ${(totalPageTime / totalPages).toFixed(1)}ms`);
      console.log(`  Render %: ${((totalRenderTime / totalPageTime) * 100).toFixed(1)}%`);
      console.log(`  First 5 pages: ${pageTimes.slice(0, 5).map(t => t.toFixed(1)).join(', ')}ms`);
      console.log(`  Last 5 pages: ${pageTimes.slice(-5).map(t => t.toFixed(1)).join(', ')}ms\n`);
    }

    app.unmount();

    // Return total time (network + cache + render) as the primary metric
    // This represents real-world user experience
    return totalPageTime;
  } catch (error) {
    console.error(`Error running ${appType} scenario:`, error);
  }
}

describe("DOM Infinite feed (happy-dom): Vue apps with useQuery", () => {


  bench("apollo(vue)", async () => {
    return await runScenario("apollo");
  });

  bench("cachebay(vue)", async () => {
    return await runScenario("cachebay");
  });

  bench("urql(vue)", async () => {
    return await runScenario("urql");
  });

  bench("relay(react)", async () => {
    return await runScenario("relay");
  });
});
