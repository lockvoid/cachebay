import { mount } from "@vue/test-utils";
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
    expect(PostList.errorUpdates.at(-1)?.message).toBe("🥲");

    // No data was emitted
    expect(PostList.dataUpdates.length).toBe(1);

    // No phantom edges
    expect(getEdges(wrapper, "title")).toEqual([]);

    // Renders may include loading+error; just ensure at least one happened.
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

    // Let B resolve first
    await delay(15);

    // Should have at least one data emission, no error
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
});
