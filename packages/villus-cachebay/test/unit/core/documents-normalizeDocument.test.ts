import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
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
// GraphQL Queries
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

export const UPDATE_USER_MUTATION = gql`
  ${USER_FRAGMENT}

  mutation UpdateUserMutation($input: UpdateUserInput!, $postCategory: String!, $postFirst: Int!, $postAfter: String!) {
    updateUser(id: $id, input: $input) {
      __typename

      user {
        __typename

        ...UserFields

        name

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
`;

export const USER_UPDATED_SUBSCRIPTION = gql`
  ${USER_FRAGMENT}
  subscription UserUpdatedSubscription($id: ID!) {
    userUpdated(id: $id) {
      user {
        __typename

        ...UserFields

        name
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

const makeViews = (graph) => {
  return createViews({ graph });
}

const makeDocuments = (graph: ReturnType<typeof createGraph>, views: ReturnType<typeof makeViews>) =>
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
    { graph, views }
  );

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeDocument (progression by query)", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    views = makeViews(graph);
    documents = makeDocuments(graph, views);
  });

  it("USER_QUERY — root '@' reference and entity snapshot (Type:id)", () => {
    const userData = {
      user: { __typename: "User", id: "u1", email: "u1@example.com" },
    };

    documents.normalizeDocument({
      document: USER_QUERY,
      variables: { id: "u1" },
      data: userData,
    });

    const root = graph.getRecord("@");
    expect(root).toEqual({
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': { __ref: "User:u1" },
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1@example.com",
    });
  });

  it("USERS_QUERY — root users connection @.users({role,first}) with edge records", () => {
    const usersData_page1 = {
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
            node: { __typename: "User", id: "u1", email: "u1@example.com" },
          },
          {
            __typename: "UserEdge",
            cursor: "u2",
            node: { __typename: "User", id: "u2", email: "u2@example.com" },
          },
        ],
      },
    };

    const usersData_page2 = {
      users: {
        __typename: "UserConnection",

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u3",
          endCursor: "u3",
          hasNextPage: false,
          hasPreviousPage: false,
        },

        edges: [
          {
            __typename: "UserEdge",
            cursor: "u3",
            node: { __typename: "User", id: "u3", email: "u3@example.com" },
          },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
      data: usersData_page1,
    });

    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: "u2" },
      data: usersData_page2,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"})')).toEqual({
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

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: { __ref: "User:u2" },
    });

    expect(graph.getRecord('@.users({"after":"u2","first":2,"role":"admin"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u3",
        endCursor: "u3",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.users({"after":"u2","first":2,"role":"admin"}).edges.0' },
      ],
    });

    expect(graph.getRecord('@.users({"after":"u2","first":2,"role":"admin"}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u3",
      node: { __ref: "User:u3" },
    });
  });

  it("USER_POSTS_QUERY — write category 'tech' first, then 'lifestyle'; BOTH keys and connections remain in cache", () => {
    const userPosts_tech = {
      user: {
        __typename: "User",
        id: "u1",
        email: "u1@example.com",

        posts: {
          __typename: "PostConnection",

          totalCount: 2,

          pageInfo: {
            startCursor: "p1",
            endCursor: "p2",
            hasNextPage: true,
            hasPreviousPage: false,
            __typename: "PageInfo",
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
                tags: ["react"],

                author: {
                  __typename: "User",
                  id: "u1",
                },
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
                tags: ["js"],

                author: {
                  __typename: "User",
                  id: "u1",
                },
              },
            },
          ],
        },
      },
    };

    const userPosts_lifestyle = {
      user: {
        __typename: "User",
        id: "u1",

        posts: {
          __typename: "PostConnection",

          totalCount: 1,

          pageInfo: {
            __typename: "PageInfo",
            startCursor: "p3",
            endCursor: "p4",
            hasNextPage: false,
            hasPreviousPage: false,
          },

          edges: [
            {
              __typename: "PostEdge",
              cursor: "p3",
              score: 0.3,

              node: {
                __typename: "Post",
                id: "p3",
                title: "Post 3",
                tags: [],

                author: {
                  __typename: "User",
                  id: "u1"
                },
              },
            },

            {
              __typename: "PostEdge",
              cursor: "p4",
              score: 0.6,

              node: {
                __typename: "Post",
                id: "p4",
                title: "Post 4",
                tags: [],

                author: {
                  __typename: "User",
                  id: "u1"
                },
              },
            },
          ],
        },
      },
    };

    documents.normalizeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
      data: userPosts_tech,
    });

    documents.normalizeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "lifestyle", postsFirst: 2, postsAfter: null },
      data: userPosts_lifestyle,
    });

    expect(graph.getRecord("User:u1")).toEqual({
      __typename: 'User',
      id: 'u1',
      email: 'u1@example.com',

      'posts({"after":null,"category":"tech","first":2})': { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2})' },
      'posts({"after":null,"category":"lifestyle","first":2})': { __ref: '@.User:u1.posts({"after":null,"category":"lifestyle","first":2})' },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2})')).toEqual({
      __typename: 'PostConnection',
      totalCount: 2,

      pageInfo: {
        __typename: 'PageInfo',
        startCursor: 'p1',
        endCursor: 'p2',
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0' },
        { __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1' },
      ],
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"lifestyle","first":2})')).toEqual({
      __typename: 'PostConnection',
      totalCount: 1,

      pageInfo: {
        __typename: 'PageInfo',
        startCursor: 'p3',
        endCursor: 'p4',
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges.0' },
        { __ref: '@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges.1' },
      ],
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      score: 0.5,
      node: { __ref: "Post:p1" },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.1')).toEqual({
      __typename: "PostEdge",
      cursor: "p2",
      score: 0.7,
      node: { __ref: "Post:p2" },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p3",
      score: 0.3,
      node: { __ref: "Post:p3" },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges.1')).toEqual({
      __typename: "PostEdge",
      cursor: "p4",
      score: 0.6,
      node: { __ref: "Post:p4" },
    });
  });

  it("USERS_POSTS_QUERY — root users connection plus nested per-user posts(category) connections", () => {
    const usersPostsData = {
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
                    },
                  },
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
    };

    documents.normalizeDocument({
      document: USERS_POSTS_QUERY,
      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
      },
      data: usersPostsData,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.1' },
      ],
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });
    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: { __ref: "User:u2" },
    });

    console.log(graph.inspect())
    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
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

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" },
    });

    expect(graph.getRecord('@.User:u2.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [],
    });
  });

  it("USER_POSTS_COMMENTS_QUERY — nested posts connection and post comments connection as separate records", () => {
    const userPostsComments_page1 = {
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
                          id: "u2",
                        },
                      },
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
                          id: "u3",
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
    };

    const userPostsComments_page2 = {
      user: {
        __typename: "User",
        id: "u1",

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
                    startCursor: "c3",
                    endCursor: "c3",
                    hasNextPage: false,
                    hasPreviousPage: false,
                  },

                  edges: [
                    {
                      __typename: "CommentEdge",
                      cursor: "c3",

                      node: {
                        __typename: "Comment",
                        id: "c3",
                        text: "Comment 3",

                        author: {
                          __typename: "User",
                          id: "u2",
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
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },

      data: userPostsComments_page1,
    });

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c2",
      },

      data: userPostsComments_page2,
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [{ __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }],
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2})')).toEqual({
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

    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "c3",
        endCursor: "c3",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [{ __ref: '@.Post:p1.comments({"after":"c2","first":1}).edges.0' }],
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: { __ref: "Comment:c1" },
    });
    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges.1')).toEqual({
      __typename: "CommentEdge",
      cursor: "c2",
      node: { __ref: "Comment:c2" },
    });
    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c3",
      node: { __ref: "Comment:c3" },
    });
    expect(graph.getRecord("Comment:c1")).toEqual({
      __typename: "Comment",
      id: "c1",
      text: "Comment 1",
      author: { __ref: "User:u2" },
    });
    expect(graph.getRecord("Comment:c2")).toEqual({
      __typename: "Comment",
      id: "c2",
      text: "Comment 2",
      author: { __ref: "User:u3" },
    });
    expect(graph.getRecord("Comment:c3")).toEqual({
      __typename: "Comment",
      id: "c3",
      text: "Comment 3",
      author: { __ref: "User:u2" },
    });
  });

  it("USERS_POSTS_COMMENTS_QUERY — root users connection and nested per-user posts + per-post comments connections", () => {
    const usersPostsCommentsData = {
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
                              text: "Comment 1",
                            },
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
    };

    documents.normalizeDocument({
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

      data: usersPostsCommentsData,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [{ __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' }],
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [{ __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }],
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":1})')).toEqual({
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

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":1}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: { __ref: "Comment:c1" },
    });
  });

  it("UPDATE_USER_MUTATION — mutation operations normalize entities correctly", () => {
    const updateUserData = {
      updateUser: {
        user: {
          __typename: "User",
          id: "u1",
          email: "u1_updated@example.com",
          name: "Updated User 1",

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
                }
              }
            ]
          }
        }
      },
    };

    documents.normalizeDocument({
      document: UPDATE_USER_MUTATION,

      variables: {
        input: {
          id: "u1",
          email: "u1_updated@example.com",
          name: "Updated User 1"
        }
      },

      data: updateUserData,
    });

    console.log(graph.inspect());
    expect(graph.getRecord("@")).toEqual({
      id: "@",
      __typename: "@",
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1_updated@example.com",
      name: "Updated User 1",


    });
  });

  it("USER_UPDATED_SUBSCRIPTION — subscription operations normalize entities correctly", () => {
    const userUpdatedData = {
      userUpdated: {
        __typename: "UserUpdated",

        user: {
          __typename: "User",
          id: "u1",
          email: "u1_subscribed@example.com",
          name: "Subscribed User 1",
        }
      },
    };

    documents.normalizeDocument({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: userUpdatedData,
    });

    expect(graph.getRecord("@")).toEqual({
      id: "@",
      __typename: "@",
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1_subscribed@example.com",
      name: "Subscribed User 1",
    });
  });
});
