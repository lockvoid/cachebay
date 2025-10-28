import { describe, it, expect, vi, beforeEach } from "vitest";
import { CombinedError } from "../../../src/core/errors";
import { createOperations } from "../../../src/core/operations";
import type { Transport, OperationResult, ObservableLike } from "../../../src/core/operations";

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

  describe("executeQuery", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };

    it("executes query and writes successful result to cache", async () => {
      const mockResult: OperationResult = {
        data: { user: { id: "1", name: "Alice" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeQuery({ query, variables });

      expect(result).toEqual({
        ...mockResult,
        meta: { source: "network" },
      });
      expect(mockPlanner.getPlan).toHaveBeenCalledWith(query);
      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "query GetUser { user { id name __typename } }", // networkQuery with __typename
          variables,
          operationType: "query",
          compiledQuery: expect.objectContaining({ compiled: true }),
        }),
      );
      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: query,
        variables,
        data: mockResult.data,
      });
    });

    it("does not write to cache when result has error", async () => {
      const mockResult: OperationResult = {
        data: null,
        error: new CombinedError({
          graphqlErrors: [{ message: "Not found" } as any],
        }),
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeQuery({ query, variables });

      expect(result).toEqual(mockResult);
      expect(mockDocuments.normalize).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Network timeout");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeQuery({ query, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockDocuments.normalize).not.toHaveBeenCalled();
    });

    it("uses empty object for missing variables", async () => {
      const mockResult: OperationResult = {
        data: { user: { id: "1" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeQuery({ query });

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {},
        }),
      );
    });

    it("returns error when materialization fails after write", async () => {
      const mockResult: OperationResult = {
        data: { user: { id: "1", name: "Alice" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Mock readQuery to return source: "none" (materialization failure)
      mockDocuments.materialize.mockReturnValue({
        data: undefined,
        source: "none",
        ok: {
          strict: false,
          canonical: false,
          miss: [
            { kind: "entity-missing", at: "@.user", id: "User:1" },
            { kind: "field-link-missing", at: "@.user", parentId: "@", fieldKey: "user({\"id\":\"1\"})" },
          ],
        },
      });

      const result = await operations.executeQuery({ query, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.message).toContain("Failed to materialize query after write");
      expect(result.error?.networkError?.message).toContain("missing required fields");
      expect(mockDocuments.normalize).toHaveBeenCalled();
    });
  });

  describe("executeQuery - cache policies", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice" } };
    const networkData = { user: { id: "1", name: "Network Alice" } };

    describe("network-only (default)", () => {
      it("always fetches from network and ignores cache", async () => {
        // Pre-populate cache with old data
        mockDocuments.normalize({ data: cachedData });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
      });

      it("invokes onNetworkData callback with data", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onNetworkData = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
          onNetworkData,
        });

        expect(onNetworkData).toHaveBeenCalledWith(networkData);
        expect(onNetworkData).toHaveBeenCalledTimes(1);
      });

      it("invokes onError callback on network failure", async () => {
        const networkError = new Error("Network failed");
        vi.mocked(mockTransport.http).mockRejectedValue(networkError);

        const onError = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
          onError,
        });

        expect(result.data).toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            networkError,
          }),
        );
      });
    });

    describe("cache-first", () => {
      it("returns cached data when canonical and strict cache hit", async () => {
        mockDocuments.materialize.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: {
            canonical: true,
            strict: true,
            strictSignature: "query-sig-123", // Includes pagination args
            canonicalSignature: "query-sig-canonical", // Excludes pagination args
          },
        });

        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          canonical: true,
          onNetworkData,
        });

        expect(result.data).toEqual(cachedData);
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onNetworkData).toHaveBeenCalledWith(cachedData);
      });

      it("fetches from network when strict cache hit but canonical cache miss", async () => {
        let readCount = 0;
        mockDocuments.materialize.mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Initial cache miss
            return {
              data: undefined,
              source: "none",
              ok: { canonical: false, strict: true },
            };
          }
          // After network fetch and write
          return {
            data: networkData,
            source: "canonical",
            ok: { canonical: true, strict: true },
          };
        });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          onNetworkData,
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
        expect(onNetworkData).toHaveBeenCalledWith(networkData);
      });

      it("fetches from network when canonical cache hit but strict cache miss", async () => {
        let readCount = 0;
        mockDocuments.materialize.mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Initial cache miss
            return {
              data: undefined,
              source: "none",
              ok: { canonical: true, strict: false },
            };
          }
          // After network fetch and write
          return {
            data: networkData,
            source: "canonical",
            ok: { canonical: true, strict: true },
          };
        });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          onNetworkData,
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
        expect(onNetworkData).toHaveBeenCalledWith(networkData);
      });
    });

    describe("cache-only", () => {
      it("returns cached data when available", async () => {
        mockDocuments.materialize.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-only",
          onNetworkData,
        });

        expect(result.data).toEqual(cachedData);
        expect(result.error).toBeNull();
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onNetworkData).toHaveBeenCalledWith(cachedData);
      });

      it("returns CacheMissError when no cache", async () => {
        mockDocuments.materialize.mockReturnValue({
          data: undefined,
          source: "none",
          ok: { canonical: false, strict: false },
        });

        const onError = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-only",
          onError,
        });

        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(CombinedError);
        expect(result.error?.networkError?.name).toBe("CacheMissError");
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
      });

      it("never makes network request", async () => {
        mockDocuments.materialize.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-only",
        });

        expect(mockTransport.http).not.toHaveBeenCalled();
      });
    });

    describe("cache-and-network", () => {
      it("returns network data after calling onCacheData with cached data", async () => {
        mockDocuments.materialize.mockReturnValueOnce({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        }).mockReturnValueOnce({
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onCacheData = vi.fn();
        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          onCacheData,
          onNetworkData,
        });

        // onCacheData should be called with cached data
        expect(onCacheData).toHaveBeenCalledWith(cachedData, { willFetchFromNetwork: true });

        // Promise should resolve with network data
        expect(result.data).toEqual(networkData);
        expect(onNetworkData).toHaveBeenCalledWith(networkData);

        // Network request should be initiated
        expect(mockTransport.http).toHaveBeenCalled();
      });

      it("handles network fetch errors and returns error", async () => {
        mockDocuments.materialize.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        });

        const networkError = new Error("Network fetch failed");
        vi.mocked(mockTransport.http).mockRejectedValue(networkError);

        const onCacheData = vi.fn();
        const onError = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          onCacheData,
          onError,
        });

        // onCacheData should be called with cached data
        expect(onCacheData).toHaveBeenCalledWith(cachedData, { willFetchFromNetwork: true });

        // Promise should resolve with error (network failed)
        expect(result.data).toBeNull();
        expect(result.error).toBeDefined();

        // onError should be called for network failure
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            networkError,
          }),
        );
      });

      it("fetches from network when no cache available", async () => {
        let readCount = 0;
        mockDocuments.materialize.mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Initial cache miss
            return {
              data: undefined,
              source: "none",
              ok: { canonical: false, strict: false },
            };
          }
          // After network fetch and write
          return {
            data: networkData,
            source: "canonical",
            ok: { canonical: true, strict: true },
          };
        });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
      });

      it("calls onCacheData with cached data and resolves with network data", async () => {
        mockDocuments.materialize.mockReturnValueOnce({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        }).mockReturnValueOnce({
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        });

        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onCacheData = vi.fn();
        const onNetworkData = vi.fn();

        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          onCacheData,
          onNetworkData,
        });

        // onCacheData should be called immediately with cached data
        expect(onCacheData).toHaveBeenCalledTimes(1);
        expect(onCacheData).toHaveBeenCalledWith(cachedData, { willFetchFromNetwork: true });

        // Promise should resolve with network data
        expect(result.data).toEqual(networkData);
        expect(result.error).toBeNull();

        // onNetworkData should be called with network data
        expect(onNetworkData).toHaveBeenCalledWith(networkData);

        // Network request should have been made
        expect(mockTransport.http).toHaveBeenCalled();
      });
    });

    describe("SSR hydration", () => {
      it("returns cached data during hydration for network-only", async () => {
        mockSsr.isHydrating.mockReturnValue(true);
        // Pre-populate cache
        mockDocuments.normalize({ data: cachedData });

        const onNetworkData = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
          onNetworkData,
        });

        expect(result.data).toEqual(cachedData);
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onNetworkData).toHaveBeenCalledWith(cachedData);
      });

      it("returns cached data during hydration for cache-first", async () => {
        mockSsr.isHydrating.mockReturnValue(true);
        // Pre-populate cache
        mockDocuments.normalize({ data: cachedData });

        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
        });

        expect(result.data).toEqual(cachedData);
        expect(mockTransport.http).not.toHaveBeenCalled();
      });

      it("skips network request during hydration", async () => {
        mockSsr.isHydrating.mockReturnValue(true);
        // Pre-populate cache
        mockDocuments.normalize({ data: cachedData });

        await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
        });

        expect(mockTransport.http).not.toHaveBeenCalled();
      });
    });

    describe("callbacks", () => {
      it("invokes onNetworkData with data on successful query", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);
        w
        const onNetworkData = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          onNetworkData,
        });

        expect(onNetworkData).toHaveBeenCalledWith(networkData);
        expect(onNetworkData).toHaveBeenCalledTimes(1);
      });

      it("invokes onError with CombinedError on failure", async () => {
        const networkError = new Error("Request failed");
        vi.mocked(mockTransport.http).mockRejectedValue(networkError);

        const onError = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          onError,
        });

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "CombinedError",
            networkError,
          }),
        );
      });

      it("invokes callbacks for partial data scenarios", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: new CombinedError({
            graphqlErrors: [{ message: "Partial error" } as any],
          }),
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onNetworkData = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          onNetworkData,
        });

        // Should still call onNetworkData even with partial errors
        expect(onNetworkData).toHaveBeenCalledWith(networkData);
      });

      it("does not invoke callbacks when not provided", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        // Should not throw when callbacks are undefined
        await expect(
          operations.executeQuery({
            query,
            variables,
          }),
        ).resolves.toBeDefined();
      });
    });
  });

  describe("executeMutation", () => {
    const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";
    const variables = { name: "Bob" };

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
          query: mutation,
          variables,
          operationType: "mutation",
          compiledQuery: expect.objectContaining({ compiled: true }),
        }),
      );
      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: mutation,
        variables,
        data: mockResult.data,
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
        dependencies: ["User:2"],
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
        updateCache: true,
      });

      // Should notify watchers
      expect(onQueryNetworkData).toHaveBeenCalledWith({
        signature: expect.any(String),
        data: mockResult.data,
        dependencies: ["User:2"],
        cachePolicy: "cache-first",
      });

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

  describe("executeSubscription", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("throws error when WebSocket transport is not configured", async () => {
      const opsWithoutWs = createOperations(
        { transport: { http: vi.fn() } },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      await expect(
        opsWithoutWs.executeSubscription({ query: subscription, variables }),
      ).rejects.toThrow("WebSocket transport is not configured");
    });

    it("executes subscription and wraps observable", async () => {
      const mockObservable: ObservableLike<OperationResult> = {
        subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      };

      vi.mocked(mockTransport.ws!).mockResolvedValue(mockObservable);

      const observable = await operations.executeSubscription({ query: subscription, variables });

      expect(mockPlanner.getPlan).toHaveBeenCalledWith(subscription);
      expect(mockTransport.ws).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "query GetUser { user { id name __typename } }", // networkQuery with __typename
          variables,
          operationType: "subscription",
          compiledQuery: expect.objectContaining({ compiled: true }),
        }),
      );
      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe("function");
    });

    it("writes subscription data to cache on next", async () => {
      let capturedObserver: any;
      const mockObservable: ObservableLike<OperationResult> = {
        subscribe: vi.fn((observer) => {
          capturedObserver = observer;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws!).mockResolvedValue(mockObservable);

      const observable = await operations.executeSubscription({ query: subscription, variables });
      const observer = {
        next: vi.fn(),
        error: vi.fn(),
        complete: vi.fn(),
      };

      observable.subscribe(observer);

      // Simulate incoming subscription data
      const networkData = { messageAdded: { id: "1", text: "Hello", __typename: "Message" } };
      const materializedData = { messageAdded: { id: "1", text: "Hello" } };

      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: materializedData,
        dependencies: ["Message:1"],
        source: "canonical",
        hot: false,
        ok: { miss: null },
      });

      const result: OperationResult = {
        data: networkData,
        error: null,
      };
      capturedObserver.next(result);

      expect(mockDocuments.normalize).toHaveBeenCalledWith({
        document: subscription,
        variables,
        data: networkData,
      });

      // Should forward materialized data, not network data
      expect(observer.next).toHaveBeenCalledWith({
        data: materializedData,
        error: null,
      });
      expect(observer.next).not.toHaveBeenCalledWith(result);
    });

    it("does not write to cache when subscription data has error", async () => {
      let capturedObserver: any;
      const mockObservable: ObservableLike<OperationResult> = {
        subscribe: vi.fn((observer) => {
          capturedObserver = observer;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws!).mockResolvedValue(mockObservable);

      const observable = await operations.executeSubscription({ query: subscription, variables });
      const observer = { next: vi.fn() };

      observable.subscribe(observer);

      const result: OperationResult = {
        data: null,
        error: new CombinedError({ graphqlErrors: [{ message: "Error" } as any] }),
      };
      capturedObserver.next(result);

      expect(mockDocuments.normalize).not.toHaveBeenCalled();
      expect(observer.next).toHaveBeenCalledWith(result);
    });

    it("forwards errors to observer", async () => {
      let capturedObserver: any;
      const mockObservable: ObservableLike<OperationResult> = {
        subscribe: vi.fn((observer) => {
          capturedObserver = observer;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws!).mockResolvedValue(mockObservable);

      const observable = await operations.executeSubscription({ query: subscription, variables });
      const observer = { error: vi.fn() };

      observable.subscribe(observer);

      const error = new Error("Connection lost");
      capturedObserver.error(error);

      expect(observer.error).toHaveBeenCalledWith(error);
    });

    it("forwards completion to observer", async () => {
      let capturedObserver: any;
      const mockObservable: ObservableLike<OperationResult> = {
        subscribe: vi.fn((observer) => {
          capturedObserver = observer;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws!).mockResolvedValue(mockObservable);

      const observable = await operations.executeSubscription({ query: subscription, variables });
      const observer = { complete: vi.fn() };

      observable.subscribe(observer);
      capturedObserver.complete();

      expect(observer.complete).toHaveBeenCalled();
    });

    it("returns error observable when transport throws", async () => {
      const transportError = new Error("WS connection failed");
      vi.mocked(mockTransport.ws!).mockRejectedValue(transportError);

      const observable = await operations.executeSubscription({ query: subscription, variables });
      const observer = { error: vi.fn() };

      observable.subscribe(observer);

      expect(observer.error).toHaveBeenCalledWith(transportError);
    });
  });

  describe("onQueryNetworkError callback", () => {
    it("calls onQueryNetworkError callback when cache-only query has no cache", async () => {
      const onQueryNetworkError = vi.fn();
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };

      const opsWithCallback = createOperations(
        { transport: mockTransport, onQueryNetworkError },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      mockDocuments.materialize.mockReturnValue({
        data: undefined,
        source: "none",
        ok: { canonical: false, strict: false },
        dependencies: new Set(),
      });

      await opsWithCallback.executeQuery({
        query,
        variables,
        cachePolicy: "cache-only",
      });

      expect(onQueryNetworkError).toHaveBeenCalledWith(
        "query-sig-123",
        expect.objectContaining({
          networkError: expect.objectContaining({
            name: "CacheMissError",
          }),
        }),
      );
    });

    it("calls onQueryNetworkError callback when network request fails", async () => {
      const onQueryNetworkError = vi.fn();
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const networkError = new Error("Network timeout");

      const opsWithCallback = createOperations(
        { transport: mockTransport, onQueryNetworkError },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      await opsWithCallback.executeQuery({
        query,
        variables,
        cachePolicy: "network-only",
      });

      expect(onQueryNetworkError).toHaveBeenCalledWith(
        "query-sig-123",
        expect.objectContaining({
          networkError,
        }),
      );
    });
  });

  describe("meta.source field", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice" } };
    const networkData = { user: { id: "1", name: "Network Alice" } };

    it("sets meta.source to 'network' for cache-and-network (resolves with network data)", async () => {
      mockDocuments.materialize.mockReturnValueOnce({
        data: cachedData,
        source: "canonical",
        ok: { canonical: true, strict: true },
        dependencies: new Set(),
      }).mockReturnValueOnce({
        data: networkData,
        source: "canonical",
        ok: { canonical: true, strict: true },
        dependencies: new Set(),
      });

      const mockResult: OperationResult = {
        data: networkData,
        error: null,
      };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-and-network",
      });

      // Promise resolves with network data
      expect(result.data).toEqual(networkData);
      expect(result.meta?.source).toBe("network");
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("sets meta.source to 'network' for network responses", async () => {
      // No cache - will fetch from network
      vi.mocked(mockTransport.http).mockResolvedValue({
        data: networkData,
        error: null,
      });

      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "network-only",
      });

      expect(result.data).toEqual(networkData);
      expect(result.meta?.source).toBe("network");
    });

    it("does not set meta.source for cache-first with cache hit", async () => {
      mockDocuments.materialize.mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: {
          canonical: true,
          strict: true,
          strictSignature: "query-sig-123", // Must match plan.makeSignature("strict", variables)
          canonicalSignature: "query-sig-canonical",
        },
      });

      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
      });

      expect(result.data).toEqual(cachedData);
      expect(result.meta?.source).toBeUndefined();
      expect(mockTransport.http).not.toHaveBeenCalled();
    });
  });

  describe("default cachePolicy from options", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice" } };

    it("uses default cachePolicy from options when not provided in executeQuery", async () => {
      const opsWithDefaultPolicy = createOperations(
        { transport: mockTransport, cachePolicy: "cache-first" },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      mockDocuments.materialize.mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: {
          canonical: true,
          strict: true,
          strictSignature: "query-sig-123",
          canonicalSignature: "query-sig-canonical",
        },
      });

      const result = await opsWithDefaultPolicy.executeQuery({
        query,
        variables,
      });

      expect(result.data).toEqual(cachedData);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("executeQuery cachePolicy takes priority over options cachePolicy", async () => {
      const opsWithDefaultPolicy = createOperations(
        { transport: mockTransport, cachePolicy: "cache-first" },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      const networkData = { user: { id: "1", name: "Network Alice" } };
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const mockResult = {
        data: networkData,
        error: null,
      };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await opsWithDefaultPolicy.executeQuery({
        query,
        variables,
        cachePolicy: "network-only", // This should override cache-first
      });

      expect(mockTransport.http).toHaveBeenCalled();
      expect(result.data).toEqual(networkData);
    });

    it("defaults to network-only when no cachePolicy provided in both places", async () => {
      const opsWithoutPolicy = createOperations(
        { transport: mockTransport },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr },
      );

      const networkData = { user: { id: "1", name: "Network Alice" } };
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const mockResult = {
        data: networkData,
        error: null,
      };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await opsWithoutPolicy.executeQuery({
        query,
        variables,
      });

      expect(mockTransport.http).toHaveBeenCalled();
      expect(result.data).toEqual(networkData);
    });
  });

  describe("onCacheData willFetchFromNetwork flag", () => {
    const query = "query GetUser($id: ID!) { user(id: $id) { id name __typename } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice", __typename: "User" } };
    const networkData = { user: { id: "1", name: "Network Alice", __typename: "User" } };

    it("cache-only with cache hit: willFetchFromNetwork = false", async () => {
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const onCacheData = vi.fn();

      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-only",
        onCacheData,
      });

      expect(onCacheData).toHaveBeenCalledWith(
        expect.objectContaining(cachedData),
        { willFetchFromNetwork: false },
      );
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("cache-first with cache hit: willFetchFromNetwork = false (cache is fresh)", async () => {
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      // Mock materialize to return strict match
      const strictSignature = "strict-sig-123";
      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: {
          canonical: true,
          strict: true,
          strictSignature: strictSignature,
        },
        dependencies: new Set(),
      });

      // Mock plan to return matching strict signature
      const makeSignatureMock = vi.fn();
      makeSignatureMock
        .mockReturnValueOnce("canonical-sig-123") // 1st call: materialize (canonical)
        .mockReturnValueOnce(strictSignature)     // 2nd call: willFetchFromNetwork check (strict) - matches!
        .mockReturnValueOnce(strictSignature);    // 3rd call: cache-first logic (strict) - matches!

      vi.mocked(mockPlanner.getPlan).mockReturnValue({
        compiled: true,
        networkQuery: query,
        makeSignature: makeSignatureMock,
      });

      const onCacheData = vi.fn();

      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
        onCacheData,
      });

      expect(onCacheData).toHaveBeenCalledWith(
        expect.objectContaining(cachedData),
        { willFetchFromNetwork: false },
      );
      // cache-first with cache hit doesn't fetch from network
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("cache-first with cache miss: onCacheData not called (no cached data)", async () => {
      const onCacheData = vi.fn();

      const mockResult = { data: networkData, error: null };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
        onCacheData,
      });

      // No cached data, so onCacheData should not be called
      expect(onCacheData).not.toHaveBeenCalled();
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-and-network with cache hit: willFetchFromNetwork = true", async () => {
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const onCacheData = vi.fn();
      const mockResult = { data: networkData, error: null };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-and-network",
        onCacheData,
      });

      expect(onCacheData).toHaveBeenCalledWith(
        expect.objectContaining(cachedData),
        { willFetchFromNetwork: true },
      );
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("network-only: onCacheData not called (ignores cache)", async () => {
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const onCacheData = vi.fn();
      const mockResult = { data: networkData, error: null };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "network-only",
        onCacheData,
      });

      // network-only never calls onCacheData (ignores cache)
      expect(onCacheData).not.toHaveBeenCalled();
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("SSR hydration: willFetchFromNetwork = false (returns cached data)", async () => {
      // Enable hydration
      vi.mocked(mockSsr.isHydrating).mockReturnValue(true);

      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      const onCacheData = vi.fn();

      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "network-only", // Even network-only uses cache during hydration
        onCacheData,
      });

      expect(onCacheData).toHaveBeenCalledWith(
        expect.objectContaining(cachedData),
        { willFetchFromNetwork: false },
      );
      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual(cachedData);
    });

    it("suspension window: willFetchFromNetwork = false (returns cached data)", async () => {
      // Pre-populate cache
      mockDocuments.normalize({ data: cachedData });

      // Mock materialize to return strict match
      const strictSignature = "strict-sig-456";
      vi.mocked(mockDocuments.materialize).mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: {
          canonical: true,
          strict: true,
          strictSignature: strictSignature,
        },
        dependencies: new Set(),
      });

      // Mock plan to return matching strict signature
      vi.mocked(mockPlanner.getPlan).mockReturnValue({
        compiled: true,
        networkQuery: query,
        makeSignature: vi.fn()
          .mockReturnValue("canonical-sig-456")  // First query
          .mockReturnValue(strictSignature)      // Strict check
          .mockReturnValue("canonical-sig-456")  // Second query (within suspension)
          .mockReturnValue(strictSignature),     // Strict check
      });

      const onCacheData = vi.fn();

      // First query - establishes suspension window
      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
      });

      vi.mocked(mockTransport.http).mockClear();

      // Second query within suspension window (< 1000ms)
      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
        onCacheData,
      });

      expect(onCacheData).toHaveBeenCalledWith(
        expect.objectContaining(cachedData),
        { willFetchFromNetwork: false },
      );
      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual(cachedData);
    });

    it("suspension window: should NOT reuse suspended response when pagination params change", async () => {
      // Pre-populate cache with first page
      const firstPageData = { posts: [{ id: "1", title: "First" }] };
      const secondPageData = { posts: [{ id: "2", title: "Second" }] };

      mockDocuments.normalize({ data: firstPageData });

      // Mock materialize to return data with proper strict signature matching
      vi.mocked(mockDocuments.materialize)
        .mockReturnValueOnce({
          // First query read
          data: firstPageData,
          source: "none",  // Cache miss, will fetch from network
          ok: {
            canonical: false,
            strict: false,
          },
          dependencies: new Set(),
        })
        .mockReturnValueOnce({
          // After first query write
          data: firstPageData,
          source: "canonical",
          ok: {
            canonical: true,
            strict: true,
            strictSignature: "strict-sig-first-10",
          },
          dependencies: new Set(),
        })
        .mockReturnValueOnce({
          // Second query read - has cache but different strict signature
          data: firstPageData,
          source: "canonical",
          ok: {
            canonical: true,
            strict: true,
            strictSignature: "strict-sig-first-10",  // Old signature, won't match
          },
          dependencies: new Set(),
        })
        .mockReturnValueOnce({
          // After second query write
          data: secondPageData,
          source: "canonical",
          ok: {
            canonical: true,
            strict: true,
            strictSignature: "strict-sig-first-20",
          },
          dependencies: new Set(),
        });

      // Mock plan to return DIFFERENT strict signatures for different pagination
      const firstStrictSig = "strict-sig-first-10";
      const secondStrictSig = "strict-sig-first-20";  // Different pagination
      const canonicalSig = "canonical-sig-posts";  // Same canonical (filters only)

      vi.mocked(mockPlanner.getPlan).mockReturnValue({
        compiled: true,
        networkQuery: query,
        makeSignature: vi.fn()
          // First query (first: 10) - both signatures calculated upfront
          .mockReturnValueOnce(canonicalSig)      // Canonical signature
          .mockReturnValueOnce(firstStrictSig)    // Strict signature (for suspension)
          .mockReturnValueOnce(firstStrictSig)    // Strict check in cache-first
          // Second query (first: 20) - both signatures calculated upfront
          .mockReturnValueOnce(canonicalSig)      // Canonical signature (same!)
          .mockReturnValueOnce(secondStrictSig)   // Strict signature (different! - should bypass suspension)
          .mockReturnValueOnce(secondStrictSig),  // Strict check in cache-first
      });

      const mockResult: OperationResult = {
        data: secondPageData,
        error: null,
      };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // First query with first: 10
      await operations.executeQuery({
        query,
        variables: { first: 10 },
        cachePolicy: "cache-first",
      });

      vi.mocked(mockTransport.http).mockClear();

      // Second query with first: 20 (different pagination) within suspension window
      const result = await operations.executeQuery({
        query,
        variables: { first: 20 },  // DIFFERENT pagination param
        cachePolicy: "cache-first",
      });

      // BUG: Current implementation uses canonical signature for suspension,
      // so it will incorrectly return cached data without making network request
      // EXPECTED: Should make network request because pagination changed
      expect(mockTransport.http).toHaveBeenCalled();  // This will FAIL with current impl
      expect(result.data).toEqual(secondPageData);
    });
  });

  // Performance tests have been moved to operations-performance.test.ts
});
