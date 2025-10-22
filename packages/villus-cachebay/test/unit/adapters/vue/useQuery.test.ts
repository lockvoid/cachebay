import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
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
    cache = createCachebay({ transport: mockTransport });
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

    expect(queryResult.data.value).toEqual({ user: { id: "1", email: "alice@example.com" } });
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
    expect(queryResult.data.value).toBeNull();
  });

  it("handles query errors", async () => {
    const errorTransport: Transport = {
      http: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("Network error"),
      }),
    };
    const errorCache = createCachebay({ transport: errorTransport });

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
              provideCachebay(app as any, errorCache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(queryResult.error.value).toBeInstanceOf(Error);
    expect(queryResult.data.value).toBeNull();
    expect(queryResult.isFetching.value).toBe(false);
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

    // Wait for suspension window to expire (default 1000ms)
    await new Promise((resolve) => setTimeout(resolve, 1100));

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
    expect(queryResult.data.value).toEqual({ user: { id: "cached", email: "cached@example.com" } });
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
      await new Promise((resolve) => setTimeout(resolve, 60));

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
});
