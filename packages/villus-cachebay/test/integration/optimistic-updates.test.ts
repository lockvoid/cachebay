import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { useQuery } from "villus";
import {
  mountWithClient,
  seedCache,
  tick,
  type Route,
  fixtures,
  operations,
} from "@/test/helpers";
import { createCache } from "@/src/core/internals";

// Small reader that lists canonical posts (thanks to @connection)
const CanonPosts = defineComponent({
  name: "CanonPosts",
  props: { first: Number, after: String },
  setup(props) {
    const { data } = useQuery({
      query: operations.POSTS_QUERY,
      variables: props,
      cachePolicy: "cache-first",
    });
    return () =>
      (data.value?.posts?.edges || []).map((e: any) =>
        h("div", { class: "row", key: e?.node?.id }, e?.node?.title || "")
      );
  },
});

// Minimal fragment for entity checks via cache.readFragment/writeFragment
const FRAG_POST = operations.POST_FRAGMENT; // fragment PostFields on Post { id title tags }

const rows = (wrapper: any) => wrapper.findAll(".row").map((n: any) => n.text());

describe("Integration • Optimistic updates (entities & canonical connections)", () => {
  // ————————————————————————————————————————————————————————————————————————
  // Entity ops
  // ————————————————————————————————————————————————————————————————————————
  it("Entity: patch+commit then revert restores previous snapshot", async () => {
    const cache = createCache();

    // baseline: missing
    const empty0 = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty0 === undefined) {
      expect(empty0).toBeUndefined();
    } else {
      expect(typeof empty0).toBe("object");
      expect(Object.keys(empty0).length).toBe(0);
    }

    const T = cache.modifyOptimistic((tx) => {
      tx.patch("Post:1", { __typename: "Post", id: "1", title: "Post A" }, { mode: "merge" });
    });
    T.commit?.();
    await tick(2);
    expect(cache.readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post A");

    T.revert?.();
    await tick(2);
    const empty1 = cache.readFragment({ id: "Post:1", fragment: FRAG_POST });
    if (empty1 === undefined) {
      expect(empty1).toBeUndefined();
    } else {
      expect(typeof empty1).toBe("object");
      expect(Object.keys(empty1).length).toBe(0);
    }
  });

  it("Entity layering (T1 -> T2 -> revert T1 -> revert T2)", async () => {
    const cache = createCache();

    const T1 = cache.modifyOptimistic((tx) => {
      tx.patch("Post:1", { __typename: "Post", id: "1", title: "Post A" }, { mode: "merge" });
    });
    const T2 = cache.modifyOptimistic((tx) => {
      tx.patch("Post:1", { __typename: "Post", id: "1", title: "Post B" }, { mode: "merge" });
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
    if (empty === undefined) {
      expect(empty).toBeUndefined();
    } else {
      expect(typeof empty).toBe("object");
      expect(Object.keys(empty).length).toBe(0);
    }
  });

  it("Entity layering (T1 -> T2 -> revert T2 -> revert T1) returns baseline", async () => {
    const cache = createCache();

    const T1 = cache.modifyOptimistic((tx) => {
      tx.patch("Post:1", { __typename: "Post", id: "1", title: "Post A" }, { mode: "merge" });
    });
    const T2 = cache.modifyOptimistic((tx) => {
      tx.patch("Post:1", { __typename: "Post", id: "1", title: "Post B" }, { mode: "merge" });
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
    if (empty === undefined) {
      expect(empty).toBeUndefined();
    } else {
      expect(typeof empty).toBe("object");
      expect(Object.keys(empty).length).toBe(0);
    }
  });

  // ————————————————————————————————————————————————————————————————————————
  // Canonical connection (root Query.posts — infinite union anchored at leader)
  // ————————————————————————————————————————————————————————————————————————
  it("Canonical connection: prepend/remove/patch; UI (canonical) updates accordingly", async () => {
    const cache = createCache();

    // Seed two pages → canonical union already P1,P2,P3,P4 (anchored at leader)
    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: null },
      data: {
        __typename: "Query",
        posts: fixtures.posts.connection(["Post 1", "Post 2"], { fromId: 1 }),
      },
    });
    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { first: 2, after: "c2" },
      data: {
        __typename: "Query",
        posts: fixtures.posts.connection(["Post 3", "Post 4"], { fromId: 3 }),
      },
    });

    const { wrapper, fx } = await mountWithClient(CanonPosts, [] as Route[], cache);

    // The reader shows canonical, i.e. union of seeded pages
    await wrapper.setProps({ first: 2, after: null });
    await tick(2);
    expect(rows(wrapper)).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    // Optimistic canonical edits: prepend a node, remove Post 1, patch pageInfo
    const T = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.prepend({ __typename: "Post", id: "9", title: "Prepended" }, { cursor: "c9" });
      c.remove({ __typename: "Post", id: "1" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c9", __typename: "PageInfo" },
      }));
    });
    T.commit?.();
    await tick(2);

    // Canonical view reflects ops
    expect(rows(wrapper)).toEqual(["Prepended", "Post 2", "Post 3", "Post 4"]);

    await fx.restore();
  });

  it("Canonical connection: invalid nodes are ignored safely (no typename/id)", async () => {
    const cache = createCache();
    const { wrapper, fx } = await mountWithClient(CanonPosts, [] as Route[], cache);
    await tick(2);
    expect(rows(wrapper)).toEqual([]);

    const T = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      // both ignored — invalid identity
      c.append({ id: "1", title: "NoType" } as any, { cursor: "x" });
      c.prepend({ __typename: "Post", title: "NoId" } as any, { cursor: "y" });
    });
    T.commit?.();
    await tick(2);
    expect(rows(wrapper)).toEqual([]);

    await fx.restore();
  });

  it("Canonical layering: T1 adds 2, T2 adds 1; revert T1 preserves T2; revert T2 → baseline", async () => {
    const cache = createCache();

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: {},                            // no cursors => canonical
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
    expect(rows(wrapper)).toEqual([]);

    const T1 = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.append({ __typename: "Post", id: "1", title: "Post 1" }, { cursor: "c1" });
      c.append({ __typename: "Post", id: "2", title: "Post 2" }, { cursor: "c2" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", hasNextPage: true, __typename: "PageInfo" },
      }));
    });

    const T2 = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.append({ __typename: "Post", id: "3", title: "Post 3" }, { cursor: "c3" });
      c.patch((prev) => ({
        pageInfo: { ...(prev.pageInfo || {}), endCursor: "c3", hasNextPage: false, __typename: "PageInfo" },
      }));
    });

    T1.commit?.();
    T2.commit?.();
    await tick(2);
    expect(rows(wrapper)).toEqual(["Post 1", "Post 2", "Post 3"]);

    // Revert T1 → keep T2 in place. Give the view a second frame to settle.
    T1.revert?.();
    await tick(2);

    const canKey = "@connection.posts({})";
    const can = (cache as any).__internals.graph.getRecord(canKey);
    const edgeKeys = Array.isArray(can?.edges) ? can.edges.map((r: any) => r.__ref) : [];
    const nodeRefs = edgeKeys.map((ek: string) => (cache as any).__internals.graph.getRecord(ek)?.node?.__ref);

    expect(rows(wrapper)).toEqual(["Post 3"]);

    // Revert T2 → back to baseline (empty)
    T2.revert?.();
    await tick(2);
    expect(rows(wrapper)).toEqual([]);

    await fx.restore();
  });
});
