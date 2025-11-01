import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick, watch } from "vue";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCachebay } from "@/src/core/client";
import type { Transport, OperationResult } from "@/src/core/operations";
import { USER_QUERY } from "@/test/helpers/operations";

describe("useQuery", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { user: { __typename: "User", id: "1", email: "alice@example.com" } },
        error: null,
      }),
    };
    cache = createCachebay({
      transport: mockTransport,
      suspensionTimeout: 50,  // Use 50ms for faster tests
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

  it("disables query when enabled is false", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          enabled: false,
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

  it("skips initial query execution when lazy is true", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
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

    // Should not execute initial query
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching.value).toBe(false);
    expect(queryResult.data.value).toBeUndefined();
  });

  it("lazy query executes when refetch is called", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
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

    // Initial: no query
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Call refetch to trigger query
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have executed query
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("lazy query does not auto-execute on re-enable", async () => {
    const isEnabled = ref(true);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
          enabled: isEnabled,
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

    // Initial: no query (lazy)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Call refetch to execute query
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Disable
    isEnabled.value = false;
    await nextTick();

    // Re-enable - should NOT auto-execute (lazy stays lazy)
    isEnabled.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still only 1 call - need to call refetch again
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
  });

  it("refetch does nothing when query is disabled", async () => {
    const isEnabled = ref(false);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          enabled: isEnabled,
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

    // Initial: no query (disabled)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Try to refetch while disabled - should do nothing
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still no calls
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data.value).toBeUndefined();
  });

  it("lazy query with refetch respects enabled state", async () => {
    const isEnabled = ref(true);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
          enabled: isEnabled,
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

    // Initial: no query (lazy)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Disable before refetch
    isEnabled.value = false;
    await nextTick();

    // Try to refetch while disabled - should do nothing
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still no calls
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Enable and refetch - should work
    isEnabled.value = true;
    await nextTick();
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now it executes
    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("lazy query can be refetched multiple times", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
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

    // Initial: no query
    expect(mockTransport.http).not.toHaveBeenCalled();

    // First refetch
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    // Mock different response
    mockTransport.http.mockResolvedValueOnce({
      data: { user: { id: "1", email: "updated@example.com" } },
      error: null,
    });

    // Second refetch
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(2);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "updated@example.com" } });
  });

  it("lazy query with enabled: false never executes", async () => {
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
          enabled: false,
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

    // Initial: no query (lazy + disabled)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Try to refetch - should do nothing (disabled)
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still no calls
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.data.value).toBeUndefined();
  });

  it("refetch works after enabling a disabled lazy query", async () => {
    const isEnabled = ref(false);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          lazy: true,
          enabled: isEnabled,
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

    // Initial: no query (lazy + disabled)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Enable
    isEnabled.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Still no query (lazy doesn't auto-execute)
    expect(mockTransport.http).not.toHaveBeenCalled();

    // Now refetch should work
    await queryResult.refetch();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  it("reacts to reactive enabled changes", async () => {
    const isEnabled = ref(false);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          enabled: isEnabled,
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

    // Enable
    isEnabled.value = true;
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

    // Refetch should return a result
    const result = await queryResult.refetch();
    expect(result).toBeDefined();
    expect(result.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
  });

  describe("refetch with variables", () => {
    it("supports passing new variables", async () => {
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

      // Initial data
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
      expect(mockTransport.http).toHaveBeenCalledTimes(1);

      // Mock different response for id: "2"
      mockTransport.http.mockResolvedValueOnce({
        data: { user: { id: "2", email: "bob@example.com" } },
        error: null,
      });

      // Refetch with new variables
      await queryResult.refetch({ variables: { id: "2" } });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have new data
      expect(queryResult.data.value).toMatchObject({ user: { id: "2", email: "bob@example.com" } });
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

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: SEARCH_QUERY,
            variables: { search: "", limit: 10, offset: 0 },
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

      mockTransport.http.mockClear();

      // Refetch with only search variable - should preserve limit and offset
      await queryResult.refetch({ variables: { search: "alice" } });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have merged variables
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

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: PAGINATED_QUERY,
            variables: { category: "tech", page: 1, perPage: 20 },
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

      mockTransport.http.mockClear();

      // Change only page - should preserve category and perPage
      await queryResult.refetch({ variables: { page: 2 } });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { category: "tech", page: 2, perPage: 20 },
        }),
      );

      mockTransport.http.mockClear();

      // Change multiple variables
      await queryResult.refetch({ variables: { category: "sports", page: 1 } });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { category: "sports", page: 1, perPage: 20 },
        }),
      );
    });

    it("refetch without arguments uses original variables", async () => {
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

      mockTransport.http.mockClear();
      mockTransport.http.mockResolvedValueOnce({
        data: { user: { id: "1", email: "alice-refreshed@example.com" } },
        error: null,
      });

      // Refetch without arguments
      await queryResult.refetch();
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should use original variables
      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { id: "1" },
        }),
      );
    });

    it("works with reactive variables", async () => {
      const variables = ref({ id: "1" });
      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: USER_QUERY,
            variables,
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

      mockTransport.http.mockClear();

      // Refetch with new variables should merge with current reactive value
      await queryResult.refetch({ variables: { id: "2" } });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockTransport.http).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { id: "2" },
        }),
      );
    });

    it("updates watcher with new variables", async () => {
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

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data.value).toMatchObject({
        user: { id: "1", email: "alice@example.com" },
      });

      // Mock response for user:2
      mockTransport.http = vi.fn().mockResolvedValue({
        data: { user: { __typename: "User", id: "2", email: "bob@example.com" } },
        error: null,
      });

      // Refetch with new variables
      await queryResult.refetch({ variables: { id: "2" } });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryResult.data.value).toMatchObject({
        user: { id: "2", email: "bob@example.com" },
      });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "2" },
        data: { user: { __typename: "User", id: "2", email: "bob-updated@example.com" } },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should reflect the update
      expect(queryResult.data.value).toMatchObject({
        user: { id: "2", email: "bob-updated@example.com" },
      });
    });

    it("defaults to network-only cache policy", async () => {
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

      // Initial data from cache
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

      mockTransport.http.mockClear();
      mockTransport.http.mockResolvedValueOnce({
        data: { user: { id: "1", email: "fresh@example.com" } },
        error: null,
      });

      // Refetch should use network-only by default, not cache-first
      await queryResult.refetch();
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have fetched from network
      expect(mockTransport.http).toHaveBeenCalledTimes(1);
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "fresh@example.com" } });
    });

    it("allows overriding cache policy for refetch", async () => {
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
            cachePolicy: "cache-only", // Use cache-only to avoid initial network request
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

      // Verify initial data from cache
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

      mockTransport.http.mockClear();

      // Refetch with cache-only policy - should not hit network
      await queryResult.refetch({ cachePolicy: "cache-only" });
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should NOT have made network request
      expect(mockTransport.http).not.toHaveBeenCalled();
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
    });
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

  it("Suspense resolves immediately with cached data for cache-and-network", async () => {
    // Create a slow transport to ensure we can verify Suspense resolves before network
    const slowTransport: Transport = {
      http: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  data: { user: { __typename: "User", id: "1", email: "network@example.com" } },
                  error: null,
                }),
              100, // 100ms delay
            ),
          ),
      ),
    };

    const slowCache = createCachebay({
      transport: slowTransport,
      suspensionTimeout: 50,
    });

    // Pre-populate cache
    slowCache.writeQuery({
      query: USER_QUERY,
      variables: { id: "1" },
      data: { user: { id: "1", email: "cached@example.com" } },
    });

    let queryResult: any;
    let suspenseResolved = false;

    const App = defineComponent({
      async setup() {
        queryResult = await useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network", // Should show cached data immediately
        }).then((result) => {
          suspenseResolved = true;
          return result;
        });
        return () => h("div", queryResult.data.value?.user?.email || "");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, slowCache);
            },
          },
        ],
      },
    });

    await nextTick();
    await nextTick();

    // KEY TEST: Suspense should have resolved immediately with cached data
    // WITHOUT waiting for the 100ms network request
    expect(suspenseResolved).toBe(true);
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });

    // Network request should have been initiated
    expect(slowTransport.http).toHaveBeenCalled();

    // Wait for network update to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Data should now be updated from network
    expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "network@example.com" } });
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
        suspensionTimeout: 1000, // 1 second window
      });

      // First query - hits network
      const result1 = await cache.executeQuery({
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
      const result2 = await cache.executeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      expect(mockTransport.http).toHaveBeenCalledTimes(1); // Still 1, no second network call
      expect(result2.data).toMatchObject({ user: { id: "1", email: "alice@example.com" } });
    });

    it("hits network again after suspension window expires", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        suspensionTimeout: 50, // 50ms window
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
        hydrationTimeout: 100,
      });

      // Mark as hydrating first
      (cache as any).__internals.ssr.hydrate({ records: [] });

      // Then write to strict cache (after hydrate which clears cache)
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      // Query during hydration - should serve from strict cache
      const result = await cache.executeQuery({
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
      const cache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100, // 100ms window
      });

      // Simulate SSR
      (cache as any).__internals.ssr.hydrate({ records: [] });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      // Query DURING hydration window - should NOT hit network
      const result = await cache.executeQuery({
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
      }); // Cached data
    });

    it("network-only still uses cache during hydration to avoid network", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        hydrationTimeout: 100,
      });

      (cache as any).__internals.ssr.hydrate({ records: [] });

      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: { user: { __typename: "User", id: "1", email: "ssr@example.com" } },
      });

      // network-only during hydration should still use cache to avoid network
      const result = await cache.executeQuery({
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

  it("destroys watcher when disabled and recreates when enabled", async () => {
    const isEnabled = ref(false);
    let queryResult: any;

    const App = defineComponent({
      setup() {
        queryResult = useQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          enabled: isEnabled,
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

    // Should not have fetched while disabled
    expect(mockTransport.http).not.toHaveBeenCalled();
    expect(queryResult.isFetching.value).toBe(false);

    // Enable - should create watcher and fetch
    isEnabled.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.http).toHaveBeenCalledTimes(1);
    expect(queryResult.data.value).toBeTruthy();

    // Disable again - should destroy watcher
    isEnabled.value = false;
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
      }),
    );
  });

  it("add default cachePolicy when not provided", async () => {
    const executeQuerySpy = vi.spyOn(cache, "executeQuery");

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

    // Verify executeQuery was called with undefined cachePolicy (core will use default)
    expect(executeQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: USER_QUERY,
        variables: { id: "1" },
        cachePolicy: undefined, // Should pass undefined to let core handle default
      }),
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
          }),
        ),
      };

      const delayedCache = createCachebay({
        transport: delayedTransport,
        suspensionTimeout: 50,
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

  describe("client-level defaultCachePolicy", () => {
    it("respects client-level cachePolicy setting when useQuery has no policy", async () => {
      // Create client with custom default cache policy
      const customTransport: Transport = {
        http: vi.fn().mockResolvedValue({
          data: { user: { __typename: "User", id: "1", email: "network@example.com" } },
          error: null,
        }),
      };

      const customCache = createCachebay({
        transport: customTransport,
        cachePolicy: "network-only", // Custom default - should always fetch from network
      });

      // Pre-populate cache
      customCache.writeQuery({
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
            // No cachePolicy specified - should use client's default (network-only)
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, customCache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have made network request (network-only policy from client)
      expect(customTransport.http).toHaveBeenCalled();

      // Should have network data, not cached data
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "network@example.com" } });
    });

    it("useQuery cachePolicy overrides client-level default", async () => {
      // Create client with network-only default
      const customTransport: Transport = {
        http: vi.fn().mockResolvedValue({
          data: { user: { __typename: "User", id: "1", email: "network@example.com" } },
          error: null,
        }),
      };

      const customCache = createCachebay({
        transport: customTransport,
        cachePolicy: "network-only", // Default is network-only
      });

      // Pre-populate cache
      customCache.writeQuery({
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
            cachePolicy: "cache-only", // Override client default with cache-only
          });
          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, customCache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should NOT have made network request (cache-only overrides network-only)
      expect(customTransport.http).not.toHaveBeenCalled();

      // Should have cached data
      expect(queryResult.data.value).toMatchObject({ user: { id: "1", email: "cached@example.com" } });
    });
  });
});
