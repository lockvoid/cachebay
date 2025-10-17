// test/perf/normalize-vs-apollo-relay.bench.ts
import { bench, describe } from "vitest";
import { gql } from "graphql-tag";

// ---- cachebay ----
import { createGraph } from "../../villus-cachebay/src/core/graph";
import { createPlanner } from "../../villus-cachebay/src/core/planner";
import { createCanonical } from "../../villus-cachebay/src/core/canonical";
import { createOptimistic } from "../../villus-cachebay/src/core/optimistic";
import { createDocuments } from "../../villus-cachebay/src/core/documents";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

process.env.NODE_ENV = "development";

// -----------------------------------------------------------------------------
// Fixtures (deterministic)
// -----------------------------------------------------------------------------
function likeCount(i: number, j: number) {
  // deterministic pseudo-random but stable
  return ((i * 131 + j * 977) % 100) | 0;
}

function makeResponse({ users = 10, posts = 5, comments = 3 }:
  { users: number; posts: number; comments: number }) {
  return {
    __typename: "Query",
    users: {
      __typename: "UserConnection",
      edges: Array.from({ length: users }, (_, i) => ({
        __typename: "UserEdge",
        cursor: "u" + (i + 1),
        node: {
          __typename: "User",
          id: "u" + (i + 1),
          name: "User " + (i + 1),
          avatar: `https://i.pravatar.cc/150?u=${i + 1}`,
          posts: {
            __typename: "PostConnection",
            edges: Array.from({ length: posts }, (_, j) => ({
              __typename: "PostEdge",
              cursor: "p" + (j + 1),
              node: {
                __typename: "Post",
                id: `p-${i + 1}-${j + 1}`,
                title: `Post ${j + 1} by User ${i + 1}`,
                likeCount: likeCount(i + 1, j + 1),
                comments: {
                  __typename: "CommentConnection",
                  edges: Array.from({ length: comments }, (_, k) => ({
                    __typename: "CommentEdge",
                    cursor: "c" + (k + 1),
                    node: {
                      __typename: "Comment",
                      id: `c-${i + 1}-${j + 1}-${k + 1}`,
                      text: `Comment ${k + 1} on Post ${j + 1}`,
                      author: {
                        __typename: "User",
                        id: "u" + ((k % users) + 1),
                        name: "User " + ((k % users) + 1),
                      },
                    },
                  })),
                  pageInfo: { __typename: "PageInfo", hasNextPage: false },
                },
              },
            })),
            pageInfo: { __typename: "PageInfo", hasNextPage: false },
          },
        },
      })),
      pageInfo: { __typename: "PageInfo", endCursor: "u" + users, hasNextPage: false },
    },
  };
}

// ---- Cachebay query: make keys explicit for clarity/perf ----
export const CACHEBAY_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) @connection {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) @connection(key: "posts") {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) @connection(key: "comments") {
                  edges {
                    cursor
                    node {
                      id
                      text
                      author {
                        id
                        name
                      }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

// ---- Apollo query: same selection (no directives) ----
export const APOLLO_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) {
                  edges {
                    cursor
                    node {
                      id
                      text
                      author { id name }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
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
    // resultCaching=false doesn’t affect writeQuery, but keep parity with your materialize benches
    resultCaching: false,
    typePolicies: {
      Query: {
        fields: {
          // default relay merging; omitting keyArgs keeps cursor args separate
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
const TIME = 1;
const VARIANTS = [
  { users: 10, posts: 5, comments: 3 },
  { users: 100, posts: 5, comments: 3 },
];

describe("normalize – Cachebay vs Apollo", () => {
  for (const variant of VARIANTS) {
    const label = `users=${variant.users}, posts=${variant.posts}, comments=${variant.comments}`;
    const data = makeResponse(variant);
    // deep-freeze is pricey; at least shallow-freeze top-level
    Object.freeze(data);

    // Cachebay: COLD (new instance per-iter) — exclude planning from timing
    bench(
      `cachebay.normalize:cold(${label})`,
      () => {
        const cb = createCachebay();
        // warm planner OUTSIDE normalize timing
        cb.planner.getPlan(CACHEBAY_QUERY);
        cb.documents.normalizeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: variant.users, after: null },
          data,
        });

        const result = cb.documents.materializeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: variant.users, after: null },
        });

        console.log(JSON.stringify(cb.graph.keys(), null, 2))
        //console.log(result.debug)
      },
      { time: TIME }
    );

    // Cachebay: HOT (pre-seeded)
    {
      let cb: ReturnType<typeof createCachebay>;
      bench(
        `cachebay.normalize:hot(${label})`,
        () => {
          cb.documents.normalizeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.users, after: null },
            data,
          });

          const result = cb.documents.materializeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.users, after: null },
          });
        },
        {
          time: TIME,
          setup() {
            cb = createCachebay();
            cb.documents.normalizeDocument({
              document: CACHEBAY_QUERY,
              variables: { first: variant.users, after: null },
              data,
            });
          },
        }
      );
    }

    // Apollo: COLD (new cache per-iter)
    bench(
      `apollo.writeQuery:cold(${label})`,
      () => {
        const apollo = createApolloCache();
        apollo.writeQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: { first: variant.users, after: null },
          data,
        });

        const result = apollo.readQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: { first: variant.users, after: null },
          data,
        });
      },
      { time: TIME }
    );

    // Apollo: HOT (pre-seeded)
    {
      let apollo: ReturnType<typeof createApolloCache>;
      bench(
        `apollo.writeQuery:hot(${label})`,
        () => {
          apollo.writeQuery({
            broadcast: false,
            query: APOLLO_QUERY,
            variables: { first: variant.users, after: null },
            data,
          });
        },
        {
          time: TIME,
          setup() {
            apollo = createApolloCache();
            apollo.writeQuery({
              broadcast: false,
              query: APOLLO_QUERY,
              variables: { first: variant.users, after: null },
              data,
            });
          },
        }
      );
    }
  }
});
