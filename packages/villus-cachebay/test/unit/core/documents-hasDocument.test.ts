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
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,

      variables: {
        id: "u1",
      },
    });

    expect(userDoc).toBe(true);
  });

  it("returns false when a root entity link is missing", () => {
    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,

      variables: {
        id: "u1",
      },
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

      variables: {
        role: "admin",
        first: 2,
        after: null,
      },
    });

    expect(result).toBe(true);
  });

  it("returns false when the root connection page is missing", () => {
    const usersDoc = documents.hasDocument({
      document: operations.USERS_QUERY,

      variables: {
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(usersDoc).toBe(false);
  });

  it("returns false when multiple root types have missing parts and true when both present", () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    const result1 = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,

      variables: {
        userId: "u1",
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(result1).toBe(false);

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

      variables: {
        userId: "u1",
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
      },
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

      variables: {
        role: "admin",
        first: 2,
        after: null,
      },
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

      variables: {
        role: "mod",
        first: 2,
        after: null,
      },
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

      variables: {
        role: "moderator",
        first: 2,
        after: null,
      },
    });

    expect(result2).toBe(true);
  });

  it("returns true when link present but entity snapshot missing (by design)", () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    const userDoc = documents.hasDocument({
      document: operations.USER_QUERY,

      variables: {
        id: "u1",
      },
    });

    expect(userDoc).toBe(true);
  });
});
