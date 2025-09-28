import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createCanonical } from "@/src/core/canonical";
import { createViews } from "@/src/core/views";
import { createDocuments } from "@/src/core/documents";
import { createOptimistic } from "@/src/core/optimistic";
import { operations, writePageSnapshot } from "@/test/helpers";

describe('documents.materializeDocument', () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] }, });
    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    views = createViews({ graph });
    documents = createDocuments({ graph, planner, canonical, views });
  });

  it('materializes user node reactively with correct shape', () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const userView = documents.materializeDocument({ document: operations.USER_QUERY, variables: { id: "u1" } });
    expect(userView).toEqual({ user: { __typename: "User", id: "u1", email: "u1@example.com" } });

    const userRecord = graph.materializeRecord("User:u1");
    expect(isReactive(userRecord)).toBe(true);

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(userRecord.email).toBe("u1+updated@example.com");
  });

  it('materializes users connection with reactive edges and nodes', () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.1', { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

    graph.putRecord('@connection.users({"role":"admin"})', {
      __typename: "UserConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.1' }
      ],
    });

    const usersView = documents.materializeDocument({
      document: operations.USERS_QUERY,

      variables: {
        usersRole: "admin",
        first: 2,
        after: null
      },
    });

    expect(isReactive(usersView.users)).toBe(true);
    expect(isReactive(usersView.users.pageInfo)).toBe(false);
    expect(isReactive(usersView.users.edges[0])).toBe(true);

    const firstUser = usersView.users.edges[0].node;
    expect(isReactive(firstUser)).toBe(true);

    graph.putRecord('@connection.users({"role":"admin"})', { pageInfo: { endCursor: "u3" } });
    expect(usersView.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(firstUser.email).toBe("u1+updated@example.com");
  });

  it('materializes nested posts connection with reactive totals, scores, nodes and authors', () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [], author: { __ref: "User:u1" } });

    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Post 2", tags: [], author: { __ref: "User:u1" } });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0', { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __ref: "Post:p1" } });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1', { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __ref: "Post:p2" } });

    graph.putRecord('@connection.User:u1.posts({"category":"tech"})', {
      __typename: "PostConnection",
      totalCount: 2,

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0' },
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1' }
      ],
    });

    const userPostsView = documents.materializeDocument({
      document: operations.USER_POSTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null
      },
    });

    expect(isReactive(userPostsView.user.posts)).toBe(true);
    expect(isReactive(userPostsView.user.posts.pageInfo)).toBe(false);
    expect(isReactive(userPostsView.user.posts.edges[0])).toBe(true);
    expect(userPostsView.user.posts.totalCount).toBe(2);

    // Post

    const firstPost = userPostsView.user.posts.edges[0].node;
    expect(isReactive(firstPost)).toBe(true);

    graph.putRecord('@connection.User:u1.posts({"category":"tech"})', { totalCount: 3 });
    expect(userPostsView.user.posts.totalCount).toBe(3);

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0', { score: 0.9 });
    expect(userPostsView.user.posts.edges[0].score).toBe(0.9);

    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    expect(firstPost.title).toBe("Post 1 (Updated)");

    // Author

    const postAuthor = firstPost.author;

    expect(isReactive(postAuthor)).toBe(true);

    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(postAuthor.email).toBe("u1+updated@example.com");
  });

  it('materializes root users and nested posts with reactive canonical connections', () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.0', { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.1', { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

    graph.putRecord('@connection.users({"role":"dj"})', {
      __typename: "UserConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.1' }
      ],
    });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });

    graph.putRecord('@connection.User:u1.posts({"category":"tech"})', {
      __typename: "PostConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }
      ],
    });

    const view = documents.materializeDocument({
      document: operations.USERS_POSTS_QUERY,

      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
      },
    });

    expect(isReactive(view.users)).toBe(true);
    expect(isReactive(view.users.pageInfo)).toBe(false);
    expect(isReactive(view.users.edges[0])).toBe(true);

    const u1Node = view.users.edges[0].node;
    expect(isReactive(u1Node)).toBe(true);
    expect(isReactive(u1Node.posts)).toBe(true);
    expect(isReactive(u1Node.posts.pageInfo)).toBe(false);
    expect(isReactive(u1Node.posts.edges[0])).toBe(true);

    const post0 = u1Node.posts.edges[0].node;
    expect(isReactive(post0)).toBe(true);

    graph.putRecord('@connection.users({"role":"dj"})', { pageInfo: { endCursor: "u3" } });
    expect(view.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    expect(post0.title).toBe("Post 1 (Updated)");
  });

  it('materializes nested posts and comments with canonical connections at every level', () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });

    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });

    graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });

    graph.putRecord("User:u2", { __typename: "User", id: "u2" });

    graph.putRecord("User:u3", { __typename: "User", id: "u3" });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });

    graph.putRecord('@connection.User:u1.posts({"category":"tech"})', {
      __typename: "PostConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }
      ],
    });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.0', { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.1', { __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });

    graph.putRecord('@connection.Post:p1.comments({})', {
      __typename: "CommentConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: true,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.0' },
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.1' }
      ],
    });

    const userPostsCommentsView = documents.materializeDocument({
      document: operations.USER_POSTS_COMMENTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
    });

    const userPosts = userPostsCommentsView.user.posts;
    expect(isReactive(userPosts)).toBe(true);
    expect(isReactive(userPosts.pageInfo)).toBe(false);
    expect(isReactive(userPosts.edges[0])).toBe(true);

    const firstPost = userPosts.edges[0].node;
    expect(isReactive(firstPost)).toBe(true);

    const postComments = firstPost.comments;
    expect(isReactive(postComments)).toBe(true);
    expect(isReactive(postComments.pageInfo)).toBe(false);
    expect(isReactive(postComments.edges[0])).toBe(true);

    const firstComment = postComments.edges[0].node;
    expect(isReactive(firstComment)).toBe(true);

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(firstComment.text).toBe("Comment 1 (Updated)");
  });

  it('materializes users, posts and comments with reactive canonical connections', () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });

    graph.putRecord('@connection.users({"role":"admin"})', {
      __typename: "UserConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u1",
        hasNextPage: true,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' }
      ],
    });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });

    graph.putRecord('@connection.User:u1.posts({"category":"tech"})', {
      __typename: "PostConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }
      ],
    });

    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1" });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":1}).edges.0', { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });

    graph.putRecord('@connection.Post:p1.comments({})', {
      __typename: "CommentConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c1",
        hasNextPage: false,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.Post:p1.comments({"after":null,"first":1}).edges.0' }
      ],
    });

    const usersPostsCommentsView = documents.materializeDocument({
      document: operations.USERS_POSTS_COMMENTS_QUERY,

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

    expect(isReactive(usersPostsCommentsView.users)).toBe(true);
    expect(isReactive(usersPostsCommentsView.users.pageInfo)).toBe(false);
    expect(isReactive(usersPostsCommentsView.users.edges[0])).toBe(true);

    const firstUser = usersPostsCommentsView.users.edges[0].node;
    const firstPost = firstUser.posts.edges[0].node;
    const firstComment = firstPost.comments.edges[0].node;

    expect(isReactive(firstUser)).toBe(true);
    expect(isReactive(firstUser.posts)).toBe(true);
    expect(isReactive(firstUser.posts.pageInfo)).toBe(false);
    expect(isReactive(firstUser.posts.edges[0])).toBe(true);
    expect(isReactive(firstPost)).toBe(true);
    expect(isReactive(firstPost.comments)).toBe(true);
    expect(isReactive(firstPost.comments.pageInfo)).toBe(false);
    expect(isReactive(firstPost.comments.edges[0])).toBe(true);
    expect(isReactive(firstComment)).toBe(true);

    graph.putRecord('@connection.users({"role":"admin"})', { pageInfo: { endCursor: "u3" } });
    expect(usersPostsCommentsView.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(firstComment.text).toBe("Comment 1 (Updated)");
  });

  it('maintains identity stability for edges and node proxies', () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@x" });

    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@x" });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.1', { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    graph.putRecord('@connection.users({"role":"admin"})', {
      __typename: "UserConnection",

      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: false,
        hasPreviousPage: false
      },

      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.1' }
      ],
    });

    const firstUsersView = documents.materializeDocument({
      document: operations.USERS_QUERY,

      variables: {
        usersRole: "admin",
        first: 2,
        after: null
      }
    });

    const edgesRef1 = firstUsersView.users.edges;
    const pageInfoRef1 = firstUsersView.users.pageInfo;
    const nodeRef1 = firstUsersView.users.edges[0].node;

    graph.putRecord('@connection.users({"role":"admin"})', { pageInfo: { endCursor: "u3" } });

    const secondUsersView = documents.materializeDocument({
      document: operations.USERS_QUERY,

      variables: {
        usersRole: "admin",
        first: 2,
        after: null
      }
    });

    expect(secondUsersView.users.edges).toBe(edgesRef1);     // edges array identity stable
    expect(secondUsersView.users.pageInfo).not.toBe(pageInfoRef1); // pageInfo replaced
    expect(secondUsersView.users.pageInfo.endCursor).toBe("u3");

    graph.putRecord("User:u1", { email: "a+1@x" });
    expect(nodeRef1.email).toBe("a+1@x");

    graph.putRecord('@.users({"after":"u2","first":1,"role":"admin"}).edges.0', { __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u2" } });
    graph.putRecord('@connection.users({"role":"admin"})', { edges: [{ __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' }, { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.1' }, { __ref: '@.users({"after":"u2","first":1,"role":"admin"}).edges.0' }] });

    const thirdUsersView = documents.materializeDocument({
      document: operations.USERS_QUERY,

      variables: {
        usersRole: "admin",
        first: 2,
        after: null
      }
    });

    expect(thirdUsersView.users.edges).not.toBe(edgesRef1);
    expect(thirdUsersView.users.edges.length).toBe(3);
  });

  it('prewarns pages and normalizes network data correctly', () => {
    writePageSnapshot(graph, '@.posts({"after":null,"first":3})', [1, 2, 3], { start: "p1", end: "p3", hasNext: true });
    writePageSnapshot(graph, '@.posts({"after":"p3","first":3})', [4, 5, 6], { start: "p4", end: "p6", hasNext: false, hasPrev: true });

    documents.prewarmDocument({ document: operations.POSTS_QUERY, variables: { first: 3, after: null } });
    documents.prewarmDocument({ document: operations.POSTS_QUERY, variables: { first: 3, after: "p3" } });

    let postsView = documents.materializeDocument({ document: operations.POSTS_QUERY, variables: { first: 3, after: null } });
    expect(postsView).toEqual({
      posts: {
        __typename: "Connection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p6",
          hasNextPage: false,
          hasPreviousPage: false
        },
        edges: [
          { __typename: "PostEdge", cursor: "p1", node: { __typename: "Post", id: "1", title: "Post 1", tags: [] } },
          { __typename: "PostEdge", cursor: "p2", node: { __typename: "Post", id: "2", title: "Post 2", tags: [] } },
          { __typename: "PostEdge", cursor: "p3", node: { __typename: "Post", id: "3", title: "Post 3", tags: [] } },
          { __typename: "PostEdge", cursor: "p4", node: { __typename: "Post", id: "4", title: "Post 4", tags: [] } },
          { __typename: "PostEdge", cursor: "p5", node: { __typename: "Post", id: "5", title: "Post 5", tags: [] } },
          { __typename: "PostEdge", cursor: "p6", node: { __typename: "Post", id: "6", title: "Post 6", tags: [] } }
        ]
      }
    });

    const networkPage2Data = {
      __typename: "Query",
      posts: {
        __typename: "PostConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "p4",
          endCursor: "p6",
          hasNextPage: false,
          hasPreviousPage: true
        },
        edges: [
          { __typename: "PostEdge", cursor: "p4", node: { __typename: "Post", id: "4", title: "Post 4" } },
          { __typename: "PostEdge", cursor: "p5", node: { __typename: "Post", id: "5", title: "Post 5" } },
          { __typename: "PostEdge", cursor: "p6", node: { __typename: "Post", id: "6", title: "Post 6" } },
        ],
      },
    };

    documents.normalizeDocument({ document: operations.POSTS_QUERY, variables: { first: 3, after: "p3" }, data: networkPage2Data });

    postsView = documents.materializeDocument({ document: operations.POSTS_QUERY, variables: { first: 3, after: null } });

    expect(postsView).toEqual({
      posts: {
        __typename: "Connection",

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p6",
          hasNextPage: false,
          hasPreviousPage: false
        },

        edges: [
          { __typename: "PostEdge", cursor: "p1", node: { __typename: "Post", id: "1", title: "Post 1", tags: [] } },
          { __typename: "PostEdge", cursor: "p2", node: { __typename: "Post", id: "2", title: "Post 2", tags: [] } },
          { __typename: "PostEdge", cursor: "p3", node: { __typename: "Post", id: "3", title: "Post 3", tags: [] } },
          { __typename: "PostEdge", cursor: "p4", node: { __typename: "Post", id: "4", title: "Post 4", tags: [] } },
          { __typename: "PostEdge", cursor: "p5", node: { __typename: "Post", id: "5", title: "Post 5", tags: [] } },
          { __typename: "PostEdge", cursor: "p6", node: { __typename: "Post", id: "6", title: "Post 6", tags: [] } }
        ]
      }
    });
  });
});
