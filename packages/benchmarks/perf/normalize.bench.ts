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

// For fair perf (strip dev-only code in your lib if you gate by NODE_ENV)
process.env.NODE_ENV = "production";

// -----------------------------------------------------------------------------
// Deterministic fixtures
// -----------------------------------------------------------------------------
function likeCount(i: number, j: number) {
  return ((i * 131 + j * 977) % 100) | 0;
}

type ResponseShape = {
  __typename: "Query";
  users: {
    __typename: "UserConnection";
    edges: Array<{
      __typename: "UserEdge";
      cursor: string;
      node: {
        __typename: "User";
        id: string;
        name: string;
        avatar: string;
        posts: {
          __typename: "PostConnection";
          edges: Array<{
            __typename: "PostEdge";
            cursor: string;
            node: {
              __typename: "Post";
              id: string;
              title: string;
              likeCount: number;
              comments: {
                __typename: "CommentConnection";
                edges: Array<{
                  __typename: "CommentEdge";
                  cursor: string;
                  node: {
                    __typename: "Comment";
                    id: string;
                    text: string;
                    author: {
                      __typename: "User";
                      id: string;
                      name: string;
                    };
                  };
                }>;
                pageInfo: { __typename: "PageInfo"; hasNextPage: boolean };
              };
            };
          }>;
          pageInfo: { __typename: "PageInfo"; hasNextPage: boolean };
        };
      };
    }>;
    pageInfo: {
      __typename: "PageInfo";
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

function makeResponse({
  users = 10,
  posts = 5,
  comments = 3,
}: {
  users: number;
  posts: number;
  comments: number;
}): ResponseShape {
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
      pageInfo: {
        __typename: "PageInfo",
        endCursor: users > 0 ? "u" + users : null,
        hasNextPage: false,
      },
    },
  };
}

// ---- Cachebay query: explicit keys for nested connections ----
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
                    node { id text author { id name } }
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
// Helpers: paginate once, reuse everywhere
// -----------------------------------------------------------------------------
type Page = {
  data: ResponseShape;
  after: string | null;
  vars: { first: number; after: string | null };
};

function buildPages(all: ResponseShape, pageSize: number): Page[] {
  const edges = all.users.edges;
  const pages: Page[] = [];
  const total = edges.length;

  for (let start = 0, pageIdx = 0; start < total; start += pageSize, pageIdx++) {
    const end = Math.min(start + pageSize, total);
    const pageEdges = edges.slice(start, end);
    const endCursor = pageEdges.length ? pageEdges[pageEdges.length - 1].cursor : null;
    const after = pageIdx === 0 ? null : pages[pageIdx - 1].data.users.pageInfo.endCursor;

    const pageData: ResponseShape = {
      __typename: "Query",
      users: {
        __typename: "UserConnection",
        edges: pageEdges,
        pageInfo: {
          __typename: "PageInfo",
          endCursor,
          hasNextPage: end < total,
        },
      },
    };

    Object.freeze(pageData); // prevent accidental mutation
    pages.push({
      data: pageData,
      after,
      vars: { first: pageSize, after },
    });
  }

  return pages;
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
