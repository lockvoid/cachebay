import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { operations } from "@/test/helpers";

describe("documents.hasDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic: null });
    views = createViews({ graph });
    documents = createDocuments({ graph, views, canonical, planner });
  });

  it("returns true when a root entity link exists", () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, ['user({"id":"u1"})']: { __ref: "User:u1" }  });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(userDoc).toBe(true);
  });

  it("returns false when a root entity link is missing", () => {
    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(userDoc).toBe(false);
  });

  it("returns true when the root connection page exists", () => {
    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(result).toBe(true);
  });

  it("returns false when the root connection page is missing", () => {
    const usersDoc = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { usersRole: "admin", usersFirst: 2, usersAfter: null },
    });

    expect(usersDoc).toBe(false);
  });

  it("returns false when multiple root types have missing parts and true when both present", () => {
    // root link present, but users page missing → false
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    // also seed user snapshot for strict leaf check on the user branch
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const result1 = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });
    expect(result1).toBe(false);

    // now add the users page → both present → true
    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result2 = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });

    expect(result2).toBe(true);
  });

  it("accepts precompiled plan", () => {
    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result = documents.hasDocument({
      document: compilePlan(operations.USERS_QUERY),
      variables: { role: "admin", first: 2, after: null },
    });

    expect(result).toBe(true);
  });

  it("returns different results when variables change the page key", () => {
    graph.putRecord('@.users({"after":null,"first":2,"role":"admin"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result1 = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "mod", first: 2, after: null },
    });
    expect(result1).toBe(false);

    graph.putRecord('@.users({"after":null,"first":2,"role":"moderator"})', {
      __typename: "UserConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "u3",
        endCursor: "u3",
        hasNextPage: false,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result2 = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "moderator", first: 2, after: null },
    });
    expect(result2).toBe(true);
  });

  it("returns false when link present but entity snapshot missing (strict leaf check)", () => {
    // link without the actual snapshot → false now (strict mode)
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });

    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(userDoc).toBe(false);
  });

  const USER_WITH_POSTS_QUERY = `
    query UserWithPosts(
      $id: ID!,
      $postsCategory: String,
      $postsFirst: Int,
      $postsAfter: String
    ) {
      user(id: $id) {
        __typename
        id
        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
          @connection(filters: ["category"]) {
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
            node { __typename id title }
          }
        }
      }
    }
  `;

  it("returns false when a nested connection page is missing under a present root link", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    // user has id/email in our main user query, but this query only needs id
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });

    const vars = { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null };
    const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';

    expect(graph.getRecord(pageKey)).toBeUndefined();

    const result = documents.hasDocument({
      document: USER_WITH_POSTS_QUERY,
      variables: vars,
    });

    expect(result).toBe(false);
  });

  it("returns true when the nested connection page exists under the root link", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    // minimal snapshot for leaf 'id' on the user branch
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });

    const vars = { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null };
    const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';

    graph.putRecord(pageKey, {
      __typename: "PostConnection",
      pageInfo: {
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
      edges: [],
    });

    const result = documents.hasDocument({
      document: USER_WITH_POSTS_QUERY,
      variables: vars,
    });

    expect(result).toBe(true);
  });
});
