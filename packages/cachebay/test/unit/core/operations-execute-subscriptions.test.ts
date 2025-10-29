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

  describe("executeSubscription", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("sends networkQuery with __typename to transport, not original query", () => {
      const mockObservable = {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };

      const networkQueryWithTypename = "subscription OnMessage { messageAdded { id text __typename } }";
      
      mockPlanner.getPlan.mockReturnValue({
        compiled: true,
        networkQuery: networkQueryWithTypename,
        makeSignature: vi.fn().mockReturnValue("subscription-sig-123"),
      });

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      operations.executeSubscription({ query: subscription, variables });

      // Should send networkQuery (with __typename), not original query
      expect(mockTransport.ws).toHaveBeenCalledWith(
        expect.objectContaining({
          query: networkQueryWithTypename, // NOT the original subscription
          variables,
          operationType: "subscription",
        }),
      );
    });

    it("returns observable for subscription", () => {
      const mockObservable = {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const result = operations.executeSubscription({ query: subscription, variables });

      expect(result).toBeDefined();
      expect(mockPlanner.getPlan).toHaveBeenCalledWith(subscription);
      expect(mockTransport.ws).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(String), // networkQuery, not original
          variables,
          operationType: "subscription",
          compiledQuery: expect.objectContaining({ compiled: true }),
        }),
      );
    });

    it("normalizes subscription events with unique rootIds", () => {
      const event1 = { data: { messageAdded: { id: "1", text: "Hello" } } };
      const event2 = { data: { messageAdded: { id: "2", text: "World" } } };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const observable = operations.executeSubscription({ query: subscription, variables });
      observable.subscribe({});

      // Simulate two events
      onNext?.(event1);
      onNext?.(event2);

      // Should normalize with unique rootIds
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, {
        document: subscription,
        variables,
        data: event1.data,
        rootId: "@subscription.0",
      });

      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, {
        document: subscription,
        variables,
        data: event2.data,
        rootId: "@subscription.1",
      });
    });

    it("materializes subscription events from custom rootId", () => {
      const event = { data: { messageAdded: { id: "3", text: "Test" } } };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const observable = operations.executeSubscription({ query: subscription, variables });
      observable.subscribe({});

      onNext?.(event);

      // Should materialize with entityId set to subscription rootId
      expect(mockDocuments.materialize).toHaveBeenCalledWith({
        document: subscription,
        variables,
        canonical: true,
        fingerprint: true,
        preferCache: false,
        updateCache: false,
        entityId: "@subscription.0",
      });
    });

    it("increments subscription clock for each event", () => {
      const events = [
        { data: { messageAdded: { id: "1", text: "First" } } },
        { data: { messageAdded: { id: "2", text: "Second" } } },
        { data: { messageAdded: { id: "3", text: "Third" } } },
      ];

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const observable = operations.executeSubscription({ query: subscription, variables });
      observable.subscribe({});

      // Simulate three events
      events.forEach(event => onNext?.(event));

      // Check rootIds increment
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        rootId: "@subscription.0",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        rootId: "@subscription.1",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(3, expect.objectContaining({
        rootId: "@subscription.2",
      }));
    });

    it("stores subscription event history with separate roots", () => {
      const event = { data: { messageAdded: { id: "4", text: "Same" } } };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const observable = operations.executeSubscription({ query: subscription, variables });
      observable.subscribe({});

      // Send same event twice
      onNext?.(event);
      onNext?.(event);

      // Both should have different rootIds even with same data
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        rootId: "@subscription.0",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        rootId: "@subscription.1",
      }));
    });
  });

  describe("executeSubscription - callbacks", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("invokes onData callback for each event", () => {
      const events = [
        { data: { messageAdded: { id: "1", text: "First" } } },
        { data: { messageAdded: { id: "2", text: "Second" } } },
      ];

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const onData = vi.fn();
      const observable = operations.executeSubscription({
        query: subscription,
        variables,
        onData,
      });
      observable.subscribe({});

      events.forEach(event => onNext?.(event));

      expect(onData).toHaveBeenCalledTimes(2);
      expect(onData).toHaveBeenNthCalledWith(1, events[0].data);
      expect(onData).toHaveBeenNthCalledWith(2, events[1].data);
    });

    it("invokes onError callback on subscription error", () => {
      const error = new Error("WebSocket connection failed");

      let onError: ((err: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onError = observer.error;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const onErrorCallback = vi.fn();
      const observable = operations.executeSubscription({
        query: subscription,
        variables,
        onError: onErrorCallback,
      });
      observable.subscribe({});

      onError?.(error);

      expect(onErrorCallback).toHaveBeenCalledTimes(1);
      expect(onErrorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          networkError: error,
        }),
      );
    });

    it("invokes onComplete callback when subscription completes", () => {
      let onComplete: (() => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onComplete = observer.complete;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const onCompleteCallback = vi.fn();
      const observable = operations.executeSubscription({
        query: subscription,
        variables,
        onComplete: onCompleteCallback,
      });
      observable.subscribe({});

      onComplete?.();

      expect(onCompleteCallback).toHaveBeenCalledTimes(1);
    });

    it("does not invoke callbacks when not provided", () => {
      const event = { data: { messageAdded: { id: "5", text: "Test" } } };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      // Should not throw when callbacks are undefined
      expect(() => {
        const observable = operations.executeSubscription({ query: subscription, variables });
        observable.subscribe({});
        onNext?.(event);
      }).not.toThrow();
    });
  });

  describe("executeSubscription - error handling", () => {
    const subscription = "subscription OnMessage { messageAdded { id text } }";
    const variables = { roomId: "1" };

    it("handles GraphQL errors in subscription events", () => {
      const errorEvent = {
        errors: [{ message: "Subscription error" }],
        data: null,
      };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      const onError = vi.fn();
      const observable = operations.executeSubscription({
        query: subscription,
        variables,
        onError,
      });
      observable.subscribe({});

      onNext?.(errorEvent);

      // Should not normalize error events
      expect(mockDocuments.normalize).not.toHaveBeenCalled();

      // Should call onError
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          graphqlErrors: expect.any(Array),
        }),
      );
    });

    it("handles materialization failures gracefully", () => {
      const event = { data: { messageAdded: { id: "8", text: "Fail" } } };

      let onNext: ((data: any) => void) | undefined;

      const mockObservable = {
        subscribe: vi.fn((observer: any) => {
          onNext = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws).mockReturnValue(mockObservable as any);

      // Mock materialize to fail
      mockDocuments.materialize.mockReturnValue({
        data: undefined,
        source: "none",
        ok: {
          strict: false,
          canonical: false,
        },
      });

      const onError = vi.fn();
      const observable = operations.executeSubscription({
        query: subscription,
        variables,
        onError,
      });
      observable.subscribe({});

      onNext?.(event);

      // Should still normalize
      expect(mockDocuments.normalize).toHaveBeenCalled();

      // Should call onError for materialization failure
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Subscription materialization failed"),
        }),
      );
    });
  });

  describe("executeSubscription - multiple subscriptions", () => {
    it("maintains separate clocks for different subscriptions", () => {
      const sub1 = "subscription OnMessage { messageAdded { id } }";
      const sub2 = "subscription OnUser { userUpdated { id } }";

      const event1 = { data: { messageAdded: { id: "1" } } };
      const event2 = { data: { userUpdated: { id: "1" } } };

      let onNext1: ((data: any) => void) | undefined;
      let onNext2: ((data: any) => void) | undefined;

      const mockObservable1 = {
        subscribe: vi.fn((observer: any) => {
          onNext1 = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      const mockObservable2 = {
        subscribe: vi.fn((observer: any) => {
          onNext2 = observer.next;
          return { unsubscribe: vi.fn() };
        }),
      };

      vi.mocked(mockTransport.ws)
        .mockReturnValueOnce(mockObservable1 as any)
        .mockReturnValueOnce(mockObservable2 as any);

      // Start both subscriptions
      const observable1 = operations.executeSubscription({ query: sub1, variables: {} });
      observable1.subscribe({});
      const observable2 = operations.executeSubscription({ query: sub2, variables: {} });
      observable2.subscribe({});

      // Send events
      onNext1?.(event1);
      onNext2?.(event2);
      onNext1?.(event1);

      // Should use sequential clock across all subscriptions
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        rootId: "@subscription.0",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        rootId: "@subscription.1",
      }));
      expect(mockDocuments.normalize).toHaveBeenNthCalledWith(3, expect.objectContaining({
        rootId: "@subscription.2",
      }));
    });
  });
});
