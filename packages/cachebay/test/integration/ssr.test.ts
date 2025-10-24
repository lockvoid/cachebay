import { mount } from "@vue/test-utils";
import { createTestClient, createConnectionComponent, createConnectionComponentSuspense, seedCache, getEdges, fixtures, operations, delay, tick } from "@/test/helpers";

const ssrRoundtrip = async ({ routes }) => {
  // 1

  const serverClient = createTestClient({
    cacheOptions: {
      suspensionTimeout: 1,
    },
  });

  await seedCache(serverClient.cache, {
    query: operations.POSTS_QUERY,

    variables: {
      category: "lifestyle",
      first: 2,
      after: null,
    },

    data: {
      __typename: "Query",

      posts: fixtures.posts.buildConnection([{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }]),
    },
  });

  const snapshot = serverClient.cache.dehydrate();

  // 2

  const clientClient = createTestClient({
    routes,

    cacheOptions: {
      suspensionTimeout: 1,
      hydrationTimeout: 10,
    },
  });

  clientClient.cache.hydrate(snapshot);

  return clientClient;
};

const routes = [
  {
    when: ({ variables }) => {
      return variables.category === "lifestyle" && !variables.after && variables.first === 2;
    },

    respond: () => {
      return {
        data: {
          __typename: "Query",

          posts: fixtures.posts.buildConnection([{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }]),
        },
      };
    },
  },

  {
    when: ({ variables }) => {
      return variables.category === "music" && !variables.after && variables.first === 2;
    },

    respond: () => {
      return {
        data: {
          __typename: "Query",

          posts: fixtures.posts.buildConnection([{ id: "p3", title: "B1" }, { id: "p4", title: "B2" }]),
        },
      };
    },
  },
];

describe("SSR", () => {
  describe("Suspense", () => {
    describe("cache-and-network", () => {
      it("renders cached data immediately after hydration without network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-and-network",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("displays cached data without making network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-first",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("displays cached data during hydration, then fetches after hydration window", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "network-only",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        // During hydration - shows cached data, no network request
        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // After hydration window (100ms) - network request fires
        await delay(120);
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("displays cached data without making network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-only",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });
  });

  describe("Non-suspense", () => {
    describe("cache-and-network", () => {
      it.only("renders cached data immediately without network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-and-network",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await delay(5);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);
        expect(Cmp.dataUpdates.length).toBe(1);
        expect(Cmp.errorUpdates.length).toBe(0);
        expect(Cmp.renders.count).toBe(1);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);
        expect(Cmp.dataUpdates.length).toBe(1);
        expect(Cmp.errorUpdates.length).toBe(0);
        expect(Cmp.renders.count).toBe(1);

        wrapper.setProps({ category: "music", first: 2, after: "pa2" });

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);
        expect(fx.calls.length).toBe(1);
        expect(Cmp.dataUpdates.length).toBe(1);
        expect(Cmp.errorUpdates.length).toBe(0);
        expect(Cmp.renders.count).toBe(1);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("displays cached data without making network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-first",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("displays cached data during hydration, then fetches after hydration window", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "network-only",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        // During hydration - shows cached data, no network request
        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // After hydration window (100ms) - network request fires
        await delay(120);
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("displays cached data without making network requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-only",

          connectionFn: (data) => {
            return data.posts;
          },
        });

        const wrapper = mount(Cmp, {
          props: {
            first: 2,
            after: null,
          },

          global: {
            plugins: [client],
          },
        });

        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });
  });
});
