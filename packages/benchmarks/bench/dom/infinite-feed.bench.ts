import Table from "cli-table3";
import { bench, describe, afterAll } from "vitest";
import { createInfiniteFeedYoga } from "../../src/server/infinite-feed-server";
import { createReactRelayNestedApp } from "../../src/ui/react-relay-infinite-feed-app";
import { createVueApolloNestedApp } from "../../src/ui/vue-apollo-infinite-feed-app";
import { createVueCachebayNestedApp } from "../../src/ui/vue-cachebay-infinite-feed-app";
import { createVueUrqlNestedApp } from "../../src/ui/vue-urql-infinite-feed-app";
import { makeNestedDataset } from "../../src/utils/seed-infinite-feed";

const DEBUG = true;
const PAGES_TO_LOAD = 2;

const BENCH_OPTIONS = {
  iterations: 10,
  warmupIterations: 2,
  throws: true,
  warmupTime: 0,
  time: 0,
};

const serverUrl = process.env.BENCH_SERVER_URL || "http://127.0.0.1:4001/graphql";

const sharedDataset = makeNestedDataset();
const sharedYoga = createInfiniteFeedYoga(sharedDataset, 0);

if (DEBUG) {
  console.log(`Using server at: ${serverUrl}`);
  console.log(`Shared dataset created with ${sharedDataset.users.size} users`);
}

const runScenario = async (
  appType: "cachebay" | "apollo" | "urql" | "relay",
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network",
) => {
  let app;

  switch (appType) {
    case "cachebay":
      app = createVueCachebayNestedApp(cachePolicy || "network-only", sharedYoga);
      break;
    case "apollo":
      app = createVueApolloNestedApp(cachePolicy || "network-only", sharedYoga);
      break;
    case "urql":
      app = createVueUrqlNestedApp(serverUrl, cachePolicy || "network-only", sharedYoga);
      break;
    case "relay":
      app = createReactRelayNestedApp(serverUrl, cachePolicy || "network-only", DEBUG, sharedYoga);
      break;
    default:
      throw new Error(`Unknown app type: ${appType}`);
  }

  app.mount();

  for (let i = 0; i < PAGES_TO_LOAD - 1; i++) {
    // console.log(`Loading page ${i + 1} of ${PAGES_TO_LOAD - 1}`);

    const isLastPage = i === PAGES_TO_LOAD - 2;

    await app.loadNextPage(isLastPage);
  }

  app.unmount();
};

describe("DOM Nested query (happy-dom): interfaces, custom keys, nested pagination", () => {
  globalThis.cachebay = { iteration: 0, name: "cachebay", totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 };
  globalThis.apollo = { iteration: 0, name: "apollo", totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 };
  globalThis.urql = { iteration: 0, name: "urql", totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 };
  globalThis.relay = { iteration: 0, name: "relay", totalRenderTime: 0, totalNetworkTime: 0, totalEntities: 0 };

  describe("network-only", async () => {
    bench("cachebay(vue, network-only)", async () => {
      globalThis.cachebay.iteration++;

      if (DEBUG) {
        console.log("cachebay(vue) network-only iteration", globalThis.cachebay.iteration);
      }

      return await runScenario("cachebay", "network-only");
    }, BENCH_OPTIONS);

    bench("apollo(vue, network-only)", async () => {
      globalThis.apollo.iteration++;

      if (DEBUG) {
        console.log("apollo(vue) network-only iteration", globalThis.apollo.iteration);
      }

      return await runScenario("apollo", "network-only");
    }, BENCH_OPTIONS);

    bench("urql(vue, network-only)", async () => {
      globalThis.urql.iteration++;
      if (DEBUG) {
        console.log("urql(vue) network-only iteration", globalThis.urql.iteration);
      }

      return await runScenario("urql", "network-only");
    }, BENCH_OPTIONS);

    bench("relay(react, network-only)", async () => {
      globalThis.relay.iteration++;
      if (DEBUG) {
        console.log("relay(react) network-only iteration", globalThis.relay.iteration);
      }

      return await runScenario("relay", "network-only");
    }, BENCH_OPTIONS);
  });

  describe("cache-first", () => {
    bench("cachebay(vue, cache-first)", async () => {
      globalThis.cachebay.iteration++;
      if (DEBUG) {
        console.log("cachebay(vue) cache-first iteration", globalThis.cachebay.iteration);
      }
      return await runScenario("cachebay", "cache-first");
    }, BENCH_OPTIONS);

    bench("apollo(vue, cache-first)", async () => {
      globalThis.apollo.iteration++;
      if (DEBUG) {
        console.log("apollo(vue) cache-first iteration", globalThis.apollo.iteration);
      }
      return await runScenario("apollo", "cache-first");
    }, BENCH_OPTIONS);

    bench("urql(vue, cache-first)", async () => {
      globalThis.urql.iteration++;
      if (DEBUG) {
        console.log("urql(vue) cache-first iteration", globalThis.urql.iteration);
      }
      return await runScenario("urql", "cache-first");
    }, BENCH_OPTIONS);

    bench("relay(react, cache-first)", async () => {
      globalThis.relay.iteration++;
      if (DEBUG) {
        console.log("relay(react) cache-first iteration", globalThis.relay.iteration);
      }
      return await runScenario("relay", "cache-first");
    }, BENCH_OPTIONS);
  });

  describe("cache-and-network", () => {
    bench("cachebay(vue, cache-and-network)", async () => {
      globalThis.cachebay.iteration++;
      if (DEBUG) {
        console.log("cachebay(vue) cache-and-network iteration", globalThis.cachebay.iteration);
      }
      return await runScenario("cachebay", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("apollo(vue, cache-and-network)", async () => {
      globalThis.apollo.iteration++;
      if (DEBUG) {
        console.log("apollo(vue) cache-and-network iteration", globalThis.apollo.iteration);
      }
      return await runScenario("apollo", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("urql(vue, cache-and-network)", async () => {
      globalThis.urql.iteration++;
      if (DEBUG) {
        console.log("urql(vue) cache-and-network iteration", globalThis.urql.iteration);
      }
      return await runScenario("urql", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("relay(react, cache-and-network)", async () => {
      globalThis.relay.iteration++;
      if (DEBUG) {
        console.log("relay(react) cache-and-network iteration", globalThis.relay.iteration);
      }
      return await runScenario("relay", "cache-and-network");
    }, BENCH_OPTIONS);
  });
});

afterAll(() => {
  const table = new Table({
    head: Object.keys(globalThis.cachebay),
  });

  table.push(Object.values(globalThis.cachebay));
  table.push(Object.values(globalThis.apollo));
  table.push(Object.values(globalThis.urql));
  table.push(Object.values(globalThis.relay));

  setTimeout(() => {
    console.log(table.toString());
  });
});
