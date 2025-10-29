// Test materialize for mutations with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { UPDATE_USER_MUTATION } from "@/test/helpers/operations";

describe("documents.materialize - mutations with rootId", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (u) => u.id,
        Post: (p) => p.id,
      },
      interfaces: {},
      onChange: () => {},
    });

    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, canonical, planner });
  });

  it("materializes mutation result from custom rootId", () => {
    const mutationData = {
      updateUser: {
        user: {
          ...users.buildNode({
            id: "u1",
            email: "materialized@example.com",
          }),
          posts: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
        },
      },
    };

    const rootId = "@mutation.0";
    const variables = {
      input: { id: "u1", email: "materialized@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // First normalize
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables,
      data: mutationData,
      rootId,
    });

    // Then materialize from same rootId (using rootId parameter)
    const result = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables,
      canonical: true,
      fingerprint: false,
      preferCache: false,
      updateCache: false,
      rootId: rootId,
    });

    // Should successfully materialize the mutation result
    expect(result.data).toMatchObject({
      updateUser: {
        user: {
          id: "u1",
          email: "materialized@example.com",
          __typename: "User",
        },
      },
    });
    expect(result.source).not.toBe("none");
  });

  it("supports materializing multiple mutations independently", () => {
    const mutation1Data = {
      updateUser: {
        user: {
          ...users.buildNode({
            id: "u1",
            email: "first@example.com",
          }),
          posts: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
        },
      },
    };

    const mutation2Data = {
      updateUser: {
        user: {
          ...users.buildNode({
            id: "u2",
            email: "second@example.com",
          }),
          posts: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
        },
      },
    };

    const variables1 = {
      input: { id: "u1", email: "first@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    const variables2 = {
      input: { id: "u2", email: "second@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // Normalize both mutations
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: variables1,
      data: mutation1Data,
      rootId: "@mutation.0",
    });

    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: variables2,
      data: mutation2Data,
      rootId: "@mutation.1",
    });

    // Materialize both independently
    const result1 = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables: variables1,
      rootId: "@mutation.0",
      canonical: true,
      fingerprint: false,
    });

    const result2 = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables: variables2,
      rootId: "@mutation.1",
      canonical: true,
      fingerprint: false,
    });

    expect(result1.data?.updateUser?.user?.email).toBe("first@example.com");
    expect(result2.data?.updateUser?.user?.email).toBe("second@example.com");
  });

  it("materialize fails gracefully if rootId doesn't exist", () => {
    const variables = {
      input: { id: "u1", email: "test@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // Try to materialize without normalizing first
    const result = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables,
      rootId: "@mutation.999", // Non-existent root
      canonical: true,
      fingerprint: false,
    });

    // Should return empty/missing result
    expect(result.source).toBe("none");
  });

  it("materialize resolves entity references correctly", () => {
    const mutationData = {
      updateUser: {
        user: {
          ...users.buildNode({
            id: "u1",
            email: "resolved@example.com",
          }),
          posts: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
        },
      },
    };

    const rootId = "@mutation.0";
    const variables = {
      input: { id: "u1", email: "resolved@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // Normalize
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables,
      data: mutationData,
      rootId,
    });

    // Update the entity directly
    graph.putRecord("User:u1", { email: "updated-after-mutation@example.com" });

    // Materialize should get the updated entity data
    const result = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables,
      rootId: rootId,
      canonical: true,
      fingerprint: false,
    });

    // Should reflect the updated entity data
    expect(result.data?.updateUser?.user?.email).toBe("updated-after-mutation@example.com");
  });

  it("materialize with wrong variables returns missing data", () => {
    const mutationData = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "correct@example.com",
        }),
      },
    };

    const correctVariables = {
      input: { id: "u1", email: "correct@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    const wrongVariables = {
      input: { id: "u1", email: "wrong@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // Normalize with correct variables
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: correctVariables,
      data: mutationData,
      rootId: "@mutation.0",
    });

    // Try to materialize with wrong variables
    const result = documents.materialize({
      document: UPDATE_USER_MUTATION,
      variables: wrongVariables,
      rootId: "@mutation.0",
      canonical: true,
      fingerprint: false,
    });

    // Should fail to find the field with wrong args
    expect(result.ok.canonical).toBe(false);
  });
});
