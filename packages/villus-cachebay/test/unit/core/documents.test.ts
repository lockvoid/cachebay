import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createDocuments } from "@/src/core/documents";

// ─────────────────────────────────────────────────────────────────────────────
// Fragments
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
// Queries
// ─────────────────────────────────────────────────────────────────────────────
export const USER_QUERY = gql`
  ${USER_FRAGMENT}
  query UserQuery($id: ID!) {
    user(id: $id) { ...UserFields __typename }
  }
`;

export const USERS_QUERY = gql`
  ${USER_FRAGMENT}
  query UsersQuery($role: String, $first: Int, $after: String) {
    users(role: $role, first: $first, after: $after) {
      __typename
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node { ...UserFields __typename } }
    }
  }
`;

export const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $category: String, $first: Int, $after: String) {
    user(id: $id) {
      ...UserFields
      __typename
      posts(category: $category, first: $first, after: $after) {
        __typename
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor node { ...PostFields __typename author { id __typename } } }
      }
    }
  }
`;

export const USERS_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UsersPostsQuery(
    $role: String
    $usersFirst: Int
    $usersAfter: String
    $category: String
    $postsFirst: Int
    $postsAfter: String
  ) {
    users(role: $role, first: $usersFirst, after: $usersAfter) {
      __typename
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          ...UserFields
          __typename
          posts(category: $category, first: $postsFirst, after: $postsAfter) {
            __typename
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges { cursor node { ...PostFields __typename } }
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
    $category: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    user(id: $id) {
      ...UserFields
      __typename
      posts(category: $category, first: $postsFirst, after: $postsAfter) {
        __typename
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            ...PostFields
            __typename
            comments(first: $commentsFirst, after: $commentsAfter) {
              __typename
              pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
              edges { cursor node { ...CommentFields __typename author { id __typename } } }
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
    $role: String
    $usersFirst: Int
    $usersAfter: String
    $category: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    users(role: $role, first: $usersFirst, after: $usersAfter) {
      __typename
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          ...UserFields
          __typename
          posts(category: $category, first: $postsFirst, after: $postsAfter) {
            __typename
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
              cursor
              node {
                ...PostFields
                __typename
                comments(first: $commentsFirst, after: $commentsAfter) {
                  __typename
                  pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
                  edges { cursor node { ...CommentFields __typename } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────
const makeGraph = () =>
  createGraph({
    keys: {
      User: (o: any) => o.id,
      Post: (o: any) => o.id,
      Comment: (o: any) => o.id,
      Tag: (o: any) => o.id,
    },
    interfaces: {
      Post: ["AudioPost", "VideoPost"],
    },
  });

const makeDocs = (graph: ReturnType<typeof createGraph>) =>
  createDocuments(
    {
      connections: {
        Query: { users: { mode: "forward", filters: ["role"] } },
        User: { posts: { mode: "forward", filters: ["category"] } },
        Post: { comments: { mode: "forward", filters: [] } },
      },
    },
    { graph }
  );

// ─────────────────────────────────────────────────────────────────────────────
// normalizeDocument — progression
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeDocument (progression by query)", () => {
  it("USER_QUERY — root '@' reference and entity snapshot (Type:id)", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    docs.normalizeDocument({
      document: USER_QUERY,
      variables: { id: "user123" },
      rootId: "@",
      data: {
        user: { __typename: "User", id: "user123", email: "john@example.com" },
      },
    });

    const root = graph.getRecord("@")!;
    expect(root.id).toBe("@");
    expect(root.__typename).toBe("@");
    expect(root['user({"id":"user123"})']).toEqual({ __ref: "User:user123" });

    expect(graph.getRecord("User:user123")).toEqual({
      id: "user123",
      __typename: "User",
      email: "john@example.com",
    });
  });

  it("USERS_QUERY — root users connection @.users({role,first}) with edge records", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    // Page 1
    docs.normalizeDocument({
      document: USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
      rootId: "@",
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
          edges: [
            { cursor: "u1", node: { __typename: "User", id: "user123", email: "john@example.com" } },
            { cursor: "u2", node: { __typename: "User", id: "user999", email: "jane@example.com" } },
          ],
        },
      },
    });

    // Page 2
    docs.normalizeDocument({
      document: USERS_QUERY,
      variables: { role: "admin", first: 2, after: "u2" },
      rootId: "@",
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
          edges: [{ cursor: "u3", node: { __typename: "User", id: "user777", email: "bob@example.com" } }],
        },
      },
    });

    // Connection + edges at root
    const connId = '@.users({"first":2,"role":"admin"})';
    const conn = graph.getRecord(connId)!;
    expect(conn.__typename).toBe("UserConnection");
    expect(conn.pageInfo.endCursor).toBe("u3");
    expect(conn.edges).toEqual([
      { __ref: '@.users({"first":2,"role":"admin"}).edges.0' },
      { __ref: '@.users({"first":2,"role":"admin"}).edges.1' },
      { __ref: '@.users({"first":2,"role":"admin"}).edges.2' },
    ]);

    expect(graph.getRecord('@.users({"first":2,"role":"admin"}).edges.0')!.node).toEqual({ __ref: "User:user123" });
    expect(graph.getRecord('@.users({"first":2,"role":"admin"}).edges.1')!.node).toEqual({ __ref: "User:user999" });
    expect(graph.getRecord('@.users({"first":2,"role":"admin"}).edges.2')!.node).toEqual({ __ref: "User:user777" });
  });

  it("USER_POSTS_QUERY — write category 'tech' first, then 'lifestyle'; BOTH keys and connections remain in cache", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    // tech
    docs.normalizeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "user123", category: "tech", first: 2, after: null },
      rootId: "@",
      data: {
        user: {
          __typename: "User",
          id: "user123",
          email: "john@example.com",
          posts: {
            __typename: "PostConnection",
            pageInfo: { startCursor: "tech1", endCursor: "tech2", hasNextPage: true, hasPreviousPage: false, __typename: "PageInfo" },
            edges: [
              { cursor: "tech1", node: { __typename: "Post", id: "post456", title: "React Tips", tags: ["react"], author: { __typename: "User", id: "user123" } } },
              { cursor: "tech2", node: { __typename: "Post", id: "post888", title: "JS Patterns", tags: ["js"], author: { __typename: "User", id: "user123" } } },
            ],
          },
        },
      },
    });

    // lifestyle
    docs.normalizeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "user123", category: "lifestyle", first: 2, after: null },
      rootId: "@",
      data: {
        user: {
          __typename: "User",
          id: "user123",
          posts: {
            __typename: "PostConnection",
            pageInfo: { startCursor: "life1", endCursor: "life2", hasNextPage: false, hasPreviousPage: false, __typename: "PageInfo" },
            edges: [
              { cursor: "life1", node: { __typename: "Post", id: "post999", title: "Work-Life", tags: [], author: { __typename: "User", id: "user123" } } },
              { cursor: "life2", node: { __typename: "Post", id: "post111", title: "Morning", tags: [], author: { __typename: "User", id: "user123" } } },
            ],
          },
        },
      },
    });

    // User field keys point to distinct connection ids
    const user = graph.getRecord("User:user123")!;
    expect(user['posts({"category":"tech","first":2})']).toEqual({ __ref: '@.User:user123.posts({"category":"tech","first":2})' });
    expect(user['posts({"category":"lifestyle","first":2})']).toEqual({ __ref: '@.User:user123.posts({"category":"lifestyle","first":2})' });

    // Tech connection exists and has two edge records
    const techConnId = '@.User:user123.posts({"category":"tech","first":2})';
    expect(graph.getRecord(techConnId)!.edges).toEqual([
      { __ref: '@.User:user123.posts({"category":"tech","first":2}).edges.0' },
      { __ref: '@.User:user123.posts({"category":"tech","first":2}).edges.1' },
    ]);
    expect(graph.getRecord('@.User:user123.posts({"category":"tech","first":2}).edges.0')!.node).toEqual({ __ref: "Post:post456" });

    // Lifestyle connection also exists independently
    const lifeConnId = '@.User:user123.posts({"category":"lifestyle","first":2})';
    expect(graph.getRecord(lifeConnId)!.edges).toEqual([
      { __ref: '@.User:user123.posts({"category":"lifestyle","first":2}).edges.0' },
      { __ref: '@.User:user123.posts({"category":"lifestyle","first":2}).edges.1' },
    ]);
    expect(graph.getRecord('@.User:user123.posts({"category":"lifestyle","first":2}).edges.1')!.node).toEqual({ __ref: "Post:post111" });
  });

  it("USERS_POSTS_QUERY — root users connection plus nested per-user posts(category) connections", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    docs.normalizeDocument({
      document: USERS_POSTS_QUERY,
      variables: {
        role: "dj",
        usersFirst: 2,
        usersAfter: null,
        category: "tech",
        postsFirst: 1,
        postsAfter: null,
      },
      rootId: "@",
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
          edges: [
            {
              cursor: "u1",
              node: {
                __typename: "User",
                id: "user123",
                email: "a@x",
                posts: {
                  __typename: "PostConnection",
                  pageInfo: { __typename: "PageInfo", startCursor: "tp1", endCursor: "tp1", hasNextPage: false, hasPreviousPage: false },
                  edges: [{ cursor: "tp1", node: { __typename: "Post", id: "post456", title: "T1", tags: [] } }],
                },
              },
            },
            {
              cursor: "u2",
              node: {
                __typename: "User",
                id: "user999",
                email: "b@x",
                posts: {
                  __typename: "PostConnection",
                  pageInfo: { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
                  edges: [],
                },
              },
            },
          ],
        },
      },
    });

    // Root connection
    const rootUsersConnId = '@.users({"first":2,"role":"dj"})';
    expect(graph.getRecord(rootUsersConnId)!.edges).toEqual([
      { __ref: '@.users({"first":2,"role":"dj"}).edges.0' },
      { __ref: '@.users({"first":2,"role":"dj"}).edges.1' },
    ]);

    // Per-user posts connections
    const u1PostsConnId = '@.User:user123.posts({"category":"tech","first":1})';
    const u2PostsConnId = '@.User:user999.posts({"category":"tech","first":1})';
    expect(graph.getRecord(u1PostsConnId)!.edges).toEqual([
      { __ref: '@.User:user123.posts({"category":"tech","first":1}).edges.0' },
    ]);
    expect(graph.getRecord(u2PostsConnId)!.edges).toEqual([]);
  });

  it("USER_POSTS_COMMENTS_QUERY — nested posts connection and post comments connection as separate records", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    // posts(tech) + comments page 1
    docs.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: { id: "user123", category: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: null },
      rootId: "@",
      data: {
        user: {
          __typename: "User",
          id: "user123",
          email: "a@x",
          posts: {
            __typename: "PostConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "tp1", endCursor: "tp1", hasNextPage: false, hasPreviousPage: false },
            edges: [
              {
                cursor: "tp1",
                node: {
                  __typename: "Post",
                  id: "post456",
                  title: "T1",
                  tags: [],
                  comments: {
                    __typename: "CommentConnection",
                    pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
                    edges: [
                      { cursor: "c1", node: { __typename: "Comment", id: "c10", text: "Nice", author: { __typename: "User", id: "user999" } } },
                      { cursor: "c2", node: { __typename: "Comment", id: "c11", text: "Great", author: { __typename: "User", id: "user777" } } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    });

    // comments page 2
    docs.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: { id: "user123", category: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 1, commentsAfter: "c2" },
      rootId: "@",
      data: {
        user: {
          __typename: "User",
          id: "user123",
          posts: {
            __typename: "PostConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "tp1", endCursor: "tp1", hasNextPage: false, hasPreviousPage: false },
            edges: [
              {
                cursor: "tp1",
                node: {
                  __typename: "Post",
                  id: "post456",
                  title: "T1",
                  tags: [],
                  comments: {
                    __typename: "CommentConnection",
                    pageInfo: { __typename: "PageInfo", startCursor: "c3", endCursor: "c3", hasNextPage: false, hasPreviousPage: false },
                    edges: [{ cursor: "c3", node: { __typename: "Comment", id: "c12", text: "Thanks", author: { __typename: "User", id: "user999" } } }],
                  },
                },
              },
            ],
          },
        },
      },
    });

    // user posts connection
    const postsConnId = '@.User:user123.posts({"category":"tech","first":1})';
    expect(graph.getRecord(postsConnId)!.edges).toEqual([
      { __ref: '@.User:user123.posts({"category":"tech","first":1}).edges.0' },
    ]);

    // post comments connection (note: per your spec, this uses '@post456...' without the dot)
    const commentsConnId = '@post456.comments({"first":2})'; // first page args
    expect(graph.getRecord(commentsConnId)!.edges).toEqual([
      { __ref: '@post456.comments({"first":2}).edges.0' },
      { __ref: '@post456.comments({"first":2}).edges.1' },
    ]);

    // second comments page is a separate connection id by args
    const commentsConnId2 = '@post456.comments({"after":"c2","first":1})';
    expect(graph.getRecord(commentsConnId2)!.edges).toEqual([
      { __ref: '@post456.comments({"after":"c2","first":1}).edges.0' },
    ]);

    // edge nodes reference comment entities with authors
    expect(graph.getRecord('@post456.comments({"first":2}).edges.0')!.node).toEqual({ __ref: "Comment:c10" });
    expect(graph.getRecord('@post456.comments({"after":"c2","first":1}).edges.0')!.node).toEqual({ __ref: "Comment:c12" });
    expect(graph.getRecord("Comment:c10")!.author).toEqual({ __ref: "User:user999" });
    expect(graph.getRecord("Comment:c12")!.author).toEqual({ __ref: "User:user999" });
  });

  it("USERS_POSTS_COMMENTS_QUERY — root users connection and nested per-user posts + per-post comments connections", () => {
    const graph = makeGraph();
    const docs = makeDocs(graph);

    docs.normalizeDocument({
      document: USERS_POSTS_COMMENTS_QUERY,
      variables: {
        role: "admin",
        usersFirst: 2,
        usersAfter: null,
        category: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: null,
      },
      rootId: "@",
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
          edges: [
            {
              cursor: "u1",
              node: {
                __typename: "User",
                id: "user123",
                email: "a@x",
                posts: {
                  __typename: "PostConnection",
                  pageInfo: { __typename: "PageInfo", startCursor: "tp1", endCursor: "tp1", hasNextPage: false, hasPreviousPage: false },
                  edges: [
                    {
                      cursor: "tp1",
                      node: {
                        __typename: "Post",
                        id: "post456",
                        title: "T1",
                        tags: [],
                        comments: {
                          __typename: "CommentConnection",
                          pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
                          edges: [{ cursor: "c1", node: { __typename: "Comment", id: "c10", text: "ok" } }],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    const rootUsersConnId = '@.users({"first":2,"role":"admin"})';
    expect(graph.getRecord(rootUsersConnId)!.edges).toEqual([
      { __ref: '@.users({"first":2,"role":"admin"}).edges.0' },
    ]);

    const u1PostsConnId = '@.User:user123.posts({"category":"tech","first":1})';
    expect(graph.getRecord(u1PostsConnId)!.edges).toEqual([
      { __ref: '@.User:user123.posts({"category":"tech","first":1}).edges.0' },
    ]);

    const pCommentsConnId = '@post456.comments({"first":1})';
    expect(graph.getRecord(pCommentsConnId)!.edges).toEqual([
      { __ref: '@post456.comments({"first":1}).edges.0' },
    ]);
    expect(graph.getRecord('@post456.comments({"first":1}).edges.0')!.node).toEqual({ __ref: "Comment:c10" });
  });
});
