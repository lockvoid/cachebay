import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
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


/** helper: write a concrete page (edges on pageKey.{edges.i}) */
function writePageSnapshot(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: (number | string)[],
  opts?: { start?: string | null; end?: string | null; hasNext?: boolean; hasPrev?: boolean }
) {
  const pageInfo = {
    __typename: "PageInfo",
    startCursor: opts?.start ?? (nodeIds.length ? `p${nodeIds[0]}` : null),
    endCursor: opts?.end ?? (nodeIds.length ? `p${nodeIds[nodeIds.length - 1]}` : null),
    hasNextPage: !!opts?.hasNext,
    hasPreviousPage: !!opts?.hasPrev,
  };
  const edges = nodeIds.map((id, i) => {
    const edgeKey = `${pageKey}.edges.${i}`;
    const nodeKey = `Post:${id}`;
    graph.putRecord(nodeKey, { __typename: "Post", id: String(id), title: `Post ${id}`, tags: [] });
    graph.putRecord(edgeKey, { __typename: "PostEdge", cursor: `p${id}`, node: { __ref: nodeKey } });
    return { __ref: edgeKey };
  });
  graph.putRecord(pageKey, { __typename: "PostConnection", pageInfo, edges });
}

const POSTS_QUERY = gql`
  query Posts($first: Int, $after: String) {
    posts(first: $first, after: $after) @connection(args: []) {
      __typename
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      edges { __typename cursor node { __typename id title } }
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
      replayOptimistic: () => ({ added: [], removed: [] }),
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

describe('MaterializeDocument', () => {
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

  it('materializes user node reactively with correct shape', () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const userView = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } });

    expect(userView).toEqual({
      user: { __typename: "User", id: "u1", email: "u1@example.com" },
    });

    const userRecord = graph.materializeRecord("User:u1");
    expect(isReactive(userRecord)).toBe(true);

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(userRecord.email).toBe("u1+updated@example.com");
  });

  it('materializes users connection with reactive edges and nodes', () => {
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

    const usersView = documents.materializeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
    });

    expect(isReactive(usersView.users)).toBe(true);
    expect(isReactive(usersView.users.pageInfo)).toBe(false);

    expect(isReactive(usersView.users.edges[0])).toBe(true);
    const userNode = usersView.users.edges[0].node;
    expect(isReactive(userNode)).toBe(true);

    graph.putRecord(canKey, { pageInfo: { endCursor: "u3" } });
    expect(usersView.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(userNode.email).toBe("u1+updated@example.com");
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

  it("identity stability: edges array updates only on ref list change; pageInfo identity replaced; node proxies stable", () => {
    // Seed canonical users u1,u2
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@x" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@x" });
    const e0 = '@.users({"after":null,"first":2,"role":"qa"}).edges.0';
    const e1 = '@.users({"after":null,"first":2,"role":"qa"}).edges.1';
    graph.putRecord(e0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    graph.putRecord(e1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    const canKey = '@connection.users({"role":"qa"})';
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: e0 }, { __ref: e1 }],
    });

    const v1 = documents.materializeDocument({ document: USERS_QUERY, variables: { usersRole: "qa", first: 2, after: null } });
    const edgesRef1 = v1.users.edges;
    const pageInfoRef1 = v1.users.pageInfo;
    const nodeRef1 = v1.users.edges[0].node;

    // Change pageInfo only
    graph.putRecord(canKey, { pageInfo: { endCursor: "u3" } });
    const v2 = documents.materializeDocument({ document: USERS_QUERY, variables: { usersRole: "qa", first: 2, after: null } });
    expect(v2.users.edges).toBe(edgesRef1);     // edges array identity stable
    expect(v2.users.pageInfo).not.toBe(pageInfoRef1); // pageInfo replaced
    expect(v2.users.pageInfo.endCursor).toBe("u3");

    // Change underlying node (reactive), not ref list
    graph.putRecord("User:u1", { email: "a+1@x" });
    expect(nodeRef1.email).toBe("a+1@x");

    // Change ref list: append another edge → edges array identity changes
    const e2 = '@.users({"after":"u2","first":1,"role":"qa"}).edges.0';
    graph.putRecord(e2, { __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u2" } });
    // simulate canonical update
    graph.putRecord(canKey, { edges: [{ __ref: e0 }, { __ref: e1 }, { __ref: e2 }] });
    const v3 = documents.materializeDocument({ document: USERS_QUERY, variables: { usersRole: "qa", first: 2, after: null } });
    expect(v3.users.edges).not.toBe(edgesRef1);
    expect(v3.users.edges.length).toBe(3);
  });

  it("prewarm P1 & P2 → union 1..6; network P2 normalize keeps 1..6", () => {
    const graph = createGraph({ interfaces: {} });
    const planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    const canonical = createCanonical({ graph, optimistic });
    const views = createViews({ graph });
    const documents = createDocuments({ graph, planner, canonical, views });

    // Concrete pages in the graph (simulate return visit)
    const p1 = '@.posts({"after":null,"first":3})';  // 1,2,3
    const p2 = '@.posts({"after":"p3","first":3})';  // 4,5,6
    writePageSnapshot(graph, p1, [1, 2, 3], { start: "p1", end: "p3", hasNext: true });
    writePageSnapshot(graph, p2, [4, 5, 6], { start: "p4", end: "p6", hasNext: false, hasPrev: true });

    // Prewarm both pages (cache path) → canonical union built
    documents.prewarmDocument({ document: POSTS_QUERY, variables: { first: 3, after: null } });
    documents.prewarmDocument({ document: POSTS_QUERY, variables: { first: 3, after: "p3" } });

    // Materialize leader (after:null) → expect union 1..6
    const toTitles = (v: any) => (v?.posts?.edges ?? []).map((e: any) => e?.node?.title);
    let view = documents.materializeDocument({ document: POSTS_QUERY, variables: { first: 3, after: null } });
    expect(toTitles(view)).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5", "Post 6"]);

    // Network P2 arrives with identical slice → normalize; union remains 1..6
    const netP2 = {
      __typename: "Query",
      posts: {
        __typename: "PostConnection",
        pageInfo: { __typename: "PageInfo", startCursor: "p4", endCursor: "p6", hasNextPage: false, hasPreviousPage: true },
        edges: [
          { __typename: "PostEdge", cursor: "p4", node: { __typename: "Post", id: "4", title: "Post 4" } },
          { __typename: "PostEdge", cursor: "p5", node: { __typename: "Post", id: "5", title: "Post 5" } },
          { __typename: "PostEdge", cursor: "p6", node: { __typename: "Post", id: "6", title: "Post 6" } },
        ],
      },
    };
    documents.normalizeDocument({ document: POSTS_QUERY, variables: { first: 3, after: "p3" }, data: netP2 });

    view = documents.materializeDocument({ document: POSTS_QUERY, variables: { first: 3, after: null } });
    expect(toTitles(view)).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5", "Post 6"]);
  });
});
