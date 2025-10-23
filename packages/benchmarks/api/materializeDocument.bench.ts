// perf/readQuery-vs-apollo.bench.ts
import { bench, group, run, summary } from "mitata";

// ---- cachebay ----
import { createCachebay as createCachebayClient } from "../../cachebay/src/core/client";

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
const USERS_TOTAL = 500;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);
const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

summary(() => {
  group("materializeDocument", () => {
    bench(`cachebay.materializeDocument:canonical(${label})`, function* () {
      yield {
        [0]() {
          const cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });

            cache.__internals.documents.materializeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              canonical: true,
            });
          }

          return cache;
        },
        bench(cache) {
          const res = cache.__internals.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            canonical: true,
            fingerprint: false,
          });
          sinkObj(res.data);
        },
      };
    });

    bench(`cachebay.materializeDocument:canonical:fingerprint(${label})`, function* () {
      yield {
        [0]() {
          const cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });

            cache.__internals.documents.materializeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              canonical: true,
              fingerprint: true,
            });
          }

          return cache;
        },
        bench(cache) {
          const res = cache.__internals.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            canonical: true,
          });
          sinkObj(res.data);
        },
      };
    });

    bench(`apollo.readQuery(${label})`, function* () {
      yield {
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
        bench(cache) {
          const res = cache.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
          sinkObj(res);
        },
      };
    });

    bench(`relay.lookup(${label})`, function* () {
      yield {
        [0]() {
          const env = createRelayEnvironment();
          for (let i = 0; i < pages.length; i++) {
            const op = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, pages[i].vars);
            env.commitPayload(op, pages[i].data);
          }
          return env;
        },
        bench(env) {
          const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
          const r = env.lookup(operation.fragment);
          sinkObj(r.data);
        },
      };
    });
  });
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;

// Run benchmarks
await run();
