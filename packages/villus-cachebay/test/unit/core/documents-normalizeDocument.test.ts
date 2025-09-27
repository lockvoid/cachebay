import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createPlanner } from "@/src/core/planner";
import { createOptimistic } from "@/src/core/optimistic";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import {
  USER_QUERY,
  USERS_QUERY,
  USER_POSTS_QUERY,
  UPDATE_USER_MUTATION,
  USER_UPDATED_SUBSCRIPTION,
  USERS_POSTS_QUERY,
  USER_POSTS_COMMENTS_QUERY,
  USERS_POSTS_COMMENTS_QUERY,
  USERS_PAGE_QUERY,
  COMMENTS_PAGE_QUERY,
} from "@/test/helpers";

describe("documents.normalizeDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let views: ReturnType<typeof createViews>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    optimistic = createOptimistic({ graph });
    views = createViews({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, views, canonical, planner });
  });

  it("normalizes root reference and entity snapshot for single user query", () => {
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

  it("normalizes root users connection with edge records", () => {
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

  it("preserves both category connections when writing tech then lifestyle posts", () => {
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

  it("normalizes root users connection plus nested per-user posts connections", () => {
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

  it("normalizes nested posts and comments connections as separate records", () => {
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

  it("normalizes root users connection and nested posts plus comments connections", () => {
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

      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
      ],
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

  it("normalizes mutation operations correctly", () => {
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

  it("normalizes subscription operations correctly", () => {
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

  it("appends after cursor and prepends before cursor in canonical infinite mode", () => {
    const adminUsersLeaderData = {
      users: {
        __typename: "UserConnection",
        totalCount: 2,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },

        edges: [
          { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1" } },
          { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2" } },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
      data: adminUsersLeaderData,
    });

    const adminUsersAfterData = {
      users: {
        __typename: "UserConnection",
        totalCount: 3,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u3",
          endCursor: "u3",
          hasNextPage: true,
          hasPreviousPage: false,
        },

        edges: [
          { __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3" } },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: "u2" },
      data: adminUsersAfterData,
    });

    const adminUsersBeforeData = {
      users: {
        __typename: "UserConnection",
        totalCount: 99,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u0",
          endCursor: "u0",
          hasNextPage: false,
          hasPreviousPage: true,
        },

        edges: [
          { __typename: "UserEdge", cursor: "u0", node: { __typename: "User", id: "u0" } },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", last: 1, before: "u1" } as any,
      data: adminUsersBeforeData,
    });

    const adminUsersConnection = graph.getRecord('@connection.users({"role":"admin"})')!;

    expect(adminUsersConnection.edges.length).toBe(4);
    expect(adminUsersConnection.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "u0", endCursor: "u3", hasNextPage: true, hasPreviousPage: true });
    expect(graph.getRecord(adminUsersConnection.edges[0].__ref as string)!).toEqual({ __typename: "UserEdge", cursor: "u0", node: { __ref: "User:u0" } });
    expect(graph.getRecord(adminUsersConnection.edges[1].__ref as string)!).toEqual({ __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    expect(graph.getRecord(adminUsersConnection.edges[2].__ref as string)!).toEqual({ __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    expect(graph.getRecord(adminUsersConnection.edges[3].__ref as string)!).toEqual({ __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u3" } });
  });

  it("appends after cursor and prepends before cursor in canonical page mode", () => {
    const moderatorUsersLeaderData = {
      users: {
        __typename: "UserConnection",
        totalCount: 10,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "m1",
          endCursor: "m2",
          hasNextPage: true,
          hasPreviousPage: false,
        },

        edges: [
          {
            __typename: "UserEdge",
            cursor: "m1",
            node: { __typename: "User", id: "m1", email: "m1@example.com" },
          },

          {
            __typename: "UserEdge",
            cursor: "m2",
            node: { __typename: "User", id: "m2", email: "m2@example.com" },
          },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", first: 2, after: null },
      data: moderatorUsersLeaderData,
    });

    const moderatorUsersAfterData = {
      users: {
        __typename: "UserConnection",
        totalCount: 12,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "m3",
          endCursor: "m4",
          hasNextPage: true,
          hasPreviousPage: false,
        },

        edges: [
          {
            __typename: "UserEdge",
            cursor: "m3",
            node: { __typename: "User", id: "m3", email: "m3@example.com" },
          },

          {
            __typename: "UserEdge",
            cursor: "m4",
            node: { __typename: "User", id: "m4", email: "m4@example.com" },
          },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", first: 2, after: "m2" },
      data: moderatorUsersAfterData,
    });

    const moderatorUsersBeforeData = {
      users: {
        __typename: "UserConnection",
        totalCount: 1,

        pageInfo: {
          __typename: "PageInfo",
          startCursor: "m0",
          endCursor: "m0",
          hasNextPage: false,
          hasPreviousPage: true,
        },

        edges: [
          {
            __typename: "UserEdge",
            cursor: "m0",
            node: { __typename: "User", id: "m0", email: "m0@example.com" },
          },
        ],
      },
    };

    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", last: 1, before: "m3" } as any,
      data: moderatorUsersBeforeData,
    });

    const moderatorUsersAfterPage = graph.getRecord('@.users({"after":"m2","first":2,"role":"mod"})')!;

    expect(moderatorUsersAfterPage.totalCount).toBe(12);
    expect(moderatorUsersAfterPage.edges.length).toBe(2);
    expect(moderatorUsersAfterPage.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "m3", endCursor: "m4", hasNextPage: true, hasPreviousPage: false });
    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"mod"}).edges.0')).toEqual({ __typename: "UserEdge", cursor: "m3", node: { __ref: "User:m3" } });
    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"mod"}).edges.1')).toEqual({ __typename: "UserEdge", cursor: "m4", node: { __ref: "User:m4" } });

    const moderatorUsersBeforePage = graph.getRecord('@.users({"before":"m3","last":1,"role":"mod"})')!;

    expect(moderatorUsersBeforePage.totalCount).toBe(1);
    expect(moderatorUsersBeforePage.edges.length).toBe(1);
    expect(moderatorUsersBeforePage.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "m0", endCursor: "m0", hasNextPage: false, hasPreviousPage: true });
    expect(graph.getRecord('@.users({"before":"m3","last":1,"role":"mod"}).edges.0')).toEqual({ __typename: "UserEdge", cursor: "m0", node: { __ref: "User:m0" } });
  });

  it("appends after cursor in canonical nested comments infinite mode", () => {
    const user1PostsComments_page1 = {
      user: {
        __typename: "User",
        id: "u1",

        posts: {
          __typename: "PostConnection",

          pageInfo: {
            __typename: "PageInfo",
            startCursor: "p1",
            endCursor: "p1"
          },

          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",

              node: {
                __typename: "Post",
                id: "p1",

                comments: {
                  __typename: "CommentConnection",
                  totalCount: 2,

                  pageInfo: {
                    __typename: "PageInfo",
                    startCursor: "c1",
                    endCursor: "c2",
                    hasNextPage: true,
                    hasPreviousPage: false,
                  },

                  edges: [
                    { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1" } },
                    { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2" } },
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

      data: user1PostsComments_page1,
    });

    const user1PostsCommentsAfterData = {
      user: {
        __typename: "User",
        id: "u1",

        posts: {
          __typename: "PostConnection",

          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",

              node: {
                __typename: "Post",
                id: "p1",

                comments: {
                  __typename: "CommentConnection",
                  totalCount: 3,

                  pageInfo: {
                    __typename: "PageInfo",
                    startCursor: "c3",
                    endCursor: "c3",
                    hasNextPage: true,
                    hasPreviousPage: false
                  },

                  edges: [
                    { __typename: "CommentEdge", cursor: "c3", node: { __typename: "Comment", id: "c3", text: "Comment 3" } },
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
        commentsFirst: 1,
        commentsAfter: "c2",
      },

      data: user1PostsCommentsAfterData,
    });

    const post1CommentsConnection = graph.getRecord('@connection.Post:p1.comments({})')!;

    expect(post1CommentsConnection.totalCount).toBe(2);
    expect(post1CommentsConnection.edges.length).toBe(3);
    expect(post1CommentsConnection.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "c1", endCursor: "c3", hasNextPage: true, hasPreviousPage: false });
    expect(post1CommentsConnection.edges[0]).toEqual({ __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.0' });
    expect(post1CommentsConnection.edges[1]).toEqual({ __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.1' });
    expect(post1CommentsConnection.edges[2]).toEqual({ __ref: '@.Post:p1.comments({"after":"c2","first":1}).edges.0' });
    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges.0')).toEqual({ __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges.1')).toEqual({ __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });
    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1}).edges.0')).toEqual({ __typename: "CommentEdge", cursor: "c3", node: { __ref: "Comment:c3" } });
  });

  it("replaces edges for each page in canonical nested comments page mode", () => {
    const post9CommentsLeaderData = {
      post: {
        __typename: "Post",
        id: "p9",

        comments: {
          __typename: "CommentConnection",
          totalCount: 10,

          pageInfo: {
            __typename: "PageInfo",
            startCursor: "x1",
            endCursor: "x2",
            hasNextPage: true,
            hasPreviousPage: false,
          },

          edges: [
            { __typename: "CommentEdge", cursor: "x1", node: { __typename: "Comment", id: "x1" } },
            { __typename: "CommentEdge", cursor: "x2", node: { __typename: "Comment", id: "x2" } },
          ],
        },
      },
    };

    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,
      variables: { postId: "p9", first: 2, after: null },
      data: post9CommentsLeaderData,
    });

    const post9CommentsConnection = graph.getRecord('@connection.Post:p9.comments({})')!;

    expect(post9CommentsConnection.totalCount).toBe(10);
    expect(post9CommentsConnection.edges.length).toBe(2);
    expect(post9CommentsConnection.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false });
    expect(post9CommentsConnection.edges[0]).toEqual({ __ref: '@.Post:p9.comments({"after":null,"first":2}).edges.0' });
    expect(post9CommentsConnection.edges[1]).toEqual({ __ref: '@.Post:p9.comments({"after":null,"first":2}).edges.1' });
    expect(graph.getRecord('@.Post:p9.comments({"after":null,"first":2}).edges.0')).toEqual({ __typename: "CommentEdge", cursor: "x1", node: { __ref: "Comment:x1" } });
    expect(graph.getRecord('@.Post:p9.comments({"after":null,"first":2}).edges.1')).toEqual({ __typename: "CommentEdge", cursor: "x2", node: { __ref: "Comment:x2" } });

    const post9CommentsAfterData = {
      post: {
        __typename: "Post",
        id: "p9",

        comments: {
          __typename: "CommentConnection",
          totalCount: 12,

          pageInfo: {
            __typename: "PageInfo",
            startCursor: "x3",
            endCursor: "x4",
            hasNextPage: false,
            hasPreviousPage: true,
          },

          edges: [
            { __typename: "CommentEdge", cursor: "x3", node: { __typename: "Comment", id: "x3" } },
            { __typename: "CommentEdge", cursor: "x4", node: { __typename: "Comment", id: "x4" } },
          ],
        },
      },
    };

    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,

      variables: {
        postId: "p9",
        first: 2,
        after: "x2"
      },

      data: post9CommentsAfterData,
    });

    const post9CommentsAfterPage = graph.getRecord('@connection.Post:p9.comments({})')!;

    expect(post9CommentsAfterPage.totalCount).toBe(12);
    expect(post9CommentsAfterPage.edges.length).toBe(2);
    expect(post9CommentsAfterPage.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "x3", endCursor: "x4", hasNextPage: false, hasPreviousPage: true });
    expect(post9CommentsAfterPage.edges[0]).toEqual({ __ref: '@.Post:p9.comments({"after":"x2","first":2}).edges.0' });
    expect(post9CommentsAfterPage.edges[1]).toEqual({ __ref: '@.Post:p9.comments({"after":"x2","first":2}).edges.1' });
    expect(graph.getRecord('@.Post:p9.comments({"after":"x2","first":2}).edges.0')).toEqual({ __typename: "CommentEdge", cursor: "x3", node: { __ref: "Comment:x3" } });
    expect(graph.getRecord('@.Post:p9.comments({"after":"x2","first":2}).edges.1')).toEqual({ __typename: "CommentEdge", cursor: "x4", node: { __ref: "Comment:x4" } });

    const post9CommentsBeforeData = {
      post: {
        __typename: "Post",
        id: "p9",
        comments: {
          __typename: "CommentConnection",
          totalCount: 1,
          pageInfo: {
            __typename: "PageInfo",
            startCursor: "x0",
            endCursor: "x0",
            hasNextPage: false,
            hasPreviousPage: true,
          },
          edges: [
            { __typename: "CommentEdge", cursor: "x0", node: { __typename: "Comment", id: "x0" } },
          ],
        },
      },
    };

    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,
      variables: { postId: "p9", last: 1, before: "x3" } as any,
      data: post9CommentsBeforeData,
    });

    const post9CommentsBeforePage = graph.getRecord('@connection.Post:p9.comments({})')!;

    expect(post9CommentsBeforePage.totalCount).toBe(1);
    expect(post9CommentsBeforePage.edges.length).toBe(1);
    expect(post9CommentsBeforePage.pageInfo).toEqual({ __typename: "PageInfo", startCursor: "x0", endCursor: "x0", hasNextPage: false, hasPreviousPage: true });
    expect(post9CommentsBeforePage.edges[0]).toEqual({ __ref: '@.Post:p9.comments({"before":"x3","last":1}).edges.0' });
    expect(graph.getRecord('@.Post:p9.comments({"before":"x3","last":1}).edges.0')).toEqual({ __typename: "CommentEdge", cursor: "x0", node: { __ref: "Comment:x0" } });
  });

  it("updates view when appending comments after leader page", () => {
    const user1PostsComments_initial = {
      user: {
        __typename: "User",
        id: "u1",
        posts: {
          __typename: "PostConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",
              node: {
                __typename: "Post",
                id: "p1",
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
                    { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1", text: "Comment 1" } },
                    { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2", text: "Comment 2" } },
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
      data: user1PostsComments_initial,
    });

    const initialView = documents.materializeDocument({
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

    const initialCommentTexts = (initialView.user.posts.edges[0].node.comments.edges || []).map((e: any) => e?.node?.text);
    expect(initialCommentTexts).toEqual(["Comment 1", "Comment 2"]);

    const user1PostsCommentsAfterData = {
      user: {
        __typename: "User",
        id: "u1",
        posts: {
          __typename: "PostConnection",
          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",
              node: {
                __typename: "Post",
                id: "p1",
                comments: {
                  __typename: "CommentConnection",
                  totalCount: 2,
                  pageInfo: { __typename: "PageInfo", startCursor: "c3", endCursor: "c3", hasNextPage: true, hasPreviousPage: false },
                  edges: [{ __typename: "CommentEdge", cursor: "c3", node: { __typename: "Comment", id: "c3", text: "Comment 3" } }],
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
        commentsFirst: 1,
        commentsAfter: "c2",
      },
      data: user1PostsCommentsAfterData,
    });

    const updatedView = documents.materializeDocument({
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

    const updatedCommentTexts = (updatedView.user.posts.edges[0].node.comments.edges || []).map((e: any) => e?.node?.text);
    expect(updatedCommentTexts).toEqual(["Comment 1", "Comment 2", "Comment 3"]);
  });

  it("merges nested comments independently per parent with anchored pageInfo", () => {
    const user1PostsComments_page1 = {
      user: {
        __typename: "User",
        id: "u1",

        posts: {
          __typename: "PostConnection",

          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",

              node: {
                __typename: "Post", id: "p1",

                comments: {
                  __typename: "CommentConnection",
                  pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
                  edges: [
                    { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1" } },
                    { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2" } },
                  ],
                }
              }
            }],
        },
      },
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },

      data: user1PostsComments_page1,
    });

    const user1PostsComments_page2 = {
      user: {
        __typename: "User",
        id: "u1",
        posts: {
          __typename: "PostConnection",
          edges: [
            {
              __typename: "PostEdge", cursor: "p2", node: {
                __typename: "Post", id: "p2",
                comments: {
                  __typename: "CommentConnection",
                  pageInfo: { __typename: "PageInfo", startCursor: "c9", endCursor: "c9", hasNextPage: false, hasPreviousPage: false },
                  edges: [{ __typename: "CommentEdge", cursor: "c9", node: { __typename: "Comment", id: "c9" } }],
                }
              }
            }],
        },
      },
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: null,
      },

      data: user1PostsComments_page2,
    });

    const user1PostsComments_page3 = {
      user: {
        __typename: "User",
        id: "u1",

        posts: {
          __typename: "PostConnection",

          edges: [
            {
              __typename: "PostEdge",
              cursor: "p1",

              node: {
                __typename: "Post",
                id: "p1",

                comments: {
                  __typename: "CommentConnection",
                pageInfo: {
                  __typename: "PageInfo",
                  startCursor: "c3",
                  endCursor: "c3",
                  hasNextPage: false,
                  hasPreviousPage: false
                },

                edges: [
                  { __typename: "CommentEdge", cursor: "c3", node: { __typename: "Comment", id: "c3" } },
                ],
              }
            }
          }]
        }
      }
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,

      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c2"
      },

      data: user1PostsComments_page3,
    });

    const user1PostsComments_page4 = {
      user: {
        __typename: "User", id: "u1",
        posts: {
          __typename: "PostConnection",
          edges: [{
            __typename: "PostEdge",
            cursor: "p2",
            node: {
              __typename: "Post", id: "p2",

              comments: {
                __typename: "CommentConnection",
                pageInfo: { __typename: "PageInfo", startCursor: "c10", endCursor: "c10", hasNextPage: false, hasPreviousPage: false },
                edges: [{ __typename: "CommentEdge", cursor: "c10", node: { __typename: "Comment", id: "c10" } }],
              }
            }
          }]
        }
      }
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null, commentsFirst: 1, commentsAfter: "c9" },
      data: user1PostsComments_page4,
    });

    const post1CommentsConnection = graph.getRecord('@connection.Post:p1.comments({})');
    const post2CommentsConnection = graph.getRecord('@connection.Post:p2.comments({})');

    const post1CommentIds = (post1CommentsConnection.edges || []).map((r: any) => graph.getRecord(graph.getRecord(r.__ref).node.__ref).id);
    const post2CommentIds = (post2CommentsConnection.edges || []).map((r: any) => graph.getRecord(graph.getRecord(r.__ref).node.__ref).id);

    expect(post1CommentIds).toEqual(["c1", "c2", "c3"]);
    expect(post2CommentIds).toEqual(["c9", "c10"]);

    expect(post1CommentsConnection.pageInfo.startCursor).toBe("c1");
    expect(post1CommentsConnection.pageInfo.endCursor).toBe("c3");
    expect(post2CommentsConnection.pageInfo.startCursor).toBe("c9");
    expect(post2CommentsConnection.pageInfo.endCursor).toBe("c10");
  });
});
