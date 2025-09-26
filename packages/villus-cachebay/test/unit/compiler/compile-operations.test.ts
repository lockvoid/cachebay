// test/unit/compiler/compile.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler";
import type { CachePlanV1, PlanField } from "@/src/compiler/types";
import {
  collectConnectionDirectives,
  everySelectionSetHasTypename,
} from "@/test/helpers";

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
/** Documents (without __typename; compiler will inject them for networkQuery) */
// ─────────────────────────────────────────────────────────────────────────────

const USER_QUERY = gql`
  ${USER_FRAGMENT}
  query UserQuery($id: ID!) {
    user(id: $id) {
      ...UserFields
    }
  }
`;

const USERS_QUERY = gql`
  ${USER_FRAGMENT}
  query UsersQuery($usersRole: String, $usersFirst: Int, $usersAfter: String) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter)
      @connection(filters: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node { ...UserFields }
      }
    }
  }
`;

const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    user(id: $id) {
      ...UserFields
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
        @connection(filters: ["category"]) {
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            ...PostFields
            author { id }
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
    users(role: $usersRole, first: $usersFirst, after: $usersAfter)
      @connection(filters: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
            @connection(filters: ["category"]) {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
              cursor
              node {
                ...PostFields
                comments(first: $commentsFirst, after: $commentsAfter)
                  @connection(filters: []) {
                  pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
                  edges { cursor node { ...CommentFields } }
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
    currentUser: user(id: $id) { id email }
  }
`;

const MULTI_TYPE_FRAGMENT_QUERY = gql`
  fragment UserOnly on User { id }
  fragment AdminOnly on Admin { role }

  query MixedTypes($id: ID!) {
    user(id: $id) {
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
    if (fields[i].responseKey === responseKey) return fields[i];
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("compiler: compilePlan", () => {
  it("compiles USER_QUERY: flattens fragments and builds arg pickers", () => {
    const plan = compilePlan(USER_QUERY);
    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const userField = findField(plan.root, "user")!;
    expect(userField).toBeTruthy();
    expect(userField.fieldName).toBe("user");
    expect(userField.isConnection).toBe(false);

    const args = userField.buildArgs({ id: "u1" });
    expect(args).toEqual({ id: "u1" });

    const child = userField.selectionSet!;
    const id = findField(child, "id");
    const email = findField(child, "email");
    expect(Boolean(id && email)).toBe(true);

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_QUERY: marks users as connection; filters & default mode", () => {
    const plan = compilePlan(USERS_QUERY);

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);
    expect(users.connectionKey).toBe("users");
    expect(users.connectionFilters).toEqual(["role"]);
    expect(users.connectionMode).toBe("infinite"); // default

    // buildArgs uses RAW vars mapped to field-arg names
    const a1 = users.buildArgs({ usersRole: "admin", usersFirst: 2, usersAfter: undefined });
    expect(a1).toEqual({ role: "admin", first: 2 });

    const edges = findField(users.selectionSet!, "edges");
    const pageInfo = findField(users.selectionSet!, "pageInfo");
    expect(Boolean(edges && pageInfo)).toBe(true);

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("compiles USER_POSTS_QUERY: nested posts as connection with filters; default mode", () => {
    const plan = compilePlan(USER_POSTS_QUERY);

    const user = findField(plan.root, "user")!;
    const posts = findField(user.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite"); // default

    const userArgs = user.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 2, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 2, after: null });

    const edges = findField(posts.selectionSet!, "edges")!;
    const node = findField(edges.selectionSet!, "node")!;
    const id = findField(node.selectionSet!, "id");
    const title = findField(node.selectionSet!, "title");
    const tags = findField(node.selectionSet!, "tags");
    const author = findField(node.selectionSet!, "author");
    expect(Boolean(id && title && tags && author)).toBe(true);

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_POSTS_COMMENTS_QUERY: users, posts, comments marked with filters & default mode", () => {
    const plan: CachePlanV1 = compilePlan(USERS_POSTS_COMMENTS_QUERY);

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);
    expect(users.connectionKey).toBe("users");
    expect(users.connectionFilters).toEqual(["role"]);
    expect(users.connectionMode).toBe("infinite");

    const userEdges = findField(users.selectionSet!, "edges")!;
    const userNode = findField(userEdges.selectionSet!, "node")!;

    const posts = findField(userNode.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    const postEdges = findField(posts.selectionSet!, "edges")!;
    const postNode = findField(postEdges.selectionSet!, "node")!;

    const comments = findField(postNode.selectionSet!, "comments")!;
    expect(comments.isConnection).toBe(true);
    expect(comments.connectionKey).toBe("comments");
    expect(comments.connectionFilters).toEqual([]); // explicit empty
    expect(comments.connectionMode).toBe("infinite");

    // RAW variable names → field args
    const usersArgs = users.buildArgs({ usersRole: "dj", usersFirst: 2, usersAfter: "u1" });
    expect(usersArgs).toEqual({ role: "dj", first: 2, after: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 1, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 1, after: null });

    const commentsArgs = comments.buildArgs({ commentsFirst: 3, commentsAfter: "c2" });
    expect(commentsArgs).toEqual({ first: 3, after: "c2" });

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  // Extra coverage

  it("preserves alias as responseKey and field name as fieldName", () => {
    const plan = compilePlan(ALIAS_QUERY);
    const currentUser = findField(plan.root, "currentUser")!;
    expect(currentUser.responseKey).toBe("currentUser");
    expect(currentUser.fieldName).toBe("user");
    expect(currentUser.buildArgs({ id: "u1" })).toEqual({ id: "u1" });

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("when multiple distinct type conditions exist, child parent inference falls back", () => {
    const plan = compilePlan(MULTI_TYPE_FRAGMENT_QUERY);
    const user = findField(plan.root, "user")!;
    const idField = findField(user.selectionSet!, "id");     // from UserOnly
    const roleField = findField(user.selectionSet!, "role"); // from AdminOnly
    expect(Boolean(idField && roleField)).toBe(true);

    // Network query checks
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });
});
