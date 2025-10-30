import { mount } from "@vue/test-utils";
import { createTestClient, createConnectionComponent, createConnectionComponentSuspense, seedCache, getEdges, fixtures, operations, delay, tick } from "@/test/helpers";

const ssrRoundtrip = async ({ routes }) => {
  // 1

  const serverClient = createTestClient({
    cacheOptions: {
      suspensionTimeout: 1,
      hydrationTimeout: 200,
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

  const result = createTestClient({
    routes,

    cacheOptions: {
      suspensionTimeout: 1,
      hydrationTimeout: 200,
    },
  });

  result.cache.hydrate(snapshot);

  return result;
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
      it("swallows cached requests but fires uncached requests during hydration", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data during hydration
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request during hydration
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("swallows cached requests but fires uncached requests during hydration", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data during hydration
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request during hydration
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("swallows cached requests but fires uncached requests during hydration", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("never fires requests, even for uncached data", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. No request fires (cache-only never makes network requests)
        // Suspense keeps showing old data until new data arrives
        await delay(20);
        expect(fx.calls.length).toBe(0); // Still 0
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]); // Suspense shows old data

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. Still no request
        await delay(20);
        expect(fx.calls.length).toBe(0); // Still 0
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]); // Cached data restored

        await fx.restore();
      });
    });
  });

  describe("Non-suspense", () => {
    describe("cache-and-network", () => {
      it("swallows cached requests but fires uncached requests during hydration", async () => {
        const { client, cache, fx } = await ssrRoundtrip({ routes });

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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("swallows cached requests but fires uncached requests during hydration", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data during hydration
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request during hydration
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("swallows cached requests but fires uncached requests during hydration", async () => {
        const { client, cache, fx } = await ssrRoundtrip({ routes });

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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await tick();
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. Request fires for uncached data
        await delay(20);
        expect(fx.calls.length).toBe(1);
        expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. No new request for cached data
        await delay(20);
        expect(fx.calls.length).toBe(1); // Still 1, no new request
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("never fires requests, even for uncached data", async () => {
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
            category: "lifestyle", // cached
          },

          global: {
            plugins: [client],
          },
        });

        // 1. Right after mount - cached data, no request
        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        // 2. Immediately switch to uncached data during hydration
        wrapper.setProps({ category: "music", first: 2, after: null });

        // 3. No request fires (cache-only never makes network requests)
        await delay(20);
        expect(fx.calls.length).toBe(0); // Still 0
        expect(getEdges(wrapper, "title")).toEqual([]); // No data (cache miss)

        // 4. Immediately switch back to cached data
        wrapper.setProps({ category: "lifestyle", first: 2, after: null });

        // 5. Still no request
        await delay(20);
        expect(fx.calls.length).toBe(0); // Still 0
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]); // Cached data restored

        await fx.restore();
      });
    });
  });
});
