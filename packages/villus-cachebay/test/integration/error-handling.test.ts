import { mount } from "@vue/test-utils";
import { createTestClient, createConnectionComponent, getEdges, fixtures, operations, delay } from "@/test/helpers";

describe("Error Handling", () => {
  it("records transport errors without empty emissions", async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { error: new Error("🥲") };
        },
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",

      connectionFn: (data) => {
        return data.posts;
      },
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client],
      },
    });

    await delay(20);

    expect(PostList.errors.length).toBe(1);
    expect(PostList.renders.length).toBe(0);

    await fx.restore();
  });

  it("drops older errors when newer data arrives", async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { error: new Error("🥲") };
        },
        delay: 30,
      },
      {
        when: ({ variables }) => {
          return variables.first === 3 && !variables.after;
        },
        respond: () => {
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]) } };
        },
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",

      connectionFn: (data) => {
        return data.posts;
      },
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client],
      },
    });

    await wrapper.setProps({ first: 3 });

    await delay(14);
    expect(PostList.renders.length).toBe(1);
    expect(PostList.errors.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await delay(25);
    expect(PostList.errors.length).toBe(0);
    expect(PostList.renders.length).toBe(1);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await fx.restore();
  });

  it("ignores cursor page errors and preserves successful data", async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]) } };
        },
        delay: 5,
      },
      {
        when: ({ variables }) => {
          return variables.first === 2 && variables.after === "c1";
        },
        respond: () => {
          return { error: new Error("Cursor page failed") };
        },
        delay: 30,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",

      connectionFn: (data) => {
        return data.posts;
      },
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client],
      },
    });

    await wrapper.setProps({ first: 2, after: "c1" });
    await wrapper.setProps({ first: 2, after: null });

    await delay(14);

    expect(PostList.renders.length).toBe(1);
    expect(PostList.errors.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await delay(25);
    expect(PostList.errors.length).toBe(0);
    expect(PostList.renders.length).toBe(1);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1"]);

    await fx.restore();
  });

  it.skip("handles transport reordering with later responses overwriting earlier ones", async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }, { title: "Post 2", id: "2" }]) } };
        },
        delay: 50,
      },
      {
        when: ({ variables }) => {
          return variables.first === 3 && !variables.after;
        },
        respond: () => {
          return { error: new Error("🥲") };
        },
        delay: 5,
      },
      {
        when: ({ variables }) => {
          return variables.first === 4 && !variables.after;
        },
        respond: () => {
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }, { title: "Post 2", id: "2" }, { title: "Post 3", id: "3" }, { title: "Post 4", id: "4" }]) } };
        },
        delay: 20,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "network-only",

      connectionFn: (data) => {
        return data.posts;
      },
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },
      global: {
        plugins: [client],
      },
    });

    await wrapper.setProps({ first: 2 });
    await wrapper.setProps({ first: 3 });
    await wrapper.setProps({ first: 4 });

    await delay(12);
    expect(PostList.errors.length).toBe(0);
    expect(PostList.renders.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual([]);

    await delay(25);
    expect(PostList.renders.length).toBe(1);
    expect(PostList.errors.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    await delay(35);
    expect(PostList.renders.length).toBe(1);
    expect(PostList.errors.length).toBe(0);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2"]);

    await fx.restore();
  });
});
