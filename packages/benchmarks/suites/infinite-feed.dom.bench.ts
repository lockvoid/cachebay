
import { bench, describe, beforeAll, afterAll } from "vitest";
import { startServer } from "../src/server/schema";
import { createReactRelayApp } from "../src/ui/react-relay-app";
import { createVueApolloApp } from "../src/ui/vue-apollo-app";
import { createVueCachebayApp } from "../src/ui/vue-cachebay-app";
import { createVueUrqlApp } from "../src/ui/vue-urql-app";
import { makeDataset } from "../src/utils/seed";

const PAGE_SIZE = 50;
const EXTRA_PAGES = 100;
const TOTAL_ROWS = PAGE_SIZE * (EXTRA_PAGES + 2);

let serverUrl: string;
let stopServer: () => Promise<void>;

beforeAll(async () => {
  const dataset = makeDataset(TOTAL_ROWS, 4242);
  const server = await startServer(dataset, { artificialDelayMs: 20 });
  serverUrl = server.url;
  stopServer = server.stop;
});

afterAll(async () => {
  await stopServer?.();
});

async function runScenario(appType: "cachebay" | "apollo" | "urql") {
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

    const pageTimes: number[] = [];

    // Load initial page + extra pages
    for (let i = 0; i < 1 + EXTRA_PAGES; i++) {
      try {
        const pageStart = performance.now();
        await app.loadNextPage();
        const pageEnd = performance.now();

        pageTimes.push(pageEnd - pageStart);
      } catch (error) {
        console.error(`Error loading page ${i + 1}:`, error);
      }
    }

    const totalRenderTime = app.getTotalRenderTime();
    const totalPageTime = pageTimes.reduce((a, b) => a + b, 0);

    //// eslint-disable-next-line no-console
    //console.log(`\n[${appType}] page load ms:`, pageTimes.map(n => n.toFixed(1)).join(', '), '| total:', totalPageTime.toFixed(1));
    //// eslint-disable-next-line no-console
    //console.log(`[${appType}] render-only ms:`, totalRenderTime.toFixed(1), '| nodes:', app.getCount());

    // Return render-only total as the DOM bench metric
    return totalRenderTime;
  } catch (error) {
    console.error(`Error running ${appType} scenario:`, error);
  }
}

describe("DOM Infinite feed (happy-dom): Vue apps with useQuery", () => {
  bench("cachebay(vue)", async () => {
    return await runScenario("cachebay");
  });

  bench("apollo(vue)", async () => {
    return await runScenario("apollo");
  });

  bench("urql(vue)", async () => {
    return await runScenario("urql");
  });

  bench("relay(react)", async () => {
    return await runScenario("relay");
  });
});
