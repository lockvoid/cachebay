// api/watchQuery.bench.ts
import { bench, describe } from "vitest";

// ---- cachebay ----
import { createCache } from "villus-cachebay/src/core";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- shared (same helpers you already use) ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

// ---- gql helpers just for the tiny "user by id" update ----
import { parse } from "graphql";

// We update a single user entity so both caches re-emit the connection view.
const CACHEBAY_USER_QUERY = parse(/* GraphQL */ `
  query UserEmail($id: ID!) {
    user(id: $id) { __typename id email }
  }
`);
const APOLLO_USER_QUERY = CACHEBAY_USER_QUERY;

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

// small helper to seed caches with all pages
function seedCachebayAllPages(cache: ReturnType<typeof createCachebay>) {
  for (let i = 0; i < pages.length; i++) {
    cache.writeQuery({
      query: CACHEBAY_QUERY,
      variables: pages[i].vars,
      data: pages[i].data,
    });
  }
}
function seedApolloAllPages(cache: InMemoryCache) {
  for (let i = 0; i < pages.length; i++) {
    cache.writeQuery({
      query: APOLLO_QUERY,
      variables: pages[i].vars,
      data: pages[i].data,
    });
  }
}

// -----------------------------------------------------------------------------
/** Initial subscription (subscribe + initial emit) */
// -----------------------------------------------------------------------------
describe("watchQuery – INITIAL subscription", () => {
  const TIME = 3000;

  // Cachebay: initial:cold (new instance + hydrate)
  {
    let snapshot: any;
    bench(
      `cachebay.watchQuery:initial:cold(${label})`,
      () => {
        const cache = createCachebay();
        cache.hydrate(snapshot);
        const sub = cache.watchQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
          onData: (d) => sinkObj(d),
        });
        sub.unsubscribe();
      },
      {
        time: TIME,
        setup() {
          const seed = createCachebay();
          seedCachebayAllPages(seed);
          snapshot = seed.dehydrate();
        },
      }
    );
  }

  // Apollo: initial:cold (new instance + restore snapshot)
  {
    let snapshot: any;
    bench(
      `apollo.watch:initial:cold(newInstance+restore)(${label})`,
      () => {
        const c = createApolloCache(false);
        c.restore(snapshot);
        const unwatch = c.watch({
          query: APOLLO_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          optimistic: false,
          immediate: true, // fire initial diff synchronously
          callback: (diff) => sinkObj(diff.result),
        });
        unwatch();
      },
      {
        time: TIME,
        setup() {
          const seed = createApolloCache(false);
          seedApolloAllPages(seed);
          snapshot = seed.extract(true);
        },
      }
    );
  }

  // Cachebay: initial:hot (reuse instance)
  {
    let cache: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.watchQuery:initial:hot(${label})`,
      () => {
        const sub = cache.watchQuery({
          query: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
          onData: (d) => sinkObj(d),
        });
        sub.unsubscribe();
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          seedCachebayAllPages(cache);
          // warm one materialization (not strictly needed)
          cache.readQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "canonical",
          });
        },
      }
    );
  }

  // Apollo: initial:hot (reuse instance)
  {
    let apollo: InMemoryCache;
    bench(
      `apollo.watch:initial:hot(${label})`,
      () => {
        const unwatch = apollo.watch({
          query: APOLLO_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          optimistic: false,
          immediate: true,
          callback: (diff) => sinkObj(diff.result),
        });
        unwatch();
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache(false);
          seedApolloAllPages(apollo);
          apollo.readQuery({ query: APOLLO_QUERY, variables: { first: PAGE_SIZE, after: null } });
        },
      }
    );
  }
});

// -----------------------------------------------------------------------------
/** Reactive updates (write → broadcast → re-materialize → emit)
 *  We update User "u1" email back-and-forth so deps fire without growing data.
 */
// -----------------------------------------------------------------------------
describe("watchQuery – REACTIVE updates", () => {
  const TIME = 3000;

  // Cachebay reactive
  {
    let cache: ReturnType<typeof createCachebay>;
    let toggle = false;

    bench(
      `cachebay.watchQuery:reactive(${label})`,
      async () => {
        toggle = !toggle;
        const email = toggle ? "u1+updated@example.com" : "u1@example.com";

        cache.writeQuery({
          query: CACHEBAY_USER_QUERY,
          variables: { id: "u1" },
          data: { user: { __typename: "User", id: "u1", email } },
        });

        // watchQuery broadcasts via queueMicrotask; flush it
        await Promise.resolve();
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          seedCachebayAllPages(cache);

          // One watcher on the connection; skip initial emit to avoid bias
          cache.watchQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "canonical",
            skipInitialEmit: true,
            onData: (d) => sinkObj(d),
          });
        },
      }
    );
  }

  // Apollo reactive
  {
    let apollo: InMemoryCache;
    let toggle = false;

    bench(
      `apollo.watch:reactive(${label})`,
      () => {
        toggle = !toggle;
        const email = toggle ? "u1+updated@example.com" : "u1@example.com";

        apollo.writeQuery({
          query: APOLLO_USER_QUERY,
          variables: { id: "u1" },
          data: { user: { __typename: "User", id: "u1", email } },
        });
        // apollo watchers broadcast synchronously
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache(false);
          seedApolloAllPages(apollo);

          // One watcher on the connection; immediate false to avoid first diff here
          apollo.watch({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            optimistic: false,
            immediate: false,
            callback: (diff) => sinkObj(diff.result),
          });
        },
      }
    );
  }
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;
