// perf/readQuery-vs-apollo.bench.ts
import { bench, group, run, summary } from "mitata";

// ---- cachebay ----
import { createCache } from "villus-cachebay/src/core";

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
const sinkObj = (o: any) => { __sink ^= (o?.users?.edges?.length ?? 0) | 0; };

// -----------------------------------------------------------------------------
// Rigs
// -----------------------------------------------------------------------------

function createCachebay() {
  return createCache({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
}

function createApolloCache(resultCaching = false) {
  return new InMemoryCache({
    resultCaching,
    typePolicies: {
      Query: {
        fields: {
          users: relayStylePagination(),
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
const USERS_TOTAL = 100;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);
const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

// -----------------------------------------------------------------------------
// Cold paths
// -----------------------------------------------------------------------------
summary(() => {
  group("readQuery – COLD paths", () => {

    // Cachebay: readQuery:canonical:cold (new instance per iteration)
    bench(`cachebay.readQuery:canonical:cold(${label})`, function* () {
      yield {
        // Computed parameter: create fresh instance before each iteration (not timed)
        [0]() {
          const cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          return cache;
        },
        // Benchmark: only measure the read (timed)
        bench(cache) {
          const res = cache.readQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "canonical",
          });
          sinkObj(res.data);
        },
      };
    });

    // Cachebay: readQuery:strict:cold (new instance per iteration)
    bench(`cachebay.readQuery:strict:cold(${label})`, function* () {
      yield {
        // Computed parameter: create fresh instance before each iteration (not timed)
        [0]() {
          const cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          return cache;
        },
        // Benchmark: only measure the read (timed)
        bench(cache) {
          const res = cache.readQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "strict",
          });
          sinkObj(res.data);
        },
      };
    });

    // Apollo: readQuery:cold (new instance per iteration)
    bench(`apollo.readQuery:cold(${label})`, function* () {
      yield {
        // Computed parameter: create fresh instance before each iteration (not timed)
        [0]() {
          const cache = createApolloCache(false);
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: APOLLO_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          return cache;
        },
        // Benchmark: only measure the read (timed)
        bench(cache) {
          const r = cache.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
          sinkObj(r);
        },
      };
    });

    // Relay: lookup:cold (new environment per iteration)
    bench(`relay.lookup:cold(${label})`, function* () {
      yield {
        // Computed parameter: create fresh environment before each iteration (not timed)
        [0]() {
          const env = createRelayEnvironment();
          for (let i = 0; i < pages.length; i++) {
            const op = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, pages[i].vars);
            env.commitPayload(op, pages[i].data);
          }
          return env;
        },
        // Benchmark: only measure the read (timed)
        bench(env) {
          const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
          const r = env.lookup(operation.fragment);
          sinkObj(r.data);
        },
      };
    });
  });
});

// -----------------------------------------------------------------------------
// Hot paths
// -----------------------------------------------------------------------------
summary(() => {
  group("readQuery – HOT paths", () => {

    // Cachebay: readQuery:canonical:hot
    const cache1 = createCachebay();
    for (let i = 0; i < pages.length; i++) {
      cache1.writeQuery({
        query: CACHEBAY_QUERY,
        variables: pages[i].vars,
        data: pages[i].data,
      });
    }
    // warm
    cache1.readQuery({
      query: CACHEBAY_QUERY,
      variables: { first: PAGE_SIZE, after: null },
      decisionMode: "canonical",
    });

    bench(`cachebay.readQuery:canonical:hot(${label})`, () => {
      const res = cache1.readQuery({
        query: CACHEBAY_QUERY,
        variables: { first: PAGE_SIZE, after: null },
        decisionMode: "canonical",
      });
      sinkObj(res.data);
    });

    // Cachebay: readQuery:strict:hot
    const cache2 = createCachebay();
    for (let i = 0; i < pages.length; i++) {
      cache2.writeQuery({
        query: CACHEBAY_QUERY,
        variables: pages[i].vars,
        data: pages[i].data,
      });
    }
    // warm
    cache2.readQuery({
      query: CACHEBAY_QUERY,
      variables: { first: PAGE_SIZE, after: null },
      decisionMode: "strict",
    });

    bench(`cachebay.readQuery:strict:hot(${label})`, () => {
      const res = cache2.readQuery({
        query: CACHEBAY_QUERY,
        variables: { first: PAGE_SIZE, after: null },
        decisionMode: "strict",
      });
      sinkObj(res.data);
    });

    // Apollo: readQuery:hot (resultCaching=false)
    const apollo1 = createApolloCache(false);
    for (let i = 0; i < pages.length; i++) {
      apollo1.writeQuery({
        query: APOLLO_QUERY,
        variables: pages[i].vars,
        data: pages[i].data,
      });
    }
    // warm
    apollo1.readQuery({
      query: APOLLO_QUERY,
      variables: { first: PAGE_SIZE, after: null },
    });

    bench(`apollo.readQuery:hot(${label})`, () => {
      const r = apollo1.readQuery({
        query: APOLLO_QUERY,
        variables: { first: PAGE_SIZE, after: null },
      });
      sinkObj(r);
    });

    // Apollo: readQuery:hot (resultCaching=true)
    const apollo2 = createApolloCache(true);
    for (let i = 0; i < pages.length; i++) {
      apollo2.writeQuery({
        query: APOLLO_QUERY,
        variables: pages[i].vars,
        data: pages[i].data,
      });
    }
    // warm
    apollo2.readQuery({
      query: APOLLO_QUERY,
      variables: { first: PAGE_SIZE, after: null },
    });

    bench(`apollo.readQuery:hot(resultCaching)(${label})`, () => {
      const r = apollo2.readQuery({
        query: APOLLO_QUERY,
        variables: { first: PAGE_SIZE, after: null },
      });
      sinkObj(r);
    });

    // Relay: lookup:hot
    const relayEnv = createRelayEnvironment();
    for (let i = 0; i < pages.length; i++) {
      const op = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, pages[i].vars);
      relayEnv.commitPayload(op, pages[i].data);
    }
    // warm
    const warmOp = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
    relayEnv.lookup(warmOp.fragment);

    bench(`relay.lookup:hot(${label})`, () => {
      const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
      const r = relayEnv.lookup(operation.fragment);
      sinkObj(r.data);
    });
  });
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;

// Run benchmarks
await run();
