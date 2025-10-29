// Test materialize for subscriptions with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { USER_UPDATED_SUBSCRIPTION } from "@/test/helpers/operations";

describe("documents.materialize - subscriptions with rootId", () => {
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

  it("materializes subscription result from custom rootId", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "sub-materialized@example.com",
        }),
      },
    };

    const rootId = "@subscription.0";
    const variables = { id: "u1" };

    // First normalize
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: subscriptionData,
      rootId,
    });

    // Then materialize from same rootId (using entityId parameter)
    const result = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      canonical: true,
      fingerprint: false,
      preferCache: false,
      updateCache: false,
      entityId: rootId,
    });

    // Should successfully materialize the subscription result
    expect(result.data).toMatchObject({
      userUpdated: {
        __typename: "UserUpdated",
        user: {
          id: "u1",
          email: "sub-materialized@example.com",
          __typename: "User",
        },
      },
    });
    expect(result.source).not.toBe("none");
  });

  it("supports materializing multiple subscription events independently", () => {
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

    const variables = { id: "u1" };

    // Normalize both events
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: event1Data,
      rootId: "@subscription.0",
    });

    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: event2Data,
      rootId: "@subscription.1",
    });

    // Materialize both independently
    const result1 = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      entityId: "@subscription.0",
      canonical: true,
      fingerprint: false,
    });

    const result2 = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      entityId: "@subscription.1",
      canonical: true,
      fingerprint: false,
    });

    // Both should materialize successfully
    expect(result1.source).not.toBe("none");
    expect(result2.source).not.toBe("none");

    // Both will show latest entity data since entity was updated
    expect(result1.data?.userUpdated?.user?.email).toBe("event2@example.com");
    expect(result2.data?.userUpdated?.user?.email).toBe("event2@example.com");
  });

  it("materialize fails gracefully if rootId doesn't exist", () => {
    const variables = { id: "u1" };

    // Try to materialize without normalizing first
    const result = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      entityId: "@subscription.999", // Non-existent root
      canonical: true,
      fingerprint: false,
    });

    // Should return empty/missing result
    expect(result.source).toBe("none");
  });

  it("materialize resolves entity references correctly", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "initial@example.com",
        }),
      },
    };

    const rootId = "@subscription.0";
    const variables = { id: "u1" };

    // Normalize
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      data: subscriptionData,
      rootId,
    });

    // Update the entity directly (simulating another update)
    graph.putRecord("User:u1", { email: "updated-after-event@example.com" });

    // Materialize should get the updated entity data
    const result = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables,
      entityId: rootId,
      canonical: true,
      fingerprint: false,
    });

    // Should reflect the updated entity data
    expect(result.data?.userUpdated?.user?.email).toBe("updated-after-event@example.com");
  });

  it("materialize with wrong variables returns missing data", () => {
    const subscriptionData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "correct@example.com",
        }),
      },
    };

    const correctVariables = { id: "u1" };
    const wrongVariables = { id: "u2" };

    // Normalize with correct variables
    documents.normalize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: correctVariables,
      data: subscriptionData,
      rootId: "@subscription.0",
    });

    // Try to materialize with wrong variables
    const result = documents.materialize({
      document: USER_UPDATED_SUBSCRIPTION,
      variables: wrongVariables,
      entityId: "@subscription.0",
      canonical: true,
      fingerprint: false,
    });

    // Should fail to find the field with wrong args
    expect(result.ok.canonical).toBe(false);
  });

  it("multiple events create separate materializable snapshots", () => {
    const variables = { id: "u1" };

    // Simulate 3 events
    for (let i = 0; i < 3; i++) {
      const eventData = {
        userUpdated: {
          __typename: "UserUpdated",
          user: users.buildNode({
            id: "u1",
            email: `event${i}@example.com`,
          }),
        },
      };

      documents.normalize({
        document: USER_UPDATED_SUBSCRIPTION,
        variables,
        data: eventData,
        rootId: `@subscription.${i}`,
      });
    }

    // All events should be materializable
    for (let i = 0; i < 3; i++) {
      const result = documents.materialize({
        document: USER_UPDATED_SUBSCRIPTION,
        variables,
        entityId: `@subscription.${i}`,
        canonical: true,
        fingerprint: false,
      });

      expect(result.source).not.toBe("none");
      expect(result.data?.userUpdated).toBeDefined();
    }
  });
});
