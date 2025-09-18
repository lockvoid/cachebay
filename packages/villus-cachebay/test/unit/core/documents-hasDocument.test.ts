import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createDocuments } from "@/src/core/documents";
import { createPlanner } from "@/src/core/planner";
import { ROOT_ID } from "@/src/core/constants";
import { compileToPlan } from "@/src/compiler";

// ─────────────────────────────────────────────────────────────────────────────
// Queries used in tests
// ─────────────────────────────────────────────────────────────────────────────

const USER_QUERY = gql`
  query UserQuery($id: ID!) {
    user(id: $id) {
      __typename
      id
      email
    }
  }
`;

const USERS_QUERY = gql`
  query UsersQuery($usersRole: String, $usersFirst: Int, $usersAfter: String) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
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
          id
          email
        }
      }
    }
  }
`;

const MIXED_QUERY = gql`
  query Mixed($id: ID!, $usersRole: String, $usersFirst: Int, $usersAfter: String) {
    user(id: $id) {
      __typename
      id
      email
    }
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      __typename
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      edges { __typename cursor node { __typename id } }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeGraph = () =>
  createGraph({
    interfaces: { Post: ["AudioPost", "VideoPost"] },
  });

const makeDocuments = (graph: ReturnType<typeof createGraph>) =>
  createDocuments({
    graph,
    views: createViews({ graph }),
    planner: createPlanner(), // compiler uses @connection in documents
  });

// For USERS_QUERY with { usersRole: "dj", usersFirst: 2, usersAfter: null }
const USERS_PAGE_KEY = '@.users({"after":null,"first":2,"role":"dj"})';

// For USERS_QUERY with { usersRole: "mod", usersFirst: 2, usersAfter: null }
const USERS_PAGE_KEY_MOD = '@.users({"after":null,"first":2,"role":"mod"})';

// Root link key for USER_QUERY with { id: "u1" }
const USER_LINK_KEY = 'user({"id":"u1"})';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("documents.hasDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let documents: ReturnType<typeof makeDocuments>;

  beforeEach(() => {
    graph = makeGraph();
    documents = makeDocuments(graph);
    // ensure root exists
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  });

  it("returns true when a root entity link exists", () => {
    // seed only the root link; entity snapshot optional by design
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [USER_LINK_KEY]: { __ref: "User:u1" },
    });

    const ok = documents.hasDocument({
      document: USER_QUERY,
      variables: { id: "u1" },
    });
    expect(ok).toBe(true);
  });

  it("returns false when a root entity link is missing", () => {
    const miss = documents.hasDocument({
      document: USER_QUERY,
      variables: { id: "u1" },
    });
    expect(miss).toBe(false);
  });

  it("returns true when the root connection page exists", () => {
    graph.putRecord(USERS_PAGE_KEY, {
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

    const ok = documents.hasDocument({
      document: USERS_QUERY,
      variables: { usersRole: "dj", usersFirst: 2, usersAfter: null },
    });
    expect(ok).toBe(true);
  });

  it("returns false when the root connection page is missing", () => {
    const miss = documents.hasDocument({
      document: USERS_QUERY,
      variables: { usersRole: "dj", usersFirst: 2, usersAfter: null },
    });
    expect(miss).toBe(false);
  });

  it("mixed root (entity + connection): false if either missing; true when both present", () => {
    // only entity link present → false
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [USER_LINK_KEY]: { __ref: "User:u1" },
    });

    let hit = documents.hasDocument({
      document: MIXED_QUERY,
      variables: { id: "u1", usersRole: "dj", usersFirst: 2, usersAfter: null },
    });
    expect(hit).toBe(false);

    // add connection page → now true
    graph.putRecord(USERS_PAGE_KEY, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [],
    });

    hit = documents.hasDocument({
      document: MIXED_QUERY,
      variables: { id: "u1", usersRole: "dj", usersFirst: 2, usersAfter: null },
    });
    expect(hit).toBe(true);
  });

  it("precompiled plan (CachePlanV1) is accepted", () => {
    const plan = compileToPlan(USERS_QUERY);

    // seed page
    graph.putRecord(USERS_PAGE_KEY, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [],
    });

    const ok = documents.hasDocument({
      document: plan, // pass plan directly
      variables: { usersRole: "dj", usersFirst: 2, usersAfter: null },
    });
    expect(ok).toBe(true);
  });

  it("is sensitive to variables (different args → different page key)", () => {
    // seed page for role=dj
    graph.putRecord(USERS_PAGE_KEY, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [],
    });

    // role=mod should miss
    const miss = documents.hasDocument({
      document: USERS_QUERY,
      variables: { usersRole: "mod", usersFirst: 2, usersAfter: null },
    });
    expect(miss).toBe(false);

    // seed mod page, now it hits
    graph.putRecord(USERS_PAGE_KEY_MOD, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
      edges: [],
    });

    const ok = documents.hasDocument({
      document: USERS_QUERY,
      variables: { usersRole: "mod", usersFirst: 2, usersAfter: null },
    });
    expect(ok).toBe(true);
  });

  it("link present but entity snapshot missing still returns true (by design)", () => {
    // root link exists but User:u1 snapshot not seeded
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [USER_LINK_KEY]: { __ref: "User:u1" },
    });

    const ok = documents.hasDocument({
      document: USER_QUERY,
      variables: { id: "u1" },
    });
    expect(ok).toBe(true);
  });
});
