import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import * as operations from "@/test/helpers/operations";

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
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(true);
  });

  it("returns false when a root entity link is missing", () => {
    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(false);
  });

  it("returns true when the root connection CANONICAL page exists (USERS_QUERY)", () => {
    // USERS_QUERY has @connection(filters: ["role"]) → canonical key includes role
    const canKey = '@connection.users({"role":"admin"})';
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: `${canKey}.pageInfo` },
    });
    graph.putRecord(`${canKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(true);
  });

  it("returns false when the root connection CANONICAL page is missing (USERS_QUERY)", () => {
    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(false);
  });

  it("returns false when multiple root branches have missing parts, then true when both present (MULTIPLE_USERS_QUERY)", () => {
    // With your planner, @connection (no explicit filters) still filters by non-pagination args (role)
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const miss = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });
    expect(miss).toBe(false);

    // ✅ use role in the CANONICAL key (planner includes role as a filter)
    const usersCanKey = '@connection.users({"role":"admin"})';
    graph.putRecord(usersCanKey, {
      __typename: "UserConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: `${usersCanKey}.pageInfo` },
    });
    graph.putRecord(`${usersCanKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const ok = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });
    expect(ok).toBe(true);
  });

  it("accepts precompiled plan", () => {
    const canKey = '@connection.users({"role":"admin"})';
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: `${canKey}.pageInfo` },
    });
    graph.putRecord(`${canKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const ok = documents.hasDocument({
      document: compilePlan(operations.USERS_QUERY),
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(true);
  });

  it("returns different results when variables change the CANONICAL key (filters: ['role'])", () => {
    const adminKey = '@connection.users({"role":"admin"})';
    graph.putRecord(adminKey, {
      __typename: "UserConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: `${adminKey}.pageInfo` },
    });
    graph.putRecord(`${adminKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const miss = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "mod", first: 2, after: null },
    });
    expect(miss).toBe(false);

    const modKey = '@connection.users({"role":"moderator"})';
    graph.putRecord(modKey, {
      __typename: "UserConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: `${modKey}.pageInfo` },
    });
    graph.putRecord(`${modKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u3",
      endCursor: "u3",
      hasNextPage: false,
      hasPreviousPage: false,
    });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "moderator", first: 2, after: null },
    });
    expect(ok).toBe(true);
  });

  it("returns false when link is present but entity snapshot is missing (strict leaf check)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" }, // link only
    });

    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(false);
  });

  it("returns false when a nested connection CANONICAL page is missing under a present root link (USER_POSTS_QUERY)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const ok = documents.hasDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(ok).toBe(false);
  });

  it("returns true when the nested connection CANONICAL page exists under the root link (USER_POSTS_QUERY)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    // USER_POSTS_QUERY selects totalCount on posts connection → include it
    // filters: ["category","sort"] but only category provided → canonical includes category only
    const postsCanKey = '@connection.User:u1.posts({"category":"tech"})';
    graph.putRecord(postsCanKey, {
      __typename: "PostConnection",
      totalCount: 0,
      edges: { __refs: [] },
      pageInfo: { __ref: `${postsCanKey}.pageInfo` },
    });
    graph.putRecord(`${postsCanKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const ok = documents.hasDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(ok).toBe(true);
  });
});
