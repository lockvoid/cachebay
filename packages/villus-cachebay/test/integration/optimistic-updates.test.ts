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

    tx1.revert?.();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT })

    expect(post_3).toEqual({});
  });

  it.only("Canonical connection: add/remove/patch; UI (canonical) updates accordingly", async () => {
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

  it.only("Canonical connection: invalid nodes are ignored safely (no typename/id)", async () => {
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

    tx.commit?.();

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["Post 2"]);
  });

  it("Canonical layering: tx1 adds 2, tx2 adds 1; revert tx1 preserves tx2; revert tx2 → baseline", async () => {
    const cache = createCache();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: {},
      data: { __typename: "Query", posts: fixtures.posts.connection([]) },
    });

    const Comp = defineComponent({
      setup() {
        const { data } = useQuery({
          query: operations.POSTS_QUERY,
          variables: {},
          cachePolicy: "cache-first",
        });
        return () => [
          (data.value?.posts?.edges || []).map((e: any) =>
            h("div", { class: "row", key: e?.node?.id }, e?.node?.title || "")
          ),
          h("div", { class: "info" }, JSON.stringify(data.value?.posts?.pageInfo || {})),
        ];
      },
    });

    const { wrapper, fx } = await mountWithClient(Comp, [] as Route[], cache);
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    const tx1 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "1", title: "Post 1" }, { position: "end" });
      c.addNode({ __typename: "Post", id: "2", title: "Post 2" }, { position: "end" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", hasNextPage: true, __typename: "PageInfo" },
      }));
    });

    const tx2 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "3", title: "Post 3" }, { position: "end" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c3", hasNextPage: false, __typename: "PageInfo" },
      }));
    });

    tx1.commit?.();
    tx2.commit?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 1", "Post 2", "Post 3"]);

    tx1.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 3"]);

    tx2.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    await fx.restore();
  });

  it("full flow: pages, optimistic remove, filters, window growth, late page change", async () => {
    let requestIndex = 0;

    const routes: Route[] = [
      {
        when: () => (requestIndex === 0 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) } })
      },
      {
        when: () => (requestIndex === 1 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A4", "A5", "A6"], { fromId: 4 }) } })
      },
      {
        when: () => (requestIndex === 2 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A7", "A8", "A9"], { fromId: 7 }) } })
      },
      {
        when: () => (requestIndex === 3 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["B1", "B2"], { fromId: 101 }) } })
      },
      {
        when: () => (requestIndex === 4 ? ((requestIndex += 1), true) : false), delay: 30,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) } })
      },
      {
        when: () => (requestIndex === 5 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.connection([{ title: "A4", id: "4" }, { title: "A5", id: "5" }, { title: "A6", id: "6" }])
          }
        })
      },
      {
        when: () => (requestIndex === 6 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["B1", "B2"], { fromId: 101 }) } })
      },
      {
        when: () => (requestIndex === 7 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) } })
      },
      {
        when: () => (requestIndex === 8 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.connection([{ title: "A4", id: "4" }, { title: "A6", id: "6" }, { title: "A7", id: "7" }])
          }
        })
      },
      {
        when: () => (requestIndex === 9 ? ((requestIndex += 1), true) : false), delay: 5,
        respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.connection(["A8", "A9", "A10"], { fromId: 8 }) } })
      },
    ];

    const Comp = PostsHarness(operations.POSTS_QUERY, "cache-and-network");
    const { wrapper, fx, cache } = await mountWithClient(Comp, routes, undefined, { category: "A", first: 3, after: null });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "p3" });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    const removeTx = (cache as any).modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } })
      c.removeNode({ __typename: "Post", id: "5" });
    });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ category: "A", first: 3, after: "p6" });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    await wrapper.setProps({ category: "B", first: 2, after: null });
    await delay(9);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    await wrapper.setProps({ category: "A", first: 3, after: null });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);
    await delay(31);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "p3" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);
    await delay(41);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ category: "B", first: 2, after: null });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    await wrapper.setProps({ category: "A", first: 3, after: null });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ category: "A", first: 3, after: "p3" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    removeTx.commit?.();

    const addTx = (cache as any).modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });

      c.addNode({ __typename: "Post", id: "0", title: "A0" }, { position: "start" });
      c.addNode({ __typename: "Post", id: "99", title: "A99" }, { position: "end" });
    });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A99"]);
    await fx.restore?.();

    await wrapper.setProps({ category: "A", first: 3, after: "p7" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A99"]);
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10", "A99"]);

    addTx.revert?.();
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);
    await fx.restore?.();
  });
});
