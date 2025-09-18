import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
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
// GraphQL Queries (used to drive materializeDocument)
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
        Query: { users: { mode: "infinite", args: ["role"] } },
        User: { posts: { mode: "infinite", args: ["category"] } },
        Post: { comments: { mode: "infinite" } },
      },
    },
    { graph }
  );

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("materializeDocument (progression by query)", () => {
  let graph: ReturnType<typeof createGraph>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    documents = makeDocuments(graph);
  });

  it("USER_QUERY — materializes user; entity node should be reactive when deref’d stand-alone", () => {
    // root link
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const view = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } });

    // top-level 'user' is a plain shape (not the proxy itself)
    expect(view).toEqual({
      user: { __typename: "User", id: "u1", email: "u1@example.com" },
    });

    // The underlying entity proxy is reactive if accessed directly
    const userProxy = graph.materializeRecord("User:u1");
    expect(isReactive(userProxy)).toBe(true);

    // verify updates propagate when reading via the proxy
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(userProxy.email).toBe("u1+updated@example.com");
  });

  it("USERS_QUERY — materializes users page; edge.node is reactive and reflects updates", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'users({"after":null,"first":2,"role":"admin"})': { __ref: '@.users({"after":null,"first":2,"role":"admin"})' },
    });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

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

    const view = documents.materializeDocument({
      document: USERS_QUERY,
      variables: { usersRole: "admin", first: 2, after: null },
    });

    // plain connection container
    expect(view.users.__typename).toBe("UserConnection");
    expect(Array.isArray(view.users.edges)).toBe(true);

    // edge.node should be a reactive proxy
    const node0 = view.users.edges[0].node;
    expect(isReactive(node0)).toBe(true);
    expect(node0.email).toBe("u1@example.com");

    // update entity → reactive view updates
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    expect(node0.email).toBe("u1+updated@example.com");

    // edge object is plain
    expect(isReactive(view.users.edges[0])).toBe(false);
  });

  it("USER_POSTS_QUERY — materializes page; includes totalCount/score; post node & author are reactive", () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    // entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [], author: { __ref: "User:u1" } });
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Post 2", tags: [], author: { __ref: "User:u1" } });

    // edges
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

    // page
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

    const view = documents.materializeDocument({
      document: USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    // totalCount and score present
    expect(view.user.posts.totalCount).toBe(2);
    expect(view.user.posts.edges[0].score).toBe(0.5);

    // reactive node & author
    const post0 = view.user.posts.edges[0].node;
    const author0 = post0.author;
    expect(isReactive(post0)).toBe(true);
    expect(isReactive(author0)).toBe(true);

    // update post title and user email → view reflects changes
    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });

    expect(post0.title).toBe("Post 1 (Updated)");
    expect(author0.email).toBe("u1+updated@example.com");
  });

  it("USERS_POSTS_QUERY — root users page; nested posts page; nested post node reactive", () => {
    // root
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'users({"after":null,"first":2,"role":"dj"})': { __ref: '@.users({"after":null,"first":2,"role":"dj"})' }
    });

    // entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });

    // users edges + page
    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.0', { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"}).edges.1', { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"dj"}).edges.1' },
      ],
    });

    // nested posts page for u1
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }],
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

    const u1Node = view.users.edges[0].node;
    const post0 = u1Node.posts.edges[0].node;

    expect(isReactive(u1Node)).toBe(true);
    expect(isReactive(post0)).toBe(true);

    // update
    graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
    expect(post0.title).toBe("Post 1 (Updated)");
  });

  it("USER_POSTS_COMMENTS_QUERY — nested posts & nested comments pages; comment node reactive", () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    // entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });
    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
    graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
    graph.putRecord("User:u2", { __typename: "User", id: "u2" });
    graph.putRecord("User:u3", { __typename: "User", id: "u3" });

    // posts page
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0', { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
    graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})', {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges.0' }],
    });

    // comments page
    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.0', { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    graph.putRecord('@.Post:p1.comments({"after":null,"first":2}).edges.1', { __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });
    graph.putRecord('@.Post:p1.comments({"after":null,"first":2})', {
      __typename: "CommentConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
      edges: [
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.0' },
        { __ref: '@.Post:p1.comments({"after":null,"first":2}).edges.1' },
      ],
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

    const post0 = view.user.posts.edges[0].node;
    const comment0 = post0.comments.edges[0].node;

    expect(isReactive(post0)).toBe(true);
    expect(isReactive(comment0)).toBe(true);

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(comment0.text).toBe("Comment 1 (Updated)");
  });

  it("USERS_POSTS_COMMENTS_QUERY — root users page + nested posts & nested comments; reactivity at each node level", () => {
    graph.putRecord("@", { id: "@", __typename: "@", 'users({"after":null,"first":2,"role":"admin"})': { __ref: '@.users({"after":null,"first":2,"role":"admin"})' } });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", tags: [] });
    graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1" });

    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', {
      __typename: "UserEdge",
      cursor: "u1",
      node: { __ref: "User:u1" },
    });
    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' }],
    });

    const u1Posts = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
    graph.putRecord(`${u1Posts}.edges.0`, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
    graph.putRecord(u1Posts, {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: `${u1Posts}.edges.0` }],
    });

    const p1Comments = '@.Post:p1.comments({"after":null,"first":1})';
    graph.putRecord(`${p1Comments}.edges.0`, { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
    graph.putRecord(p1Comments, {
      __typename: "CommentConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: `${p1Comments}.edges.0` }],
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

    const u1Node = view.users.edges[0].node;
    const post0 = u1Node.posts.edges[0].node;
    const comment0 = post0.comments.edges[0].node;

    expect(isReactive(u1Node)).toBe(true);
    expect(isReactive(post0)).toBe(true);
    expect(isReactive(comment0)).toBe(true);

    graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
    expect(comment0.text).toBe("Comment 1 (Updated)");
  });
});
