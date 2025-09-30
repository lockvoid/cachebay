import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, createDetailComponent, seedCache, getEdges, getPageInfo, fixtures, operations, delay, tick } from '@/test/helpers';

describe("Optimistic updates", () => {
  it("Entity: patch+commit then revert restores previous snapshot", async () => {
    const { cache } = createTestClient();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });

    expect(post_1).toEqual({});

    const tx = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });
    });

    tx.commit();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });

    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post 1" });

    tx.revert();

    const post_4 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });

    expect(post_4).toEqual({});
  });

  it("Entity layering (tx1 -> tx2 -> revert tx1 -> revert tx2)", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "1", title: "Post A" });
    });

    const tx2 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B" });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx1.revert();

    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx2.revert();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_3).toEqual({});
  });

  it("Entity layering (tx1 -> tx2 -> revert tx2 -> revert tx1) returns baseline", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post A" });
    });

    const tx2 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B" });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx2.revert();

    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post A" });

    tx1.revert();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_3).toEqual({});
  });

  it("Canonical connection: add/remove/patch; UI (canonical) updates accordingly", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,

      variables: {
        first: 2,
        after: null,
      },

      data: {
        __typename: "Query",

        posts: fixtures.posts.buildConnection([
          { __typename: "Post", id: "p1", title: "Post 1" },
          { __typename: "Post", id: "p2", title: "Post 2" },
        ]),
      },
    });

    await seedCache(cache, {
      query: operations.POSTS_QUERY,

      variables: {
        first: 2,
        after: 'p2',
      },

      data: {
        __typename: "Query",

        posts: fixtures.posts.buildConnection([
          { __typename: "Post", id: "p3", title: "Post 3" },
          { __typename: "Post", id: "p4", title: "Post 4" },
        ]),
      },
    });

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
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    const tx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      c.addNode({ __typename: "Post", id: "p5", title: "Post 5" }, { position: "start" });

      c.removeNode({ __typename: "Post", id: "p1" });

      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), startCursor: "p5" },
      }));
    });

    tx.commit();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 5", "Post 2", "Post 3", "Post 4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: "p5", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });
  });

  it("Canonical connection: invalid nodes are ignored safely (no typename/id)", async () => {
    const { client, cache } = createTestClient();

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
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    const tx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      c.addNode({ id: "p2", title: "Post 1" }, { position: "end" });

      c.addNode({ id: "p1", __typename: "Post", title: "Post 2" }, { position: "start" });
    });

    tx.commit();

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["Post 2"]);
  });

  it("Canonical layering: tx1 adds 2, tx2 adds 1; revert tx1 preserves tx2; revert tx2 → baseline", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,

      variables: {},

      data: {
        __typename: "Query",

        posts: fixtures.posts.buildConnection([])
      },
    });

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
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    const tx1 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });

      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", hasNextPage: true },
      }));
    });

    const tx2 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "end" });

      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c3", hasNextPage: false },
      }));
    });

    tx1.commit();
    tx2.commit();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2", "Post 3"]);

    tx1.revert();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 3"]);

    tx2.revert();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);
  });

  it("full flow: pages, optimistic remove, filters, window growth, late page change", async () => {
    let requestIndex = 0;

    const routes = [
      {
        when: () => {
          return requestIndex === 0 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa1', title: 'A1' },
            { id: 'pa2', title: 'A2' },
            { id: 'pa3', title: 'A3' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 1 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa4', title: 'A4' },
            { id: 'pa5', title: 'A5' },
            { id: 'pa6', title: 'A6' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 2 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa7', title: 'A7' },
            { id: 'pa8', title: 'A8' },
            { id: 'pa9', title: 'A9' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 3 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pb1', title: 'B1' },
            { id: 'pb2', title: 'B2' },
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 4 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa1', title: 'A1' },
            { id: 'pa2', title: 'A2' },
            { id: 'pa3', title: 'A3' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 5 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa4', title: 'A4' },
            { id: 'pa5', title: 'A5' },
            { id: 'pa6', title: 'A6' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },
      },

      {
        when: () => {
          return requestIndex === 6 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pb1', title: 'B1' },
            { id: 'pb2', title: 'B2' },
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 7 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa1', title: 'A1' },
            { id: 'pa2', title: 'A2' },
            { id: 'pa3', title: 'A3' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 8 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa4', title: 'A4' },
            { id: 'pa6', title: 'A6' },
            { id: 'pa7', title: 'A7' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 5,
      },

      {
        when: () => {
          return requestIndex === 9 && (requestIndex++, true);
        },

        respond: () => {
          const posts = [
            { id: 'pa8', title: 'A8' },
            { id: 'pa9', title: 'A9' },
            { id: 'pa10', title: 'A10' }
          ];

          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },

        delay: 10,
      },
    ];

    const { client, cache } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const wrapper = mount(Cmp, {
      props: {
        category: "A",
        first: 3,
        after: null,
      },

      global: {
        plugins: [client, cache],
      },
    });

    await delay(7);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });

    await delay(7);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    const removeTx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } })

      c.removeNode({ __typename: "Post", id: "pa5" });
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ category: "A", first: 3, after: "pa6" });

    await delay(7);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    await wrapper.setProps({ category: "B", first: 2, after: null });

    await delay(9);
    expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

    await wrapper.setProps({ category: "A", first: 3, after: null });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    await delay(31);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await delay(41);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ category: "B", first: 2, after: null });
    await delay(6);
    expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

    await wrapper.setProps({ category: "A", first: 3, after: null });

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await delay(6);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    removeTx.commit();

    const addTx = (cache as any).modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });

      c.addNode({ __typename: "Post", id: "pa0", title: "A0" }, { position: "start" });
      c.addNode({ __typename: "Post", id: "pa100", title: "A100" }, { position: "end" });
    });

    await delay(6);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);

    await wrapper.setProps({ category: "A", first: 3, after: "pa7" });

    await tick(5);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);

    await delay(16);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10", "A100"]);

    addTx.revert();

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);
  });
});
