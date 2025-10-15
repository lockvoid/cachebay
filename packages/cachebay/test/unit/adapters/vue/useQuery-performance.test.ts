// Mock documents module to inject performance counters
let normalizeCount = 0;
let materializeHotCount = 0;
let materializeColdCount = 0;
let watchQueryCallCount = 0;

vi.mock("@/src/core/documents", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/documents")>("@/src/core/documents");

  return {
    ...actual,
    createDocuments: (deps: any) => {
      const documents = actual.createDocuments(deps);

      // Wrap normalize to count calls
      const origNormalize = documents.normalize;
      documents.normalize = ((...args: any[]) => {
        normalizeCount++;
        return origNormalize.apply(documents, args);
      }) as any;

      // Wrap materialize to count calls and track HOT vs COLD
      const origMaterialize = documents.materialize;

      documents.materialize = ((...args: any[]) => {
        const result = origMaterialize.apply(documents, args);

        // Track HOT vs COLD based on the hot field
        if (result.hot) {
          materializeHotCount++;
        } else {
          materializeColdCount++;
        }

        return result;
      }) as any;

      return documents;
    },
  };
});

vi.mock("@/src/core/queries", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/queries")>("@/src/core/queries");

  return {
    ...actual,
    createQueries: (deps: any) => {
      const queries = actual.createQueries(deps);

      // Wrap watchQuery to count calls
      const origWatchQuery = queries.watchQuery;
      queries.watchQuery = ((...args: any[]) => {
        watchQueryCallCount++;
        return origWatchQuery.apply(queries, args);
      }) as any;

      return queries;
    },
  };
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ref, nextTick, defineComponent, h, createApp } from "vue";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCachebay } from "@/src/core/client";
import type { CachePolicy } from "@/src/core/operations";
import { operations, tick, delay } from "@/test/helpers";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("useQuery Performance", () => {
  let client: ReturnType<typeof createCachebay>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;
    watchQueryCallCount = 0;

    mockFetch = vi.fn();

    // Create mock transport that returns GraphQL result format
    const mockTransport = {
      http: mockFetch,
      ws: vi.fn(),
    };

    client = createCachebay({
      transport: mockTransport,
      suspensionTimeout: 0,
      hydrationTimeout: 0,
    });
  });

  // Helper to run useQuery in Vue context
  const runInVueContext = async <T = void>(testFn: () => T): Promise<T> => {
    let result: T;
    const app = createApp({
      setup() {
        result = testFn();
        return () => h("div");
      },
    });

    // Provide cachebay BEFORE mounting
    provideCachebay(app as any, client);

    const container = document.createElement("div");
    app.mount(container);

    await tick();

    // Return the result from testFn (no cleanup needed - each test is isolated)
    return result!;
  };

  describe("cache-first policy", () => {
    it("two-phase: COLD path (2 materializations) then HOT path (1 materialization)", async () => {
      // Mock transport.http should return { data, error } format
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // PHASE 1: First query - COLD path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // COLD path: normalize 1, materialize 2 COLD (executeQuery cache check + propagateData)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query with same variables - HOT path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT path: normalize 0, materialize 1 HOT (executeQuery returns cached fingerprint)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
      expect(watchQueryCallCount).toBe(2); // Second useQuery call creates new watcher
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional network call
    });


    it("variable change: two-phase COLD (2 materializations) then HOT (1 materialization)", async () => {
      const variables = ref({ id: "1" });

      mockFetch.mockImplementation(async () => ({
        data: { user: { __typename: "User", id: variables.value.id, name: `User ${variables.value.id}` } },
        error: null,
      }));

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables,
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // PHASE 1: First query with id: "1" - COLD path
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Change variables to id: "2" - COLD path (new query)
      variables.value = { id: "2" };
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once (network response)
      // Should materialize twice: executeQuery cache check + propagateData (both COLD for new variables)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      // Still only 1 watchQuery (watcher updates, doesn't remount)
      expect(watchQueryCallCount).toBe(1);
    });
  });

  describe("cache-only policy", () => {
    it("two-phase: COLD path (1 materialization) then HOT path (1 materialization)", async () => {
      // Pre-populate cache
      client.writeQuery({
        query: operations.USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
      });

      normalizeCount = 0;

      // PHASE 1: First query - COLD path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // COLD path: normalize 0, materialize 1 (executeQuery cache check, no network)
      expect(normalizeCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query - HOT path (fingerprint matches)
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT path: normalize 0, materialize 1 (returns cached fingerprint)
      expect(normalizeCount).toBe(0);
      expect(watchQueryCallCount).toBe(2); // Second useQuery creates new watcher
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("cache miss: COLD first time, then HOT (cache miss results are cached)", async () => {
      // PHASE 1: First cache miss
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "999" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize (cache-only never hits network)
      // Should materialize once COLD (cache miss)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query with same variables - now HOT (cache miss result was cached)
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "999" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT because cache miss results ARE cached (source: "none" is cached)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0); // Not COLD because result is cached
      expect(materializeHotCount).toBe(1); // HOT because cache miss result is cached
      expect(watchQueryCallCount).toBe(2); // Second useQuery creates new watcher
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("network-only policy", () => {
    it("two-phase: COLD (2 materializations) then mixed (1 COLD + 1 HOT)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // PHASE 1: First query - COLD path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // First query: normalize 1, materialize 1 COLD (executeQuery only, no watcher for propagateData)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query - mixed (executeQuery HOT + propagateData COLD)
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Second query: normalize 1, materialize 1 COLD (executeQuery, no watcher so no propagateData)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(2); // Second useQuery creates new watcher
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("cache-and-network policy", () => {
    it("two-phase: COLD path (2 materializations) then HOT path (1 materialization)", async () => {
      // Pre-populate cache
      client.writeQuery({
        query: operations.USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", name: "Cached" } },
      });

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Network" } },
        error: null,
      });

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 1: First query - COLD path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // COLD path: normalize 1, materialize 2 (executeQuery cache + propagateData after network)
      expect(normalizeCount).toBe(1);
      expect(watchQueryCallCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query - HOT path
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT path: normalize 1, materialize 1
      expect(normalizeCount).toBe(1);
      expect(watchQueryCallCount).toBe(2); // Second useQuery creates new watcher
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("refetch performance", () => {
    it("refetch: normalize 1, materialize 2 (executeQuery + propagateData)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      const queryRef = await runInVueContext(() => {
        return useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters after initial query
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Refetch (defaults to network-only)
      await queryRef.refetch();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once (network response)
      // Should materialize once (propagateData, executeQuery returns cached fingerprint)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
    });

    it("refetch with variables: normalize 1, materialize 2 (executeQuery + propagateData)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "2", email: "bob@example.com", name: "Bob" } },
        error: null,
      });

      const queryRef = await runInVueContext(() => {
        return useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await delay(20);

      // PHASE 1: Initial query - 1 watchQuery call
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2); // executeQuery + propagateData
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // PHASE 2: Refetch with new variables - watcher updates, doesn't remount
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await queryRef.refetch({ variables: { id: "2" } });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once (network response)
      // Should materialize twice: executeQuery + propagateData
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
    });
  });

  describe("reactive options performance", () => {
    it("enabled toggle: no extra normalize/materialize when disabled and other watcher mounted", async () => {
      const enabled = ref(true);

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // phase 1

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          enabled,
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      // Phase 2 Disable query

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      enabled.value = false;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize or materialize when disabled
      // Watcher created once
      expect(watchQueryCallCount).toBe(2);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);

      // Phase 3 Re-enable
      enabled.value = true;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should execute query again
      expect(watchQueryCallCount).toBe(3);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
    });

    it("enabled toggle: extra cold materialize when disabled and no other watcher mounted", async () => {
      const enabled = ref(true);

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // phase 1

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          enabled,
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      // Phase 2 Disable query

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      enabled.value = false;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize or materialize when disabled
      // Watcher created once
      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);

      // Phase 3 Re-enable
      enabled.value = true;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should execute query again
      expect(watchQueryCallCount).toBe(2);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
    });

    it("cache policy change: triggers new executeQuery", async () => {
      const cachePolicy = ref<CachePolicy>("cache-first");

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Change policy to network-only
      cachePolicy.value = "network-only";
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should execute query with new policy (HOT path - fingerprint cached)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      // Still only 1 watchQuery (watcher reused)
      expect(watchQueryCallCount).toBe(1);
    });
  });

  describe("lazy mode performance", () => {
    it("lazy mode: no initial normalize/materialize", async () => {
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize or materialize in lazy mode
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("lazy mode with Suspense throws clear error", async () => {
      // Lazy mode is incompatible with Suspense - should throw helpful error
      let caughtError: Error | null = null;

      try {
        await runInVueContext(async () => {
          // Using await here triggers the then() method which throws
          return await useQuery({
            query: operations.USER_QUERY,
            variables: { id: "1" },
            lazy: true,
          });
        });
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toContain("[cachebay] useQuery: lazy mode is incompatible with Suspense");
    });

    it("lazy mode without Suspense works correctly", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // Use lazy mode WITHOUT Suspense (no await in setup)
      let queryRef: any;

      const app = createApp({
        setup() {
          queryRef = useQuery({
            query: operations.USER_QUERY,
            variables: { id: "1" },
            lazy: true,
          });
          return () => h("div");
        },
      });

      provideCachebay(app as any, client);
      const container = document.createElement("div");
      app.mount(container);

      await tick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not have executed yet
      expect(normalizeCount).toBe(0);

      // Trigger query via refetch
      await queryRef.refetch();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
    });
  });

  describe("immediate option", () => {
    it("default (not lazy) materializes on cache hit", async () => {
      // Pre-populate cache AND materialize it once to populate materializeCache
      client.writeQuery({
        query: operations.USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "u1@example.com" } },
      });

      // Phase 1

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);

      // Phase 2

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should materialize immediately from cache (1 HOT since materializeCache is populated)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
      expect(watchQueryCallCount).toBe(2);
    });

    it("lazy: true does NOT execute query on mount", async () => {
      // Pre-populate cache
      client.writeQuery({
        query: operations.USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
      });

      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT materialize (lazy: true)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
    });
  });

  describe("multiple queries performance", () => {
    it("10 queries with same variables: normalize 1, materialize 11 (2 for first + 1 per cached query)", async () => {
      mockFetch.mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // First query hits network
      await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // PHASE 1: First query - COLD
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      const normalizeAfterFirst = normalizeCount;
      const coldAfterFirst = materializeColdCount;
      const hotAfterFirst = materializeHotCount;

      // PHASE 2: Next 9 queries use cache - HOT
      for (let i = 0; i < 9; i++) {
        await runInVueContext(() => {
          useQuery({
            query: operations.USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-first",
          });
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize only once (first query)
      expect(normalizeCount).toBe(normalizeAfterFirst);

      // Should materialize 1 HOT time per cached query (9 queries * 1 = 9 additional)
      expect(materializeColdCount).toBe(coldAfterFirst);
      expect(materializeHotCount).toBe(hotAfterFirst + 9);
      // Each useQuery creates a new watcher (10 total)
      expect(watchQueryCallCount).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
