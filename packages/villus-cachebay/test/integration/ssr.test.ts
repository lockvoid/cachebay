import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, createConnectionComponentSuspense, seedCache, getEdges, fixtures, operations, delay, tick } from '@/test/helpers';

const ssrRoundtrip = async ({ routes }) => {
  // 1

  const serverClient = createTestClient();

  await seedCache(serverClient.cache, {
    query: operations.POSTS_QUERY,

    variables: {
      first: 2,
      after: null,
    },

    data: {
      __typename: "Query",

      posts: fixtures.posts.buildConnection([{ id: 'p1', title: 'A1' }, { id: 'p2', title: 'A2' }]),
    }
  });

  const snapshot = serverClient.cache.dehydrate();

  // 2

  const clientClient = createTestClient({ routes });

  clientClient.cache.hydrate(snapshot);

  return clientClient;
};

const routes = [
  {
    when: ({ variables }) => {
      return !variables.after && variables.first === 2;
    },

    respond: () => {
      return {
        data: {
          __typename: "Query",

          posts: fixtures.posts.buildConnection([{ id: 'p1', title: 'A1 Updated' }, { id: 'p2', title: 'A2 Updated' }])
        }
      };
    },
  },
];

describe("SSR", () => {
  describe("Suspense", () => {
    describe("cache-and-network", () => {
      it("hydrates from cache; 0 requests during hydration", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-and-network",

          connectionFn: (data) => {
            return data.posts;
          }
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
      it("hydrates from cache; 0 requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-first",

          connectionFn: (data) => {
            return data.posts;
          }
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
      it("1 request after hydrate; final is network", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "network-only",

          connectionFn: (data) => {
            return data.posts;
          }
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
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("hydrates from cache; 0 requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponentSuspense(operations.POSTS_QUERY, {
          cachePolicy: "cache-only",

          connectionFn: (data) => {
            return data.posts;
          }
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
      it("hydrates from cache; 0 requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-and-network",

          connectionFn: (data) => {
            return data.posts;
          }
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

        await tick(2);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("hydrates from cache; 0 requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-first",

          connectionFn: (data) => {
            return data.posts;
          }
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
      it("1 request after hydrate; final is network", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "network-only",

          connectionFn: (data) => {
            return data.posts;
          }
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
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await delay(20);
        expect(getEdges(wrapper, "title")).toEqual(["A1 Updated", "A2 Updated"]);
        expect(fx.calls.length).toBe(1);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("hydrates from cache; 0 requests", async () => {
        const { client, fx } = await ssrRoundtrip({ routes });

        const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
          cachePolicy: "cache-first",

          connectionFn: (data) => {
            return data.posts;
          }
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
