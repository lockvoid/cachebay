import { describe, it, expect } from "vitest";
import { defineComponent, h, computed } from "vue";
import gql from "graphql-tag";
import { useQuery } from "villus";
import {
  mountWithClient,
  seedCache,
  tick,
  delay,
  type Route,
  fixtures,
  operations,
  rowsByClass,
  rowsNoPI,
  CanonPosts,
  PostsHarness,
  POSTS_APPEND_OPTIMISTIC,
} from "@/test/helpers";
import { createCache } from "@/src/core/internals";

const FRAG_POST = operations.POST_FRAGMENT;

describe("Integration • Optimistic updates (entities & canonical connections)", () => {
  it("Entity: patch+commit then revert restores previous snapshot", async () => {
    const cache = createCache();

    const empty0 = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty0 === undefined) expect(empty0).toBeUndefined();
    else {
      expect(typeof empty0).toBe("object");
      expect(Object.keys(empty0).length).toBe(0);
    }

    const T = cache.modifyOptimistic((tx) => {
      tx.patch(
        "Post:1",
        { __typename: "Post", id: "1", title: "Post A" },
        { mode: "merge" }
      );
    });
    T.commit?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post A");

    T.revert?.();
    await tick(2);
    const empty1 = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty1 === undefined) expect(empty1).toBeUndefined();
    else {
      expect(typeof empty1).toBe("object");
      expect(Object.keys(empty1).length).toBe(0);
    }
  });

  it("Entity layering (T1 -> T2 -> revert T1 -> revert T2)", async () => {
    const cache = createCache();

    const T1 = cache.modifyOptimistic((tx) => {
      tx.patch(
        "Post:1",
        { __typename: "Post", id: "1", title: "Post A" },
        { mode: "merge" }
      );
    });
    const T2 = cache.modifyOptimistic((tx) => {
      tx.patch(
        "Post:1",
        { __typename: "Post", id: "1", title: "Post B" },
        { mode: "merge" }
      );
    });

    T1.commit?.();
    T2.commit?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T1.revert?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T2.revert?.();
    await tick(2);
    const empty = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty === undefined) expect(empty).toBeUndefined();
    else {
      expect(typeof empty).toBe("object");
      expect(Object.keys(empty).length).toBe(0);
    }
  });

  it("Entity layering (T1 -> T2 -> revert T2 -> revert T1) returns baseline", async () => {
    const cache = createCache();

    const T1 = cache.modifyOptimistic((tx) => {
      tx.patch(
        "Post:1",
        { __typename: "Post", id: "1", title: "Post A" },
        { mode: "merge" }
      );
    });
    const T2 = cache.modifyOptimistic((tx) => {
      tx.patch(
        "Post:1",
        { __typename: "Post", id: "1", title: "Post B" },
        { mode: "merge" }
      );
    });

    T1.commit?.();
    T2.commit?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T2.revert?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post A");

    T1.revert?.();
    await tick(2);
    const empty = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty === undefined) expect(empty).toBeUndefined();
    else {
      expect(typeof empty).toBe("object");
      expect(Object.keys(empty).length).toBe(0);
    }
  });

  it("Canonical connection: add/remove/patch; UI (canonical) updates accordingly", async () => {
    const cache = createCache();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: { __typename: "Query", posts: fixtures.posts.connection(["Post 1", "Post 2"], { fromId: 1 }) },
    });
    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: "c2" },
      data: { __typename: "Query", posts: fixtures.posts.connection(["Post 3", "Post 4"], { fromId: 3 }) },
    });

    const { wrapper, fx } = await mountWithClient(CanonPosts, [] as Route[], cache);

    await wrapper.setProps({ first: 2, after: null });
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    const T = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "9", title: "Prepended" }, { position: "start" });
      c.removeNode({ __typename: "Post", id: "1" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c9", __typename: "PageInfo" },
      }));
    });
    T.commit?.();
    await tick(2);

    expect(rowsByClass(wrapper)).toEqual(["Prepended", "Post 2", "Post 3", "Post 4"]);
    await fx.restore();
  });

  it("Canonical connection: invalid nodes are ignored safely (no typename/id)", async () => {
    const cache = createCache();
    const { wrapper, fx } = await mountWithClient(CanonPosts, [] as Route[], cache);
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    const T = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.addNode({ id: "1", title: "NoType" } as any, { position: "end" });
      c.addNode({ __typename: "Post", title: "NoId" } as any, { position: "start" });
    });
    T.commit?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    await fx.restore();
  });

  it("Canonical layering: T1 adds 2, T2 adds 1; revert T1 preserves T2; revert T2 → baseline", async () => {
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

    const T1 = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "1", title: "Post 1" }, { position: "end" });
      c.addNode({ __typename: "Post", id: "2", title: "Post 2" }, { position: "end" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", hasNextPage: true, __typename: "PageInfo" },
      }));
    });

    const T2 = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "3", title: "Post 3" }, { position: "end" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c3", hasNextPage: false, __typename: "PageInfo" },
      }));
    });

    T1.commit?.();
    T2.commit?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 1", "Post 2", "Post 3"]);

    T1.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 3"]);

    T2.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    await fx.restore();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * PART 2 — limit window (leader collapse + optimistic reapply)
 * -------------------------------------------------------------------------- */



describe("Integration • limit window (leader collapse + optimistic reapply)", () => {
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

    const Comp = PostsHarness(POSTS_APPEND_OPTIMISTIC, "cache-and-network");
    const { wrapper, fx, cache } = await mountWithClient(Comp, routes, undefined, { filter: "A", first: 3, after: null });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ filter: "A", first: 3, after: "p3" });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    const T = (cache as any).modifyOptimistic((tx: any) => {
      tx.connection({ parent: "Query", key: "posts", filters: { filter: "A" } })
        .removeNode({ __typename: "Post", id: "5" });
    });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ filter: "A", first: 3, after: "p6" });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    await wrapper.setProps({ filter: "B", first: 2, after: null });
    await delay(9);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    await wrapper.setProps({ filter: "A", first: 3, after: null });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);
    await delay(31);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ filter: "A", first: 3, after: "p3" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);
    await delay(41);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await wrapper.setProps({ filter: "B", first: 2, after: null });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    await wrapper.setProps({ filter: "A", first: 3, after: null });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    await wrapper.setProps({ filter: "A", first: 3, after: "p3" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    T.commit?.();

    const Tadd = (cache as any).modifyOptimistic((tx: any) => {
      const c = tx.connection({ parent: "Query", key: "posts", filters: { filter: "A" } });
      c.addNode({ __typename: "Post", id: "0", title: "A0" }, { position: "start" });
      c.addNode({ __typename: "Post", id: "99", title: "A99" }, { position: "end" });
    });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A99"]);
    await fx.restore?.();

    await wrapper.setProps({ filter: "A", first: 3, after: "p7" });
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A99"]);
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A0", "A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10", "A99"]);

    Tadd.revert?.();
    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);
    await fx.restore?.();
  });
});
