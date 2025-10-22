// perf/writeQuery-vs-apollo.bench.ts
import { bench, group, run, summary } from "mitata";

// ---- cachebay ----
import { createCachebay as createCachebayClient } from "../../villus-cachebay/src/core/client";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- relay ----
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import RelayWriteQuery from "../src/__generated__/relayWriteQueryDefRelayWriteQuery.graphql";

// ---- shared ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

// sink to force result consumption
let __sink = 0;
const sinkWrite = () => { __sink ^= 1; };

// -----------------------------------------------------------------------------
// Rigs
// -----------------------------------------------------------------------------
function createCachebay() {
  return createCachebayClient({
    transport: {
      http: async () => ({ data: {} }), // dummy transport for benchmarks
    },
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
}

function createApolloCache() {
  return new InMemoryCache({
    // parity with normalize benches (disables apollo's result memo)
    resultCaching: false,
    typePolicies: {
      Query: {
        fields: {
          users: relayStylePagination(), // default relay merge
        },
      },
      User: {
        keyFields: ["id"],
        fields: {
          posts: relayStylePagination(),
        },
      },
      Post: {
        keyFields: ["id"],
        fields: {
          comments: relayStylePagination(),
        },
      },
      Comment: { keyFields: ["id"] },
    },
  });
}

function createRelayEnvironment() {
  return new Environment({
    network: Network.create(() => Promise.resolve({ data: {} })),
    store: new Store(new RecordSource()),
  });
}

// -----------------------------------------------------------------------------
// Shared data
// -----------------------------------------------------------------------------
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);
const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

// -----------------------------------------------------------------------------
// Paginated writes
// -----------------------------------------------------------------------------
summary(() => {
  group("writeQuery – Paginated (COLD)", () => {

    // Cachebay: COLD — new instance per iteration, write ALL pages
    bench(`cachebay.writeQuery:cold(${label})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();

          cachebay.__internals.planner.getPlan(CACHEBAY_QUERY)

          return cachebay;
        },
        bench(cache) {
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: p.vars,
              data: p.data,
            });
          }
          sinkWrite();
        },
      };
    });

    // Apollo: COLD — new cache per iteration, write ALL pages
    bench(`apollo.writeQuery:cold(${label})`, function* () {
      yield {
        [0]() {
          return createApolloCache();
        },
        bench(apollo) {
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            apollo.writeQuery({
              broadcast: false,
              query: APOLLO_QUERY,
              variables: p.vars,
              data: p.data,
            });
          }
          sinkWrite();
        },
      };
    });

    // Relay: COLD — new environment per iteration, write ALL pages
    bench(`relay.commitPayload:cold(${label})`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        bench(relay) {
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
            relay.commitPayload(operation, p.data);
          }
          sinkWrite();
        },
      };
    });
  });
});

summary(() => {
  group("writeQuery – Paginated (HOT)", () => {
    // Cachebay: HOT — pre-seeded, write ALL pages again
    const cache1 = createCachebay();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      cache1.writeQuery({
        query: CACHEBAY_QUERY,
        variables: p.vars,
        data: p.data,
      });
    }

    bench(`cachebay.writeQuery:hot(${label})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        cache1.writeQuery({
          query: CACHEBAY_QUERY,
          variables: p.vars,
          data: p.data,
        });
      }
      sinkWrite();
    });

    // Apollo: HOT — pre-seeded, write ALL pages again
    const apollo1 = createApolloCache();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      apollo1.writeQuery({
        broadcast: false,
        query: APOLLO_QUERY,
        variables: p.vars,
        data: p.data,
      });
    }

    bench(`apollo.writeQuery:hot(${label})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        apollo1.writeQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: p.vars,
          data: p.data,
        });
      }
      sinkWrite();
    });

    // Relay: HOT — pre-seeded, write ALL pages again
    const relay1 = createRelayEnvironment();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
      relay1.commitPayload(operation, p.data);
    }

    bench(`relay.commitPayload:hot(${label})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
        relay1.commitPayload(operation, p.data);
      }
      sinkWrite();
    });
  });
});

// -----------------------------------------------------------------------------
// Single-page writes
// -----------------------------------------------------------------------------
const USERS_PER_PAGE = 10;
const singlePage = Object.freeze(makeResponse({ users: USERS_PER_PAGE, posts: 5, comments: 3 }));

summary(() => {
  group("writeQuery – Single page (COLD)", () => {

    // Cachebay: write single page (cold)
    bench(`cachebay.writeQuery:single-page:cold(${USERS_PER_PAGE} users)`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();
          // Warm up: compile the plan
          cachebay.__internals.planner.getPlan(CACHEBAY_QUERY);
          return cachebay;
        },
        bench(cache) {
          cache.writeQuery({
            query: CACHEBAY_QUERY,
            variables: { first: USERS_PER_PAGE, after: null },
            data: singlePage,
          });
          sinkWrite();
        },
      };
    });

    // Apollo: write single page (cold)
    bench(`apollo.writeQuery:single-page:cold(${USERS_PER_PAGE} users)`, function* () {
      yield {
        [0]() {
          return createApolloCache();
        },
        bench(apollo) {
          apollo.writeQuery({
            broadcast: false,
            query: APOLLO_QUERY,
            variables: { first: USERS_PER_PAGE, after: null },
            data: singlePage,
          });
          sinkWrite();
        },
      };
    });

    // Relay: write single page (cold)
    bench(`relay.commitPayload:single-page:cold(${USERS_PER_PAGE} users)`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        bench(relay) {
          const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PER_PAGE, after: null });
          relay.commitPayload(operation, singlePage);
          sinkWrite();
        },
      };
    });
  });
});

summary(() => {
  group("writeQuery – Single page (HOT)", () => {
    // Cachebay: write single page (hot)
    const cache2 = createCachebay();
    cache2.writeQuery({
      query: CACHEBAY_QUERY,
      variables: { first: USERS_PER_PAGE, after: null },
      data: singlePage,
    });

    bench(`cachebay.writeQuery:single-page:hot(${USERS_PER_PAGE} users)`, () => {
      cache2.writeQuery({
        query: CACHEBAY_QUERY,
        variables: { first: USERS_PER_PAGE, after: null },
        data: singlePage,
      });
      sinkWrite();
    });

    // Apollo: write single page (hot)
    const apollo2 = createApolloCache();
    apollo2.writeQuery({
      broadcast: false,
      query: APOLLO_QUERY,
      variables: { first: USERS_PER_PAGE, after: null },
      data: singlePage,
    });

    bench(`apollo.writeQuery:single-page:hot(${USERS_PER_PAGE} users)`, () => {
      apollo2.writeQuery({
        broadcast: false,
        query: APOLLO_QUERY,
        variables: { first: USERS_PER_PAGE, after: null },
        data: singlePage,
      });
      sinkWrite();
    });

    // Relay: write single page (hot)
    const relay2 = createRelayEnvironment();
    const warmOp2 = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PER_PAGE, after: null });
    relay2.commitPayload(warmOp2, singlePage);

    bench(`relay.commitPayload:single-page:hot(${USERS_PER_PAGE} users)`, () => {
      const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PER_PAGE, after: null });
      relay2.commitPayload(operation, singlePage);
      sinkWrite();
    });
  });
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;

// Run benchmarks
await run();
