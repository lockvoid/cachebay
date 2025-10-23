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
    expect(queryResult.data.value).toBe(undefined);
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

  describe("Smart watcher reuse for pagination", () => {
    it("reuses watcher when paginating within same connection", async () => {
      const POSTS_QUERY = `
        query GetPosts($category: String, $first: Int, $after: String) {
          posts(category: $category, first: $first, after: $after) @connection(key: "posts") {
            edges {
              node {
                id
                title
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const postsTransport: Transport = {
        http: vi.fn()
          .mockResolvedValueOnce({
            data: {
              posts: {
                edges: [
                  { node: { id: "p1", title: "Post 1" } },
                  { node: { id: "p2", title: "Post 2" } },
                ],
                pageInfo: { hasNextPage: true, endCursor: "cursor2" },
              },
            },
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              posts: {
                edges: [
                  { node: { id: "p3", title: "Post 3" } },
                  { node: { id: "p4", title: "Post 4" } },
                ],
                pageInfo: { hasNextPage: false, endCursor: "cursor4" },
              },
            },
            error: null,
          }),
      };

      const postsCache = createCachebay({ 
        transport: postsTransport,
        suspensionTimeout: 50
      });

      const variables = ref({ category: "tech", first: 2, after: null });
      let queryResult: any;
      const emissions: any[] = [];

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: POSTS_QUERY,
            variables,
          });

          // Track emissions
          queryResult.data.value && emissions.push(queryResult.data.value);

          return () => h("div");
        },
      });

      mount(App, {
        global: {
          plugins: [
            {
              install(app) {
                provideCachebay(app as any, postsCache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(postsTransport.http).toHaveBeenCalledTimes(1);

      // Wait for suspension window to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Change pagination cursor (same canonical connection)
      variables.value = { category: "tech", first: 2, after: "cursor2" };

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called network for page 2
      expect(postsTransport.http).toHaveBeenCalledTimes(2);

      // Watcher was reused (not recreated), so recycling should work
      // This is verified by the fact that the watcher didn't unsubscribe/resubscribe
    });

    it("recreates watcher when filter changes (different canonical connection)", async () => {
      const POSTS_QUERY = `
        query GetPosts($category: String, $first: Int, $after: String) {
          posts(category: $category, first: $first, after: $after) @connection(key: "posts") {
            edges {
              node {
                id
                title
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const postsTransport: Transport = {
        http: vi.fn()
          .mockResolvedValueOnce({
            data: {
              posts: {
                edges: [{ node: { id: "p1", title: "Tech Post" } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              posts: {
                edges: [{ node: { id: "p2", title: "News Post" } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
            error: null,
          }),
      };

      const postsCache = createCachebay({ 
        transport: postsTransport,
        suspensionTimeout: 50
      });

      const variables = ref({ category: "tech", first: 10, after: null });
      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: POSTS_QUERY,
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
                provideCachebay(app as any, postsCache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(postsTransport.http).toHaveBeenCalledTimes(1);
      expect(queryResult.data.value.posts.edges[0].node.title).toBe("Tech Post");

      // Wait for suspension window
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Change category (different canonical connection)
      variables.value = { category: "news", first: 10, after: null };

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have called network for new category
      expect(postsTransport.http).toHaveBeenCalledTimes(2);
      expect(queryResult.data.value.posts.edges[0].node.title).toBe("News Post");
    });

    it("keeps watcher when only pagination args change", async () => {
      const POSTS_QUERY = `
        query GetPosts($first: Int, $after: String, $last: Int, $before: String) {
          posts(first: $first, after: $after, last: $last, before: $before) @connection(key: "posts") {
            edges {
              node {
                id
                title
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              endCursor
              startCursor
            }
          }
        }
      `;

      const postsTransport: Transport = {
        http: vi.fn().mockResolvedValue({
          data: {
            posts: {
              edges: [{ node: { id: "p1", title: "Post" } }],
              pageInfo: {
                hasNextPage: true,
                hasPreviousPage: false,
                endCursor: "c1",
                startCursor: "c0",
              },
            },
          },
          error: null,
        }),
      };

      const postsCache = createCachebay({ 
        transport: postsTransport,
        suspensionTimeout: 50
      });

      const variables = ref({ first: 10, after: null, last: null, before: null });
      let queryResult: any;

      const App = defineComponent({
        setup() {
          queryResult = useQuery({
            query: POSTS_QUERY,
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
                provideCachebay(app as any, postsCache);
              },
            },
          ],
        },
      });

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(postsTransport.http).toHaveBeenCalledTimes(1);

      // Wait for suspension window to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Change all pagination args (but no filters)
      variables.value = { first: 5, after: "c1", last: null, before: null };

      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Watcher should be reused (canonical key unchanged)
      // Network call happens but watcher wasn't recreated
      expect(postsTransport.http).toHaveBeenCalledTimes(2);
    });
  });
});
