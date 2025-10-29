import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CombinedError } from "../../../src/core/errors";
import { createOperations } from "../../../src/core/operations";
import type { Transport, OperationResult, ObservableLike } from "../../../src/core/operations";
import * as instrumentation from "../../../src/core/instrumentation";

describe("operations", () => {
  let mockTransport: Transport;
  let mockPlanner: any;
  let mockDocuments: any;
  let mockSsr: any;
  let operations: ReturnType<typeof createOperations>;

  beforeEach(() => {
    // Mock transport
    mockTransport = {
      http: vi.fn(),
      ws: vi.fn(),
    };

    // Mock planner
    mockPlanner = {
      getPlan: vi.fn().mockReturnValue({
        compiled: true,
        networkQuery: "query GetUser { user { id name __typename } }",
        makeSignature: vi.fn().mockReturnValue("query-sig-123"),
      }),
    };

    // Mock documents with proper cache simulation
    let cachedData: any = null;
    const materializeCache = new Map<string, any>();

    mockDocuments = {
      normalize: vi.fn((args) => {
        cachedData = args.data;
        // Clear cache when data is written
        materializeCache.clear();
      }),
      materialize: vi.fn((args) => {
        const { force = false, variables = {}, canonical = true } = args;
        const cacheKey = JSON.stringify({ variables, canonical });

        // Check cache if not forcing
        if (!force && materializeCache.has(cacheKey)) {
          return materializeCache.get(cacheKey);
        }

        // Materialize from cached data
        let result;
        if (cachedData) {
          result = {
            data: cachedData,
            source: "canonical",
            ok: { canonical: true, strict: true },
            dependencies: new Set(),
          };
        } else {
          // No cache
          result = {
            data: undefined,
            source: "none",
            ok: { canonical: false, strict: false },
            dependencies: new Set(),
          };
        }

        // Cache the result
        materializeCache.set(cacheKey, result);
        return result;
      }),
      invalidate: vi.fn((args) => {
        const { variables = {}, canonical = true } = args;
        const cacheKey = JSON.stringify({ variables, canonical });
        materializeCache.delete(cacheKey);
      }),
    };

    // Mock SSR
    mockSsr = {
      isHydrating: vi.fn().mockReturnValue(false),
    };

    // Create operations instance
    operations = createOperations(
      { transport: mockTransport, suspensionTimeout: 1000 },
      { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
    );
  });

  describe("CombinedError", () => {
    it("creates error from network error", () => {
      const networkError = new Error("Network failed");
      const error = new CombinedError({ networkError });

      expect(error.name).toBe("CombinedError");
      expect(error.message).toBe("[Network] Network failed");
      expect(error.networkError).toBe(networkError);
    });

    it("creates error from GraphQL errors", () => {
      const graphqlErrors = [
        { message: "Field not found" } as any,
        { message: "Invalid argument" } as any,
      ];
      const error = new CombinedError({ graphqlErrors });

      expect(error.message).toBe("[GraphQL] Field not found\n[GraphQL] Invalid argument");
      expect(error.graphqlErrors).toBe(graphqlErrors);
    });

    it("prioritizes network error over GraphQL errors", () => {
      const networkError = new Error("Network failed");
      const graphqlErrors = [{ message: "Field not found" } as any];
      const error = new CombinedError({ networkError, graphqlErrors });

      expect(error.message).toBe("[Network] Network failed");
    });

    it("converts to string", () => {
      const error = new CombinedError({
        networkError: new Error("Failed"),
      });

      expect(error.toString()).toBe("[Network] Failed");
    });
  });

  describe("executeMutation", () => {
    const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";
    const variables = { name: "Bob" };

    it("sends networkQuery with __typename to transport, not original query", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      };

      const networkQueryWithTypename = "mutation CreateUser($name: String!) { createUser(name: $name) { id name __typename } }";
      
      mockPlanner.getPlan.mockReturnValue({
        compiled: true,
        networkQuery: networkQueryWithTypename,
        makeSignature: vi.fn().mockReturnValue("mutation-sig-123"),
      });

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeMutation({ query: mutation, variables });

      // Should send networkQuery (with __typename), not original query
      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          query: networkQueryWithTypename, // NOT the original mutation
          variables,
          operationType: "mutation",
        }),
      );
    });

    it("executes mutation and writes successful result to cache", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "2", name: "Bob" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeMutation({ query: mutation, variables });

      expect(result).toEqual(mockResult);
      expect(mockPlanner.getPlan).toHaveBeenCalledWith(mutation);
      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(String), // networkQuery, not original
          variables,
          operationType: "mutation",
          compiledQuery: expect.objectContaining({ compiled: true }),
        }),
      );
      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: mutation,
        variables,
        data: mockResult.data,
        rootId: "@mutation.0",
      });
    });

    it("does not write to cache when mutation has error", async () => {
      const mockResult: OperationResult = {
        data: null,
        error: new CombinedError({
          graphqlErrors: [{ message: "Validation failed" } as any],
        }),
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeMutation({ query: mutation, variables });

      expect(result).toEqual(mockResult);
      expect(mockDocuments.normalize).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Connection refused");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeMutation({ query: mutation, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockDocuments.normalize).not.toHaveBeenCalled();
    });

    it("materializes and notifies watchers after successful mutation", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "2", name: "Bob" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);
      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: mockResult.data,
        fingerprints: { __version: 123, createUser: { __version: 456 } },
        dependencies: new Set(["User:2"]),
        source: "canonical",
        hot: false,
        ok: { miss: null },
      });

      const onQueryNetworkData = vi.fn().mockReturnValue(true);
      const opsWithWatchers = createOperations(
        {
          transport: mockTransport,
          onQueryNetworkData,
        },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      await opsWithWatchers.executeMutation({ query: mutation, variables });

      // Should materialize after normalize
      expect(mockDocuments.materialize).toHaveBeenCalledWith({
        document: mutation,
        variables,
        canonical: true,
        fingerprint: true,
        preferCache: false,
        updateCache: false,
        rootId: "@mutation.0",
      });

      // Should notify watchers
      expect(onQueryNetworkData).toHaveBeenCalledWith(
        expect.any(String), // signature
        mockResult.data, // data
        expect.any(Object), // fingerprints
        expect.any(Set), // dependencies
      );

      // Should NOT invalidate (watchers caught it)
      expect(mockDocuments.invalidate).not.toHaveBeenCalled();
    });

    it("invalidates cache if no watchers caught mutation result", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "2", name: "Bob" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);
      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: mockResult.data,
        dependencies: ["User:2"],
        source: "canonical",
        hot: false,
        ok: { miss: null },
      });

      const onQueryNetworkData = vi.fn().mockReturnValue(false); // No watchers caught it
      const opsWithWatchers = createOperations(
        {
          transport: mockTransport,
          onQueryNetworkData,
        },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      await opsWithWatchers.executeMutation({ query: mutation, variables });

      // Should invalidate cache (no watchers)
      expect(mockDocuments.invalidate).toHaveBeenCalledWith({
        document: mutation,
        variables,
        canonical: true,
        fingerprint: true,
      });
    });

    it("does not materialize or notify when onQueryNetworkData is not provided", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "2", name: "Bob" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeMutation({ query: mutation, variables });

      // Should normalize
      expect(mockDocuments.normalize).toHaveBeenCalled();

      // Should materialize but NOT cache (no watcher system)
      expect(mockDocuments.materialize).toHaveBeenCalledWith({
        document: mutation,
        variables,
        canonical: true,
        fingerprint: true,
        preferCache: false,
        updateCache: false,  // No watcher system
        rootId: "@mutation.0",
      });
    });

    it("returns materialized data, not raw network response", async () => {
      const networkData = { createUser: { id: "2", name: "Bob", __typename: "User" } };
      const materializedData = { createUser: { id: "2", name: "Bob" } }; // Normalized

      vi.mocked(mockTransport.http).mockResolvedValue({
        data: networkData,
        error: null,
      });

      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: materializedData,
        dependencies: ["User:2"],
        source: "canonical",
        hot: false,
        ok: { miss: null },
      });

      const result = await operations.executeMutation({ query: mutation, variables });

      // Should return materialized data, not network data
      expect(result.data).toEqual(materializedData);
      expect(result.data).not.toEqual(networkData);
    });
  });

  describe("executeMutation - with clock and rootId", () => {
    const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name __typename } }";
    
    it("normalizes mutation with unique rootId using mutation clock", async () => {
      const variables1 = { name: "Alice" };
      const variables2 = { name: "Bob" };
      
      const mockResult1: OperationResult = {
        data: { createUser: { id: "1", name: "Alice", __typename: "User" } },
        error: null,
      };
      
      const mockResult2: OperationResult = {
        data: { createUser: { id: "2", name: "Bob", __typename: "User" } },
        error: null,
      };

      vi.mocked(mockTransport.http)
        .mockResolvedValueOnce(mockResult1)
        .mockResolvedValueOnce(mockResult2);

      // Execute first mutation
      await operations.executeMutation({ query: mutation, variables: variables1 });

      // Execute second mutation
      await operations.executeMutation({ query: mutation, variables: variables2 });

      // Should normalize with unique rootIds
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, {
        document: mutation,
        variables: variables1,
        data: mockResult1.data,
        rootId: "@mutation.0",
      });

      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, {
        document: mutation,
        variables: variables2,
        data: mockResult2.data,
        rootId: "@mutation.1",
      });
    });

    it("materializes mutation result from custom rootId", async () => {
      const variables = { name: "Charlie" };
      const mockResult: OperationResult = {
        data: { createUser: { id: "3", name: "Charlie", __typename: "User" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeMutation({ query: mutation, variables });

      // Should materialize with rootId set to mutation rootId
      expect(mockDocuments.materialize).toHaveBeenCalledWith({
        document: mutation,
        variables,
        canonical: true,
        fingerprint: true,
        preferCache: false,
        updateCache: false,
        rootId: "@mutation.0",
      });
    });

    it("increments mutation clock for each mutation", async () => {
      const mutation1 = "mutation CreateUser { createUser(name: \"A\") { id } }";
      const mutation2 = "mutation UpdateUser { updateUser(id: \"1\") { id } }";
      const mutation3 = "mutation DeleteUser { deleteUser(id: \"1\") { success } }";

      vi.mocked(mockTransport.http).mockResolvedValue({ data: {}, error: null });

      await operations.executeMutation({ query: mutation1, variables: {} });
      await operations.executeMutation({ query: mutation2, variables: {} });
      await operations.executeMutation({ query: mutation3, variables: {} });

      // Check rootIds increment
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        rootId: "@mutation.0",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        rootId: "@mutation.1",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(3, expect.objectContaining({
        rootId: "@mutation.2",
      }));
    });

    it("stores mutation history with separate roots", async () => {
      const variables = { name: "Dave" };
      const mockResult: OperationResult = {
        data: { createUser: { id: "4", name: "Dave", __typename: "User" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Execute mutation twice with same variables
      await operations.executeMutation({ query: mutation, variables });
      await operations.executeMutation({ query: mutation, variables });

      // Both should have different rootIds even with same variables
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        rootId: "@mutation.0",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        rootId: "@mutation.1",
      }));
    });
  });

  describe("executeMutation - callbacks", () => {
    const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";
    const variables = { name: "Eve" };

    it("invokes onData callback with mutation result", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "5", name: "Eve" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const onData = vi.fn();
      await operations.executeMutation({ 
        query: mutation, 
        variables,
        onData,
      });

      expect(onData).toHaveBeenCalledWith(mockResult.data);
      expect(onData).toHaveBeenCalledTimes(1);
    });

    it("invokes onError callback on mutation failure", async () => {
      const networkError = new Error("Mutation failed");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const onError = vi.fn();
      await operations.executeMutation({
        query: mutation,
        variables,
        onError,
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          networkError,
        }),
      );
    });

    it("invokes onError for GraphQL errors", async () => {
      const mockResult: OperationResult = {
        data: null,
        error: new CombinedError({
          graphqlErrors: [{ message: "User already exists" } as any],
        }),
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const onError = vi.fn();
      await operations.executeMutation({
        query: mutation,
        variables,
        onError,
      });

      expect(onError).toHaveBeenCalledWith(mockResult.error);
    });

    it("does not invoke callbacks when not provided", async () => {
      const mockResult: OperationResult = {
        data: { createUser: { id: "6", name: "Frank" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Should not throw when callbacks are undefined
      await expect(
        operations.executeMutation({
          query: mutation,
          variables,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("executeMutation - error handling", () => {
    const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";

    it("returns error when materialization fails after write (production mode)", async () => {
      // Mock __DEV__ = false (production)
      vi.spyOn(instrumentation, "__DEV__", "get").mockReturnValue(false);

      const mockResult: OperationResult = {
        data: { createUser: { id: "9", name: "Ivy" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Mock materialize to return source: "none" (materialization failure)
      mockDocuments.materialize.mockReturnValue({
        data: undefined,
        source: "none",
        ok: {
          strict: false,
          canonical: false,
          miss: [
            { kind: "field-link-missing", at: "createUser", parentId: "User:9", fieldKey: "email" },
          ],
        },
      });

      const result = await operations.executeMutation({ 
        query: mutation, 
        variables: { name: "Ivy" },
      });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.message).toContain("Mutation materialization failed");
      expect(result.error?.message).not.toContain("Missing fields:");
      expect(mockDocuments.normalize).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it("returns detailed error with miss information (dev mode)", async () => {
      // Mock __DEV__ = true (development)
      vi.spyOn(instrumentation, "__DEV__", "get").mockReturnValue(true);

      const mockResult: OperationResult = {
        data: { createUser: { id: "9", name: "Ivy" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Mock materialize to return source: "none" with miss information
      mockDocuments.materialize.mockReturnValue({
        data: undefined,
        source: "none",
        ok: {
          strict: false,
          canonical: false,
          miss: [
            { kind: "field-link-missing", at: "createUser", parentId: "User:9", fieldKey: "email" },
            { kind: "entity-missing", at: "createUser.profile", id: "Profile:1" },
          ],
        },
      });

      const result = await operations.executeMutation({ 
        query: mutation, 
        variables: { name: "Ivy" },
      });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.message).toContain("Mutation materialization failed");
      expect(result.error?.message).toContain("Missing fields:");
      expect(result.error?.message).toContain('Field "email" not found on entity "User:9"');
      expect(result.error?.message).toContain('Entity "Profile:1" not found in cache');
      expect(mockDocuments.normalize).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it("handles null fields in mutation response", async () => {
      const mutationWithNullableField = `
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

      const responseData = {
        createDirectUpload: {
          directUpload: {
            uploadUrl: "https://example.com/upload",
            __typename: "DirectUpload",
          },
          errors: null, // This is a valid null value, not a missing field
          __typename: "CreateDirectUploadPayload",
        },
      };

      const mockResult: OperationResult = {
        data: responseData,
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Mock normalize to store the data
      mockDocuments.normalize.mockImplementation(() => {});

      // Mock materialize to return the data with null field
      mockDocuments.materialize.mockReturnValue({
        data: responseData,
        source: "canonical",
        fingerprints: {},
        dependencies: new Set(),
        ok: {
          strict: true,
          canonical: true,
        },
      });

      const result = await operations.executeMutation({
        query: mutationWithNullableField,
        variables: { input: { filename: "test.wav" } },
      });

      // Should succeed - null is a valid value
      expect(result.data).toEqual(responseData);
      expect(result.error).toBeNull();
      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: mutationWithNullableField,
        variables: { input: { filename: "test.wav" } },
        data: responseData,
        rootId: "@mutation.0",
      });
    });

    it("handles partial data with GraphQL errors", async () => {
      const partialData = { createUser: { id: "10", name: null } };
      const mockResult: OperationResult = {
        data: partialData,
        error: new CombinedError({
          graphqlErrors: [{ message: "Name validation failed" } as any],
        }),
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeMutation({
        query: mutation,
        variables: { name: "" },
      });

      // Should still normalize partial data
      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: mutation,
        variables: { name: "" },
        data: partialData,
        rootId: "@mutation.0",
      });

      expect(result.data).toEqual(partialData);
      expect(result.error).toBeDefined();
    });
  });
});
