import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Fragments
// ─────────────────────────────────────────────────────────────────────────────

export const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

export const POST_FRAGMENT = gql`
  fragment PostFields on Post {
    id
    title
    tags
  }
`;

export const COMMENT_FRAGMENT = gql`
  fragment CommentFields on Comment {
    id
    text
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Queries (used to drive materializeDocument)
// ─────────────────────────────────────────────────────────────────────────────

export const USER_QUERY = gql`
  ${USER_FRAGMENT}
  query UserQuery($id: ID!) {
    user(id: $id) {
      ...UserFields
    }
  }
`;

export const USERS_QUERY = gql`
  ${USER_FRAGMENT}
  query UsersQuery($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) @connection(args: ["role"]) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        cursor
        node {
          ...UserFields
        }
      }
    }
  }
`;

export const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    user(id: $id) {
      ...UserFields
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
        totalCount
        pageInfo {
          startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }
        edges {
          cursor
          score
          node {
            ...PostFields
            author {
              id
            }
          }
        }
      }
    }
  }
`;

export const USERS_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UsersPostsQuery(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        cursor
        node {
          ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
            pageInfo {
              startCursor
              endCursor
              hasNextPage
              hasPreviousPage
            }
            edges {
              cursor
              node {
                ...PostFields
              }
            }
          }
        }
      }
    }
  }
`;

export const USER_POSTS_COMMENTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${COMMENT_FRAGMENT}
  query UserPostsCommentsQuery(
    $id: ID!
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    user(id: $id) {
      ...UserFields
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
        pageInfo {
          startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }
        edges {
          cursor
          node {
            ...PostFields
            comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
              pageInfo {
                startCursor
                endCursor
                hasNextPage
                hasPreviousPage
              }
              edges {
                cursor
                node {
                  ...CommentFields
                  author {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const USERS_POSTS_COMMENTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${COMMENT_FRAGMENT}
  query UsersPostsCommentsQuery(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        cursor
        node {
          ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
            pageInfo {
              startCursor
              endCursor
              hasNextPage
              hasPreviousPage
            }
            edges {
              cursor
              node {
                ...PostFields
                comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
                  pageInfo {
                    startCursor
                    endCursor
                    hasNextPage
                    hasPreviousPage
                  }
                  edges {
                    cursor
                    node {
                      ...CommentFields
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// NEW: Page-mode versions (for replacement canonical behavior)
const USERS_PAGE_QUERY = gql`
  query UsersPage($usersRole: String, $first: Int, $after: String, $before: String, $last: Int) {
    users(role: $usersRole, first: $first, after: $after, before: $before, last: $last)
      @connection(args: ["role"], mode: "page") {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node { id email } }
    }
  }
