// test/integration/optimistic-updates.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { useQuery } from "villus";
import { tick, delay, seedCache, type Route } from "@/test/helpers";
import {
  mountWithClient,
  getListItems,
  cacheConfigs,
  testQueries,
  mockResponses,
} from "@/test/helpers/integration";

const FRAG_POST = /* GraphQL */ `
  fragment P on Post { __typename id title }
`;

// Accept reactive-empty {} or undefined
const expectEmptySnapshot = (snap: any) => {
  if (snap === undefined) {
    expect(snap).toBeUndefined();
  } else {
    expect(typeof snap).toBe("object");
    expect(Object.keys(snap).length).toBe(0);
  }
};

describe("Integration • Optimistic updates (entities & connections)", () => {
  const mocks: Array<{ waitAll: () => Promise<void>; restore: () => void }> = [];

  afterEach(async () => {
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  it("Entity: patch+commit, then revert restores previous snapshot", async () => {
    const cache = cacheConfigs.basic();

    expectEmptySnapshot((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST }));

    const t = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: "Post", id: "1", title: "Post A" }, "merge");
    });
    t.commit?.();
    await tick();

    expect((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post A");

    t.revert?.();
    await tick();

    expectEmptySnapshot((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST }));
  });

  it("Entity layering (order: T1 -> T2 -> revert T1 -> revert T2)", async () => {
    const cache = cacheConfigs.basic();

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: "Post", id: "1", title: "Post A" }, "merge");
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: "Post", id: "1", title: "Post B" }, "merge");
    });

    T1.commit?.();
    T2.commit?.();
    await tick();

    expect((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T1.revert?.();
    await tick();
    expect((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T2.revert?.();
    await tick();

    expectEmptySnapshot((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST }));
  });

  it("Entity layering (order: T1 -> T2 -> revert T2 -> revert T1) returns baseline", async () => {
    const cache = cacheConfigs.basic();

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: "Post", id: "1", title: "Post A" }, "merge");
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: "Post", id: "1", title: "Post B" }, "merge");
    });

    T1.commit?.();
    T2.commit?.();
    await tick();

    expect((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post B");

    T2.revert?.();
    await tick();
    expect((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST })?.title).toBe("Post A");

    T1.revert?.();
    await tick();

    expectEmptySnapshot((cache as any).readFragment({ id: "Post:1", fragment: FRAG_POST }));
  });

  // ───────────────── Single-page connection (explicit pageKey) ─────────────────

  it("Single page connection: add/remove/patch affects only that page", async () => {
    const cache = cacheConfigs.withRelay();

    // Seed two pages
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { first: 2, after: null },
      data: mockResponses.posts(["Post 1", "Post 2"]).data,
      materialize: true,
    });
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { first: 2, after: "c2" },
      data: mockResponses.posts(["Post 3", "Post 4"], { fromId: 3 }).data,
      materialize: true,
    });

    const List = defineComponent({
      props: { first: Number, after: String },
      setup(props) {
        const { data } = useQuery({ query: testQueries.POSTS, variables: props, cachePolicy: "cache-first" });
        return () => h("ul", (data.value?.posts?.edges || []).map((e: any) => h("li", { key: e.node.id }, e.node.title)));
      },
    });

    const { wrapper } = await mountWithClient(List, [] as Route[], cache);
    await wrapper.setProps({ first: 2, after: null });
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 1", "Post 2"]);

    // explicit pageKey for page 1 (note arg order: after then first)
    const page1Key = '@.posts({"after":null,"first":2})';
    const t = (cache as any).modifyOptimistic((c: any) => {
      const [page] = c.connection({ pageKey: page1Key });
      page.addNode({ __typename: "Post", id: "10", title: "Only Here" }, { cursor: "c10", position: "end" });
      page.patch({ endCursor: "c10", hasNextPage: false });
    });
    t.commit?.();
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 1", "Post 2", "Only Here"]);

    // switch to page 2: unchanged
    await wrapper.setProps({ first: 2, after: "c2" });
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 3", "Post 4"]);
  });

  // ───────────────── Family connection (connections policy: choose one page) ─────────────────

  it("Family connection: addNode/removeNode/patch targets a chosen page (not every page)", async () => {
    const cache = cacheConfigs.withRelay();

    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { first: 2, after: null },
      data: mockResponses.posts(["Post 1", "Post 2"]).data,
      materialize: true,
    });
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { first: 2, after: "c2" },
      data: mockResponses.posts(["Post 3", "Post 4"], { fromId: 3 }).data,
      materialize: true,
    });

    const List = defineComponent({
      props: { first: Number, after: String },
      setup(props) {
        const { data } = useQuery({ query: testQueries.POSTS, variables: props, cachePolicy: "cache-first" });
        return () =>
          h("ul", (data.value?.posts?.edges || []).map((e: any) => h("li", { key: e.node.id }, e.node.title)));
      },
    });

    const { wrapper } = await mountWithClient(List, [] as Route[], cache);

    // View page 1
    await wrapper.setProps({ first: 2, after: null });
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 1", "Post 2"]);

    // Prepend to the family → chosen page is the leading page (page with after:null)
    const tx = (cache as any).modifyOptimistic((c: any) => {
      const [fam] = c.connections({ parent: "Query", field: "posts", variables: {} });
      fam.addNode({ __typename: "Post", id: "9", title: "Fam Added" }, { cursor: "c9", position: "start" });
      fam.removeNode({ __typename: "Post", id: "1" });
      fam.patch({ endCursor: "c9", hasNextPage: true });
    });
    tx.commit?.();
    await tick();

    // Page 1 shows the change
    expect(getListItems(wrapper)).toEqual(["Fam Added", "Post 2"]);

    // Switch to page 2 → unchanged (NOT added on every page)
    await wrapper.setProps({ first: 2, after: "c2" });
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 3", "Post 4"]);
  });

  it("Family invalid nodes are ignored safely", async () => {
    const cache = cacheConfigs.withRelay();

    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts([]).data,
      materialize: true,
    });

    const UL = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: "cache-first" });
        return () => h("ul", (data.value?.posts?.edges || []).map((e: any) => h("li", { key: e.node.id }, e.node.title)));
      },
    });

    const { wrapper } = await mountWithClient(UL, [] as Route[], cache);
    await tick();

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [fam] = c.connections({ parent: "Query", field: "posts", variables: {} });
      fam.addNode({ id: "1", title: "NoTypename" } as any, { cursor: "x" });
      fam.addNode({ __typename: "Post", title: "NoId" } as any, { cursor: "y" });
    });
    t.commit?.();
    await tick();

    expect(getListItems(wrapper)).toEqual([]);
  });

  it("Family layering: T1 adds, T2 adds; revert T1 preserves T2; revert T2 returns to baseline", async () => {
    const cache = cacheConfigs.withRelay();

    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts([]).data,
      materialize: true,
    });

    const Comp = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: "cache-first" });
        return () =>
          h("div", [
            h("ul", (data.value?.posts?.edges || []).map((e: any) => h("li", { key: e.node.id }, e.node.title))),
            h("div", { class: "pageInfo" }, JSON.stringify(data.value?.posts?.pageInfo || {})),
          ]);
      },
    });

    const { wrapper } = await mountWithClient(Comp, [] as Route[], cache);
    await tick();

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      const [fam] = c.connections({ parent: "Query", field: "posts", variables: {} });
      fam.addNode({ __typename: "Post", id: "1", title: "Post 1" }, { cursor: "c1" });
      fam.addNode({ __typename: "Post", id: "2", title: "Post 2" }, { cursor: "c2" });
      fam.patch({ endCursor: "c2", hasNextPage: true });
    });

    const T2 = (cache as any).modifyOptimistic((c: any) => {
      const [fam] = c.connections({ parent: "Query", field: "posts", variables: {} });
      fam.addNode({ __typename: "Post", id: "3", title: "Post 3" }, { cursor: "c3" });
      fam.patch({ endCursor: "c3", hasNextPage: false });
    });

    T1.commit?.();
    T2.commit?.();
    await tick();

    expect(getListItems(wrapper)).toEqual(["Post 1", "Post 2", "Post 3"]);
    const info = wrapper.find(".pageInfo").text();
    expect(info).toContain('"endCursor":"c3"');
    expect(info).toContain('"hasNextPage":false');

    T1.revert?.();
    await tick();
    expect(getListItems(wrapper)).toEqual(["Post 3"]);

    T2.revert?.();
    await tick();
    expect(getListItems(wrapper)).toEqual([]);
    expect(wrapper.find(".pageInfo").text()).toBe('{"__typename":"PageInfo","endCursor":null,"hasNextPage":true}');
  });
});
