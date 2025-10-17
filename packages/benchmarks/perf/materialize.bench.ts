// perf/materialize-vs-apollo.bench.ts
import { bench, describe } from "vitest";
import { gql } from "graphql-tag";

// ---- cachebay bits ----
import { createGraph } from "../../villus-cachebay/src/core/graph";
import { createPlanner } from "../../villus-cachebay/src/core/planner";
import { createCanonical } from "../../villus-cachebay/src/core/canonical";
import { createOptimistic } from "../../villus-cachebay/src/core/optimistic";
import { createDocuments } from "../../villus-cachebay/src/core/documents";

// ---- apollo bits ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

process.env.NODE_ENV = "production";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function makeResponse({ posts = 1000, comments = 0 }: { posts: number; comments: number }) {
  return {
    __typename: "Query",
    user: {
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      posts: {
        __typename: "PostConnection",
        edges: Array.from({ length: posts }, (_, i) => ({
          __typename: "PostEdge",
          cursor: "p" + (i + 1),
          node: {
            __typename: "Post",
            id: String(i + 1),
            title: "Post " + (i + 1),
            comments: {
              __typename: "CommentConnection",
              edges: Array.from({ length: comments }, (_, j) => ({
                __typename: "CommentEdge",
                cursor: "c" + (j + 1),
                node: {
                  __typename: "Comment",
                  uuid: `c-${i + 1}-${j + 1}`,
                  text: `Comment ${j + 1} on Post ${i + 1}`,
                },
              })),
              pageInfo: { __typename: "PageInfo", hasNextPage: false, hasPreviousPage: false },
            },
          },
        })),
        pageInfo: { __typename: "PageInfo", hasNextPage: false, hasPreviousPage: false },
      },
    },
  };
}

const CACHEBAY_QUERY = gql`
  query Q($first: Int!, $commentsFirst: Int!, $__nonce: Int) {
    user {
      id
      email
      posts(first: $first) @connection(key: "posts") {
        edges {
          cursor
          node {
            id
            title
            comments(first: $commentsFirst) @connection(key: "comments") {
              edges {
                cursor
                node {
                  uuid
                  text
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
      }
    }
  }
`;

const APOLLO_QUERY = gql`
  query QApollo($first: Int!, $commentsFirst: Int!) {
    user {
      id
      email
      posts(first: $first) {
        edges {
          cursor
          node {
            id
            title
            comments(first: $commentsFirst) {
              edges {
                cursor
                node {
                  uuid
                  text
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
        }
      }
    }
  }
`;

// -----------------------------------------------------------------------------
// Rigs
// -----------------------------------------------------------------------------

function createCachebay() {
  const graph = createGraph({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.uuid ?? null,
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
      Comment: (o: any) => o.uuid ?? null,
    },
  });
  const planner = seed?.planner ?? createPlanner();
  const optimistic = createOptimistic({ graph });
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, planner, canonical });
  return { graph, planner, documents };
}

function createApolloCache() {
  return new InMemoryCache({
    typePolicies: {
      Query: { keyFields: ["__typename"] },
      User: { keyFields: ["id"], fields: { posts: relayStylePagination() } },
      Post: { keyFields: ["id"], fields: { comments: relayStylePagination() } },
      Comment: { keyFields: ["uuid"] },
    },
  });
}

// -----------------------------------------------------------------------------
// Benches
// -----------------------------------------------------------------------------

const TIME = 3000;
const VARIANTS = [{ posts: 1000, comments: 5 }];

describe("materialize – Cachebay vs Apollo(readQuery)", () => {
  for (const variant of VARIANTS) {
    const label = `posts=${variant.posts}, comments=${variant.comments}`;
    const data = makeResponse(variant);

    // ---------------- Cachebay: canonical:cold (LRU MISS via __nonce; keep same graph/planner) ----------------
    {
      let ctx: ReturnType<typeof createInstances>;
      let nonce = 0;

      bench(
        `cachebay.materialize:canonical:cold(${label})`,
        () => {
          const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });
          nonce++;
          documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments, __nonce: nonce },
            decisionMode: "canonical",
          });
        },
        {
          time: TIME,
          setup() {
            ctx = createInstances();
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
          },
        }
      );
    }

    // ---------------- Cachebay: strict:cold ----------------
    {
      let ctx: ReturnType<typeof createInstances>;
      let nonce = 0;

      bench(
        `cachebay.materialize:strict:cold(${label})`,
        () => {
          const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });
          nonce++;
          const d = documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments, __nonce: nonce },
            decisionMode: "strict",
          });
        },
        {
          time: TIME,
          setup() {
            ctx = createInstances();
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
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
          ctx.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
            decisionMode: "canonical",
          });
        },
        {
          time: TIME,
          setup() {
            ctx = createInstances();
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
            // warm LRU
            ctx.documents.materializeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
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
          ctx.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
            decisionMode: "strict",
          });
        },
        {
          time: TIME,
          setup() {
            ctx = createInstances();
            ctx.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
            // warm LRU
            ctx.documents.materializeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
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
          // Clear Apollo's memoized result tree; normalized store stays
          (apollo as any).resetResultCache?.();
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
          });
        },
        {
          time: TIME,
          setup() {
            apollo = createApolloCache();
            apollo.writeQuery({
              query: APOLLO_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
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
          const c = createApolloCache();
          c.restore(snapshot);
          c.readQuery({
            query: APOLLO_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
          });
        },
        {
          time: TIME,
          setup() {
            const seed = createApolloCache();
            seed.writeQuery({
              query: APOLLO_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
            snapshot = seed.extract(true); // normalized dump only
          },
        }
      );
    }

    // ---------------- Apollo: readQuery:hot (pre-seeded cache) ----------------
    {
      let apollo: ReturnType<typeof createApolloCache>;
      bench(
        `apollo.readQuery:hot(${label})`,
        () => {
          apollo.readQuery({
            query: APOLLO_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
          });
        },
        {
          time: TIME,
          setup() {
            apollo = createApolloCache();
            apollo.writeQuery({
              query: APOLLO_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
              data,
            });
            apollo.readQuery({
              query: APOLLO_QUERY,
              variables: { first: variant.posts, commentsFirst: variant.comments },
            });
          },
        }
      );
    }
  }
});
