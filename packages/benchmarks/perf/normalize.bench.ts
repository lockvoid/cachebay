// test/perf/normalize-vs-apollo-relay.bench.ts
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

// Ensure prod code paths
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
            // keep comments present so shapes match between queries
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

// Cachebay query uses @connection annotations
export const CACHEBAY_QUERY = gql`
  query Q($first: Int!, $commentsFirst: Int!) {
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

// Apollo query has the same shape (no directives; policies handle pagination)
export const APOLLO_QUERY = gql`
  query Q($first: Int!, $commentsFirst: Int!) {
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

function createApolloCache() {
  return new InMemoryCache({
    resultCaching: false,

    typePolicies: {
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
      Comment: {
        keyFields: ["uuid"],
      },
    },
  });
}

const TIME = 3000;

const VARIANTS = [
  { posts: 1000, comments: 5 },
];

describe("normalize – Cachebay vs Apollo", () => {
  for (const variant of VARIANTS) {
    const label = `posts=${variant.posts}, comments=${variant.comments}`;
    const data = makeResponse(variant);

    bench(`cachebay.normalize:cold(${label})`, () => {
      const cachebay = createCachebay();

      cachebay.documents.normalizeDocument({
        document: CACHEBAY_QUERY,
        variables: { first: variant.posts, commentsFirst: variant.comments },
        data,
      });
    }, {
      time: TIME,
    });

    {
      let cachebay;

      bench(`cachebay.normalize:hot(${label})`, () => {
        cachebay.documents.normalizeDocument({
          document: CACHEBAY_QUERY,
          variables: { first: variant.posts, commentsFirst: variant.comments },
          data,
        });
      }, {
        time: TIME,

        setup() {
          cachebay = createCachebay();

          cachebay.documents.normalizeDocument({
            document: CACHEBAY_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
            data,
          });
        },
      });
    }

    // Apollo: COLD (fresh cache per iter)
    bench(`apollo.writeQuery:cold(${label})`, () => {
      const apollo = createApolloCache();

      apollo.writeQuery({
        broadcast: false,
        query: APOLLO_QUERY,
        variables: { first: variant.posts, commentsFirst: variant.comments },
        data,
      });
    }, {
      time: TIME
    });

    {
      let apollo;

      bench(`apollo.writeQuery:hot(${label})`, () => {
        apollo.writeQuery({
          broadcast: false,
          query: APOLLO_QUERY,
          variables: { first: variant.posts, commentsFirst: variant.comments },
          data,
        });
      }, {
        time: TIME,

        setup() {
          apollo = createApolloCache();

          apollo.writeQuery({
            broadcast: false,
            query: APOLLO_QUERY,
            variables: { first: variant.posts, commentsFirst: variant.comments },
            data,
          });
        },
      });
    }
  }
});
