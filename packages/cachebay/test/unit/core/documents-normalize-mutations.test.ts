// Test normalize for mutations with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { UPDATE_USER_MUTATION } from "@/test/helpers/operations";

describe("documents.normalize - mutations with rootId", () => {
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

  it("normalizes mutation with custom rootId", () => {
    const mutationData = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "updated@example.com",
        }),
      },
    };

    const rootId = "@mutation.0";

    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: {
        input: { id: "u1", email: "updated@example.com" },
        postCategory: "tech",
        postFirst: 10,
        postAfter: "",
      },
      data: mutationData,
      rootId,
    });

    // Check entity was normalized
    expect(graph.getRecord("User:u1")).toMatchObject({
      id: "u1",
      __typename: "User",
      email: "updated@example.com",
    });

    // Check mutation root was created with link to entity
    const mutationRoot = graph.getRecord(rootId);
    const fieldKey = 'updateUser({"input":{"id":"u1","email":"updated@example.com"}})';
    
    expect(mutationRoot).toEqual({
      id: rootId,
      __typename: rootId,
      [fieldKey]: {
        __ref: expect.any(String),
      },
    });
  });

  it("supports multiple mutations with different rootIds", () => {
    const mutation1Data = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "first@example.com",
        }),
      },
    };

    const mutation2Data = {
      updateUser: {
        user: users.buildNode({
          id: "u2",
          email: "second@example.com",
        }),
      },
    };

    // First mutation
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: {
        input: { id: "u1", email: "first@example.com" },
        postCategory: "tech",
        postFirst: 10,
        postAfter: "",
      },
      data: mutation1Data,
      rootId: "@mutation.0",
    });

    // Second mutation
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: {
        input: { id: "u2", email: "second@example.com" },
        postCategory: "tech",
        postFirst: 10,
        postAfter: "",
      },
      data: mutation2Data,
      rootId: "@mutation.1",
    });

    // Both entities should exist
    expect(graph.getRecord("User:u1")?.email).toBe("first@example.com");
    expect(graph.getRecord("User:u2")?.email).toBe("second@example.com");

    // Both mutation roots should exist
    expect(graph.getRecord("@mutation.0")).toMatchObject({
      id: "@mutation.0",
      __typename: "@mutation.0",
    });
    expect(graph.getRecord("@mutation.1")).toMatchObject({
      id: "@mutation.1",
      __typename: "@mutation.1",
    });
  });

  it("mutations with rootId don't pollute @ root", () => {
    const mutationData = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "mutation@example.com",
        }),
      },
    };

    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: {
        input: { id: "u1", email: "mutation@example.com" },
        postCategory: "tech",
        postFirst: 10,
        postAfter: "",
      },
      data: mutationData,
      rootId: "@mutation.0",
    });

    // Check that @ root doesn't have mutation fields
    const rootRecord = graph.getRecord("@");
    const rootKeys = Object.keys(rootRecord || {});
    const mutationFields = rootKeys.filter((k) => k.includes("updateUser"));
    expect(mutationFields.length).toBe(0);

    // Check mutation root exists separately
    expect(graph.getRecord("@mutation.0")).toMatchObject({
      id: "@mutation.0",
      __typename: "@mutation.0",
    });
  });

  it("same mutation with same args but different rootIds creates separate roots", () => {
    const mutationData = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "same@example.com",
        }),
      },
    };

    const variables = {
      input: { id: "u1", email: "same@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: "",
    };

    // Execute same mutation twice with different rootIds
    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables,
      data: mutationData,
      rootId: "@mutation.0",
    });

    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables,
      data: mutationData,
      rootId: "@mutation.1",
    });

    // Both roots should exist with the same field (same args)
    const fieldKey = 'updateUser({"input":{"id":"u1","email":"same@example.com"}})';
    
    expect(graph.getRecord("@mutation.0")).toEqual({
      id: "@mutation.0",
      __typename: "@mutation.0",
      [fieldKey]: {
        __ref: expect.any(String),
      },
    });
    
    expect(graph.getRecord("@mutation.1")).toEqual({
      id: "@mutation.1",
      __typename: "@mutation.1",
      [fieldKey]: {
        __ref: expect.any(String),
      },
    });
  });

  it("mutation without rootId uses @ root (backward compatibility)", () => {
    const mutationData = {
      updateUser: {
        user: users.buildNode({
          id: "u1",
          email: "legacy@example.com",
        }),
      },
    };

    documents.normalize({
      document: UPDATE_USER_MUTATION,
      variables: {
        input: { id: "u1", email: "legacy@example.com" },
        postCategory: "tech",
        postFirst: 10,
        postAfter: "",
      },
      data: mutationData,
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

  it("normalizes and materializes mutation with null field", () => {
    const mutation = `
      mutation CreateDirectUpload($input: CreateDirectUploadInput!) {
        createDirectUpload(input: $input) {
          directUpload {
            uploadUrl
            __typename
          }
          errors {
            message
            __typename
          }
          __typename
        }
      }
    `;

    const mutationData = {
      createDirectUpload: {
        directUpload: {
          uploadUrl: "https://example.com/upload",
          __typename: "DirectUpload",
        },
        errors: null, // This is a valid null value
        __typename: "CreateDirectUploadPayload",
      },
    };

    const rootId = "@mutation.0";

    // Normalize the mutation response
    documents.normalize({
      document: mutation,
      variables: { input: { filename: "test.wav" } },
      data: mutationData,
      rootId,
    });

    // Materialize it back - should succeed with null field
    const result = documents.materialize({
      document: mutation,
      variables: { input: { filename: "test.wav" } },
      canonical: true,
      fingerprint: false,
      preferCache: false,
      updateCache: false,
      rootId,
    });

    // Should succeed - null is a valid value, not a cache miss
    expect(result.source).not.toBe("none");
    expect(result.data).toEqual(mutationData);
    expect(result.data.createDirectUpload.errors).toBeNull();
  });
});