`;

const COMMENTS_PAGE_QUERY = gql`
  query CommentsPage($postId: ID!, $first: Int, $after: String, $before: String, $last: Int) {
    post(id: $postId) {
      id
      comments(first: $first, after: $after, before: $before, last: $last) @connection(args: [], mode: "page") {
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor node { id text } }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

const makeGraph = () =>
  createGraph({
    interfaces: {
      Post: ["AudioPost", "VideoPost"],
    },
  });

const makePlanner = () => createPlanner();
const makeViews = (graph: ReturnType<typeof createGraph>) => createViews({ graph });

// NOTE: canonical needs an optimistic hook; for materialization-only tests we provide a no-op.
const makeCanonical = (graph: ReturnType<typeof createGraph>) =>
  createCanonical({
    graph,
    optimistic: {
      reapplyOptimistic: () => ({ inserted: [], removed: [] }),
    } as any,
  });

const makeDocuments = (
  graph: ReturnType<typeof createGraph>,
  planner: ReturnType<typeof createPlanner>,
  canonical: ReturnType<typeof makeCanonical>,
  views: ReturnType<typeof makeViews>
) => createDocuments({ graph, planner, canonical, views });

// helpers for canonical keys we seed/read
const canUsers = (role: string) => `@connection.users({"role":"${role}"})`;
const canPosts = (userId: string, category: string) =>
  `@connection.User:${userId}.posts({"category":"${category}"})`;
const canComments = (postId: string) => `@connection.Post:${postId}.comments({})`;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("materializeDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof makeCanonical>;
  let views: ReturnType<typeof makeViews>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    planner = makePlanner();
    canonical = makeCanonical(graph); // <-- pass graph in
    views = makeViews(graph);
    documents = makeDocuments(graph, planner, canonical, views);
  });

  it("USER_QUERY — user node reactive when read directly; materialized shape ok", () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const view = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } });

    expect(view).toEqual({
      user: { __typename: "User", id: "u1", email: "u1@example.com" },
    });

    const userProxy = graph.materializeRecord("User:u1");
    expect(isReactive(userProxy)).toBe(true);

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(userProxy.email).toBe("u1+updated@example.com");
  });

  it("USERS_QUERY — canonical connection reactive (edges reactive; pageInfo not); node reactive; updates flow via canonical", () => {
    // Seed edge records for the leader page (after:null)
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

    const e0 = '@.users({"after":null,"first":2,"role":"admin"}).edges.0';
    const e1 = '@.users({"after":null,"first":2,"role":"admin"}).edges.1';
    graph.putRecord(e0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    graph.putRecord(e1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

    // Seed canonical root users(role:admin)
    const canKey = canUsers("admin");
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [{ __ref: e0 }, { __ref: e1 }],
    });

    const view = documents.materializeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
    });

    // Canonical view
    expect(isReactive(view.users)).toBe(true);
    expect(isReactive(view.users.pageInfo)).toBe(false);

    // edges reactive; node reactive
    expect(isReactive(view.users.edges[0])).toBe(true);
    const node0 = view.users.edges[0].node;
    expect(isReactive(node0)).toBe(true);

    // reactive update through CANONICAL
    graph.putRecord(canKey, { pageInfo: { endCursor: "u3" } });
    expect(view.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(node0.email).toBe("u1+updated@example.com");
  });

  it("USER_POSTS_QUERY — nested posts connection (canonical) reactive; totals/score reactive; node & author reactive", () => {
    // Seed root link to the user
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    // Entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [], author: { __ref: "User:u1" } });
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Post 2", tags: [], author: { __ref: "User:u1" } });

    // Concrete page edge records
    const pe0 = '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0';
    const pe1 = '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1';
    graph.putRecord(pe0, { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __ref: "Post:p1" } });
    graph.putRecord(pe1, { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __ref: "Post:p2" } });

    // Seed CANONICAL posts for User:u1 (category:tech)
    const canPostsKey = canPosts("u1", "tech");
    graph.putRecord(canPostsKey, {
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [{ __ref: pe0 }, { __ref: pe1 }],
    });

    const view = documents.materializeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    // canonical posts connection is reactive
    expect(isReactive(view.user.posts)).toBe(true);
    expect(view.user.posts.totalCount).toBe(2);
    expect(isReactive(view.user.posts.pageInfo)).toBe(false);
    expect(isReactive(view.user.posts.edges[0])).toBe(true);

    const post0 = view.user.posts.edges[0].node;
    const author0 = post0.author;
    expect(isReactive(post0)).toBe(true);
    expect(isReactive(author0)).toBe(true);

    // updates: canonical totals & edge meta & entity
    graph.putRecord(canPostsKey, { totalCount: 3 });
    expect(view.user.posts.totalCount).toBe(3);

    graph.putRecord(pe0, { score: 0.9 });
    expect(view.user.posts.edges[0].score).toBe(0.9);

    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(post0.title).toBe("Post 1 (Updated)");
    expect(author0.email).toBe("u1+updated@example.com");
  });

  it("USERS_POSTS_QUERY — root users canonical reactive; nested posts canonical reactive; nested post node reactive", () => {
    // Seed users canonical
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

    const ue0 = '@.users({"after":null,"first":2,"role":"dj"}).edges.0';
    const ue1 = '@.users({"after":null,"first":2,"role":"dj"}).edges.1';
    graph.putRecord(ue0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    graph.putRecord(ue1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

    const canUsersKey = canUsers("dj");
    graph.putRecord(canUsersKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: ue0 }, { __ref: ue1 }],
    });

    // Seed nested posts CANONICAL for u1 (category:tech)
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });
    const pKey = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
    const pe0 = `${pKey}.edges.0`;
    graph.putRecord(pe0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });

    const canPostsKey = canPosts("u1", "tech");
    graph.putRecord(canPostsKey, {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: pe0 }],
    });

    const view = documents.materializeDocument({
      document: USERS_POSTS_QUERY,
      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
      },
    });

    // root canonical users
    expect(isReactive(view.users)).toBe(true);
    expect(isReactive(view.users.pageInfo)).toBe(false);
    expect(isReactive(view.users.edges[0])).toBe(true);

    // nested posts canonical
    const u1Node = view.users.edges[0].node;
    expect(isReactive(u1Node)).toBe(true);
    expect(isReactive(u1Node.posts)).toBe(true);
    expect(isReactive(u1Node.posts.pageInfo)).toBe(false);
    expect(isReactive(u1Node.posts.edges[0])).toBe(true);

    const post0 = u1Node.posts.edges[0].node;
    expect(isReactive(post0)).toBe(true);

    // updates flow
    graph.putRecord(canUsersKey, { pageInfo: { endCursor: "u3" } });
    expect(view.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    expect(post0.title).toBe("Post 1 (Updated)");
  });

  it("USER_POSTS_COMMENTS_QUERY — nested posts/comments canonical at every level", () => {
    // Root entity link for user
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    // Entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });
    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
    graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
    graph.putRecord("User:u2", { __typename: "User", id: "u2" });
    graph.putRecord("User:u3", { __typename: "User", id: "u3" });

    // posts canonical for user:u1 (category:tech)
    const pe0 = '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0';
    graph.putRecord(pe0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
    const canPostsKey = canPosts("u1", "tech");
    graph.putRecord(canPostsKey, {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: pe0 }],
    });

    // comments canonical for Post:p1
    const ce0 = '@.Post:p1.comments({"after":null,"first":2}).edges.0';
    const ce1 = '@.Post:p1.comments({"after":null,"first":2}).edges.1';
    graph.putRecord(ce0, { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    graph.putRecord(ce1, { __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });
    const canCommentsKey = canComments("p1");
    graph.putRecord(canCommentsKey, {
      __typename: "CommentConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: ce0 }, { __ref: ce1 }],
    });

    const view = documents.materializeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
    });

    // reactive at every canonical level
    const posts = view.user.posts;
    expect(isReactive(posts)).toBe(true);
    expect(isReactive(posts.pageInfo)).toBe(false);
    expect(isReactive(posts.edges[0])).toBe(true);

    const post0 = posts.edges[0].node;
    expect(isReactive(post0)).toBe(true);

    const comments = post0.comments;
    expect(isReactive(comments)).toBe(true);
    expect(isReactive(comments.pageInfo)).toBe(false);
    expect(isReactive(comments.edges[0])).toBe(true);

    const comment0 = comments.edges[0].node;
    expect(isReactive(comment0)).toBe(true);

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(comment0.text).toBe("Comment 1 (Updated)");
  });

  it("USERS_POSTS_COMMENTS_QUERY — root users canonical + nested posts/comments canonical: everything reactive", () => {
    // root users canonical
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    const ue0 = '@.users({"after":null,"first":2,"role":"admin"}).edges.0';
    graph.putRecord(ue0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    const canUsersKey = canUsers("admin");
    graph.putRecord(canUsersKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u1", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: ue0 }],
    });

    // nested posts canonical
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });
    const pe0 = '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0';
    graph.putRecord(pe0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
    const canPostsKey = canPosts("u1", "tech");
    graph.putRecord(canPostsKey, {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: pe0 }],
    });

    // nested comments canonical
    const ce0 = '@.Post:p1.comments({"after":null,"first":1}).edges.0';
    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1" });
    graph.putRecord(ce0, { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    const canCommentsKey = canComments("p1");
    graph.putRecord(canCommentsKey, {
      __typename: "CommentConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: ce0 }],
    });

    const view = documents.materializeDocument({
      document: USERS_POSTS_COMMENTS_QUERY,
      variables: {
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: null,
      },
    });

    expect(isReactive(view.users)).toBe(true);
    expect(isReactive(view.users.pageInfo)).toBe(false);
    expect(isReactive(view.users.edges[0])).toBe(true);

    const u1Node = view.users.edges[0].node;
    const post0 = u1Node.posts.edges[0].node;
    const comment0 = post0.comments.edges[0].node;

    expect(isReactive(u1Node)).toBe(true);
    expect(isReactive(u1Node.posts)).toBe(true);
    expect(isReactive(u1Node.posts.pageInfo)).toBe(false);
    expect(isReactive(u1Node.posts.edges[0])).toBe(true);
    expect(isReactive(post0)).toBe(true);
    expect(isReactive(post0.comments)).toBe(true);
    expect(isReactive(post0.comments.pageInfo)).toBe(false);
    expect(isReactive(post0.comments.edges[0])).toBe(true);
    expect(isReactive(comment0)).toBe(true);

    // reactivity on updates via canonical
    graph.putRecord(canUsersKey, { pageInfo: { endCursor: "u3" } });
    expect(view.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(comment0.text).toBe("Comment 1 (Updated)");
  });
});
