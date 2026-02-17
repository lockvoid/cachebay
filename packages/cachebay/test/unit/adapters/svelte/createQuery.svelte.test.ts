import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { createCachebay } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";
import { USER_QUERY } from "@/test/helpers/operations";

// Mock svelte context + onDestroy
const contextStore = new Map<unknown, unknown>();
const destroyCallbacks: Array<() => void> = [];

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
    onDestroy: (fn: () => void) => {
      destroyCallbacks.push(fn);
    },
  };
});

import { setCachebay } from "@/src/adapters/svelte/context";
import { createQuery } from "@/src/adapters/svelte/createQuery.svelte";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("createQuery", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    contextStore.clear();
    destroyCallbacks.length = 0;

    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { user: { __typename: "User", id: "1", email: "alice@example.com" } },
        error: null,
      }),
    };
    cache = createCachebay({
      transport: mockTransport,
      suspensionTimeout: 50,
    });
    setCachebay(cache);
  });

  it("executes query and returns reactive data", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
    expect(queryResult.isFetching).toBe(false);
    expect(queryResult.error).toBeNull();
  });

  it("starts with loading state", async () => {
    // Use a delayed transport to catch the loading state
    mockTransport.http = vi.fn().mockImplementation(() =>
      new Promise((resolve) =>
        setTimeout(() => resolve({
          data: { user: { __typename: "User", id: "1", email: "alice@example.com" } },
          error: null,
        }), 50),
      ),
    );

    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });
    });

    flushSync();
    // Give $effect time to run and set isFetching=true, but not enough for network to complete
    await new Promise((r) => setTimeout(r, 5));

    expect(queryResult.isFetching).toBe(true);
    expect(queryResult.data).toBe(undefined);
  });

  it("disables query when enabled is false", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        enabled: false,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching).toBe(false);
  });

  it("skips initial query execution when lazy is true", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching).toBe(false);
    expect(queryResult.data).toBeUndefined();
  });

  it("lazy query executes when refetch is called", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Initial: no query
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Call refetch to trigger query
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("lazy query does not auto-execute on re-enable", async () => {
    let isEnabled = $state(true);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Initial: no query (lazy)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Call refetch to execute query
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Disable
    isEnabled = false;
    flushSync();

    // Re-enable - should NOT auto-execute (lazy stays lazy)
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still only 1 call
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
  });

  it("refetch does nothing when query is disabled", async () => {
    let isEnabled = $state(false);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();

    // Try to refetch while disabled - should do nothing
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data).toBeUndefined();
  });

  it("lazy query with refetch respects enabled state", async () => {
    let isEnabled = $state(true);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Initial: no query (lazy)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Disable before refetch
    isEnabled = false;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Try to refetch while disabled - should do nothing
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();

    // Enable and refetch - should work
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("lazy query can be refetched multiple times", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();

    // First refetch
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Mock different response
    (mockTransport.http as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { user: { id: "1", email: "updated@example.com" } },
      error: null,
    });

    // Second refetch
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(2);
    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "updated@example.com" } });
  });

  it("lazy query with enabled: false never executes", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
        enabled: false,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();

    // Try to refetch - should do nothing (disabled)
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data).toBeUndefined();
  });

  it("refetch works after enabling a disabled lazy query", async () => {
    let isEnabled = $state(false);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        lazy: true,
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();

    // Enable
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still no query (lazy doesn't auto-execute)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Now refetch should work
    await queryResult.refetch();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("reacts to reactive enabled changes", async () => {
    let isEnabled = $state(false);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Enable
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalled();
    expect(queryResult.data).toBeTruthy();
  });

  it("reacts to reactive variables changes", async () => {
    let currentId = $state("1");
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: () => ({ id: currentId }),
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Wait for suspension window to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change variables
    currentId = "2";
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(2);
  });

  it("provides refetch function", async () => {
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(typeof queryResult.refetch).toBe("function");
  });

  describe("refetch with variables", () => {
    it("supports passing new variables", async () => {
      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(mockTransport.http).toHaveBeenCalledTimes(1);

      // Mock different response for id: "2"
      (mockTransport.http as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { user: { id: "2", email: "bob@example.com" } },
        error: null,
      });

      // Refetch with new variables
      await queryResult.refetch({ variables: { id: "2" } });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({ user: { id: "2", email: "bob@example.com" } });
      expect(mockTransport.http).toHaveBeenCalledTimes(2);
      expect(mockTransport.http).toHaveBeenLastCalledWith(
        expect.objectContaining({
          variables: { id: "2" },
        }),
      );
    });

    it("merges new variables with existing variables (Apollo behavior)", async () => {
      const SEARCH_QUERY = `
        query SearchUsers($search: String, $limit: Int, $offset: Int) {
          users(search: $search, limit: $limit, offset: $offset) {
            id
            email
          }
        }
      `;

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: SEARCH_QUERY,
          variables: { search: "", limit: 10, offset: 0 },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();

      // Refetch with only search variable - should preserve limit and offset
      await queryResult.refetch({ variables: { search: "alice" } });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { search: "alice", limit: 10, offset: 0 },
        }),
      );
    });

    it("allows overriding specific variables while preserving others", async () => {
      const PAGINATED_QUERY = `
        query GetPosts($category: String, $page: Int, $perPage: Int) {
          posts(category: $category, page: $page, perPage: $perPage) {
            id
            title
          }
        }
      `;

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: PAGINATED_QUERY,
          variables: { category: "tech", page: 1, perPage: 20 },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();

      // Change only page - should preserve category and perPage
      await queryResult.refetch({ variables: { page: 2 } });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { category: "tech", page: 2, perPage: 20 },
        }),
      );

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();

      // Change multiple variables
      await queryResult.refetch({ variables: { category: "sports", page: 1 } });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { category: "sports", page: 1, perPage: 20 },
        }),
      );
    });

    it("refetch without arguments uses original variables", async () => {
      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();
      (mockTransport.http as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { user: { id: "1", email: "alice-refreshed@example.com" } },
        error: null,
      });

      // Refetch without arguments
      await queryResult.refetch();
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { id: "1" },
        }),
      );
    });

    it("defaults to network-only cache policy", async () => {
      // Pre-populate cache
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Initial data from cache
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();
      (mockTransport.http as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { user: { id: "1", email: "fresh@example.com" } },
        error: null,
      });

      // Refetch should use network-only by default, not cache-first
      await queryResult.refetch();
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledTimes(1);
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "fresh@example.com" } });
    });

    it("allows overriding cache policy for refetch", async () => {
      // Pre-populate cache
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

      (mockTransport.http as ReturnType<typeof vi.fn>).mockClear();

      // Refetch with cache-only policy - should not hit network
      await queryResult.refetch({ cachePolicy: "cache-only" });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
    });

    it("updates watcher with new variables", async () => {
      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({
        user: { id: "1", email: "alice@example.com" },
      });

      // Mock response for user:2
      mockTransport.http = vi.fn().mockResolvedValue({
        data: { user: { __typename: "User", id: "2", email: "bob@example.com" } },
        error: null,
      });

      // Refetch with new variables
      await queryResult.refetch({ variables: { id: "2" } });
      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({
        user: { id: "2", email: "bob@example.com" },
      });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "2" },
        data: { user: { __typename: "User", id: "2", email: "bob-updated@example.com" } },
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should reflect the update
      expect(queryResult.data).toMatchObject({
        user: { id: "2", email: "bob-updated@example.com" },
      });
    });
  });

  it("handles cache-only policy", async () => {
    // Pre-populate cache
    cache.writeQuery({
      query: USER_QUERY,
      variables: { id: "cached" },
      data: { user: { id: "cached", email: "cached@example.com" } },
    });

    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "cached" },
        cachePolicy: "cache-only",
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data).toMatchObject({ user: { id: "cached", email: "cached@example.com" } });
  });

  describe("Suspension timeout", () => {
    it("serves cached response within suspension window to avoid duplicate network requests", async () => {
      const localCache = createCachebay({
        transport: mockTransport,
        suspensionTimeout: 1000,
      });

      // First query - hits network
      const result1 = await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1);
      expect(result1.data).toEqual({
        user: {
          id: "1",
          email: "alice@example.com",
          __typename: "User",
        },
      });

      // Second query within suspension window - serves from cache without network
      const result2 = await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1); // Still 1, no second network call
      expect(result2.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
    });

    it("hits network again after suspension window expires", async () => {
      const localCache = createCachebay({
        transport: mockTransport,
        suspensionTimeout: 50,
      });

      // First query
      await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1);

      // Wait for suspension window to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second query after window - hits network again
      await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(2);
    });
  });

  describe("SSR hydration", () => {
    it("serves from strict cache during hydration", async () => {
      const localCache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100,
      });

      (localCache as any).__internals.ssr.hydrate({ records: [] });

      localCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      const result = await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({
        user: {
          __typename: "User",
          id: "1",
          email: "ssr@example.com",
        },
      });
    });

    it("does not hit network during hydration window", async () => {
      const localCache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100,
      });

      (localCache as any).__internals.ssr.hydrate({ records: [] });

      localCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      const result = await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({
        user: {
          __typename: "User",
          id: "1",
          email: "ssr@example.com",
        },
      });
    });

    it("network-only still uses cache during hydration to avoid network", async () => {
      const localCache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100,
      });

      (localCache as any).__internals.ssr.hydrate({ records: [] });

      localCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      const result = await localCache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: "network-only",
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({
        user: {
          __typename: "User",
          id: "1",
          email: "ssr@example.com",
        },
      });
    });
  });

  it("reacts to reactive cache policy changes", async () => {
    let currentPolicy = $state<"cache-first" | "network-only">("cache-first");

    // Pre-populate cache
    cache.writeQuery({
      query: USER_QUERY,
      variables: { id: "1" },
      data: { user: { id: "1", email: "cached@example.com" } },
    });

    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: () => currentPolicy,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // cache-first should use cached data without network call
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

    // Wait for suspension window
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change to network-only
    currentPolicy = "network-only";
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should now hit network
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
  });

  it("updates watcher when variables change", async () => {
    let currentId = $state("1");
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: () => ({ id: currentId }),
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data).toMatchObject({ user: { id: "1" } });

    // Wait for suspension window
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change variables
    currentId = "2";
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(2);
  });

  it("destroys watcher when disabled and recreates when enabled", async () => {
    let isEnabled = $state(false);
    let queryResult: any;

    $effect.root(() => {
      queryResult = createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching).toBe(false);

    // Enable
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data).toBeTruthy();

    // Disable again
    isEnabled = false;
    flushSync();

    expect(queryResult.isFetching).toBe(false);
  });

  it("add default cachePolicy when not provided", async () => {
    const executeQuerySpy = vi.spyOn(cache, "executeQuery");

    $effect.root(() => {
      createQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        // No cachePolicy specified
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(executeQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: undefined,
      }),
    );
  });

  describe("isFetching behavior for cache policies", () => {
    it("cache-first: sets isFetching to false immediately with cache hit", async () => {
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
      expect(queryResult.isFetching).toBe(false);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("cache-first: sets isFetching to false after network fetch on cache miss", async () => {
      // Use delayed transport to catch loading state
      mockTransport.http = vi.fn().mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({
            data: { user: { __typename: "User", id: "1", email: "alice@example.com" } },
            error: null,
          }), 50),
        ),
      );

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });
      });

      flushSync();
      await new Promise((r) => setTimeout(r, 5));

      // Initially fetching
      expect(queryResult.isFetching).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(queryResult.isFetching).toBe(false);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-only: sets isFetching to false immediately with cache hit", async () => {
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
      expect(queryResult.isFetching).toBe(false);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("network-only: sets isFetching to false after network fetch completes", async () => {
      // Use delayed transport to catch loading state
      mockTransport.http = vi.fn().mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({
            data: { user: { __typename: "User", id: "1", email: "alice@example.com" } },
            error: null,
          }), 50),
        ),
      );

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });
      });

      flushSync();
      await new Promise((r) => setTimeout(r, 5));

      // Initially fetching
      expect(queryResult.isFetching).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(queryResult.isFetching).toBe(false);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-and-network: keeps isFetching true until network fetch completes", async () => {
      const delayedTransport = {
        http: vi.fn().mockImplementation(() =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                data: { user: { id: "1", email: "network@example.com" } },
                error: null,
              });
            }, 50);
          }),
        ),
      };

      const delayedCache = createCachebay({
        transport: delayedTransport,
        suspensionTimeout: 50,
      });
      contextStore.clear();
      setCachebay(delayedCache);

      delayedCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });
      });

      flushSync();
      await tick();

      // Should show cached data immediately
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

      // But isFetching should still be true (background fetch in progress)
      expect(queryResult.isFetching).toBe(true);

      // Wait for background fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now isFetching should be false
      expect(queryResult.isFetching).toBe(false);

      // Data should be updated from network
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "network@example.com" } });
    });
  });

  describe("client-level defaultCachePolicy", () => {
    it("respects client-level cachePolicy setting when createQuery has no policy", async () => {
      const customTransport: Transport = {
        http: vi.fn().mockResolvedValue({
          data: { user: { __typename: "User", id: "1", email: "network@example.com" } },
          error: null,
        }),
      };

      const customCache = createCachebay({
        transport: customTransport,
        cachePolicy: "network-only",
      });

      customCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      contextStore.clear();
      setCachebay(customCache);

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(customTransport.http).toHaveBeenCalled();
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "network@example.com" } });
    });

    it("createQuery cachePolicy overrides client-level default", async () => {
      const customTransport: Transport = {
        http: vi.fn().mockResolvedValue({
          data: { user: { __typename: "User", id: "1", email: "network@example.com" } },
          error: null,
        }),
      };

      const customCache = createCachebay({
        transport: customTransport,
        cachePolicy: "network-only",
      });

      customCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      contextStore.clear();
      setCachebay(customCache);

      let queryResult: any;

      $effect.root(() => {
        queryResult = createQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(customTransport.http).not.toHaveBeenCalled();
      expect(queryResult.data).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
    });
  });
});
