import { bench, describe } from "vitest";
import { createReactRelayNestedApp } from "../src/ui/react-relay-nested-query-app";
import { createVueApolloNestedApp } from "../src/ui/vue-apollo-nested-query-app";
import { createVueCachebayNestedApp } from "../src/ui/vue-cachebay-nested-query-app";
import { createVueUrqlNestedApp } from "../src/ui/vue-urql-nested-query-app";

const DEBUG = process.env.DEBUG === 'true';
const PAGES_TO_LOAD = 50; // 1000 users / 10 per page = 100 pages

const serverUrl = process.env.BENCH_SERVER_URL || 'http://127.0.0.1:4001/graphql';

if (DEBUG) {
  console.log(`Using server at: ${serverUrl}`);
}

async function runScenario(
  appType: "cachebay" | "apollo" | "urql" | "relay",
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network"
) {
  try {
    let app;

    switch (appType) {
      case "cachebay":
        app = createVueCachebayNestedApp(serverUrl, cachePolicy || "network-only");
        break;
      case "apollo":
        app = createVueApolloNestedApp(serverUrl, cachePolicy || "network-only");
        break;
      case "urql":
        app = createVueUrqlNestedApp(serverUrl, cachePolicy || "network-only");
        break;
      case "relay":
        app = createReactRelayNestedApp(serverUrl, cachePolicy || "network-only");
        break;
      default:
        throw new Error(`Unknown app type: ${appType}`);
    }

    app.mount();

    if (DEBUG) {
      console.log(`\n[${appType}] Starting benchmark...`);
    }

    const pageTimes: number[] = [];

    // Load pages with nested data
    for (let i = 0; i < PAGES_TO_LOAD; i++) {
      try {
        const pageStart = performance.now();
        await app.loadNextPage();
        const pageEnd = performance.now();

        const pageTime = pageEnd - pageStart;
        pageTimes.push(pageTime);

        if (DEBUG) {
          const count = app.getCount();
          console.log(`[${appType}] Page ${i + 1}/${PAGES_TO_LOAD}: ${pageTime.toFixed(1)}ms | Total entities: ${count}`);
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
      console.log(`  Final entity count: ${finalCount}`);
      console.log(`  Avg per page: ${(totalPageTime / PAGES_TO_LOAD).toFixed(1)}ms`);
      console.log(`  Render %: ${((totalRenderTime / totalPageTime) * 100).toFixed(1)}%\n`);
    }

    app.unmount();

    // Return total time (network + cache + render) as the primary metric
    // This represents real-world user experience
    return totalPageTime;
  } catch (error) {
    console.error(`Error running ${appType} scenario:`, error);
  }
}

describe("DOM Nested query (happy-dom): interfaces, custom keys, nested pagination", () => {
  describe("network-only", () => {
    bench("cachebay(vue)", async () => {
      return await runScenario("cachebay", "network-only");
    });

     bench("apollo(vue)", async () => {
        return await runScenario("apollo", "network-only");
      });

      bench("urql(vue)", async () => {
        return await runScenario("urql", "network-only");
      });

      bench("relay(react)", async () => {
        return await runScenario("relay", "network-only");
        });
  });
  /*
    describe("cache-first", () => {
      bench("cachebay(vue)", async () => {
        return await runScenario("cachebay", "cache-first");
      });

      bench("apollo(vue)", async () => {
        return await runScenario("apollo", "cache-first");
      });

      bench("urql(vue)", async () => {
        return await runScenario("urql", "cache-first");
      });

      bench("relay(react)", async () => {
        return await runScenario("relay", "cache-first");
      });
    });

    describe("cache-and-network", () => {

      bench("cachebay(vue)", async () => {
        return await runScenario("cachebay", "cache-and-network");
      }, {
        teardown() {
          // console.log('Metrics');
          // console.log(JSON.stringify(metrics, null, 2));
        }
      });

      bench("apollo(vue)", async () => {
        return await runScenario("apollo", "cache-and-network");
      });

      bench("urql(vue)", async () => {
        return await runScenario("urql", "cache-and-network");
      });

      bench("relay(react)", async () => {
        return await runScenario("relay", "cache-and-network");
      });
      }); */
});
