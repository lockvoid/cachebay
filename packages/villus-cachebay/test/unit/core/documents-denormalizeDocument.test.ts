import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
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
// GraphQL Queries (used to drive denormalizeDocument)
// ─────────────────────────────────────────────────────────────────────────────

export const USER_QUERY = gql`
  ${USER_FRAGMENT}

  query UserQuery($id: ID!) {
    user(id: $id) {
      __typename

      ...UserFields
    }
  }
`;

export const USERS_QUERY = gql`
  ${USER_FRAGMENT}

  query UsersQuery($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) {
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
      __typename

      ...UserFields

      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) {
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

            ...PostFields

            author {
              __typename
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
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) {
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

          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) {
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
      __typename

      ...UserFields

      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) {
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

            ...PostFields

            comments(first: $commentsFirst, after: $commentsAfter) {
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

                  ...CommentFields

                  author {
                    __typename
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
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) {
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

          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) {
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

                ...PostFields

                comments(first: $commentsFirst, after: $commentsAfter) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

const makeGraph = () =>
  createGraph({
    interfaces: {
      Post: ["AudioPost", "VideoPost"],
    },
  });

const makeDocuments = (graph: ReturnType<typeof createGraph>) =>
  createDocuments(
    {
      connections: {
        Query: {
          users: { mode: "infinite", args: ["role"] }
        },

        User: {
          posts: { mode: "infinite", args: ["category"] }
        },

        Post: {
          comments: { mode: "infinite" }
        },
      },
    },
    { graph }
  );

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("denormalizeDocument (progression by query)", () => {
  let graph: ReturnType<typeof createGraph>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    documents = makeDocuments(graph);
  });

  it("USER_QUERY — returns plain user object for @['user({id})'] → __ref User:u1", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': { __ref: "User:u1" }
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    const result = documents.denormalizeDocument({ document: USER_QUERY, variables: { id: "u1" } });

    expect(result).toEqual({
      user: {
        __typename: "User",
        id: "u1",
        email: "u1@example.com"
      },
    });
  });

  it("USERS_QUERY — returns exact page for users({role,first,after}) with edges", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'users({"after":null,"first":2,"role":"admin"})': { __ref: '@.users({"after":null,"first":2,"role":"admin"})' },
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    graph.putRecord("User:u2", {
      __typename: "User",
      id: "u2",
      email: "u2@example.com"
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', {
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.1', {
      __typename: "UserEdge",
      cursor: "u2",
      node: { __ref: "User:u2" },
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.1' },
      ],
    });

    const result = documents.denormalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
    });

    expect(result).toEqual({
      users: {
        __typename: "UserConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          {
            __typename: "UserEdge",
            cursor: "u1",
            node: {
              __typename: "User",
              id: "u1",
              email: "u1@example.com"
            }
          },
          {
            __typename: "UserEdge",
            cursor: "u2",
            node: {
              __typename: "User",
              id: "u2",
              email: "u2@example.com"
            }
          },
        ],
      },
    });
  });

  it("USER_POSTS_QUERY — returns exact page; includes connection totalCount and edge score", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': { __ref: "User:u1" }
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    graph.putRecord("Post:p1", {
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      tags: []
    });

    graph.putRecord("Post:p2", {
      __typename: "Post",
      id: "p2",
      title: "Post 2",
      tags: []
    });

    // connection page (tech)
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

    const result = documents.denormalizeDocument({
      document: USER_POSTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
      },
    });

    expect(result).toEqual({
      user: {
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
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
              node: {
                __typename: "Post",
                id: "p1",
                title: "Post 1",
                tags: [],
              },
            },
            {
              __typename: "PostEdge",
              cursor: "p2",
              score: 0.7,
              node: {
                __typename: "Post",
                id: "p2",
                title: "Post 2",
                tags: [],
              },
            },
          ],
        },
      },
    });
  });

  it("USERS_POSTS_QUERY — root users page; nested posts page per user", () => {
    // root users
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'users({"after":null,"first":2,"role":"dj"})': { __ref: '@.users({"after":null,"first":2,"role":"dj"})' }
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    graph.putRecord("User:u2", {
      __typename: "User",
      id: "u2",
      email: "u2@example.com"
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.0', {
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" }
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.1', {
      __typename: "UserEdge",
      cursor: "u2",
      node: { __ref: "User:u2" }
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
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
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.1' },
      ],
    });

    // nested posts for u1
    graph.putRecord("Post:p1", {
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      tags: []
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', {
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" }
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' },
      ],
    });

    // nested posts for u2 (empty)
    graph.putRecord('@.User:u2.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false
      },
      edges: [],
    });

    const result = documents.denormalizeDocument({
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

    expect(result).toEqual({
      users: {
        __typename: "UserConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          {
            __typename: "UserEdge",
            cursor: "u1",
            node: {
              __typename: "User",
              id: "u1",
              email: "u1@example.com",
              posts: {
                __typename: "PostConnection",
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: "p1",
                  endCursor: "p1",
                  hasNextPage: false,
                  hasPreviousPage: false,
                },
                edges: [
                  {
                    __typename: "PostEdge",
                    cursor: "p1",
                    node: {
                      __typename: "Post",
                      id: "p1",
                      title: "Post 1",
                      tags: []
                    }
                  }
                ],
              },
            },
          },
          {
            __typename: "UserEdge",
            cursor: "u2",
            node: {
              __typename: "User",
              id: "u2",
              email: "u2@example.com",
              posts: {
                __typename: "PostConnection",
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: null,
                  endCursor: null,
                  hasNextPage: false,
                  hasPreviousPage: false,
                },
                edges: [],
              },
            },
          },
        ],
      },
    });
  });

  it("USER_POSTS_COMMENTS_QUERY — nested posts & nested comments pages", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': { __ref: "User:u1" }
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    graph.putRecord("User:u2", {
      __typename: "User",
      id: "u2"
    });

    graph.putRecord("User:u3", {
      __typename: "User",
      id: "u3"
    });

    graph.putRecord("Post:p1", {
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      tags: []
    });

    graph.putRecord("Comment:c1", {
      __typename: "Comment",
      id: "c1",
      text: "Comment 1",
      author: { __ref: "User:u2" }
    });

    graph.putRecord("Comment:c2", {
      __typename: "Comment",
      id: "c2",
      text: "Comment 2",
      author: { __ref: "User:u3" }
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', {
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" },
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' },
      ],
    });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.0', {
      __typename: "CommentEdge",
      cursor: "c1",
      node: { __ref: "Comment:c1" },
    });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.1', {
      __typename: "CommentEdge",
      cursor: "c2",
      node: { __ref: "Comment:c2" },
    });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":2})', {
      __typename: "CommentConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.0' },
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.1' },
      ],
    });

    const result = documents.denormalizeDocument({
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

    expect(result).toEqual({
      user: {
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
        posts: {
          __typename: "PostConnection",
          pageInfo: {
            __typename: "PageInfo",
            startCursor: "p1",
            endCursor: "p1",
            hasNextPage: false,
            hasPreviousPage: false,
          },
          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",
              node: {
                __typename: "Post",
                id: "p1",
                title: "Post 1",
                tags: [],
                comments: {
                  __typename: "CommentConnection",
                  pageInfo: {
                    __typename: "PageInfo",
                    startCursor: "c1",
                    endCursor: "c2",
                    hasNextPage: true,
                    hasPreviousPage: false,
                  },
                  edges: [
                    {
                      __typename: "CommentEdge",
                      cursor: "c1",
                      node: {
                        __typename: "Comment",
                        id: "c1",
                        text: "Comment 1",
                        author: {
                          __typename: "User",
                          id: "u2"
                        }
                      }
                    },
                    {
                      __typename: "CommentEdge",
                      cursor: "c2",
                      node: {
                        __typename: "Comment",
                        id: "c2",
                        text: "Comment 2",
                        author: {
                          __typename: "User",
                          id: "u3"
                        }
                      }
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });
  });

  it("USERS_POSTS_COMMENTS_QUERY — root users page + nested posts & nested comments", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'users({"after":null,"first":2,"role":"admin"})': { __ref: '@.users({"after":null,"first":2,"role":"admin"})' }
    });

    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com"
    });

    graph.putRecord("Post:p1", {
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      tags: []
    });

    graph.putRecord("Comment:c1", {
      __typename: "Comment",
      id: "c1",
      text: "Comment 1"
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', {
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
      ],
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', {
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" }
    });

    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' },
      ],
    });

    graph.putRecord('@.Post:p1.comments({"after":null,"first":1}).edges.0', {
      __typename: "CommentEdge",
      cursor: "c1",
      node: { __ref: "Comment:c1" }
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
      edges: [
        { __ref: '@.Post:p1.comments({"after":null,"first":1}).edges.0' },
      ],
    });

    const result = documents.denormalizeDocument({
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

    expect(result).toEqual({
      users: {
        __typename: "UserConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          {
            __typename: "UserEdge",
            cursor: "u1",
            node: {
              __typename: "User",
              id: "u1",
              email: "u1@example.com",
              posts: {
                __typename: "PostConnection",
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: "p1",
                  endCursor: "p1",
                  hasNextPage: false,
                  hasPreviousPage: false,
                },
                edges: [
                  {
                    __typename: "PostEdge",
                    cursor: "p1",
                    node: {
                      __typename: "Post",
                      id: "p1",
                      title: "Post 1",
                      tags: [],
                      comments: {
                        __typename: "CommentConnection",
                        pageInfo: {
                          __typename: "PageInfo",
                          startCursor: "c1",
                          endCursor: "c1",
                          hasNextPage: false,
                          hasPreviousPage: false,
                        },
                        edges: [
                          {
                            __typename: "CommentEdge",
                            cursor: "c1",
                            node: {
                              __typename: "Comment",
                              id: "c1",
                              text: "Comment 1"
                            }
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
  });
});
