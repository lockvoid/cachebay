import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  seedCache,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

describe("Optimistic updates (Svelte)", () => {
  it("applies entity patch; commit persists; revert after commit is a no-op", async () => {
    const { cache } = createTestClient();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toBe(null);

    const tx = cache.modifyOptimistic((o: any) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", flags: [] });
    });

    tx.commit();

    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [] });
    tx.revert();

    const post_4 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_4).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [] });
  });

  it("layers entity transactions; commit persists, reverts after commit are no-ops", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o: any) => {
      o.patch("Post:p1", { __typename: "Post", id: "1", title: "Post A", flags: [] });
    });

    const tx2 = cache.modifyOptimistic((o: any) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B", flags: [] });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });

    tx1.revert();
    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });

    tx2.revert();
    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });
  });

  it("commit persists; reverting committed layers in any order does not change state", async () => {
    const { cache } = createTestClient();

    const tx1 = cache.modifyOptimistic((o: any) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post A", flags: [] });
    });

    const tx2 = cache.modifyOptimistic((o: any) => {
      o.patch("Post:p1", { __typename: "Post", id: "p1", title: "Post B", flags: [] });
    });

    tx1.commit();
    tx2.commit();

    const post_1 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_1).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });

    tx2.revert();
    const post_2 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_2).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });

    tx1.revert();
    const post_3 = cache.readFragment({ id: "Post:p1", fragment: operations.POST_FRAGMENT });
    expect(post_3).toEqual({ __typename: "Post", id: "p1", title: "Post B", flags: [] });
  });

  it("modifies canonical connection by adding, removing, and patching nodes with UI updates", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
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
      variables: { first: 2, after: "p2" },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([
          { __typename: "Post", id: "p3", title: "Post 3" },
          { __typename: "Post", id: "p4", title: "Post 4" },
        ]),
      },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    expect(getTitles()).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);
    expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p5", title: "Post 5" }, { position: "start" });
      c.removeNode({ __typename: "Post", id: "p1" });
      c.patch((prev: any) => ({
        pageInfo: { ...(prev.pageInfo || {}), startCursor: "p5" },
      }));
    });

    tx.commit();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Post 5", "Post 2", "Post 3", "Post 4"]);
    expect(getPI()).toEqual({ startCursor: "p5", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    q.dispose();
  });

  it("ignores invalid nodes safely when they lack required typename or id", async () => {
    const { cache } = createTestClient();

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

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual([]);

    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ id: "p2", title: "Post 1" } as any, { position: "end" });
      c.addNode({ id: "p1", __typename: "Post", title: "Post 2" }, { position: "start" });
    });
    tx.commit();

    await tick(2);
    flushSync();

    expect(getTitles()).toEqual(["Post 2"]);

    q.dispose();
  });

  it("layers canonical connection transactions and preserves correct state when reverting", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: {},
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual([]);

    const tx1 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      c.patch((prev: any) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", hasNextPage: true },
      }));
    });

    const tx2 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "end" });
      c.patch((prev: any) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c3", hasNextPage: false },
      }));
    });

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Post 1", "Post 2", "Post 3"]);

    tx1.revert();
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Post 3"]);

    tx2.revert();
    await tick();
    flushSync();

    expect(getTitles()).toEqual([]);

    q.dispose();
  });

  it("commit(data) replaces a temp node with server node on a connection", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual([]);

    const tx = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      const id = data?.id ?? "temp-1";
      const title = data?.title ?? "Temp Title";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });
    });

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Temp Title"]);

    tx.commit({ id: "p100", title: "Server Title" });

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Server Title"]);

    q.dispose();
  });

  it("commit(data) with multiple layers keeps order", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 4, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual([]);

    // L1: temp at start
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
    flushSync();

    expect(getTitles()).toEqual(["Draft X", "Stable P2"]);

    tx1.commit({ id: "p1", title: "Real P1" });
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Real P1", "Stable P2"]);

    tx2.revert();
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Real P1"]);

    q.dispose();
  });

  it("commit(data) for entities: optimistic draft → commit final; revert after commit is no-op", async () => {
    const { cache } = createTestClient();

    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT })).toBe(null);

    const tx = cache.modifyOptimistic((o: any, { data }: any) => {
      const title = data?.title ?? "Draft Title";
      o.patch("Post:x1", { __typename: "Post", id: "x1", title, flags: [1] }, { mode: "merge" });
    });

    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Draft Title", flags: [1] });

    tx.commit({ title: "Final Title" });
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Final Title", flags: [1] });

    tx.revert();
    expect(cache.readFragment({ id: "Post:x1", fragment: operations.POST_FRAGMENT }))
      .toEqual({ __typename: "Post", id: "x1", title: "Final Title", flags: [1] });
  });

  it("commit(data) applies connection patch and node add in the same builder", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => q.data?.posts?.pageInfo;

    expect(getTitles()).toEqual([]);

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
    flushSync();

    expect(getTitles()).toEqual(["Temp 99"]);

    tx.commit({ id: "p99", title: "Server 99" });
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Server 99"]);
    expect(getPI()?.endCursor).toBe("p99");

    q.dispose();
  });

  it("commit() with no data replays the same builder write-through (idempotent)", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: { __typename: "Query", posts: fixtures.posts.buildConnection([]) },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual([]);

    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "px", title: "PX" }, { position: "end" });
    });

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["PX"]);

    tx.commit(); // no data
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["PX"]);

    q.dispose();
  });

  it("commit(data) ordering with competing layers on same connection", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([{ id: "p2", title: "P2" }]),
      },
    });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    expect(getTitles()).toEqual(["P2"]);

    const t1 = cache.modifyOptimistic((o: any, { data }: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      const id = data?.id ?? "temp-1";
      const title = data?.title ?? "Temp 1";
      c.addNode({ __typename: "Post", id, title }, { position: "start" });
    });

    const t2 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p3", title: "P3" }, { position: "after", anchor: "Post:p2" });
    });

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["Temp 1", "P2", "P3"]);

    t1.commit({ id: "p1", title: "P1" });
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["P1", "P2", "P3"]);

    t2.revert();
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["P1", "P2"]);

    q.dispose();
  });

  it("handles complex flow with pagination, optimistic updates, filtering, and dynamic changes", async () => {
    let requestIndex = 0;

    const routes = [
      { when: () => requestIndex === 0 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } }), delay: 20 },
      { when: () => requestIndex === 1 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa4", title: "A4" }, { id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }]) } }), delay: 20 },
      { when: () => requestIndex === 2 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa7", title: "A7" }, { id: "pa8", title: "A8" }, { id: "pa9", title: "A9" }]) } }), delay: 20 },
      { when: () => requestIndex === 3 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pb1", title: "B1" }, { id: "pb2", title: "B2" }]) } }), delay: 20 },
      { when: () => requestIndex === 4 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } }), delay: 20 },
      { when: () => requestIndex === 5 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa4", title: "A4" }, { id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }]) } }), delay: 20 },
      { when: () => requestIndex === 6 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pb1", title: "B1" }, { id: "pb2", title: "B2" }]) } }), delay: 20 },
      { when: () => requestIndex === 7 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } }), delay: 20 },
      { when: () => requestIndex === 8 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa4", title: "A4" }, { id: "pa6", title: "A6" }, { id: "pa7", title: "A7" }]) } }), delay: 20 },
      { when: () => requestIndex === 9 && (requestIndex++, true), respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa8", title: "A8" }, { id: "pa9", title: "A9" }, { id: "pa10", title: "A10" }]) } }), delay: 20 },
    ];

    let currentCategory = $state("A");
    let currentFirst = $state(3);
    let currentAfter = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ category: currentCategory, first: currentFirst, after: currentAfter }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    // 1. Initial A leader
    await tick();
    flushSync();
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3"]);

    // 2. Paginate after pa3
    currentAfter = "pa3";
    flushSync();
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 3. Optimistic remove A5
    const removeTx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });
      c.removeNode({ __typename: "Post", id: "pa5" });
    });
    await delay(10);
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 4. Continue after pa6
    currentAfter = "pa6";
    flushSync();
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    // 5. Switch to B
    currentCategory = "B";
    currentFirst = 2;
    currentAfter = null;
    flushSync();
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["B1", "B2"]);

    // 6. Switch back to A
    currentCategory = "A";
    currentFirst = 3;
    currentAfter = null;
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    // 7. Network refresh resets
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3"]);

    // 8. Re-paginate after pa3
    currentAfter = "pa3";
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3"]);

    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 9. Switch to B again
    currentCategory = "B";
    currentFirst = 2;
    currentAfter = null;
    flushSync();
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["B1", "B2"]);

    // 10. Back to A
    currentCategory = "A";
    currentFirst = 3;
    currentAfter = null;
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 11. Leader refresh resets again
    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3"]);

    // 12. Re-paginate after pa3 (server now returns A7 too)
    currentAfter = "pa3";
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3"]);

    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6", "A7"]);

    // 13. Commit optimistic remove
    removeTx.commit();

    // 14. New optimistic adds
    const addTx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });
      c.addNode({ __typename: "Post", id: "pa0", title: "A0", flags: [] }, { position: "start" });
      c.addNode({ __typename: "Post", id: "pa100", title: "A100", flags: [] }, { position: "end" });
    });

    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);

    // 15. Final pagination: after pa7
    currentAfter = "pa7";
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A100"]);

    await delay(30);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10", "A100"]);

    // 16. Revert optimistic adds
    addTx.revert();
    await delay(10);
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);

    q.dispose();
  });

  it("first render after remount shows cached union; network leader without A4 resets to server slice", async () => {
    let leaderHits = 0;

    const routes = [
      {
        when: ({ variables }: any) => variables?.first === 3 && variables?.after == null && leaderHits === 0,
        respond: () => {
          leaderHits++;
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } };
        },
        delay: 15,
      },
      {
        when: ({ variables }: any) => variables?.first === 3 && variables?.after == null && leaderHits === 1,
        respond: () => {
          leaderHits++;
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } };
        },
        delay: 20,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const getTitles = (q: any) => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    // First mount → leader #1
    let q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3, after: null }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();
    await delay(20);
    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A1", "A2", "A3"]);

    // Commit optimistic A4
    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "pa4", title: "A4", flags: [] }, { position: "start" });
    });
    tx.commit();

    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A4", "A1", "A2", "A3"]);

    // Unmount
    q.dispose();

    // Remount
    q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3, after: null }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A4", "A1", "A2", "A3"]);

    // Leader #2 (without A4) resets
    await delay(25);
    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A1", "A2", "A3"]);

    q.dispose();
    await fx.restore();
  });

  it("first render after remount shows cached union; network leader including A4 keeps it", async () => {
    let leaderHits = 0;

    const routes = [
      {
        when: ({ variables }: any) => variables?.first === 3 && variables?.after == null && leaderHits === 0,
        respond: () => {
          leaderHits++;
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }, { id: "pa3", title: "A3" }]) } };
        },
        delay: 15,
      },
      {
        when: ({ variables }: any) => variables?.first === 3 && variables?.after == null && leaderHits === 1,
        respond: () => {
          leaderHits++;
          return { data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa4", title: "A4" }, { id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }]) } };
        },
        delay: 20,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const getTitles = (q: any) => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

    // First mount
    let q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3, after: null }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();
    await delay(20);
    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A1", "A2", "A3"]);

    // Commit optimistic A4
    const tx = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "pa4", title: "A4", flags: [] }, { position: "start" });
    });
    tx.commit();

    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A4", "A1", "A2", "A3"]);

    // Unmount/remount
    q.dispose();
    q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3, after: null }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A4", "A1", "A2", "A3"]);

    // Leader #2 includes A4
    await delay(25);
    await tick();
    flushSync();

    expect(getTitles(q)).toEqual(["A4", "A1", "A2"]);

    q.dispose();
    await fx.restore();
  });
});
