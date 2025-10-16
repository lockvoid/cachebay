import { bench, describe } from "vitest";
import { gql } from "graphql-tag";
import { createGraph } from "../../src/core/graph";
import { createDocuments } from "../../src/core/documents";
import { createPlanner } from "../../src/core/planner";
import { createCanonical } from "../../src/core/canonical";
import { createOptimistic } from "../../src/core/optimistic";

const createInstances = (ctx: any = {}) => {
  const graph = ctx.graph || createGraph({
    keys: {
      User: (user) => {
        return user.id ?? null;
      },

      Post: (post) => {
        return post.id ?? null;
      },

      Comment: (comment) => {
        return comment.uuid ?? null;
      },
    },
  });

  const planner = ctx.planner || createPlanner();
  const optimistic = ctx.optimistic || createOptimistic({ graph });
  const canonical = ctx.canonical || createCanonical({ graph, optimistic });
  const documents = ctx.documents || createDocuments({ graph, planner, canonical });

  return {
    planner,
    graph,
    optimistic,
    canonical,
    documents,
  };
}

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

const TIME = 3000;

const VARIANTS = [
  { posts: 1000, comments: 5 },
];

describe("Lifecycle", () => {
  for (const variant of VARIANTS) {
    const label = `posts=${variant.posts}, comments=${variant.comments}`;

    const data = makeResponse(variant);

    //{
    //  let ctx;
    //
    //  bench(`plan:cold(${label})`, () => {
    //    ctx.planner.getPlan(QUERY);
    //  }, {
    //    time: TIME,
    //
    //    setup() {
    //      ctx = createInstances();
    //    },
    //  });
    //}
    //
    //{
    //  let ctx;
    //
    //  bench(`plan:hot(${label})`, () => {
    //    ctx.planner.getPlan(QUERY);
    //  }, {
    //    time: TIME,
    //
    //    setup() {
    //      ctx = createInstances();
    //      ctx.planner.getPlan(QUERY);
    //    },
    //  });
    //}

    {
      let ctx;

      bench(`normalize:cold(${label})`, () => {
        const { documents } = createInstances({ planner: ctx.planner });

        documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.planner.getPlan(QUERY);
        },
      });
    }

    {
      let ctx;

      bench(`normalize:hot(${label})`, () => {
        ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
        },
      });
    }

    {
      let ctx;

      bench(`materialize:canonical:cold(${label})`, () => {
        const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });

        documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "canonical", });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
        },
      });
    }

    {
      let ctx;

      bench(`materialize:strict:cold(${label})`, () => {
        const { documents } = createInstances({ planner: ctx.planner, graph: ctx.graph });

        documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "strict", });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
        },
      });
    }

    {
      let ctx;

      bench(`materialize:canonical:hot(${label})`, () => {
        ctx.documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "canonical", });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
          ctx.documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "canonical", });
        },
      });
    }

    {
      let ctx;

      bench(`materialize:strict:hot(${label})`, () => {
        ctx.documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "strict", });
      }, {
        time: TIME,

        setup() {
          ctx = createInstances();
          ctx.documents.normalizeDocument({ document: QUERY, variables: { first: variant.posts }, data });
          ctx.documents.materializeDocument({ document: QUERY, variables: { first: variant.posts }, decisionMode: "strict", });
        },
      });
    }
  }
});
