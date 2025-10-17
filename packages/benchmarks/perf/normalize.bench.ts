// test/perf/normalize-vs-apollo-relay.bench.ts
import { bench, describe } from "vitest";

// ---- cachebay ----
import { createGraph } from "../../villus-cachebay/src/core/graph";
import { createPlanner } from "../../villus-cachebay/src/core/planner";
import { createCanonical } from "../../villus-cachebay/src/core/canonical";
import { createOptimistic } from "../../villus-cachebay/src/core/optimistic";
import { createDocuments } from "../../villus-cachebay/src/core/documents";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- shared ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

process.env.NODE_ENV = "production";

// -----------------------------------------------------------------------------
// Rigs
// -----------------------------------------------------------------------------
function createCachebay() {
  const graph = createGraph({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
  const planner = createPlanner();
  const optimistic = createOptimistic({ graph });
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, planner, canonical });
  return { graph, planner, documents };
}

function createApolloCache() {
  return new InMemoryCache({
    // parity with your materialize benches (disables apollo’s result memo)
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

// -----------------------------------------------------------------------------
// Benches
// -----------------------------------------------------------------------------
const TIME = 1;
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;

describe("normalize – Cachebay vs Apollo (paginated)", () => {
  const allUsers = makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 });
  Object.freeze(allUsers);

  const pages = buildPages(allUsers, PAGE_SIZE);
  const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

  // Cachebay: COLD — new instance per iteration, normalize ALL pages
  bench(
    `cachebay.normalize:cold(${label})`,
    () => {
      const cb = createCachebay();
      // Optional: exclude planning from normalization cost — warm plan once
      cb.planner.getPlan(CACHEBAY_QUERY);

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        cb.documents.normalizeDocument({
          document: CACHEBAY_QUERY,
          variables: p.vars,
          data: p.data,
        });
      }
    },
    { time: TIME }
  );

  // Cachebay: HOT — pre-seeded once in setup, then normalize ALL pages again
  {
    let cb: ReturnType<typeof createCachebay>;
    bench(
      `cachebay.normalize:hot(${label})`,
      () => {
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          cb.documents.normalizeDocument({
            document: CACHEBAY_QUERY,
            variables: p.vars,
            data: p.data,
          });
        }
      },
      {
        time: TIME,
        setup() {
          cb = createCachebay();
          cb.planner.getPlan(CACHEBAY_QUERY); // warm once
          // pre-seed with all pages
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            cb.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
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
});
