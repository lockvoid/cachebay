// perf/materialize-vs-apollo.bench.ts
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

// sink to force result consumption
let __sink = 0;
const sinkObj = (o: any) => { __sink ^= (o?.users?.edges?.length ?? 0) | 0; };

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

function createInstances(seed?: { graph?: ReturnType<typeof createGraph>; planner?: ReturnType<typeof createPlanner> }) {
  const graph = seed?.graph ?? createGraph({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
  const planner = seed?.planner ?? createPlanner();
  const optimistic = createOptimistic({ graph });
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, planner, canonical });
  return { graph, planner, documents };
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
// Benches
// -----------------------------------------------------------------------------

const TIME = 3000;
const USERS_TOTAL = 100;
const PAGE_SIZE = 10;

describe("materialize – Cachebay vs Apollo(readQuery)", () => {
  const allUsers = makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 });
  Object.freeze(allUsers);

  const pages = buildPages(allUsers, PAGE_SIZE);
  const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

  // ---------------- Cachebay: canonical:cold (LRU MISS; new instance) ----------------
  {
    let ctx: ReturnType<typeof createInstances>;

    bench(
      `cachebay.materialize:canonical:cold(${label})`,
      () => {
        const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });
        const res = documents.materializeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
        });
        if (res.status !== "FULFILLED") throw new Error("cachebay canonical cold -> MISSING");
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          ctx = createInstances();
          // Normalize all pages
          for (let i = 0; i < pages.length; i++) {
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
        },
      }
    );
  }

  // ---------------- Cachebay: strict:cold ----------------
  {
    let ctx: ReturnType<typeof createInstances>;

    bench(
      `cachebay.materialize:strict:cold(${label})`,
      () => {
        const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });
        const res = documents.materializeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "strict",
        });
        if (res.status !== "FULFILLED") throw new Error("cachebay strict cold -> MISSING");
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          ctx = createInstances();
          for (let i = 0; i < pages.length; i++) {
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
        },
      }
    );
  }

  // ---------------- Cachebay: canonical:hot (LRU HIT) ----------------
  {
    let ctx: ReturnType<typeof createInstances>;
    bench(
      `cachebay.materialize:canonical:hot(${label})`,
      () => {
        const res = ctx.documents.materializeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "canonical",
        });
        if (res.status !== "FULFILLED") throw new Error("cachebay canonical hot -> MISSING");
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          ctx = createInstances();
          for (let i = 0; i < pages.length; i++) {
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm LRU
          ctx.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "canonical",
          });
        },
      }
    );
  }

  // ---------------- Cachebay: strict:hot (LRU HIT) ----------------
  {
    let ctx: ReturnType<typeof createInstances>;
    bench(
      `cachebay.materialize:strict:hot(${label})`,
      () => {
        const res = ctx.documents.materializeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: PAGE_SIZE, after: null },
          decisionMode: "strict",
        });
        if (res.status !== "FULFILLED") throw new Error("cachebay strict hot -> MISSING");
        sinkObj(res.data);
      },
      {
        time: TIME,
        setup() {
          ctx = createInstances();
          for (let i = 0; i < pages.length; i++) {
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
          }
          // warm LRU
          ctx.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            decisionMode: "strict",
          });
        },
      }
    );
  }

  // ---------------- Apollo: readQuery:cold (reset result cache) ----------------
  {
    let apollo: ReturnType<typeof createApolloCache>;
    bench(
      `apollo.readQuery:cold(resetResultCache)(${label})`,
      () => {
        (apollo as any).resetResultCache?.();
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
        },
      }
    );
  }

  // ---------------- Apollo: readQuery:cold (new instance + restore snapshot) ----------------
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

  // ---------------- Apollo: readQuery:hot (resultCaching=false) ----------------
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
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
        },
      }
    );
  }

  // ---------------- Apollo: readQuery:hot (resultCaching=true) ----------------
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
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: PAGE_SIZE, after: null },
          });
        },
      }
    );
  }
});

// keep the sink visible so V8 can’t fully DCE it
(globalThis as any).__bench_sink = __sink;
