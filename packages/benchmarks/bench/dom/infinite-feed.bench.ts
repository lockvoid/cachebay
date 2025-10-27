import Table from "cli-table3";
import { bench, describe, afterAll } from "vitest";
import { createInfiniteFeedYoga } from "../../src/server/infinite-feed-server";
import { createReactRelayNestedApp } from "../../src/ui/react-relay-infinite-feed-app";
import { createVueApolloNestedApp } from "../../src/ui/vue-apollo-infinite-feed-app";
import { createVueCachebayNestedApp } from "../../src/ui/vue-cachebay-infinite-feed-app";
import { createVueUrqlNestedApp } from "../../src/ui/vue-urql-infinite-feed-app";
import { generateInfiniteFeedDataset } from "../../src/utils/seed-infinite-feed";

const PAGES_TO_LOAD = 2;

const BENCH_OPTIONS = {
  iterations: 10,
  warmupIterations: 2,
  throws: true,
  warmupTime: 0,
  time: 0,
};

const sharedDataset = generateInfiniteFeedDataset();
const yoga = createInfiniteFeedYoga(sharedDataset, 0);

const runScenario = async (
  appType: "cachebay" | "apollo" | "urql" | "relay",
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network",
) => {
  let app;

  switch (appType) {
    case "cachebay":
      app = createVueCachebayNestedApp(cachePolicy || "network-only", yoga);
      break;
    case "apollo":
      app = createVueApolloNestedApp(cachePolicy || "network-only", yoga);
      break;
    case "urql":
      app = createVueUrqlNestedApp(cachePolicy || "network-only", yoga);
      break;
    case "relay":
      app = createReactRelayNestedApp(cachePolicy || "network-only", yoga);
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

      return await runScenario("cachebay", "network-only");
    }, BENCH_OPTIONS);

    bench("apollo(vue, network-only)", async () => {
      globalThis.apollo.iteration++;

      return await runScenario("apollo", "network-only");
    }, BENCH_OPTIONS);

    bench("urql(vue, network-only)", async () => {
      globalThis.urql.iteration++;

      return await runScenario("urql", "network-only");
    }, BENCH_OPTIONS);

    bench("relay(react, network-only)", async () => {
      globalThis.relay.iteration++;

      return await runScenario("relay", "network-only");
    }, BENCH_OPTIONS);
  });

  describe("cache-first", () => {
    bench("cachebay(vue, cache-first)", async () => {
      globalThis.cachebay.iteration++;

      return await runScenario("cachebay", "cache-first");
    }, BENCH_OPTIONS);

    bench("apollo(vue, cache-first)", async () => {
      globalThis.apollo.iteration++;

      return await runScenario("apollo", "cache-first");
    }, BENCH_OPTIONS);

    bench("urql(vue, cache-first)", async () => {
      globalThis.urql.iteration++;

      return await runScenario("urql", "cache-first");
    }, BENCH_OPTIONS);

    bench("relay(react, cache-first)", async () => {
      globalThis.relay.iteration++;

      return await runScenario("relay", "cache-first");
    }, BENCH_OPTIONS);
  });

  describe("cache-and-network", () => {
    bench("cachebay(vue, cache-and-network)", async () => {
      globalThis.cachebay.iteration++;

      return await runScenario("cachebay", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("apollo(vue, cache-and-network)", async () => {
      globalThis.apollo.iteration++;

      return await runScenario("apollo", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("urql(vue, cache-and-network)", async () => {
      globalThis.urql.iteration++;

      return await runScenario("urql", "cache-and-network");
    }, BENCH_OPTIONS);

    bench("relay(react, cache-and-network)", async () => {
      globalThis.relay.iteration++;

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
