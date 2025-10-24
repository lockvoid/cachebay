import { mount } from "@vue/test-utils";
import { createTestClient, createConnectionComponent, seedCache, getEdges, getPageInfo, fixtures, operations, delay, tick } from "@/test/helpers";

describe("Optimistic updates", () => {
  it("applies entity patch; commit persists; revert after commit is a no-op", async () => {
    const { cache } = createTestClient();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toBe(null);

    const tx = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });
    });

    tx.commit();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post 1" });

    tx.revert();

    const post_4 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_4).toEqual({ __typename: "Post", id: "p1", title: "Post 1" });
  });

  it("layers entity transactions; commit persists, reverts after commit are no-ops", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "1", title: "Post A" });
    });

    const tx2 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B" });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx1.revert();
    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx2.revert();
    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post B" });
  });

  it("commit persists; reverting committed layers in any order does not change state", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post A" });
    });

    const tx2 = cache.modifyOptimistic((o) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B" });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx2.revert();

    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post B" });

    tx1.revert();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post B" });
  });

  it("modifies canonical connection by adding, removing, and patching nodes with UI updates", async () => {
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
        after: "p2",
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
      },
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

  it("ignores invalid nodes safely when they lack required typename or id", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { category: undefined, sort: undefined, first: 2, after: null },
      data: {
        __typename: "Query",
        posts: {
          __typename: "PostConnection",
          edges: [],
          pageInfo: {
            __typename: "PageInfo",
            startCursor: null,
            endCursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 2, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    const tx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      c.addNode({ id: "p2", title: "Post 1" } as any, { position: "end" });

      c.addNode({ id: "p1", __typename: "Post", title: "Post 2" }, { position: "start" });
    });
    tx.commit();

    await tick(2);
    expect(getEdges(wrapper, "title")).toEqual(["Post 2"]);
  });

  it("layers canonical connection transactions and preserves correct state when reverting", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: {},
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 2, after: null },
      global: { plugins: [client, cache] },
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

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2", "Post 3"]);

    tx1.revert();
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Post 3"]);

    tx2.revert();
    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);
  });

  it("handles complex flow with pagination, optimistic updates, filtering, and dynamic changes", async () => {
    let requestIndex = 0;

    const routes = [
      // 0: A leader
      {
        when: () => requestIndex === 0 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }],
            ),
          },
        }),
        delay: 20,
      },
      // 1: A after pa3
      {
        when: () => requestIndex === 1 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa4", title: "A4" }, { id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }],
            ),
          },
        }),
        delay: 20,
      },
      // 2: A after pa6
      {
        when: () => requestIndex === 2 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa7", title: "A7" }, { id: "pa8", title: "A8" }, { id: "pa9", title: "A9" }],
            ),
          },
        }),
        delay: 20,
      },
      // 3: B leader
      {
        when: () => requestIndex === 3 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ id: "pb1", title: "B1" }, { id: "pb2", title: "B2" }]),
          },
        }),
        delay: 20,
      },
      // 4: A leader refresh (resets canonical to leader slice only)
      {
        when: () => requestIndex === 4 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }],
            ),
          },
        }),
        delay: 20,
      },
      // 5: A after pa3 (still includes pa5; optimistic removal persists in canonical union state)
      {
        when: () => requestIndex === 5 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa4", title: "A4" }, { id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }],
            ),
          },
        }),
        delay: 20,
      },
      // 6: B leader again
      {
        when: () => requestIndex === 6 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ id: "pb1", title: "B1" }, { id: "pb2", title: "B2" }]),
          },
        }),
        delay: 20,
      },
      // 7: A leader refresh again
      {
        when: () => requestIndex === 7 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }],
            ),
          },
        }),
        delay: 20,
      },
      // 8: A after pa3 (server now omits pa5 and includes pa7)
      {
        when: () => requestIndex === 8 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa4", title: "A4" }, { id: "pa6", title: "A6" }, { id: "pa7", title: "A7" }],
            ),
          },
        }),
        delay: 20,
      },
      // 9: A after pa7
      {
        when: () => requestIndex === 9 && (requestIndex++, true),
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "pa8", title: "A8" }, { id: "pa9", title: "A9" }, { id: "pa10", title: "A10" }],
            ),
          },
        }),
        delay: 20,
      },
    ];

    const { client, cache } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { category: "A", first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    // 1. Initial A leader
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    // 2. Paginate after pa3
    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 3. Optimistic remove A5
    const removeTx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });
      c.removeNode({ __typename: "Post", id: "pa5" });
    });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 4. Continue after pa6
    await wrapper.setProps({ category: "A", first: 3, after: "pa6" });
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    // 5. Switch to B
    await wrapper.setProps({ category: "B", first: 2, after: null });
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

    // 6. Switch back to A (serve cached union with optimistic remove)
    await wrapper.setProps({ category: "A", first: 3, after: null });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    // 7. Network refresh (leader) resets canonical to leader slice only
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    // 8. Re-paginate after pa3 with canonical-first: after network page lands show A4 & A6 (pa5 removed optimistically in the past)
    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 9. Switch to B again
    await wrapper.setProps({ category: "B", first: 2, after: null });
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

    // 10. Back to A (cached union shows A4 & A6)
    await wrapper.setProps({ category: "A", first: 3, after: null });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 11. Leader refresh resets again
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    // 12. Re-paginate after pa3 again (server now also returns A7)
    await wrapper.setProps({ category: "A", first: 3, after: "pa3" });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7"]);

    // 13. Commit optimistic remove permanently
    removeTx.commit();

    // 14. New optimistic adds (prepend A0, append A100)
    const addTx = (cache as any).modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });
      c.addNode({ __typename: "Post", id: "pa0", title: "A0", flags: [] }, { position: "start" });
      c.addNode({ __typename: "Post", id: "pa100", title: "A100", flags: [] }, { position: "end" });
    });
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);

    // 15. Final pagination: after pa7
    await wrapper.setProps({ category: "A", first: 3, after: "pa7" });
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);
    await delay(30);
    expect(getEdges(wrapper, "title")).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10", "A100"]);

    // 16. Revert optimistic adds
    addTx.revert();
    await delay(10);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);
  });

  it("commit(data) replaces a temp node with server node on a connection (no duplicate, order preserved)", async () => {
    const { client, cache } = createTestClient();

    // Seed an empty canonical so cache-first can render immediately
    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 2, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    // Optimistic: add temp at start; on commit, re-run with server id/title
    const tx = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      const id = data?.id ?? "temp-1";
      const title = data?.title ?? "Temp Title";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Temp Title"]);

    // Commit with data — should replace temp-1 with server node (no duplicate)
    tx.commit({ id: "p100", title: "Server Title" });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Server Title"]);
  });

  it("commit(data) with multiple layers keeps order: temp→server at start, existing end node intact", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,

      variables: {
        first: 2,
        after: null,
      },

      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 4, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    // L1: temp at start (will become p1 after commit)
    const tx1 = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      const id = data?.id ?? "temp-x";
      const title = data?.title ?? "Draft X";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });
    });

    // L2: permanent node at end
    const tx2 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p2", title: "Stable P2" }, { position: "end" });
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Draft X", "Stable P2"]);

    // Commit L1 with server values
    tx1.commit({ id: "p1", title: "Real P1" });
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Real P1", "Stable P2"]);

    // Revert L2 (still live) → only Real P1 remains
    tx2.revert();
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Real P1"]);
  });

  it("commit(data) for entities: optimistic draft → commit final; revert after commit is no-op", async () => {
    const { cache } = createTestClient();

    // Starts empty
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT })).toBe(null)

    // Builder branches by data presence
    const tx = cache.modifyOptimistic((o: any, { data }: any) => {
      const title = data?.title ?? "Draft Title";
      o.patch("Post:x1", { __typename: "Post", id: "x1", title }, { mode: "merge" });
    });

    // Optimistic visible
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Draft Title" });

    // Commit final value
    tx.commit({ title: "Final Title" });
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Final Title" });

    // Revert after commit is a no-op
    tx.revert();
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Final Title" });
  });

  it("commit(data) applies connection patch and node add in the same builder", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (d) => d.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 2, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    // On optimistic: add temp at start + set endCursor:'temp'
    // On commit(data): add server node + set endCursor to real id
    const tx = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });

      const id = data?.id ?? "tmp-99";
      const title = data?.title ?? "Temp 99";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });

      const end = data?.id ?? "tmp-99";
      c.patch((prev: any) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: end },
      }));
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Temp 99"]);

    // Commit with real id
    tx.commit({ id: "p99", title: "Server 99" });
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Server 99"]);
    // pageInfo.endCursor is set to real id 'p99'
    expect(getPageInfo(wrapper).endCursor).toBe("p99");
  });

  it("commit() with no data replays the same builder write-through (idempotent)", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual([]);

    // Builder does not branch on ctx.data; commit() should leave result unchanged
    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "px", title: "PX" }, { position: "end" });
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["PX"]);

    tx.commit(); // no data
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["PX"]);
  });

  it("commit(data) ordering with competing layers on same connection", async () => {
    const { client, cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([{ id: "p2", title: "P2" }]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-first",
      connectionFn: (data) => data.posts,
    });

    const wrapper = mount(Cmp, {
      props: { first: 2, after: null },
      global: { plugins: [client, cache] },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["P2"]);

    // L1 temp at start → commit to p1
    const t1 = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      const id = data?.id ?? "temp-1";
      const title = data?.title ?? "Temp 1";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });
    });

    // L2 after p2 insert p3
    const t2 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p3", title: "P3" }, { position: "after", anchor: "Post:p2" });
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["Temp 1", "P2", "P3"]);

    t1.commit({ id: "p1", title: "P1" });
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["P1", "P2", "P3"]);

    // Revert t2 (still live) → only P1 and P2 remain
    t2.revert();
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["P1", "P2"]);
  });

  it("first render after remount shows cached union; network leader without A4 resets to server slice", async () => {
    // Two leader responses: #1 A1..A3, #2 A1..A3 (omits A4)
    let leaderHits = 0;
    const routes = [
      {
        when: ({ variables }) =>
          variables?.first === 3 && variables?.after == null && leaderHits === 0,
        respond: () => {
          leaderHits++;
          const posts = [
            { id: "pa1", title: "A1" },
            { id: "pa2", title: "A2" },
            { id: "pa3", title: "A3" },
          ];
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },
        delay: 15,
      },
      {
        when: ({ variables }) =>
          variables?.first === 3 && variables?.after == null && leaderHits === 1,
        respond: () => {
          leaderHits++;
          const posts = [
            { id: "pa1", title: "A1" },
            { id: "pa2", title: "A2" },
            { id: "pa3", title: "A3" },
          ];
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },
        delay: 20,
      },
    ];

    const { client, cache, fx } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => data.posts,
    });

    // First mount → leader #1
    let wrapper = mount(Cmp, {
      props: { first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    // Wait leader #1 → A1,A2,A3
    await delay(20);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    // Commit an optimistic node A4 at start
    const tx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "pa4", title: "A4", flags: [] }, { position: "start" });
    });
    tx.commit();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A4", "A1", "A2", "A3"]);

    // Simulate "revisit": unmount/remount with the same client + cache
    wrapper.unmount();

    wrapper = mount(Cmp, {
      props: { first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    // Immediate cached frame on remount should still show A4 at start
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A4", "A1", "A2", "A3"]);

    // Then leader #2 arrives (omits A4) → reset to server slice
    await delay(25);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    await fx.restore();
  });

  it("first render after remount shows cached union; network leader including A4 keeps it", async () => {
    // Two leader responses: #1 A1..A3, #2 A4 + A1..A2 (server now includes A4)
    let leaderHits = 0;
    const routes = [
      {
        when: ({ variables }) =>
          variables?.first === 3 && variables?.after == null && leaderHits === 0,
        respond: () => {
          leaderHits++;
          const posts = [
            { id: "pa1", title: "A1" },
            { id: "pa2", title: "A2" },
            { id: "pa3", title: "A3" },
          ];
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },
        delay: 15,
      },
      {
        when: ({ variables }) =>
          variables?.first === 3 && variables?.after == null && leaderHits === 1,
        respond: () => {
          leaderHits++;
          // Now server echoes A4 (plus A1,A2)
          const posts = [
            { id: "pa4", title: "A4" },
            { id: "pa1", title: "A1" },
            { id: "pa2", title: "A2" },
          ];
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection(posts) } };
        },
        delay: 20,
      },
    ];

    const { client, cache, fx } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => data.posts,
    });

    // First mount → leader #1
    let wrapper = mount(Cmp, {
      props: { first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    // Wait leader #1 → A1,A2,A3
    await delay(20);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3"]);

    // Commit optimistic A4 at start
    const tx = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "pa4", title: "A4", flags: [] }, { position: "start" });
    });
    tx.commit();

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A4", "A1", "A2", "A3"]);

    // Revisit (unmount/remount)
    wrapper.unmount();
    wrapper = mount(Cmp, {
      props: { first: 3, after: null },
      global: { plugins: [client, cache] },
    });

    // Cached frame → A4 + A1..A3
    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A4", "A1", "A2", "A3"]);

    // Leader #2 includes A4 → A4 remains
    await delay(25);
    expect(getEdges(wrapper, "title")).toEqual(["A4", "A1", "A2"]);

    await fx.restore();
  });
});
