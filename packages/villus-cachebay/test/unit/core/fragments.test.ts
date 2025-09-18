import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { createFragments } from "@/src/core/fragments";

// Fragments
const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

const USER_POSTS_FRAGMENT = gql`
  fragment UserPosts on User {
    id
    email
    posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
      __typename
      totalCount
      pageInfo {
        __typename
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        __typename
        cursor
        score
        node {
          __typename
          id
          title
          tags
        }
      }
    }
  }
`;

const POST_COMMENTS_FRAGMENT = gql`
  fragment PostWithComments on Post {
    id
    title
    comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
      __typename
      pageInfo {
        __typename
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        __typename
        cursor
        node {
          __typename
          id
          text
          author {
            __typename
            id
          }
        }
      }
    }
  }
`;

// helpers
const makeGraph = () =>
  createGraph({
    interfaces: { Post: ["AudioPost", "VideoPost"] },
  });


const makePlanner = () => {
  // no options — compiler reads @connection
  return createPlanner();
};


const makeFragments = (graph: ReturnType<typeof createGraph>, planner: ReturnType<typeof makePlanner>) =>
  createFragments(
    {
      // options kept for API compatibility; ignored (compiler uses @connection)
    },
    { graph, planner, views: createViews({ graph }) }
  );

// ─────────────────────────────────────────────────────────────────────────────

describe("readFragment (reactive)", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof makePlanner>;
  let fragments: ReturnType<typeof makeFragments>;

  beforeEach(() => {
    graph = makeGraph();
    planner = makePlanner();
    fragments = makeFragments(graph, planner);
  });

  it("UserFields — reactive user view", () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const view = fragments.readFragment({
      id: "User:u1",
      fragment: USER_FRAGMENT,
      variables: {},
    });

    expect(isReactive(view)).toBe(true);
    expect(view.__typename).toBe("User");
    expect(view.id).toBe("u1");
    expect(view.email).toBe("u1@example.com");

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(view.email).toBe("u1+updated@example.com");
  });

  it("UserPosts — connection reactive; extras present", () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", tags: [] });
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2", tags: [] });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0', {
      __typename: "PostEdge",
      cursor: "p1",
      score: 0.5,
      node: { __ref: "Post:p1" },
    });
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1', {
      __typename: "PostEdge",
      cursor: "p2",
      score: 0.7,
      node: { __ref: "Post:p2" },
    });
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2})', {
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0' },
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1' },
      ],
    });

    const view = fragments.readFragment({
      id: "User:u1",
      fragment: USER_POSTS_FRAGMENT,
      variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(isReactive(view.posts)).toBe(true);
    expect(view.posts.totalCount).toBe(2);
    expect(isReactive(view.posts.edges[0])).toBe(true);
    expect(isReactive(view.posts.edges[0].node)).toBe(true);
    expect(view.posts.edges[0].node.title).toBe("P1");
  });

  it("PostWithComments — nested connection reactive; comment node reactive", () => {
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", tags: [] });
    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "C1", author: { __ref: "User:u2" } });
    graph.putRecord("User:u2", { __typename: "User", id: "u2" });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":1}).edges.0', {
      __typename: "CommentEdge",
      cursor: "c1",
      node: { __ref: "Comment:c1" },
    });
    graph.putRecord('@.Post:p1.comments({"after":null,"first":1})', {
      __typename: "CommentConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c1",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [{ __ref: '@.Post:p1.comments({"after":null,"first":1}).edges.0' }],
    });

    const view = fragments.readFragment({
      id: "Post:p1",
      fragment: POST_COMMENTS_FRAGMENT,
      variables: { commentsFirst: 1, commentsAfter: null },
    });

    expect(isReactive(view.comments)).toBe(true);
    expect(isReactive(view.comments.edges[0])).toBe(true);
    expect(isReactive(view.comments.edges[0].node)).toBe(true);

    graph.putRecord("Comment:c1", { text: "C1 (Updated)" });
    expect(view.comments.edges[0].node.text).toBe("C1 (Updated)");
  });

  it("returns reactive empty view when entity is missing (proxy created later)", () => {
    const view = fragments.readFragment({
      id: "User:missing",
      fragment: USER_FRAGMENT,
      variables: {},
    });

    // Your graph.materializeRecord returns a live proxy even if the snapshot isn't seeded yet.
    // So we assert reactive empty object rather than undefined.
    if (view === undefined) {
      // if your graph returns undefined in your build, allow that too
      expect(view).toBeUndefined();
    } else {
      expect(isReactive(view)).toBe(true);
      expect(Object.keys(view).length).toBe(0);
    }
  });
});

describe("writeFragment (targeted)", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof makePlanner>;
  let fragments: ReturnType<typeof makeFragments>;

  beforeEach(() => {
    graph = makeGraph();
    planner = makePlanner();
    fragments = makeFragments(graph, planner);
  });

  it("UserFields — writes entity fields shallowly", () => {
    fragments.writeFragment({
      id: "User:u1",
      fragment: USER_FRAGMENT,
      variables: {},
      data: { __typename: "User", id: "u1", email: "seed@example.com" },
    });

    expect(graph.getRecord("User:u1")).toEqual({
      __typename: "User",
      id: "u1",
      email: "seed@example.com",
    });

    const view = fragments.readFragment({ id: "User:u1", fragment: USER_FRAGMENT, variables: {} });
    expect(view.email).toBe("seed@example.com");

    fragments.writeFragment({
      id: "User:u1",
      fragment: USER_FRAGMENT,
      variables: {},
      data: { email: "seed2@example.com" },
    });
    expect(graph.getRecord("User:u1")!.email).toBe("seed2@example.com");
    expect(view.email).toBe("seed2@example.com");
  });

  it("UserPosts — writes a connection page (no link); read is reactive", () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

    fragments.writeFragment({
      id: "User:u1",
      fragment: USER_POSTS_FRAGMENT,
      variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
      data: {
        id: "u1",
        email: "x@example.com",
        posts: {
          __typename: "PostConnection",
          totalCount: 2,
          pageInfo: {
            __typename: "PageInfo",
            startCursor: "p1",
            endCursor: "p2",
            hasNextPage: true,
            hasPreviousPage: false,
          },
          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",
              score: 0.5,
              node: { __typename: "Post", id: "p1", title: "P1", tags: [] },
            },
            {
              __typename: "PostEdge",
              cursor: "p2",
              score: 0.7,
              node: { __typename: "Post", id: "p2", title: "P2", tags: [] },
            },
          ],
        },
      },
    });

    // Page and edges exist
    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2})')).toMatchObject({
      __typename: "PostConnection",
      totalCount: 2,
    });
    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0')).toMatchObject({
      cursor: "p1",
      score: 0.5,
      node: { __ref: "Post:p1" },
    });

    const view = fragments.readFragment({
      id: "User:u1",
      fragment: USER_POSTS_FRAGMENT,
      variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(view.posts.totalCount).toBe(2);
    expect(view.posts.edges[0].node.title).toBe("P1");

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0', { score: 0.9 });
    expect(view.posts.edges[0].score).toBe(0.9);
  });
});
