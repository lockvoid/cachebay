import { bench, describe } from "vitest";
import { createReactRelayNestedApp } from "../src/ui/react-relay-nested-query-app";
import { createVueApolloNestedApp } from "../src/ui/vue-apollo-nested-query-app";
import { createVueCachebayNestedApp } from "../src/ui/vue-cachebay-nested-query-app";
import { createVueUrqlNestedApp } from "../src/ui/vue-urql-nested-query-app";
import Table from 'cli-table3';

const DEBUG = process.env.DEBUG === 'true';
const PAGES_TO_LOAD = 2; // 1000 users / 10 per page = 100 pages

const serverUrl = process.env.BENCH_SERVER_URL || 'http://127.0.0.1:4001/graphql';

if (DEBUG) {
  console.log(`Using server at: ${serverUrl}`);
}

const runScenario = async (
  appType: "cachebay" | "apollo" | "urql" | "relay",
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network"
) => {
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

    for (let i = 0; i < PAGES_TO_LOAD - 1; i++) {
      // console.log(`Loading page ${i + 1} of ${PAGES_TO_LOAD - 1}`);

      await app.loadNextPage();
    }

    app.unmount();
}

describe("DOM Nested query (happy-dom): interfaces, custom keys, nested pagination", () => {
  globalThis.cachebay = { iteration: 0, name: 'cachebay', totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 }
  globalThis.apollo = { iteration: 0, name: 'apollo', totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 }
  globalThis.urql = { iteration: 0, name: 'urql', totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 }

  describe("network-only", async () => {
   bench("cachebay(vue)", () => {
     globalThis.cachebay.iteration++;

     return runScenario("cachebay", "network-only");
   }, {
     iterations: 10,
     warmupIterations: 10,
     throws: true,
     time: 0,
     warmupTime: 0,
   });

   bench("apollo(vue)", async () => {
     globalThis.apollo.iteration++;

     return await runScenario("apollo", "network-only");
   }, {
     iterations: 10,
     warmupIterations: 10,
     throws: true,
     warmupTime: 0,
     time: 0,
   });

  // bench("urql(vue)", async () => {
  //   globalThis.urql.iteration++;
  //   return await runScenario("urql", "network-only");
  // }, {
  //   iterations: 10
  // });
 /*
      bench("relay(react)", async () => {
        return await runScenario("relay", "network-only");
        }); */
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

afterAll(() => {
  const table = new Table({
    head: Object.keys(globalThis.cachebay)
  });

  table.push(Object.values(globalThis.cachebay));
  table.push(Object.values(globalThis.apollo));
  table.push(Object.values(globalThis.urql));

  setTimeout(() => {
    console.log(table.toString())
  })
});
