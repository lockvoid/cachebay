import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCache } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport, OperationResult } from "@/src/core/operations";

const QUERY = `query GetUser { user { id name } }`;

describe("useQuery", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { user: { id: "1", name: "Alice" } },
        error: null,
      }),
    };
    cache = createCache({ transport: mockTransport });
  });

  it("executes query and returns reactive data", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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

    expect(queryResult.data.value).toEqual({ user: { id: "1", name: "Alice" } });
    expect(queryResult.loading.value).toBe(false);
    expect(queryResult.error.value).toBeNull();
  });

  it("starts with loading state", () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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

    expect(queryResult.loading.value).toBe(true);
    expect(queryResult.data.value).toBeNull();
  });

  it("handles query errors", async () => {
    const errorTransport: Transport = {
      http: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("Network error"),
      }),
    };
    const errorCache = createCache({ transport: errorTransport });

    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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

    expect(queryResult.error.value).toBeTruthy();
    expect(queryResult.data.value).toBeNull();
    expect(queryResult.loading.value).toBe(false);
  });

  it("pauses query when pause is true", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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
    expect(queryResult.loading.value).toBe(false);
  });

  it("reacts to reactive pause changes", async () => {
    const isPaused = ref(true);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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
          query: QUERY,
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
          query: QUERY,
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
          query: QUERY,
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
      query: QUERY,
      variables: {},
      data: { user: { id: "cached", name: "Cached User" } },
    });

    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: QUERY,
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
    expect(queryResult.data.value).toEqual({ user: { id: "cached", name: "Cached User" } });
  });
});
