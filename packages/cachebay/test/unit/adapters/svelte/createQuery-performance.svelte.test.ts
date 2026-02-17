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

// Mock svelte context + onDestroy
const contextStore = new Map<unknown, unknown>();

vi.mock("svelte", async () => {
  const actual = await vi.importActual<typeof import("svelte")>("svelte");
  return {
    ...actual,
    setContext: (key: unknown, value: unknown) => {
      contextStore.set(key, value);
    },
    getContext: (key: unknown) => {
      return contextStore.get(key);
    },
    onDestroy: () => {},
  };
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { setCachebay } from "@/src/adapters/svelte/context";
import { createQuery } from "@/src/adapters/svelte/createQuery.svelte";
import { createCachebay } from "@/src/core/client";
import type { CachePolicy } from "@/src/core/operations";
import { operations } from "@/test/helpers";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("createQuery Performance", () => {
  let client: ReturnType<typeof createCachebay>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;
    watchQueryCallCount = 0;
    contextStore.clear();

    mockFetch = vi.fn();

    const mockTransport = {
      http: mockFetch,
      ws: vi.fn(),
    };

    client = createCachebay({
      transport: mockTransport,
      suspensionTimeout: 0,
      hydrationTimeout: 0,
    });

    setCachebay(client);
  });

  // Helper to run createQuery in $effect.root context
  // Must be async + flush microtasks so deferred executeQuery materializations
  // settle before the helper returns (matches Vue's runInVueContext behaviour).
  const runInSvelteContext = async (testFn: () => any) => {
    let result: any;

    $effect.root(() => {
      result = testFn();
    });

    flushSync();
    await new Promise<void>((r) => queueMicrotask(r));

    return result;
  };

  describe("cache-first policy", () => {
    it("two-phase: COLD path (2 materializations) then HOT path (1 materialization)", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // PHASE 1: First query - COLD path
      await runInSvelteContext(() => {
        createQuery({
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
      await runInSvelteContext(() => {
        createQuery({
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
      expect(watchQueryCallCount).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("variable change: two-phase COLD (2 materializations) then HOT (1 materialization)", async () => {
      let currentId = $state("1");

      mockFetch.mockImplementation(async () => ({
        data: { user: { __typename: "User", id: currentId, name: `User ${currentId}` } },
        error: null,
      }));

      $effect.root(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: () => ({ id: currentId }),
          cachePolicy: "cache-first",
        });
      });

      flushSync();
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
      currentId = "2";
      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1); // Watcher updates, doesn't remount
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
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query - HOT path
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(watchQueryCallCount).toBe(2);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("cache miss: COLD first time, then HOT (cache miss results are cached)", async () => {
      // PHASE 1: First cache miss
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "999" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query with same variables - HOT
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "999" },
          cachePolicy: "cache-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
      expect(watchQueryCallCount).toBe(2);
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
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second query
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(2);
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
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

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
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(watchQueryCallCount).toBe(2);
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

      const queryRef = await runInSvelteContext(() => {
        return createQuery({
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

      const queryRef = await runInSvelteContext(() => {
        return createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // PHASE 1: Initial query
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);

      // PHASE 2: Refetch with new variables
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await queryRef.refetch({ variables: { id: "2" } });
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1); // Watcher reused
    });
  });

  describe("reactive options performance", () => {
    it("enabled toggle: no extra normalize/materialize when disabled and other watcher mounted", async () => {
      let isEnabled = $state(true);

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // Phase 1
      $effect.root(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          enabled: () => isEnabled,
          cachePolicy: "cache-first",
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      // Mount another watcher
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      // Phase 2: Disable query
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      isEnabled = false;
      flushSync();
      await new Promise<void>((r) => queueMicrotask(r));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(2);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);

      // Phase 3: Re-enable
      materializeHotCount = 0;
      materializeColdCount = 0;

      isEnabled = true;
      flushSync();
      await new Promise<void>((r) => queueMicrotask(r));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(3);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
    });

    it("enabled toggle: extra cold materialize when disabled and no other watcher mounted", async () => {
      let isEnabled = $state(true);

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      // Phase 1
      $effect.root(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          enabled: () => isEnabled,
          cachePolicy: "cache-first",
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      // Phase 2: Disable query
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      isEnabled = false;
      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(1);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);

      // Phase 3: Re-enable
      isEnabled = true;
      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchQueryCallCount).toBe(2);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
    });

    it("cache policy change: triggers new executeQuery", async () => {
      let currentPolicy = $state<CachePolicy>("cache-first");

      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      $effect.root(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: () => currentPolicy,
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset counters
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Change policy to network-only
      currentPolicy = "network-only";
      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1); // Watcher reused
    });
  });

  describe("lazy mode performance", () => {
    it("lazy mode: no initial normalize/materialize", async () => {
      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);
      expect(watchQueryCallCount).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("lazy mode without refetch does not execute", async () => {
      mockFetch.mockResolvedValue({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      });

      const queryRef = await runInSvelteContext(() => {
        return createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

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
      // Pre-populate cache
      client.writeQuery({
        query: operations.USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "u1@example.com" } },
      });

      // Phase 1
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      await runInSvelteContext(() => {
        createQuery({
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

      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

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

      await runInSvelteContext(() => {
        createQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          lazy: true,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

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
      await runInSvelteContext(() => {
        createQuery({
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
        await runInSvelteContext(() => {
          createQuery({
            query: operations.USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-first",
          });
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(normalizeAfterFirst);
      expect(materializeColdCount).toBe(coldAfterFirst);
      expect(materializeHotCount).toBe(hotAfterFirst + 9);
      expect(watchQueryCallCount).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
