// test/integration/optimistic.integration.test.ts
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
} from "@/test/helpers";
import { createCache } from "@/src/core/internals";

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * -------------------------------------------------------------------------- */

// read rows rendered with a specific CSS class (used by CanonPosts etc.)
const rowsByClass = (wrapper: any, cls = ".row") =>
  wrapper.findAll(cls).map((n: any) => n.text());

// read all <div> texts except the .pi metadata block (used by PostsHarness)
const rowsNoPI = (wrapper: any) =>
  wrapper.findAll("div:not(.pi)").map((n: any) => n.text());

/* ────────────────────────────────────────────────────────────────────────────
 * PART 1 — Integration • Optimistic updates (entities & canonical connections)
 * -------------------------------------------------------------------------- */

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
    expect(rowsByClass(wrapper)).toEqual(["Post 1", "Post 2"]);

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
    expect(rowsByClass(wrapper)).toEqual(["Prepended", "Post 2"]);

    await fx.restore();
  });

  it("Canonical connection: invalid nodes are ignored safely (no typename/id)", async () => {
    const cache = createCache();
    const { wrapper, fx } = await mountWithClient(CanonPosts, [] as Route[], cache);
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    const T = cache.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      // both ignored — invalid identity
      c.append({ id: "1", title: "NoType" } as any, { cursor: "x" });
      c.prepend({ __typename: "Post", title: "NoId" } as any, { cursor: "y" });
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
      variables: {}, // no cursors => canonical
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
    expect(rowsByClass(wrapper)).toEqual(["Post 1", "Post 2", "Post 3"]);

    // Revert T1 → keep T2 in place. Give the view a second frame to settle.
    T1.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual(["Post 3"]);

    // Revert T2 → back to baseline (empty)
    T2.revert?.();
    await tick(2);
    expect(rowsByClass(wrapper)).toEqual([]);

    await fx.restore();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * PART 2 — Integration • limit window (leader collapse + optimistic reapply)
 * -------------------------------------------------------------------------- */

// Canonical/infinite: union semantics; the union grows/shrinks while leader network can
// collapse the window to the leader slice.
const POSTS_APPEND = gql`
  query PostsAppend($filter: String, $first: Int, $after: String) {
    posts(filter: $filter, first: $first, after: $after)
      @connection(mode: "infinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const PostsHarness = (
  queryDoc: any,
  cachePolicy: "cache-first" | "cache-and-network" | "network-only" = "cache-and-network"
) =>
  defineComponent({
    name: "PostsHarness",
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: Record<string, any> = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () => {
        const edges = (data?.value?.posts?.edges ?? []).map((e: any) => h("div", {}, e?.node?.title || ""));
        const pi = h("div", { class: "pi" }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
        return [...edges, pi];
      };
    },
  });

describe("Integration • limit window (leader collapse + optimistic reapply)", () => {
  it("full flow: pages, optimistic remove, filters, window growth, late page change", async () => {
    let requestIndex = 0;

    const routes: Route[] = [
      // 0) A page1: A1,A2,A3 (initial load)
      {
        when: () => (requestIndex === 0 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) },
        }),
      },
      // 1) A page2: A4,A5,A6 (first time)
      {
        when: () => (requestIndex === 1 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A4", "A5", "A6"], { fromId: 4 }) },
        }),
      },
      // 2) A page3: A7,A8,A9 (first time)
      {
        when: () => (requestIndex === 2 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A7", "A8", "A9"], { fromId: 7 }) },
        }),
      },
      // 3) B page1
      {
        when: () => (requestIndex === 3 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["B1", "B2"], { fromId: 101 }) },
        }),
      },
      // 4) A page1 slow revalidate
      {
        when: () => (requestIndex === 4 ? ((requestIndex += 1), true) : false),
        delay: 30,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) },
        }),
      },
      // 5) A page2 replay (server still A4,A5,A6)
      {
        when: () => (requestIndex === 5 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.connection(
              [{ title: "A4", id: "4" }, { title: "A5", id: "5" }, { title: "A6", id: "6" }],
            ),
          },
        }),
      },
      // 6) B page1 again
      {
        when: () => (requestIndex === 6 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["B1", "B2"], { fromId: 101 }) },
        }),
      },
      // 7) A page1 (fast)
      {
        when: () => (requestIndex === 7 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A1", "A2", "A3"], { fromId: 1 }) },
        }),
      },
      // 8) A page2 (fast)
      {
        when: () => (requestIndex === 8 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.connection([{ title: "A4", id: "4" }, { title: "A6", id: "6" }, { title: "A7", id: "7" }]),
          },
        }),
      },
      // 9) A page3 (A8,A9,A10)
      {
        when: () => (requestIndex === 9 ? ((requestIndex += 1), true) : false),
        delay: 5,
        respond: () => ({
          data: { __typename: "Query", posts: fixtures.posts.connection(["A8", "A9", "A10"], { fromId: 8 }) },
        }),
      },
    ];

    // 0) A page1 request
    console.log("Subtest 0");
    const Comp = PostsHarness(POSTS_APPEND, "cache-and-network");
    const { wrapper, fx, cache } = await mountWithClient(
      Comp,
      routes,
      undefined,
      { filter: "A", first: 3, after: null }
    );
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    // 1) A page2 request → grow union
    console.log("Subtest 1");
    await wrapper.setProps({ filter: "A", first: 3, after: "p3" });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    const T = (cache as any).modifyOptimistic((tx: any) => {
      tx.connection({ parent: "Query", key: "posts", filters: { filter: "A" } }).remove({ __typename: "Post", id: "5" });
    });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 2)
    console.log("Subtest 2");
    await wrapper.setProps({ filter: "A", first: 3, after: "p6" });
    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    // 3)
    console.log("Subtest 3");
    await wrapper.setProps({ filter: "B", first: 2, after: null });
    await delay(9);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    // 4)
    console.log("Subtest 4");
    await wrapper.setProps({ filter: "A", first: 3, after: null });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9"]);

    await delay(31);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    // 5)
    console.log("Subtest 5");
    await wrapper.setProps({ filter: "A", first: 3, after: "p3" });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await delay(41);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    // 6)
    console.log("Subtest 6");
    await wrapper.setProps({ filter: "B", first: 2, after: null });

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["B1", "B2"]);

    // 7)
    console.log("Subtest 7");
    await wrapper.setProps({ filter: "A", first: 3, after: null });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3"]);

    // 8)
    console.log("Subtest 8");
    await wrapper.setProps({ filter: "A", first: 3, after: 'p3' });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6"]);

    T.commit?.();

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7"]);

    await fx.restore?.();

    // 9)
    console.log("Subtest 9");
    await wrapper.setProps({ filter: "A", first: 3, after: 'p7' });

    await tick(2);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7"]);

    T.commit?.();

    await delay(6);
    expect(rowsNoPI(wrapper)).toEqual(["A1", "A2", "A3", "A4", "A6", "A7", "A8", "A9", "A10"]);

    await fx.restore?.();
  });
});
