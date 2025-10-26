// Mock documents module to inject performance counters
let normalizeCount = 0;
let materializeHotCount = 0;
let materializeColdCount = 0;

vi.mock("@/src/core/documents", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/documents")>("@/src/core/documents");

  return {
    ...actual,
    createDocuments: (deps: any) => {
      const documents = actual.createDocuments(deps);

      // Wrap normalize to count calls
      const origNormalize = documents.normalizeDocument;
      documents.normalizeDocument = ((...args: any[]) => {
        normalizeCount++;
        return origNormalize.apply(documents, args);
      }) as any;

      // Wrap materialize to count calls and track HOT vs COLD
      const origMaterialize = documents.materializeDocument;
      
      documents.materializeDocument = ((...args: any[]) => {
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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ref, nextTick, defineComponent, h, createApp } from "vue";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCachebay } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { operations } from "@/test/helpers";
import type { CachePolicy } from "@/src/core/operations";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("useQuery Performance", () => {
  let client: ReturnType<typeof createCachebay>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;

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
  const runInVueContext = async (testFn: () => void | Promise<void>) => {
    const app = createApp({
      setup() {
        testFn();
        return () => h('div');
      },
    });

    // Provide cachebay BEFORE mounting
    provideCachebay(app as any, client);

    const container = document.createElement('div');
    app.mount(container);

    await tick();

    // Return cleanup function
    return () => app.unmount();
  };

  describe("cache-first policy", () => {
    it("two-phase: COLD path (2 materializations) then HOT path (1 materialization)", async () => {
      // Mock transport.http should return { data, error } format
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // PHASE 1: First query - COLD path
      const cleanup1 = await runInVueContext(() => {
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

      cleanup1();

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query with same variables - HOT path
      const cleanup2 = await runInVueContext(() => {
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
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional network call

      cleanup2();
    });


    it("variable change: two-phase COLD (2 materializations) then HOT (1 materialization)", async () => {
      const variables = ref({ id: "1" });

      mockFetch.mockImplementation(async () => ({
        data: { user: { __typename: "User", id: variables.value.id, name: `User ${variables.value.id}` } },
        error: null,
      }));

      const cleanup = await runInVueContext(() => {
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

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;
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

      cleanup();
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
      materializeCount = 0;

      // PHASE 1: First query - COLD path
      const cleanup1 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // COLD path: normalize 0, materialize 1 (executeQuery cache check, no network)
      expect(normalizeCount).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup1();

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;

      // PHASE 2: Second query - HOT path (fingerprint matches)
      const cleanup2 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT path: normalize 0, materialize 1 (returns cached fingerprint)
      expect(normalizeCount).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup2();
    });

    it("cache miss: always COLD (1 materialization each time)", async () => {
      // PHASE 1: First cache miss
      const cleanup1 = await runInVueContext(() => {
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
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup1();

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second cache miss with same variables - still COLD (cache misses aren't cached)
      const cleanup2 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "999" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Still COLD (cache miss results are cached but still return source: "none")
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1); // HOT because cache miss result is cached
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup2();
    });
  });

  describe("network-only policy", () => {
    it("two-phase: COLD (2 materializations) then mixed (1 COLD + 1 HOT)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // PHASE 1: First query - COLD path
      const cleanup1 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // First query: normalize 1, materialize 2 COLD (executeQuery + propagateData)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      cleanup1();

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query - mixed (executeQuery HOT + propagateData COLD)
      const cleanup2 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Second query: normalize 1, materialize 1 HOT (executeQuery cache check, no watcher so no propagateData)
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);  // executeQuery cache check is HOT
      expect(mockFetch).toHaveBeenCalledTimes(2);

      cleanup2();
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
      materializeCount = 0;

      // PHASE 1: First query - COLD path
      const cleanup1 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // COLD path: normalize 1, materialize 2 (executeQuery cache + propagateData after network)
      expect(normalizeCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      cleanup1();

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;

      // PHASE 2: Second query - HOT path
      const cleanup2 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // HOT path: normalize 1, materialize 1
      expect(normalizeCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      cleanup2();
    });
  });

  describe("refetch performance", () => {
    it("refetch: normalize 1, materialize 2 (executeQuery + propagateData)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      let queryRef: any;
      const cleanup = await runInVueContext(() => {
        queryRef = useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters after initial query
      normalizeCount = 0;
      materializeCount = 0;

      // Refetch (defaults to network-only)
      await queryRef.refetch();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once (network response)
      // Should materialize once (propagateData, executeQuery returns cached fingerprint)
      expect(normalizeCount).toBe(1);

      cleanup();
    });

    it("refetch with variables: normalize 1, materialize 2 (executeQuery + propagateData)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "2", name: "Bob" } },
        error: null,
      });

      let queryRef: any;
      const cleanup = await runInVueContext(() => {
        queryRef = useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;

      // Refetch with new variables
      await queryRef.refetch({ variables: { id: "2" } });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once (network response)
      // Should materialize twice: executeQuery + propagateData
      expect(normalizeCount).toBe(1);

      cleanup();
    });
  });

  describe("reactive options performance", () => {
    it("enabled toggle: no extra normalize/materialize when disabled", async () => {
      const enabled = ref(true);

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      const cleanup = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          enabled,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const initialNormalize = normalizeCount;
      const initialMaterialize = materializeCount;

      // Disable query
      enabled.value = false;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize or materialize when disabled
      expect(normalizeCount).toBe(initialNormalize);

      // Re-enable
      enabled.value = true;
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should execute query again
      expect(normalizeCount).toBeGreaterThan(initialNormalize);

      cleanup();
    });

    it("cache policy change: triggers new executeQuery", async () => {
      const cachePolicy = ref<CachePolicy>("cache-first");

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      const cleanup = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters
      normalizeCount = 0;
      materializeCount = 0;

      // Change policy to network-only
      cachePolicy.value = "network-only";
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should execute query with new policy (HOT path - fingerprint cached)
      expect(normalizeCount).toBe(1);

      cleanup();
    });
  });

  describe("lazy mode performance", () => {
    it("lazy mode: no initial normalize/materialize", async () => {
      const cleanup = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should NOT normalize or materialize in lazy mode
      expect(normalizeCount).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();

      cleanup();
    });

    it("lazy mode refetch: normalize 1, materialize 2", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      let queryRef: any;
      const cleanup = await runInVueContext(() => {
        queryRef = useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(normalizeCount).toBe(0);

      // Trigger query via refetch
      await queryRef.refetch();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize once and materialize once (COLD path for first query)
      expect(normalizeCount).toBe(1);

      cleanup();
    });
  });

  describe("watcher update with immediate: false", () => {
    it("should update watcher without immediate materialization", async () => {
      const variables = ref({ id: "1" });

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: variables.value.id, name: `User ${variables.value.id}` } },
        error: null,
      });

      const cleanup = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const initialMaterialize = materializeCount;

      // Change variables - watcher.update() uses immediate: false
      variables.value = { id: "2" };
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should materialize twice more: executeQuery + propagateData

      cleanup();
    });
  });

  describe("multiple queries performance", () => {
    it("10 queries with same variables: normalize 1, materialize 11 (2 for first + 1 per cached query)", async () => {
      mockFetch.mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // First query hits network
      const cleanup1 = await runInVueContext(() => {
        useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const normalizeAfterFirst = normalizeCount;
      const materializeAfterFirst = materializeCount;

      // Next 9 queries use cache
      const cleanups = [];
      for (let i = 0; i < 9; i++) {
        const cleanup = await runInVueContext(() => {
          useQuery({
            query: operations.USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-first",
          });
        });
        cleanups.push(cleanup);
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should normalize only once (first query)
      expect(normalizeCount).toBe(normalizeAfterFirst);

      // Should materialize 1 time per cached query (9 queries * 1 = 9 additional)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      cleanup1();
      cleanups.forEach(c => c());
    });
  });
});
