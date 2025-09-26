import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createDocuments } from "@/src/core/documents";
import { createPlanner } from "@/src/core/planner";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { compilePlan } from "@/src/compiler";
import { TEST_QUERIES } from "@/test/helpers";

describe('documents.hasDocument', () => {
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

  it('returns true when a root entity link exists', () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    const userDoc = documents.hasDocument({
      document: TEST_QUERIES.USER_SIMPLE,

      variables: {
        id: "u1",
      },
    });

    expect(userDoc).toBe(true);
  });

  it('returns false when a root entity link is missing', () => {
    const userDoc = documents.hasDocument({
      document: TEST_QUERIES.USER_SIMPLE,

      variables: {
        id: "u1",
      },
    });

    expect(userDoc).toBe(false);
  });

  it('returns true when the root connection page exists', () => {
    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
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

    const usersDoc = documents.hasDocument({
      document: TEST_QUERIES.USERS_SIMPLE,

      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(usersDoc).toBe(true);
  });

  it('returns false when the root connection page is missing', () => {
    const usersDoc = documents.hasDocument({
      document: TEST_QUERIES.USERS_SIMPLE,

      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(usersDoc).toBe(false);
  });

  it('returns false when multiple root types have missing parts and true when both present', () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    let mixedDoc = documents.hasDocument({
      document: TEST_QUERIES.USER_USERS_MIXED,

      variables: {
        id: "u1",
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(mixedDoc).toBe(false);

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
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

    mixedDoc = documents.hasDocument({
      document: TEST_QUERIES.USER_USERS_MIXED,

      variables: {
        id: "u1",
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(mixedDoc).toBe(true);
  });

  it('accepts precompiled plan (CachePlanV1)', () => {
    const plan = compilePlan(TEST_QUERIES.USERS_SIMPLE);

    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
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

    const planDoc = documents.hasDocument({
      document: plan,

      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(planDoc).toBe(true);
  });

  it('returns different results when variables change the page key', () => {
    graph.putRecord('@.users({"after":null,"first":2,"role":"dj"})', {
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

    const usersDoc = documents.hasDocument({
      document: TEST_QUERIES.USERS_SIMPLE,

      variables: {
        usersRole: "mod",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(usersDoc).toBe(false);

    graph.putRecord('@.users({"after":null,"first":2,"role":"mod"})', {
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

    const usersDocAfter = documents.hasDocument({
      document: TEST_QUERIES.USERS_SIMPLE,

      variables: {
        usersRole: "mod",
        usersFirst: 2,
        usersAfter: null,
      },
    });

    expect(usersDocAfter).toBe(true);
  });

  it('returns true when link present but entity snapshot missing (by design)', () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, 'user({"id":"u1"})': { __ref: "User:u1" } });

    const userDoc = documents.hasDocument({
      document: TEST_QUERIES.USER_SIMPLE,

      variables: {
        id: "u1",
      },
    });

    expect(userDoc).toBe(true);
  });
});
