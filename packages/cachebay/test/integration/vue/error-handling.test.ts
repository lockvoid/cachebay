import { mount } from "@vue/test-utils";
import { defineComponent, h, Suspense, onErrorCaptured, ref } from "vue";
import { useQuery } from "@/src/adapters/vue";
import {
  createTestClient,
  createConnectionComponent,
  getEdges,
  fixtures,
  operations,
  delay,
} from "@/test/helpers";

describe("Error Handling (epoch & pagination semantics)", () => {
  it("records transport errors without data emissions on cold network-only", async () => {
    const routes = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",
      connectionFn: (data) => data.posts,
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] },
    });

    await delay(20);

    // Error surfaced
    expect(PostList.errorUpdates.length).toBe(1);
    expect(PostList.errorUpdates.at(-1)?.message).toBe("[Network] 🥲");

    // No data was emitted
    expect(PostList.dataUpdates.length).toBe(1);

    expect(getEdges(wrapper, "title")).toEqual([]);
    expect(PostList.renders.count).toBeGreaterThanOrEqual(1);

    await fx.restore();
  });

  it("drops older errors when newer data arrives (latest-variables win)", async () => {
    const routes = [
      // A: slow error for first=2
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 30,
      },
      // B: quick success for first=3
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]),
          },
        }),
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",
      connectionFn: (data) => data.posts,
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] },
    });

    // Trigger B
    await wrapper.setProps({ first: 3 });

    await delay(15);

    expect(PostList.dataUpdates.length).toBeGreaterThanOrEqual(1);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    // When A's stale error arrives, it's ignored
    await delay(25);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await fx.restore();
  });

  it("ignores cursor page errors and preserves successful base page data", async () => {
    const routes = [
      // Base page succeeds
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]),
          },
        }),
        delay: 5,
      },
      // Next page fails (arrives late)
      {
        when: ({ variables }) => variables.first === 2 && variables.after === "c1",
        respond: () => ({ error: new Error("Cursor page failed") }),
        delay: 30,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",
      connectionFn: (data) => data.posts,
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] },
    });

    // Request next page (will error), then immediately revert to base
    await wrapper.setProps({ first: 2, after: "c1" });
    await wrapper.setProps({ first: 2, after: null });

    // Base result settles
    await delay(14);

    // We should have data, and no error recorded
    expect(PostList.dataUpdates.length).toBeGreaterThanOrEqual(1);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    // When the page error finally lands, keep base data intact, no error surfaced
    await delay(25);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await fx.restore();
  });

  it("handles out-of-order transports, later success overwrites earlier error & earlier success", async () => {
    const routes = [
      // A: first=2 (slow success)
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1", id: "1" },
              { title: "Post 2", id: "2" },
            ]),
          },
        }),
        delay: 50,
      },
      // B: first=3 (fast error)
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 5,
      },
      // C: first=4 (mid success)
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1", id: "1" },
              { title: "Post 2", id: "2" },
              { title: "Post 3", id: "3" },
              { title: "Post 4", id: "4" },
            ]),
          },
        }),
        delay: 20,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",
      connectionFn: (data) => data.posts,
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] },
    });

    // Fire A, then B (error), then C (success) — C must win.
    await wrapper.setProps({ first: 2 });
    await wrapper.setProps({ first: 3 });
    await wrapper.setProps({ first: 4 });

    // Early: B's error might have landed, but we gate by "latest" so it should not surface.
    await delay(12);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual([]);

    // C arrives: final data visible
    await delay(25);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(PostList.dataUpdates.length).toBeGreaterThanOrEqual(1);
    expect(getEdges(wrapper, "title")).toEqual([
      "Post 1",
      "Post 2",
      "Post 3",
      "Post 4",
    ]);

    // A arrives very late; must be ignored
    await delay(35);
    expect(PostList.errorUpdates.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual([
      "Post 1",
      "Post 2",
      "Post 3",
      "Post 4",
    ]);

    await fx.restore();
  });

  it("triggers Vue error boundary (onErrorCaptured) in Suspense mode with network-only error", async () => {
    const routes = [
      {
        when: ({ variables }) => variables.id === "1",
        respond: () => ({ error: new Error("Network timeout") }),
        delay: 5,
      },
    ];

    const { client, fx } = createTestClient({ routes });

    let errorCaptured: Error | null = null;
    let errorCapturedCount = 0;

    // Child component using Suspense (async setup)
    const AsyncChild = defineComponent({
      async setup() {
        const query = await useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        return () => h("div", query.data.value?.user?.email || "No data");
      },
    });

    // Parent component with error boundary
    const Parent = defineComponent({
      setup() {
        const hasError = ref(false);
        const errorMessage = ref("");

        onErrorCaptured((err) => {
          errorCaptured = err as Error;
          errorCapturedCount++;
          hasError.value = true;
          errorMessage.value = err.message;
          return false; // Prevent error from propagating further
        });

        return () =>
          h("div", [
            hasError.value
              ? h("div", { class: "error-boundary" }, `Error: ${errorMessage.value}`)
              : h(Suspense, {}, {
                  default: () => h(AsyncChild),
                  fallback: () => h("div", { class: "loading" }, "Loading..."),
                }),
          ]);
      },
    });

    const wrapper = mount(Parent, {
      global: { plugins: [client] },
    });

    // Initially should show loading
    expect(wrapper.find(".loading").exists()).toBe(true);

    // Wait for error to be caught
    await delay(20);

    // Error should be captured by onErrorCaptured
    expect(errorCapturedCount).toBe(1);
    expect(errorCaptured).not.toBeNull();
    expect(errorCaptured?.message).toContain("Network timeout");

    // Error boundary should display error
    expect(wrapper.find(".error-boundary").exists()).toBe(true);
    expect(wrapper.find(".error-boundary").text()).toContain("Network timeout");

    await fx.restore();
  });

  it("resolves with cached data in Suspense mode when cache-and-network has network error", async () => {
    const routes = [
      {
        when: ({ variables }) => variables.id === "1",
        respond: () => ({ error: new Error("Network failed!") }),
        delay: 10,
      },
    ];

    const { client, cache, fx } = createTestClient({ routes });

    // Pre-populate cache with stale data
    cache.writeQuery({
      query: operations.USER_QUERY,
      variables: { id: "1" },
      data: {
        __typename: "Query",
        user: {
          __typename: "User",
          id: "1",
          email: "cached@example.com",
          name: "Cached User",
        },
      },
    });

    let errorCaptured: Error | null = null;

    // Child component using Suspense (async setup)
    const AsyncChild = defineComponent({
      async setup() {
        const query = await useQuery({
          query: operations.USER_QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network", // Returns cached data immediately, then fetches
        });

        return () =>
          h("div", [
            h("div", { class: "email" }, query.data.value?.user?.email || "No email"),
            query.error.value
              ? h("div", { class: "error-indicator" }, "Network error occurred")
              : null,
          ]);
      },
    });

    // Parent component with error boundary
    const Parent = defineComponent({
      setup() {
        onErrorCaptured((err) => {
          errorCaptured = err as Error;
          return false;
        });

        return () =>
          h(Suspense, {}, {
            default: () => h(AsyncChild),
            fallback: () => h("div", { class: "loading" }, "Loading..."),
          });
      },
    });

    const wrapper = mount(Parent, {
      global: { plugins: [client] },
    });

    // Should show loading initially
    expect(wrapper.find(".loading").exists()).toBe(true);

    // Wait for cache data to resolve Suspense
    await delay(5);

    // Should NOT trigger error boundary because cached data resolved the Suspense
    expect(errorCaptured).toBeNull();

    // Should show cached data
    expect(wrapper.find(".email").text()).toBe("cached@example.com");

    // Wait for network error
    await delay(15);

    // Still should NOT trigger error boundary (network error happens after Suspense resolved)
    expect(errorCaptured).toBeNull();

    // Should still show cached data
    expect(wrapper.find(".email").text()).toBe("cached@example.com");

    // Should show error indicator (error.value is set)
    expect(wrapper.find(".error-indicator").exists()).toBe(true);

    await fx.restore();
  });
});
