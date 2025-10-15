import { bench, describe } from "vitest";

// TODO: fix these imports to your real paths
import { createGraph } from "../../src/core/graph";
import { createDocuments } from "../../src/core/documents";
import { createPlanner } from "../../src/core/planner";
import { createCanonical } from "../../src/core/canonical";
import { createOptimistic } from "../../src/core/optimistic";
import { gql } from "graphql-tag";

// --- tiny test rig ---------------------------------------------------------

// Factory to create fresh instances for each benchmark
function createFreshInstances() {
  const graph = createGraph({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.uuid ?? null,
    },
  });

  const optimistic = createOptimistic({ graph });
  const planner = createPlanner();
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, planner, canonical });

  return { graph, optimistic, planner, canonical, documents };
}

// synthetic response generator (Query.user.posts(edges[n]).comments(edges[m]))
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
            ...(comments > 0
              ? {
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
              }
              : null),
          },
        })),
        pageInfo: { __typename: "PageInfo", hasNextPage: false, hasPreviousPage: false },
      },
    },
  };
}

// very small “query” that selects user{posts{edges{node{...}} pageInfo}}

const QUERY = gql`
  query Q($first: Int!) {
    user {
      id
      email
      posts(first: $first) @connection(key: "posts") {
        edges {
          node {
            id
            title
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

function seed(documents: ReturnType<typeof createDocuments>, { posts, comments }: { posts: number; comments: number }) {
  const data = makeResponse({ posts, comments });

  documents.normalizeDocument({ document: QUERY, variables: { first: posts }, data });
}

// --- benches ---------------------------------------------------------------

describe("cachebay-core", () => {
  const SIZES = [
    // { posts: 200, comments: 0 },
    //{ posts: 500, comments: 0 },
    // { posts: 1000, comments: 0 },
    { posts: 1000, comments: 5 },   // nested comments to stress depth
  ];

  let documents: ReturnType<typeof createDocuments>;

  for (const s of SIZES) {
    const label = `posts=${s.posts}, comments=${s.comments}`;
    const data = makeResponse(s);

    bench(`normalize(${label})`, () => {
      documents.normalizeDocument({ document: QUERY, variables: { first: s.posts }, data });
    }, {
      time: 3000,
      setup() {
        const instances = createFreshInstances();
        documents = instances.documents;
      },
    });

    bench(`materialize:canonical(${label})`, () => {
      const result = documents.materializeDocument({
        document: QUERY,
        variables: { first: s.posts },
        decisionMode: "canonical",
      });
    }, {
      time: 3000,
      setup() {
        const instances = createFreshInstances();
        documents = instances.documents;
        seed(documents, s);
      },
    });

    bench(`materialize:strict(${label})`, () => {
      const result = documents.materializeDocument({
        document: QUERY,
        variables: { first: s.posts },
        decisionMode: "strict",
      });
    }, {
      time: 3000,
      setup() {
        const instances = createFreshInstances();
        documents = instances.documents;
        seed(documents, s);
      },
    });

    // stamp+LRU hit check (best-case)
    bench(`materialize:canonical (hot LRU)(${label})`, () => {
      const result = documents.materializeDocument({
        document: QUERY,
        variables: { first: s.posts },
        decisionMode: "canonical",
      });
    }, {
      time: 3000,
      setup() {
        const instances = createFreshInstances();
        documents = instances.documents;
        seed(documents, s);
      },
    });
  }
});
