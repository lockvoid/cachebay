// perf/readQuery-vs-apollo.bench.ts
import { bench, describe } from "vitest";

// ---- cachebay ----
import { createCache } from "../../villus-cachebay/src/core/internals";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

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
describe("readQuery – COLD paths", () => {
  const TIME = 3000;

  // Cachebay: readQuery:canonical:cold (new instance)
  {
    let snapshot: any;
    bench(
      `cachebay.readQuery:canonical:cold(${label})`,
      () => {
        const cache = createCachebay();
        cache.hydrate(snapshot);
        const res = cache.readQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
        });
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          const seed = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            seed.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          snapshot = seed.dehydrate();
        },
      }
    );
  }

  // Cachebay: readQuery:strict:cold (new instance)
  {
    let snapshot: any;
    bench(
      `cachebay.readQuery:strict:cold(${label})`,
      () => {
        const cache = createCachebay();
        cache.hydrate(snapshot);
        const res = cache.readQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "strict",
        });
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          const seed = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            seed.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          snapshot = seed.dehydrate();
        },
      }
    );
  }

  // Apollo: readQuery:cold (new instance + restore snapshot)
  {
    let snapshot: any;
    bench(
      `apollo.readQuery:cold(newInstance+restore)(${label})`,
      () => {
        const c = createApolloCache(false);
        c.restore(snapshot);
        const r = c.readQuery({
          query: APOLLO_QUERY,
          variables: { first: PAGE_SIZE, after: null },
        });
        sinkObj(r);
      },
      {
        time: TIME,
        setup() {
          const seed = createApolloCache(false);
          for (let i = 0; i < pages.length; i++) {
            seed.writeQuery({
              query: APOLLO_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          snapshot = seed.extract(true);
        },
      }
    );
  }
});

// -----------------------------------------------------------------------------
// Hot paths
// -----------------------------------------------------------------------------
describe("readQuery – HOT paths", () => {
  const TIME = 3000;

  // Cachebay: readQuery:canonical:hot
  {
    let cache: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.readQuery:canonical:hot(${label})`,
      () => {
        const res = cache.readQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
        });
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm
          cache.readQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "canonical",
          });
        },
      }
    );
  }

  // Cachebay: readQuery:strict:hot
  {
    let cache: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.readQuery:strict:hot(${label})`,
      () => {
        const res = cache.readQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "strict",
        });
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm
          cache.readQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "strict",
          });
        },
      }
    );
  }

  // Apollo: readQuery:hot (resultCaching=false)
  {
    let apollo: ReturnType<typeof createApolloCache>;
    bench(
      `apollo.readQuery:hot(${label})`,
      () => {
        const r = apollo.readQuery({
          query: APOLLO_QUERY,
          variables: { first: PAGE_SIZE, after: null },
        });
        sinkObj(r);
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache(false);
          for (let i = 0; i < pages.length; i++) {
            apollo.writeQuery({
              query: APOLLO_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
        },
      }
    );
  }

  // Apollo: readQuery:hot (resultCaching=true)
  {
    let apollo: ReturnType<typeof createApolloCache>;
    bench(
      `apollo.readQuery:hot(resultCaching)(${label})`,
      () => {
        const r = apollo.readQuery({
          query: APOLLO_QUERY,
          variables: { first: PAGE_SIZE, after: null },
        });
        sinkObj(r);
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache(true);
          for (let i = 0; i < pages.length; i++) {
            apollo.writeQuery({
              query: APOLLO_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
        },
      }
    );
  }
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;
