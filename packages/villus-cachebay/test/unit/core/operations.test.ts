import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOperations, CombinedError } from "../../../src/core/operations";
import type { Transport, OperationResult, ObservableLike } from "../../../src/core/operations";

describe("operations", () => {
  let mockTransport: Transport;
  let mockPlanner: any;
  let mockQueries: any;
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
        makeSignature: vi.fn().mockReturnValue("query-sig-123"),
      }),
    };

    // Mock queries
    let cachedData: any = null;
    mockQueries = {
      writeQuery: vi.fn((args) => {
        cachedData = args.data;
      }),
      readQuery: vi.fn(() => ({ data: cachedData })),
    };

    // Mock SSR
    mockSsr = {
      isHydrating: vi.fn().mockReturnValue(false),
    };

    // Create operations instance
    operations = createOperations(
      { transport: mockTransport, suspensionTimeout: 1000 },
      { planner: mockPlanner, queries: mockQueries, ssr: mockSsr }
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
          query,
          variables,
          operationType: "query",
          compiledQuery: expect.objectContaining({ compiled: true }),
        })
      );
      expect(mockQueries.writeQuery).toHaveBeenCalledWith({
        query,
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
      expect(mockQueries.writeQuery).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Network timeout");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeQuery({ query, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockQueries.writeQuery).not.toHaveBeenCalled();
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
      expect(mockQueries.writeQuery).toHaveBeenCalledWith({
        query: mutation,
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
      expect(mockQueries.writeQuery).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      const networkError = new Error("Connection refused");
      vi.mocked(mockTransport.http).mockRejectedValue(networkError);

      const result = await operations.executeMutation({ query: mutation, variables });

      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(CombinedError);
      expect(result.error?.networkError).toBe(networkError);
      expect(mockQueries.writeQuery).not.toHaveBeenCalled();
    });
  });

  describe("executeSubscription", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("throws error when WebSocket transport is not configured", async () => {
      const opsWithoutWs = createOperations(
        { transport: { http: vi.fn() } },
        { planner: mockPlanner, queries: mockQueries }
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

      expect(mockQueries.writeQuery).toHaveBeenCalledWith({
        query: subscription,
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

      expect(mockQueries.writeQuery).not.toHaveBeenCalled();
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
});
