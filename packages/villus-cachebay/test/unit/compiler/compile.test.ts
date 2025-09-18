// test/unit/compiler/compile.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler/compile";
import type { CachePlanV1, PlanField } from "@/src/compiler/types";

const connections = {
  Query: {
    users: { mode: "infinite", args: ["role"] },
  },
  User: {
    posts: { mode: "infinite", args: ["category"] },
  },
  Post: {
    comments: { mode: "infinite", args: [] },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Fragments
// ─────────────────────────────────────────────────────────────────────────────

const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

const POST_FRAGMENT = gql`
  fragment PostFields on Post {
    id
    title
    tags
  }
`;

const COMMENT_FRAGMENT = gql`
  fragment CommentFields on Comment {
    id
    text
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

const USER_QUERY = gql`
  ${USER_FRAGMENT}
  query UserQuery($id: ID!) {
    user(id: $id) {
      __typename
      ...UserFields
    }
  }
`;

const USERS_QUERY = gql`
  ${USER_FRAGMENT}
  query UsersQuery($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) {
      __typename
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node { __typename ...UserFields }
      }
    }
  }
`;

const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $first: Int, $after: String) {
    user(id: $id) {
      __typename
      ...UserFields
      posts(category: $postsCategory, first: $first, after: $after) {
        __typename
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            __typename
            ...PostFields
            author { __typename id }
          }
        }
      }
    }
  }
`;

const USERS_POSTS_COMMENTS_QUERY = gql`
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
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          __typename
          ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) {
            __typename
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
              cursor
              node {
                __typename
                ...PostFields
                comments(first: $commentsFirst, after: $commentsAfter) {
                  __typename
                  pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
                  edges {
                    cursor
                    node { __typename ...CommentFields }
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

// Extra: alias & multi-type cases
const ALIAS_QUERY = gql`
  query AliasQuery($id: ID!) {
    currentUser: user(id: $id) { __typename id email }
  }
`;

const MULTI_TYPE_FRAGMENT_QUERY = gql`
  fragment UserOnly on User { id }
  fragment AdminOnly on Admin { role }

  query MixedTypes($id: ID!) {
    user(id: $id) {
      __typename
      ...UserOnly
      ...AdminOnly
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const findField = (fields: PlanField[], responseKey: string): PlanField | null => {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].responseKey === responseKey) {
      return fields[i];
    }
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("compiler: compileToPlan", () => {
  it("compiles USER_QUERY: flattens fragments and builds arg pickers", () => {
    const plan = compileToPlan(USER_QUERY, { connections });
    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const userField = findField(plan.root, "user")!;
    expect(userField).toBeTruthy();
    expect(userField.fieldName).toBe("user");
    expect(userField.isConnection).toBe(false);

    const args = userField.buildArgs({ id: "u1" });
    expect(args).toEqual({ id: "u1" });

    // Fragment flattened: expect child fields id, email present somewhere in selectionSet
    const child = userField.selectionSet!;
    const id = findField(child, "id");
    const email = findField(child, "email");
    expect(Boolean(id && email)).toBe(true);
  });

  it("compiles USERS_QUERY: marks users as connection, args builder omits undefined", () => {
    const plan = compileToPlan(USERS_QUERY, { connections });

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);

    const a1 = users.buildArgs({ usersRole: "admin", first: 2, after: undefined });
    expect(a1).toEqual({ role: "admin", first: 2 });

    // Ensure selection has edges and pageInfo lowered
    const edges = findField(users.selectionSet!, "edges");
    const pageInfo = findField(users.selectionSet!, "pageInfo");
    expect(Boolean(edges && pageInfo)).toBe(true);
  });

  it("compiles USER_POSTS_QUERY: marks nested posts as connection and builds both arg builders", () => {
    const plan = compileToPlan(USER_POSTS_QUERY, { connections });

    const user = findField(plan.root, "user")!;
    const posts = findField(user.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);

    const userArgs = user.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", first: 2, after: null });
    expect(postsArgs).toEqual({ category: "tech", first: 2, after: null });

    // Post node fields lowered (id, title, tags, author.id)
    const edges = findField(posts.selectionSet!, "edges")!;
    const node = findField(edges.selectionSet!, "node")!;
    const id = findField(node.selectionSet!, "id");
    const title = findField(node.selectionSet!, "title");
    const tags = findField(node.selectionSet!, "tags");
    const author = findField(node.selectionSet!, "author");
    expect(Boolean(id && title && tags && author)).toBe(true);
  });

  it("compiles USERS_POSTS_COMMENTS_QUERY: connection flags on users, posts, comments", () => {
    const plan: CachePlanV1 = compileToPlan(USERS_POSTS_COMMENTS_QUERY, { connections });

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);

    const edges = findField(users.selectionSet!, "edges")!;
    const userNode = findField(edges.selectionSet!, "node")!;

    const posts = findField(userNode.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);

    const postEdges = findField(posts.selectionSet!, "edges")!;
    const postNode = findField(postEdges.selectionSet!, "node")!;

    const comments = findField(postNode.selectionSet!, "comments")!;
    expect(comments.isConnection).toBe(true);

    // Arg builders wiring
    const usersArgs = users.buildArgs({ usersRole: "dj", usersFirst: 2, usersAfter: "u1" });
    expect(usersArgs).toEqual({ role: "dj", first: 2, after: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 1, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 1, after: null });

    const commentsArgs = comments.buildArgs({ commentsFirst: 3, commentsAfter: "c2" });
    expect(commentsArgs).toEqual({ first: 3, after: "c2" });
  });

  // Extra coverage

  it("preserves alias as responseKey and field name as fieldName", () => {
    const plan = compileToPlan(ALIAS_QUERY, { connections });
    const currentUser = findField(plan.root, "currentUser")!;
    expect(currentUser.responseKey).toBe("currentUser");
    expect(currentUser.fieldName).toBe("user");
    expect(currentUser.buildArgs({ id: "u1" })).toEqual({ id: "u1" });
  });

  it("when multiple distinct type conditions exist, child parent inference falls back", () => {
    const plan = compileToPlan(MULTI_TYPE_FRAGMENT_QUERY, { connections });
    const user = findField(plan.root, "user")!;
    // Selection set should contain both fields from UserOnly/AdminOnly fragments
    const idField = findField(user.selectionSet!, "id");     // from UserOnly
    const roleField = findField(user.selectionSet!, "role"); // from AdminOnly
    expect(Boolean(idField && roleField)).toBe(true);
    // We do not assert isConnection here; this test guards inference strategy.
  });
});
