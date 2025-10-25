import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick, watch } from "vue";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCachebay } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport, OperationResult } from "@/src/core/operations";
import { USER_QUERY } from "@/test/helpers/operations";

describe("useQuery", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { user: { id: "1", email: "alice@example.com" } },
        error: null,
      }),
    };
    cache = createCachebay({ 
      transport: mockTransport,
      suspensionTimeout: 50  // Use 50ms for faster tests
    });
  });

  it("executes query and returns reactive data", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    // Wait for query to execute
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
    expect(queryResult.isFetching.value).toBe(false);
    expect(queryResult.error.value).toBeNull();
  });

  it("starts with loading state", () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    expect(queryResult.isFetching.value).toBe(true);
    expect(queryResult.data.value).toBe(undefined);
  });

  it("pauses query when pause is true", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          pause: true,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching.value).toBe(false);
  });

  it("reacts to reactive pause changes", async () => {
    const isPaused = ref(true);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          pause: isPaused,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Unpause
    isPaused.value = false;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalled();
    expect(queryResult.data.value).toBeTruthy();
  });

  it("reacts to reactive variables changes", async () => {
    const userId = ref("1");
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: () => ({ id: userId.value }),
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Wait for suspension window to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change variables
    userId.value = "2";
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(2);
  });

  it("provides refetch function", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(typeof queryResult.refetch).toBe("function");

    // Refetch should be callable without errors
    await expect(queryResult.refetch()).resolves.not.toThrow();
  });

  it("supports Suspense with then method", async () => {
    let queryResult: any;
    let thenCalled = false;

    const App = defineComponent({
      async setup() {
        queryResult = await useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
        }).then((result) => {
          thenCalled = true;
          return result;
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(thenCalled).toBe(true);
    expect(queryResult.data).toBeDefined();
  });

  it("handles cache-only policy", async () => {
    // Pre-populate cache
    cache.writeQuery({
      query: USER_QUERY,
      variables: { id: "cached" },
      data: { user: { id: "cached", email: "cached@example.com" } },
    });

    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "cached" },
          cachePolicy: "cache-only",
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data.value).toMatchObject({ user: { id: "cached", email: "cached@example.com" } });
  });

  describe("Suspension timeout", () => {
    it("serves cached response within suspension window to avoid duplicate network requests", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        suspensionTimeout: 1000 // 1 second window
      });

      // First query - hits network
      const result1 = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1);
      expect(result1.data).toEqual({ user: { id: "1", email: "alice@example.com" } });

      // Second query within suspension window - serves from cache without network
      const result2 = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1); // Still 1, no second network call
      expect(result2.data).toEqual({ user: { id: "1", email: "alice@example.com" } });
    });

    it("hits network again after suspension window expires", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        suspensionTimeout: 50 // 50ms window
      });

      // First query
      await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1);

      // Wait for suspension window to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second query after window - hits network again
      await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(2);
    });

  });

  describe("SSR hydration", () => {
    it("serves from strict cache during hydration", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100
      });

      // Mark as hydrating first
      (cache as any).__internals.ssr.hydrate({ records: [] });

      // Then write to strict cache (after hydrate which clears cache)
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "ssr@example.com" } },
      });

      // Query during hydration - should serve from strict cache
      const result = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({ user: { id: "1", email: "ssr@example.com" } });
    });

    it("does not hit network during hydration window", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100 // 100ms window
      });

      // Simulate SSR
      (cache as any).__internals.ssr.hydrate({ records: [] });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "ssr@example.com" } },
      });

      // Query DURING hydration window - should NOT hit network
      const result = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({ user: { id: "1", email: "ssr@example.com" } }); // Cached data
    });

    it("network-only still uses cache during hydration to avoid network", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100
      });

      (cache as any).__internals.ssr.hydrate({ records: [] });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "ssr@example.com" } },
      });

      // network-only during hydration should still use cache to avoid network
      const result = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: "network-only",
      });

      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(result.data).toEqual({ user: { id: "1", email: "ssr@example.com" } });
    });
  });

  it("reacts to reactive cache policy changes", async () => {
    const policy = ref<"cache-first" | "network-only">("cache-first");
    let queryResult: any;

    // Pre-populate cache
    cache.writeQuery({
      query: USER_QUERY,
      variables: { id: "1" },
      data: { user: { id: "1", email: "cached@example.com" } },
    });

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: policy,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // cache-first should use cached data without network call
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

    // Wait for suspension window
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change to network-only
    policy.value = "network-only";
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should now hit network
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
  });

  it("updates watcher when variables change", async () => {
    const userId = ref("1");
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: () => ({ id: userId.value }),
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1" } });

    // Wait for suspension window
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Change variables - should call watchHandle.update()
    userId.value = "2";
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have called network again with new variables
    expect(mockTransport.http).toHaveBeenCalledTimes(2);
  });

  it("destroys watcher when paused and recreates when unpaused", async () => {
    const isPaused = ref(true);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          pause: isPaused,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not have fetched while paused
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching.value).toBe(false);

    // Unpause - should create watcher and fetch
    isPaused.value = false;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toBeTruthy();

    // Pause again - should destroy watcher
    isPaused.value = true;
    await nextTick();

    expect(queryResult.isFetching.value).toBe(false);
  });

  it("uses global cachePolicy when no local policy is specified", async () => {
    const httpSpy = vi.fn().mockResolvedValue({
      data: { user: { id: "1", email: "alice@example.com" } },
      error: null,
    });

    const cacheWithPolicy = createCachebay({
      transport: { http: httpSpy },
      cachePolicy: "network-only",
    });

    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          // No cachePolicy specified - should use global "network-only"
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cacheWithPolicy);
            },
          },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have called HTTP transport (network-only behavior)
    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(httpSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.any(String),
        variables: { id: "1" },
        operationType: "query",
      })
    );
  });

  it("does not add default cachePolicy when not provided", async () => {
    const executeQuerySpy = vi.spyOn(cache, 'executeQuery');

    const App = defineComponent({
      setup() {
        useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          // No cachePolicy specified - should pass undefined to executeQuery
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify executeQuery was called with undefined cachePolicy
    expect(executeQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: undefined,
      })
    );
  });

  describe("isFetching behavior for cache policies", () => {
    it("cache-first: sets isFetching to false immediately with cache hit", async () => {
      // Pre-populate cache
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-first",
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, cache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should show cached data
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
      
      // isFetching should be false (not waiting for anything)
      expect(queryResult.isFetching.value).toBe(false);
      
      // Should not have made network request
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("cache-first: sets isFetching to false after network fetch on cache miss", async () => {
      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-first",
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, cache);
              },
            },
          ],
        },
      });

      // Initially fetching
      expect(queryResult.isFetching.value).toBe(true);

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // After network fetch completes
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(queryResult.isFetching.value).toBe(false);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-only: sets isFetching to false immediately with cache hit", async () => {
      // Pre-populate cache
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-only",
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, cache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
      expect(queryResult.isFetching.value).toBe(false);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("network-only: sets isFetching to false after network fetch completes", async () => {
      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "network-only",
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, cache);
              },
            },
          ],
        },
      });

      // Initially fetching
      expect(queryResult.isFetching.value).toBe(true);

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // After network fetch completes
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(queryResult.isFetching.value).toBe(false);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-and-network: keeps isFetching true until network fetch completes", async () => {
      // Create a delayed mock transport
      const delayedTransport = {
        http: vi.fn().mockImplementation(() => 
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                data: { user: { id: "1", email: "network@example.com" } },
                error: null,
              });
            }, 50); // 50ms delay
          })
        ),
      };

      const delayedCache = createCachebay({ 
        transport: delayedTransport,
        suspensionTimeout: 50
      });

      // Pre-populate cache
      delayedCache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { id: "1", email: "cached@example.com" } },
      });

      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables: { id: "1" },
            cachePolicy: "cache-and-network",
          });
          
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, delayedCache);
              },
            },
          ],
        },
      });

      await nextTick();
      
      // Should show cached data immediately
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
      
      // But isFetching should still be true (background fetch in progress)
      expect(queryResult.isFetching.value).toBe(true);

      // Wait for background fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Now isFetching should be false
      expect(queryResult.isFetching.value).toBe(false);
      
      // Data should be updated from network
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "network@example.com" } });
    });
  });
});


