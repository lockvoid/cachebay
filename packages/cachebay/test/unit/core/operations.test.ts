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

      expect(result).toEqual(mockResult);
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
          ok: { canonical: false, strict: true },
        });

        const networkError = new Error("Background fetch failed");
        vi.mocked(mockTransport.http).mockRejectedValue(networkError);

        const onError = vi.fn();
        const result = await operations.executeQuery({
          query,
          variables,
          cachePolicy: "cache-and-network",
          canonical: false,
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
          query: subscription,
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
});
