// Test normalize for subscriptions with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { USER_UPDATED_SUBSCRIPTION } from "@/test/helpers/operations";

describe("documents.normalize - subscriptions with rootId", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (u) => u.id,
      },
      interfaces: {},
      onChange: () => {},
    });

    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, canonical, planner });
  });

  it("normalizes subscription with custom rootId", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "subscribed@example.com",
        }),
      },
    };

    const rootId = "@subscription.0";

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: subscriptionData,
      rootId,
    });

    // Check entity was normalized
    expect(graph.getRecord("User:u1")).toMatchObject({
      id: "u1",
      __typename: "User",
      email: "subscribed@example.com",
    });

    // Check subscription root was created
    expect(graph.getRecord(rootId)).toMatchObject({
      id: rootId,
      __typename: rootId,
    });
  });

  it("supports multiple subscription events with different rootIds", () => {
    const event1Data = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "event1@example.com",
        }),
      },
    };

    const event2Data = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "event2@example.com",
        }),
      },
    };

    // First event
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: event1Data,
      rootId: "@subscription.0",
    });

    // Second event (updates same user)
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: event2Data,
      rootId: "@subscription.1",
    });

    // Entity should have latest data
    expect(graph.getRecord("User:u1")?.email).toBe("event2@example.com");

    // Both subscription roots should exist
    expect(graph.getRecord("@subscription.0")).toMatchObject({
      id: "@subscription.0",
      __typename: "@subscription.0",
    });
    expect(graph.getRecord("@subscription.1")).toMatchObject({
      id: "@subscription.1",
      __typename: "@subscription.1",
    });
  });

  it("subscriptions with rootId don't pollute @ root", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "sub@example.com",
        }),
      },
    };

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: subscriptionData,
      rootId: "@subscription.0",
    });

    // Check that @ root doesn't have subscription fields
    const rootRecord = graph.getRecord("@");
    const rootKeys = Object.keys(rootRecord || {});
    const subscriptionFields = rootKeys.filter((k) => k.includes("userUpdated"));
    expect(subscriptionFields.length).toBe(0);

    // Check subscription root exists separately
    expect(graph.getRecord("@subscription.0")).toMatchObject({
      id: "@subscription.0",
      __typename: "@subscription.0",
    });
  });

  it("multiple events for same subscription create separate roots", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "event@example.com",
        }),
      },
    };

    const variables = { id: "u1" };

    // Simulate 3 events from same subscription
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: subscriptionData,
      rootId: "@subscription.0",
    });

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: subscriptionData,
      rootId: "@subscription.1",
    });

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: subscriptionData,
      rootId: "@subscription.2",
    });

    // All roots should exist
    expect(graph.getRecord("@subscription.0")).toMatchObject({ id: "@subscription.0" });
    expect(graph.getRecord("@subscription.1")).toMatchObject({ id: "@subscription.1" });
    expect(graph.getRecord("@subscription.2")).toMatchObject({ id: "@subscription.2" });
  });

  it("subscription without rootId uses @ root (backward compatibility)", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "legacy@example.com",
        }),
      },
    };

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
      data: subscriptionData,
      // No rootId - should use @ root
    });

    // Entity should be normalized
    expect(graph.getRecord("User:u1")?.email).toBe("legacy@example.com");

    // @ root should exist
    expect(graph.getRecord("@")).toMatchObject({
      id: "@",
      __typename: "@",
    });
  });
});
