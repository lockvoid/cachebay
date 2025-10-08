import { describe, it, expect, beforeEach, vi } from "vitest";
import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import * as operations from "@/test/helpers/operations";

/**
 * Tests that documents.materializeDocument correctly delegates to views.getView
 * with appropriate canonical keys, variables, and field metadata.
 */
describe("documents.materializeDocument (delegates to views.getView)", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: { getView: ReturnType<typeof vi.fn> };
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        Profile: (p) => p.slug,
        Media: (m) => m.key,
        Stat: (s) => s.key,
        Comment: (c) => c.uuid,
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });

    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    views = { getView: vi.fn() };

    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    documents = createDocuments({
      graph,
      planner,
      canonical,
      views: views as any,
    });
  });

  it("calls getView with canonical key for a root @connection (USERS_QUERY)", () => {
    const variables = { role: "admin", first: 2, after: null };
    const expectedCanonicalSource = '@connection.users({"role":"admin"})';
    const mockViewResult = { kind: "usersView" };

    views.getView.mockReturnValue(mockViewResult);

    const result = documents.materializeDocument({
      document: operations.USERS_QUERY,
      variables: variables,
    });

    expect(result.users).toBe(mockViewResult);
    expect(views.getView).toHaveBeenCalledTimes(1);

    const getViewArgs = views.getView.mock.calls[0][0];
    expect(getViewArgs.source).toBe(expectedCanonicalSource);
    expect(getViewArgs.variables).toEqual(variables);
    expect(getViewArgs.canonical).toBe(true);
    expect(getViewArgs.field?.responseKey).toBe("users");
    expect(getViewArgs.field?.isConnection).toBe(true);
  });

  it("calls getView with entity __ref for a root object field (USER_QUERY)", () => {
    const variables = { id: "u1" };
    const userFieldKey = 'user({"id":"u1"})';
    const entityRef = "User:u1";

    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [userFieldKey]: { __ref: entityRef },
    });

    const mockViewResult = { kind: "userView" };
    views.getView.mockReturnValue(mockViewResult);

    const result = documents.materializeDocument({
      document: operations.USER_QUERY,
      variables: variables,
    });

    expect(result.user).toBe(mockViewResult);
    expect(views.getView).toHaveBeenCalledTimes(1);

    const getViewArgs = views.getView.mock.calls[0][0];
    expect(getViewArgs.source).toBe(entityRef);
    expect(getViewArgs.variables).toEqual(variables);
    expect(getViewArgs.canonical).toBe(true);
    expect(getViewArgs.field?.responseKey).toBe("user");
    expect(getViewArgs.field?.isConnection).toBeFalsy();
  });

  it("uses the alias as the response key and still calls getView with the real link", () => {
    const variables = { id: "u2" };
    const userFieldKey = 'user({"id":"u2"})';
    const entityRef = "User:u2";
    const aliasKey = "currentUser";

    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [userFieldKey]: { __ref: entityRef },
    });

    const mockViewResult = { kind: "currentUserView" };
    views.getView.mockReturnValue(mockViewResult);

    const result = documents.materializeDocument({
      document: operations.USER_WITH_ALIAS_QUERY,
      variables: variables,
    });

    expect(result[aliasKey]).toBe(mockViewResult);
    expect(result.user).toBeUndefined();
    expect(views.getView).toHaveBeenCalledTimes(1);

    const getViewArgs = views.getView.mock.calls[0][0];
    expect(getViewArgs.source).toBe(entityRef);
    expect(getViewArgs.field?.responseKey).toBe(aliasKey);
  });

  it("returns undefined when the root link is missing (and does not call getView)", () => {
    const variables = { id: "u3" };

    const result = documents.materializeDocument({
      document: operations.USER_QUERY,
      variables: variables,
    });

    expect(result.user).toBeUndefined();
    expect(views.getView).not.toHaveBeenCalled();
  });

  it("returns null when the root link is explicitly null (and does not call getView)", () => {
    const variables = { id: "u4" };
    const userFieldKey = 'user({"id":"u4"})';

    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      [userFieldKey]: null,
    });

    const result = documents.materializeDocument({
      document: operations.USER_QUERY,
      variables: variables,
    });

    expect(result.user).toBeNull();
    expect(views.getView).not.toHaveBeenCalled();
  });

  it("accepts a precompiled plan and still uses canonical key for root @connection", () => {
    const compiledPlan = compilePlan(operations.USERS_QUERY);
    const variables = { role: "moderator", first: 3, after: null };
    const expectedCanonicalSource = '@connection.users({"role":"moderator"})';
    const mockViewResult = { kind: "usersView-compiled" };

    views.getView.mockReturnValue(mockViewResult);

    const result = documents.materializeDocument({
      document: compiledPlan,
      variables: variables,
    });

    expect(result.users).toBe(mockViewResult);
    expect(views.getView).toHaveBeenCalledTimes(1);

    const getViewArgs = views.getView.mock.calls[0][0];
    expect(getViewArgs.source).toBe(expectedCanonicalSource);
    expect(getViewArgs.variables).toEqual(variables);
    expect(getViewArgs.canonical).toBe(true);
    expect(getViewArgs.field?.responseKey).toBe("users");
  });

  it("builds canonical source using only declared filters (ignores pagination vars)", () => {
    const variables = { role: "dj", first: 10, after: "X" };
    const expectedCanonicalSource = '@connection.users({"role":"dj"})';
    const mockViewResult = { v: 1 };

    views.getView.mockReturnValue(mockViewResult);

    documents.materializeDocument({
      document: operations.USERS_QUERY,
      variables: variables,
    });

    const getViewArgs = views.getView.mock.calls[0][0];
    expect(getViewArgs.source).toBe(expectedCanonicalSource);
  });
});
