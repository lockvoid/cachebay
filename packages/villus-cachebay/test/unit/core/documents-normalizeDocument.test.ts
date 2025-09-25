import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createPlanner } from "@/src/core/planner";
import { createOptimistic } from "@/src/core/optimistic";
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
// GraphQL Queries
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

export const UPDATE_USER_MUTATION = gql`
  ${USER_FRAGMENT}

  mutation UpdateUserMutation($input: UpdateUserInput!, $postCategory: String!, $postFirst: Int!, $postAfter: String!) {
    updateUser(id: $id, input: $input) {

      user {

        ...UserFields

        name

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
`;

export const USER_UPDATED_SUBSCRIPTION = gql`
  ${USER_FRAGMENT}
  subscription UserUpdatedSubscription($id: ID!) {
    userUpdated(id: $id) {
      user {

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

const makeOptimistic = (graph: ReturnType<typeof createGraph>) => {
  return createOptimistic({ graph });
};

const makeViews = (graph: ReturnType<typeof createGraph>) => {
  return createViews({ graph });
};

const makePlanner = () => {
  // no options — compiler reads @connection
  return createPlanner();
};

const makeCanonical = (graph: ReturnType<typeof createGraph>, optimistic: ReturnType<typeof makeOptimistic>) => {
  return createCanonical({ graph, optimistic });
};

const makeDocuments = (
  graph: ReturnType<typeof createGraph>,
  planner: ReturnType<typeof createPlanner>,
  canonical: ReturnType<typeof makeCanonical>,
  views: ReturnType<typeof makeViews>
) => createDocuments({ graph, planner, canonical, views });

// helper: read canonical node ids by canonical key
const canonicalNodeIds = (graph: ReturnType<typeof createGraph>, canonicalKey: string): string[] => {
  const can = graph.getRecord(canonicalKey) || {};
  const refs = Array.isArray(can.edges) ? can.edges : [];
  const out: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const edgeRef = refs[i]?.__ref;
    if (!edgeRef) continue;
    const e = graph.getRecord(edgeRef);
    const nodeRef = e?.node?.__ref;
    const n = nodeRef ? graph.getRecord(nodeRef) : undefined;
    if (n?.id != null) out.push(String(n.id));
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeDocument (progression by query)", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof makeOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let views: ReturnType<typeof createViews>;
  let canonical: ReturnType<typeof makeCanonical>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    optimistic = makeOptimistic(graph);
    views = makeViews(graph);
    planner = makePlanner();
    canonical = makeCanonical(graph, optimistic);
    documents = makeDocuments(graph, planner, canonical, views);
  });

  // ───────────────── existing tests (UNCHANGED) ─────────────────

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

  // ───────────────── NEW: canonical @connection behavior ─────────────────

  it("canonical users (infinite): leader then after appends; before prepends", () => {
    // leader (no cursor)
    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
      data: {
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
      },
    });

    // after page
    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: "u2" },
      data: {
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
          edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3" } }],
        },
      },
    });

    // before page
    documents.normalizeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", last: 1, before: "u1" } as any,
      data: {
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
          edges: [{ __typename: "UserEdge", cursor: "u0", node: { __typename: "User", id: "u0" } }],
        },
      },
    });

    const canKey = '@connection.users({"role":"admin"})';
    const canon = graph.getRecord(canKey)!;

    // Edges length (u0 prepended, leader u1/u2, after u3)
    expect(canon.edges.length).toBe(4);

    // Read edge records the canonical list points to (explicitly; no loops)
    const r0 = canon.edges[0].__ref as string;
    const r1 = canon.edges[1].__ref as string;
    const r2 = canon.edges[2].__ref as string;
    const r3 = canon.edges[3].__ref as string;

    const e0 = graph.getRecord(r0)!;
    const e1 = graph.getRecord(r1)!;
    const e2 = graph.getRecord(r2)!;
    const e3 = graph.getRecord(r3)!;

    // Explicit assertions on each edge record (no entity deref assertions here — just the edge record itself)
    expect(e0).toEqual({ __typename: "UserEdge", cursor: "u0", node: { __ref: "User:u0" } });
    expect(e1).toEqual({ __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    expect(e2).toEqual({ __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    expect(e3).toEqual({ __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u3" } });

    // pageInfo remains anchored to the leader (no-cursor) page
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "u0", // head
      endCursor: "u3",   // tail
      hasNextPage: true, // from tail
      hasPreviousPage: true, // from head
    });

    // totalCount sticks from leader in infinite mode
    expect(canon.totalCount).toBe(2);
  });

  it("canonical users (page mode): last fetched page replaces edges (leader, then after, then before)", () => {
    // leader
    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", first: 2, after: null },
      data: {
        users: {
          __typename: "UserConnection",
          totalCount: 10,
          pageInfo: { __typename: "PageInfo", startCursor: "m1", endCursor: "m2", hasNextPage: true, hasPreviousPage: false },
          edges: [
            { __typename: "UserEdge", cursor: "m1", node: { __typename: "User", id: "m1" } },
            { __typename: "UserEdge", cursor: "m2", node: { __typename: "User", id: "m2" } },
          ],
        },
      },
    });

    const canKey = '@connection.users({"role":"mod"})';
    let canon = graph.getRecord(canKey)!;
    expect(canon.edges.length).toBe(2);

    const lm0 = '@.users({"after":null,"first":2,"role":"mod"}).edges.0';
    const lm1 = '@.users({"after":null,"first":2,"role":"mod"}).edges.1';
    expect(canon.edges[0]).toEqual({ __ref: lm0 });
    expect(canon.edges[1]).toEqual({ __ref: lm1 });
    expect(graph.getRecord(lm0)).toEqual({ __typename: "UserEdge", cursor: "m1", node: { __ref: "User:m1" } });
    expect(graph.getRecord(lm1)).toEqual({ __typename: "UserEdge", cursor: "m2", node: { __ref: "User:m2" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "m1",
      endCursor: "m2",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(canon.totalCount).toBe(10);

    // after → replace
    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", first: 2, after: "m2" },
      data: {
        users: {
          __typename: "UserConnection",
          totalCount: 12,
          pageInfo: { __typename: "PageInfo", startCursor: "m3", endCursor: "m4", hasNextPage: false, hasPreviousPage: true },
          edges: [
            { __typename: "UserEdge", cursor: "m3", node: { __typename: "User", id: "m3" } },
            { __typename: "UserEdge", cursor: "m4", node: { __typename: "User", id: "m4" } },
          ],
        },
      },
    });

    canon = graph.getRecord(canKey)!;
    const am0 = '@.users({"after":"m2","first":2,"role":"mod"}).edges.0';
    const am1 = '@.users({"after":"m2","first":2,"role":"mod"}).edges.1';
    expect(canon.edges.length).toBe(2);
    expect(canon.edges[0]).toEqual({ __ref: am0 });
    expect(canon.edges[1]).toEqual({ __ref: am1 });
    expect(graph.getRecord(am0)).toEqual({ __typename: "UserEdge", cursor: "m3", node: { __ref: "User:m3" } });
    expect(graph.getRecord(am1)).toEqual({ __typename: "UserEdge", cursor: "m4", node: { __ref: "User:m4" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "m3",
      endCursor: "m4",
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(canon.totalCount).toBe(12);

    // before → replace
    documents.normalizeDocument({
      document: USERS_PAGE_QUERY,
      variables: { usersRole: "mod", last: 1, before: "m3" } as any,
      data: {
        users: {
          __typename: "UserConnection",
          totalCount: 1,
          pageInfo: { __typename: "PageInfo", startCursor: "m0", endCursor: "m0", hasNextPage: true, hasPreviousPage: false },
          edges: [{ __typename: "UserEdge", cursor: "m0", node: { __typename: "User", id: "m0" } }],
        },
      },
    });

    canon = graph.getRecord(canKey)!;
    const bm0 = '@.users({"before":"m3","last":1,"role":"mod"}).edges.0';
    expect(canon.edges.length).toBe(1);
    expect(canon.edges[0]).toEqual({ __ref: bm0 });
    expect(graph.getRecord(bm0)).toEqual({ __typename: "UserEdge", cursor: "m0", node: { __ref: "User:m0" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "m0",
      endCursor: "m0",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(canon.totalCount).toBe(1);
  });

  it("canonical nested comments (infinite): leader then after appends", () => {
    // leader for Post:p1
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
      data: {
        user: {
          __typename: "User",
          id: "u1",
          posts: {
            __typename: "PostConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1" },
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
      },
    });

    // after page for comments
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
      data: {
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
                    totalCount: 3, // should remain anchored to 2 (leader) in infinite
                    pageInfo: { __typename: "PageInfo", startCursor: "c3", endCursor: "c3", hasNextPage: true, hasPreviousPage: false },
                    edges: [{ __typename: "CommentEdge", cursor: "c3", node: { __typename: "Comment", id: "c3" } }],
                  },
                },
              },
            ],
          },
        },
      },
    });

    const canKey = '@connection.Post:p1.comments({})';
    const canon = graph.getRecord(canKey)!;

    // Edges
    const ce0 = '@.Post:p1.comments({"after":null,"first":2}).edges.0';
    const ce1 = '@.Post:p1.comments({"after":null,"first":2}).edges.1';
    const ce2 = '@.Post:p1.comments({"after":"c2","first":1}).edges.0';

    expect(canon.edges.length).toBe(3);
    expect(canon.edges[0]).toEqual({ __ref: ce0 });
    expect(canon.edges[1]).toEqual({ __ref: ce1 });
    expect(canon.edges[2]).toEqual({ __ref: ce2 });

    expect(graph.getRecord(ce0)).toEqual({ __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    expect(graph.getRecord(ce1)).toEqual({ __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });
    expect(graph.getRecord(ce2)).toEqual({ __typename: "CommentEdge", cursor: "c3", node: { __ref: "Comment:c3" } });

    // Anchored leader pageInfo and totalCount
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c1", // head
      endCursor: "c3",   // tail
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(canon.totalCount).toBe(2);
  });

  it("canonical page-mode nested comments: leader, after, before each replace", () => {
    // leader
    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,
      variables: { postId: "p9", first: 2, after: null },
      data: {
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
      },
    });

    const canKey = '@connection.Post:p9.comments({})';
    let canon = graph.getRecord(canKey)!;
    const lx0 = '@.Post:p9.comments({"after":null,"first":2}).edges.0';
    const lx1 = '@.Post:p9.comments({"after":null,"first":2}).edges.1';

    expect(canon.edges.length).toBe(2);
    expect(canon.edges[0]).toEqual({ __ref: lx0 });
    expect(canon.edges[1]).toEqual({ __ref: lx1 });
    expect(graph.getRecord(lx0)).toEqual({ __typename: "CommentEdge", cursor: "x1", node: { __ref: "Comment:x1" } });
    expect(graph.getRecord(lx1)).toEqual({ __typename: "CommentEdge", cursor: "x2", node: { __ref: "Comment:x2" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "x1",
      endCursor: "x2",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(canon.totalCount).toBe(10);

    // after → replace
    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,
      variables: { postId: "p9", first: 2, after: "x2" },
      data: {
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
      },
    });

    canon = graph.getRecord(canKey)!;
    const ax0 = '@.Post:p9.comments({"after":"x2","first":2}).edges.0';
    const ax1 = '@.Post:p9.comments({"after":"x2","first":2}).edges.1';

    expect(canon.edges.length).toBe(2);
    expect(canon.edges[0]).toEqual({ __ref: ax0 });
    expect(canon.edges[1]).toEqual({ __ref: ax1 });
    expect(graph.getRecord(ax0)).toEqual({ __typename: "CommentEdge", cursor: "x3", node: { __ref: "Comment:x3" } });
    expect(graph.getRecord(ax1)).toEqual({ __typename: "CommentEdge", cursor: "x4", node: { __ref: "Comment:x4" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "x3",
      endCursor: "x4",
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(canon.totalCount).toBe(12);

    // before → replace
    documents.normalizeDocument({
      document: COMMENTS_PAGE_QUERY,
      variables: { postId: "p9", last: 1, before: "x3" } as any,
      data: {
        post: {
          __typename: "Post",
          id: "p9",
          comments: {
            __typename: "CommentConnection",
            totalCount: 9,
            pageInfo: {
              __typename: "PageInfo",
              startCursor: "x0",
              endCursor: "x0",
              hasNextPage: true,
              hasPreviousPage: false,
            },
            edges: [{ __typename: "CommentEdge", cursor: "x0", node: { __typename: "Comment", id: "x0" } }],
          },
        },
      },
    });

    canon = graph.getRecord(canKey)!;
    const bx0 = '@.Post:p9.comments({"before":"x3","last":1}).edges.0';

    expect(canon.edges.length).toBe(1);
    expect(canon.edges[0]).toEqual({ __ref: bx0 });
    expect(graph.getRecord(bx0)).toEqual({ __typename: "CommentEdge", cursor: "x0", node: { __ref: "Comment:x0" } });
    expect(canon.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "x0",
      endCursor: "x0",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(canon.totalCount).toBe(9);
  });
  it("materialized canonical nested comments: leader (C1,C2) then after (C3) updates view (regression)", () => {
    // 1) Leader page: Post:p1 → comments C1, C2
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
      data: {
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
      },
    });

    // Materialize now → expect C1, C2
    let view = documents.materializeDocument({
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

    let got = (view.user.posts.edges[0].node.comments.edges || []).map((e: any) => e?.node?.text);
    expect(got).toEqual(["Comment 1", "Comment 2"]);

    // 2) After page: add C3 (after "c2")
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
      data: {
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
                      hasPreviousPage: false,
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
      },
    });

    // Materialize again → expect C1, C2, C3 (this failed before the fix)
    view = documents.materializeDocument({
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

    got = (view.user.posts.edges[0].node.comments.edges || []).map((e: any) => e?.node?.text);
    expect(got).toEqual(["Comment 1", "Comment 2", "Comment 3"]);
  });
});
