// perf/writeQuery-vs-apollo.bench.ts
import { bench, describe } from "vitest";

// ---- cachebay ----
import { createCache } from "../../villus-cachebay/src/core/internals";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- relay ----
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { createOperationDescriptor, getRequest } from "relay-runtime";
import { RelayWriteQuery } from "../src/relayWriteQueryDef";

// ---- shared ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

process.env.NODE_ENV = "production";

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
// Benches
// -----------------------------------------------------------------------------
const TIME = 1;
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;

describe("writeQuery – Cachebay vs Apollo (paginated)", () => {
  const allUsers = makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 });
  Object.freeze(allUsers);

  const pages = buildPages(allUsers, PAGE_SIZE);
  const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

  // Cachebay: COLD — new instance per iteration, write ALL pages
  bench(
    `cachebay.writeQuery:cold(${label})`,
    () => {
      const cache = createCachebay();

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        cache.writeQuery({
          query: CACHEBAY_QUERY,
          variables: p.vars,
          data: p.data,
        });
      }
    },
    { time: TIME }
  );

  // Cachebay: HOT — pre-seeded once in setup, then write ALL pages again
  {
    let cache: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.writeQuery:hot(${label})`,
      () => {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          cache.writeQuery({
            query: CACHEBAY_QUERY,
            variables: p.vars,
            data: p.data,
          });
        }
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          // pre-seed with all pages
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: p.vars,
              data: p.data,
            });
          }
        },
      }
    );
  }

  // Apollo: COLD — new cache per iteration, write ALL pages
  bench(
    `apollo.writeQuery:cold(${label})`,
    () => {
      const apollo = createApolloCache();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        apollo.writeQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: p.vars,
          data: p.data,
        });
      }
    },
    { time: TIME }
  );

  // Apollo: HOT — pre-seeded once in setup, then write ALL pages again
  {
    let apollo: ReturnType<typeof createApolloCache>;
    bench(
      `apollo.writeQuery:hot(${label})`,
      () => {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          apollo.writeQuery({
            broadcast: false,
            query: APOLLO_QUERY,
            variables: p.vars,
            data: p.data,
          });
        }
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache();
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            apollo.writeQuery({
              broadcast: false,
              query: APOLLO_QUERY,
              variables: p.vars,
              data: p.data,
            });
          }
        },
      }
    );
  }

  // Relay: COLD — new environment per iteration, write ALL pages
  bench(
    `relay.commitPayload:cold(${label})`,
    () => {
      const relay = createRelayEnvironment();
      const request = getRequest(RelayWriteQuery);

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const operation = createOperationDescriptor(request, p.vars);
        relay.commitPayload(operation, p.data);
      }
    },
    { time: TIME }
  );

  // Relay: HOT — pre-seeded once in setup, then write ALL pages again
  {
    let relay: ReturnType<typeof createRelayEnvironment>;
    let request: ReturnType<typeof getRequest>;
    bench(
      `relay.commitPayload:hot(${label})`,
      () => {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          const operation = createOperationDescriptor(request, p.vars);
          relay.commitPayload(operation, p.data);
        }
      },
      {
        time: TIME,
        setup() {
          relay = createRelayEnvironment();
          request = getRequest(RelayWriteQuery);
          // pre-seed with all pages
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const operation = createOperationDescriptor(request, p.vars);
            relay.commitPayload(operation, p.data);
          }
        },
      }
    );
  }
});

// -----------------------------------------------------------------------------
// Single-page write benchmarks (more granular)
// -----------------------------------------------------------------------------
describe("writeQuery – Single page writes", () => {
  const TIME = 3000;
  const USERS_PER_PAGE = 10;
  const singlePage = makeResponse({ users: USERS_PER_PAGE, posts: 5, comments: 3 });
  Object.freeze(singlePage);

  // Cachebay: write single page (cold)
  bench(
    `cachebay.writeQuery:single-page:cold(${USERS_PER_PAGE} users)`,
    () => {
      const cache = createCachebay();
      cache.writeQuery({
        query: CACHEBAY_QUERY,
        variables: { first: USERS_PER_PAGE, after: null },
        data: singlePage,
      });
    },
    { time: TIME }
  );

  // Cachebay: write single page (hot)
  {
    let cache: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.writeQuery:single-page:hot(${USERS_PER_PAGE} users)`,
      () => {
        cache.writeQuery({
          query: CACHEBAY_QUERY,
          variables: { first: USERS_PER_PAGE, after: null },
          data: singlePage,
        });
      },
      {
        time: TIME,
        setup() {
          cache = createCachebay();
          // warm
          cache.writeQuery({
            query: CACHEBAY_QUERY,
            variables: { first: USERS_PER_PAGE, after: null },
            data: singlePage,
          });
        },
      }
    );
  }

  // Apollo: write single page (cold)
  bench(
    `apollo.writeQuery:single-page:cold(${USERS_PER_PAGE} users)`,
    () => {
      const apollo = createApolloCache();
      apollo.writeQuery({
        broadcast: false,
        query: APOLLO_QUERY,
        variables: { first: USERS_PER_PAGE, after: null },
        data: singlePage,
      });
    },
    { time: TIME }
  );

  // Apollo: write single page (hot)
  {
    let apollo: ReturnType<typeof createApolloCache>;
    bench(
      `apollo.writeQuery:single-page:hot(${USERS_PER_PAGE} users)`,
      () => {
        apollo.writeQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: { first: USERS_PER_PAGE, after: null },
          data: singlePage,
        });
      },
      {
        time: TIME,
        setup() {
          apollo = createApolloCache();
          // warm
          apollo.writeQuery({
            broadcast: false,
            query: APOLLO_QUERY,
            variables: { first: USERS_PER_PAGE, after: null },
            data: singlePage,
          });
        },
      }
    );
  }

  // Relay: write single page (cold)
  bench(
    `relay.commitPayload:single-page:cold(${USERS_PER_PAGE} users)`,
    () => {
      const relay = createRelayEnvironment();
      const request = getRequest(RelayWriteQuery);
      const operation = createOperationDescriptor(request, { first: USERS_PER_PAGE, after: null });
      relay.commitPayload(operation, singlePage);
    },
    { time: TIME }
  );

  // Relay: write single page (hot)
  {
    let relay: ReturnType<typeof createRelayEnvironment>;
    let request: ReturnType<typeof getRequest>;
    bench(
      `relay.commitPayload:single-page:hot(${USERS_PER_PAGE} users)`,
      () => {
        const operation = createOperationDescriptor(request, { first: USERS_PER_PAGE, after: null });
        relay.commitPayload(operation, singlePage);
      },
      {
        time: TIME,
        setup() {
          relay = createRelayEnvironment();
          request = getRequest(RelayWriteQuery);
          // warm
          const operation = createOperationDescriptor(request, { first: USERS_PER_PAGE, after: null });
          relay.commitPayload(operation, singlePage);
        },
      }
    );
  }
});
