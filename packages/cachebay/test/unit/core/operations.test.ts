import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOperations } from "../../../src/core/operations";
import { CombinedError } from "../../../src/core/errors";
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
    mockDocuments = {
      normalizeDocument: vi.fn((args) => {
        cachedData = args.data;
      }),
      materializeDocument: vi.fn((args) => {
        // If we have cached data
        if (cachedData) {
          return {
            data: cachedData,
            source: "canonical",
            ok: { canonical: true, strict: true },
            dependencies: new Set(),
          };
        }
        // No cache
        return {
          data: undefined,
          source: "none",
          ok: { canonical: false, strict: false },
          dependencies: new Set(),
        };
      }),
    };

    // Mock SSR
    mockSsr = {
      isHydrating: vi.fn().mockReturnValue(false),
    };

    // Create operations instance
    operations = createOperations(
      { transport: mockTransport, suspensionTimeout: 1000 },
      { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
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
        meta: { source: 'network' },
      });
      expect(mockPlanner.getPlan).toHaveBeenCalledWith(query);
      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "query GetUser { user { id name __typename } }", // networkQuery with __typename
          variables,
          operationType: "query",
          compiledQuery: expect.objectContaining({ compiled: true }),
        })
      );
      expect(mockDocuments.normalizeDocument).toHaveBeenCalledWith({
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
      expect(mockDocuments.normalizeDocument).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Network timeout");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeQuery({ query, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockDocuments.normalizeDocument).not.toHaveBeenCalled();
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
        })
      );
    });

    it("returns error when materialization fails after write", async () => {
      const mockResult: OperationResult = {
        data: { user: { id: "1", name: "Alice" } },
        error: null,
      };

      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      // Mock readQuery to return source: "none" (materialization failure)
      mockDocuments.materializeDocument.mockReturnValue({
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
      expect(mockDocuments.normalizeDocument).toHaveBeenCalled();
    });
  });

  describe("executeQuery - cache policies", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice" } };
    const networkData = { user: { id: "1", name: "Network Alice" } };

    describe("network-only (default)", () => {
      it("always fetches from network and ignores cache", async () => {
        // Setup: First readQuery returns cached data, second returns network data after write
        let readCount = 0;
        mockDocuments.materializeDocument.mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Initial read (before network fetch)
            return {
              data: cachedData,
              source: "canonical",
              ok: { canonical: true, strict: true },
            };
          }
          // After write, return the network data
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
          cachePolicy: "network-only",
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
      });

      it("invokes onSuccess callback with data", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onSuccess = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
          onSuccess,
        });

        expect(onSuccess).toHaveBeenCalledWith(networkData);
        expect(onSuccess).toHaveBeenCalledTimes(1);
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
          })
        );
      });
    });

    describe("cache-first", () => {
      it("returns cached data when canonical and strict cache hit", async () => {
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          canonical: true,
          onSuccess,
        });

        expect(result.data).toEqual(cachedData);
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(cachedData);
      });

      it("fetches from network when strict cache hit but canonical cache miss", async () => {
        let readCount = 0;
        mockDocuments.materializeDocument.mockImplementation(() => {
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

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          onSuccess,
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(networkData);
      });

      it("fetches from network when canonical cache hit but strict cache miss", async () => {
        let readCount = 0;
        mockDocuments.materializeDocument.mockImplementation(() => {
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

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-first",
          onSuccess,
        });

        expect(result.data).toEqual(networkData);
        expect(mockTransport.http).toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(networkData);
      });
    });

    describe("cache-only", () => {
      it("returns cached data when available", async () => {
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-only",
          onSuccess,
        });

        expect(result.data).toEqual(cachedData);
        expect(result.error).toBeNull();
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(cachedData);
      });

      it("returns CacheMissError when no cache", async () => {
        mockDocuments.materializeDocument.mockReturnValue({
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
        mockDocuments.materializeDocument.mockReturnValue({
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
      it("returns cached data immediately and fetches in background", async () => {
        let readCount = 0;
        mockDocuments.materializeDocument.mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            // Initial read returns cached data
            return {
              data: cachedData,
              source: "canonical",
              ok: { canonical: true, strict: true },
            };
          }
          // After background fetch and write, return network data
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

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          canonical: true,
          onSuccess,
        });

        // Should return cached data immediately
        expect(result.data).toEqual(cachedData);
        expect(onSuccess).toHaveBeenCalledWith(cachedData);

        // Network request should be initiated
        expect(mockTransport.http).toHaveBeenCalled();

        // Wait for background fetch to complete
        await new Promise((resolve) => setTimeout(resolve, 10));

        // onSuccess should be called again with network data
        expect(onSuccess).toHaveBeenCalledTimes(2);
        expect(onSuccess).toHaveBeenNthCalledWith(2, networkData);
      });

      it("handles background fetch errors gracefully", async () => {
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "strict",
          ok: { canonical: true, strict: false },
        });

        const networkError = new Error("Background fetch failed");
        vi.mocked(mockTransport.http).mockRejectedValue(networkError);

        const onError = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          onError,
        });

        // Should still return cached data
        expect(result.data).toEqual(cachedData);
        expect(result.error).toBeNull();

        // Wait for background fetch to fail
        await new Promise((resolve) => setTimeout(resolve, 10));

        // onError should be called for background failure
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            networkError,
          })
        );
      });

      it("fetches from network when no cache available", async () => {
        let readCount = 0;
        mockDocuments.materializeDocument.mockImplementation(() => {
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
    });

    describe("SSR hydration", () => {
      it("returns cached data during hydration for network-only", async () => {
        mockSsr.isHydrating.mockReturnValue(true);
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        const onSuccess = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
          onSuccess,
        });

        expect(result.data).toEqual(cachedData);
        expect(mockTransport.http).not.toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledWith(cachedData);
      });

      it("returns cached data during hydration for cache-first", async () => {
        mockSsr.isHydrating.mockReturnValue(true);
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

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
        mockDocuments.materializeDocument.mockReturnValue({
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

        await operations.executeQuery({
          query,
          variables,
          cachePolicy: "network-only",
        });

        expect(mockTransport.http).not.toHaveBeenCalled();
      });
    });

    describe("callbacks", () => {
      it("invokes onSuccess with data on successful query", async () => {
        const mockResult: OperationResult = {
          data: networkData,
          error: null,
        };
        vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

        const onSuccess = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          onSuccess,
        });

        expect(onSuccess).toHaveBeenCalledWith(networkData);
        expect(onSuccess).toHaveBeenCalledTimes(1);
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
          })
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

        const onSuccess = vi.fn();
        await operations.executeQuery({
          query,
          variables,
          onSuccess,
        });

        // Should still call onSuccess even with partial errors
        expect(onSuccess).toHaveBeenCalledWith(networkData);
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
          })
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
        })
      );
      expect(mockDocuments.normalizeDocument).toHaveBeenCalledWith({
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
      expect(mockDocuments.normalizeDocument).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Connection refused");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeMutation({ query: mutation, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockDocuments.normalizeDocument).not.toHaveBeenCalled();
    });
  });

  describe("executeSubscription", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("throws error when WebSocket transport is not configured", async () => {
      const opsWithoutWs = createOperations(
        { transport: { http: vi.fn() } },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      await expect(
        opsWithoutWs.executeSubscription({ query: subscription, variables })
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
        })
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
      const result: OperationResult = {
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      };
      capturedObserver.next(result);

      expect(mockDocuments.normalizeDocument).toHaveBeenCalledWith({
        document: subscription,
        variables,
        data: result.data,
      });
      expect(observer.next).toHaveBeenCalledWith(result);
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

      expect(mockDocuments.normalizeDocument).not.toHaveBeenCalled();
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

  describe("onQueryError callback", () => {
    it("calls onQueryError callback when cache-only query has no cache", async () => {
      const onQueryError = vi.fn();
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };

      const opsWithCallback = createOperations(
        { transport: mockTransport, onQueryError },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      mockDocuments.materializeDocument.mockReturnValue({
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

      expect(onQueryError).toHaveBeenCalledWith(
        "query-sig-123",
        expect.objectContaining({
          networkError: expect.objectContaining({
            name: "CacheMissError",
          }),
        })
      );
    });

    it("calls onQueryError callback when network request fails", async () => {
      const onQueryError = vi.fn();
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const networkError = new Error("Network timeout");

      const opsWithCallback = createOperations(
        { transport: mockTransport, onQueryError },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      await opsWithCallback.executeQuery({
        query,
        variables,
        cachePolicy: "network-only",
      });

      expect(onQueryError).toHaveBeenCalledWith(
        "query-sig-123",
        expect.objectContaining({
          networkError,
        })
      );
    });
  });

  describe("meta.source field", () => {
    const query = "query GetUser { user { id name } }";
    const variables = { id: "1" };
    const cachedData = { user: { id: "1", name: "Cached Alice" } };
    const networkData = { user: { id: "1", name: "Network Alice" } };

    it("sets meta.source to 'cache' for cache-and-network with cache hit", async () => {
      mockDocuments.materializeDocument.mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: { canonical: true, strict: true },
      });

      const result = await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-and-network",
      });

      expect(result.data).toEqual(cachedData);
      expect(result.meta?.source).toBe('cache');
      expect(mockTransport.http).toHaveBeenCalled(); // Background fetch
    });

    it("sets meta.source to 'network' for network responses", async () => {
      mockDocuments.materializeDocument
        .mockReturnValueOnce({
          data: undefined,
          source: "none",
          ok: { canonical: false, strict: false },
        })
        .mockReturnValueOnce({
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        });

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
      expect(result.meta?.source).toBe('network');
    });

    it("does not set meta.source for cache-first with cache hit", async () => {
      mockDocuments.materializeDocument.mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: { canonical: true, strict: true },
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
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      mockDocuments.materializeDocument.mockReturnValue({
        data: cachedData,
        source: "canonical",
        ok: { canonical: true, strict: true },
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
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      const networkData = { user: { id: "1", name: "Network Alice" } };
      let readCount = 0;
      mockDocuments.materializeDocument.mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return {
            data: cachedData,
            source: "canonical",
            ok: { canonical: true, strict: true },
          };
        }
        return {
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        };
      });

      const mockResult = {
        data: networkData,
        error: null,
      };
      vi.mocked(mockTransport.http).mockResolvedValue(mockResult);

      const result = await opsWithDefaultPolicy.executeQuery({
        query,
        variables,
        cachePolicy: "network-only",
      });

      expect(mockTransport.http).toHaveBeenCalled();
      expect(result.data).toEqual(networkData);
    });

    it("defaults to network-only when no cachePolicy provided in both places", async () => {
      const opsWithoutPolicy = createOperations(
        { transport: mockTransport },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );

      const networkData = { user: { id: "1", name: "Network Alice" } };
      let readCount = 0;
      mockDocuments.materializeDocument.mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return {
            data: cachedData,
            source: "canonical",
            ok: { canonical: true, strict: true },
          };
        }
        return {
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
        };
      });

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

  describe("Performance", () => {
    let normalizeCount = 0;
    let materializeCount = 0;

    beforeEach(() => {
      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      // Save the original vi.fn() mocks created by outer beforeEach
      const originalNormalize = mockDocuments.normalizeDocument;
      const originalMaterialize = mockDocuments.materializeDocument;

      // Wrap with counting spies
      mockDocuments.normalizeDocument = (...args: any[]) => {
        normalizeCount++;
        return originalNormalize(...args);
      };

      mockDocuments.materializeDocument = (...args: any[]) => {
        materializeCount++;
        return originalMaterialize(...args);
      };

      // Fix planner to return unique signatures based on variables
      mockPlanner.getPlan = vi.fn().mockReturnValue({
        compiled: true,
        networkQuery: "query GetUser { user { id name __typename } }",
        makeSignature: vi.fn((mode: string, vars: any) => {
          // Create unique signature based on variables
          return `query-sig-${JSON.stringify(vars)}`;
        }),
      });

      // Recreate operations instance with wrapped mocks
      operations = createOperations(
        { transport: mockTransport, suspensionTimeout: 1000 },
        { planner: mockPlanner, documents: mockDocuments, ssr: mockSsr }
      );
    });

    it("executeQuery (network-only): should materialize 2 times (before + after network)", async () => {
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const networkData = { user: { id: "1", name: "Alice" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with network-only (default)
      await operations.executeQuery({
        query,
        variables,
      });

      // Should materialize twice: once before network (cache check), once after normalize
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeCount).toBe(2); // Before network + after normalize
    });

    it("executeQuery (cache-first with cache hit): should materialize 1 time (cache only)", async () => {
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const cachedData = { user: { id: "1", name: "Cached Alice" } };

      // Override materialize to return cached data
      mockDocuments.materializeDocument = (...args: any[]) => {
        materializeCount++;
        return {
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        };
      };

      // Execute query with cache-first
      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
      });

      // Should materialize once (cache hit, no network)
      expect(normalizeCount).toBe(0); // No network request
      expect(materializeCount).toBe(1); // Only cache read
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("executeQuery (cache-first with cache miss): should materialize 2 times", async () => {
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const networkData = { user: { id: "1", name: "Alice" } };

      // First call: cache miss
      let callCount = 0;
      mockDocuments.materializeDocument = (...args: any[]) => {
        materializeCount++;
        callCount++;
        if (callCount === 1) {
          return {
            data: undefined,
            source: "none",
            ok: { canonical: false, strict: false },
            dependencies: new Set(),
          };
        }
        // After normalize
        return {
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        };
      };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with cache-first
      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-first",
      });

      // Should materialize twice: cache miss + after network
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeCount).toBe(2); // Cache check + after normalize
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("executeQuery (cache-and-network): should materialize 2 times (cache + network)", async () => {
      const query = "query GetUser { user { id name } }";
      const variables = { id: "1" };
      const cachedData = { user: { id: "1", name: "Cached Alice" } };
      const networkData = { user: { id: "1", name: "Network Alice" } };

      let callCount = 0;
      mockDocuments.materializeDocument = (...args: any[]) => {
        materializeCount++;
        callCount++;
        if (callCount === 1) {
          // First call: return cached data
          return {
            data: cachedData,
            source: "canonical",
            ok: { canonical: true, strict: true },
            dependencies: new Set(),
          };
        }
        // Second call: return network data after normalize
        return {
          data: networkData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        };
      };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with cache-and-network
      await operations.executeQuery({
        query,
        variables,
        cachePolicy: "cache-and-network",
      });

      // Should materialize twice: cache + after network
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeCount).toBe(2); // Cache read + after normalize
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("10 sequential queries (network-only): should normalize 10, materialize 20", async () => {
      const query = "query GetUser { user { id name } }";
      const networkData = { user: { id: "1", name: "Alice" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute 10 queries
      for (let i = 0; i < 10; i++) {
        await operations.executeQuery({
          query,
          variables: { id: String(i + 1) },
        });
      }

      // Should normalize 10 times, materialize 20 times (2 per query)
      expect(normalizeCount).toBe(10);
      expect(materializeCount).toBe(20); // 2 per query (before + after)
    });

    it("pagination: 5 pages should normalize 5, materialize 10", async () => {
      const query = "query GetPosts($after: String) { posts(after: $after) { edges { node { id } } } }";

      mockTransport.http = vi.fn().mockResolvedValue({
        data: { posts: { edges: [{ node: { id: "1" } }] } },
        error: null,
      });

      // Load 5 pages
      for (let i = 0; i < 5; i++) {
        await operations.executeQuery({
          query,
          variables: { after: i === 0 ? null : `cursor${i}` },
        });
      }

      // Should normalize 5 times, materialize 10 times (2 per page)
      expect(normalizeCount).toBe(5);
      expect(materializeCount).toBe(10);
    });

    it("executeMutation: should normalize 1, materialize 0 (no read-back)", async () => {
      const mutation = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";
      const variables = { name: "Bob" };
      const mutationData = { createUser: { id: "2", name: "Bob" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: mutationData,
        error: null,
      });

      // Execute mutation
      await operations.executeMutation({
        mutation,
        variables,
      });

      // Should normalize once (write mutation result)
      // Mutations don't materialize - they just write and return the network data
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(0);
    });

    it("cache-only: should materialize 1, normalize 0 (no network)", async () => {
      const query = "query GetUser { user { id name } }";
      const cachedData = { user: { id: "1", name: "Cached Alice" } };

      // Override materialize to return cached data
      mockDocuments.materializeDocument = (...args: any[]) => {
        materializeCount++;
        return {
          data: cachedData,
          source: "canonical",
          ok: { canonical: true, strict: true },
          dependencies: new Set(),
        };
      };

      // Execute query with cache-only
      await operations.executeQuery({
        query,
        variables: {},
        cachePolicy: "cache-only",
      });

      // Should materialize once (cache only), no normalize
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });
  });
});
