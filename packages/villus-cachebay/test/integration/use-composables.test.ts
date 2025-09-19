import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { operations } from "@/test/helpers";
import { tick } from "@/test/helpers";
import { createCache } from "@/src/core/internals";
import { provideCachebay } from "@/src/core/plugin";
import { useFragment } from "@/src/composables/useFragment";
import { useCache } from "@/src/composables/useCache";

/** tiny helper to provide our cache instance in VTU */
const provide = (cache: any) => ({
  install(app: any) {
    provideCachebay(app, cache);
  },
});

describe("Integration • useFragment / useCache", () => {
  it("useFragment — reactive entity view (updates flow)", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    }) as any;

    // seed entity via graph
    const graph = (cache as any).__internals.graph;
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const Comp = defineComponent({
      name: "EntityFragmentComp",
      setup() {
        const ref = useFragment({
          id: "User:u1",
          fragment: operations.USER_FRAGMENT, // reuse exported fragment
          variables: {},
        });
        return () => h("div", {}, ref.value?.email || "");
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();
    expect(wrapper.text()).toBe("u1@example.com");

    // update → reactive
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    await tick();
    expect(wrapper.text()).toBe("u1+updated@example.com");
  });

  it("useFragment — connection fields reactive (edges list & node updates)", async () => {
    const cache = createCache({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    }) as any;

    const graph = (cache as any).__internals.graph;

    // seed user and one page (after:null, first:2) with 1 edge
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });

    const pageKey = '@.User:u1.posts({"after":null,"first":2})';
    graph.putRecord(`${pageKey}.edges.0`, {
      __typename: "PostEdge",
      cursor: "p1",
      node: { __ref: "Post:p1" },
    });
    graph.putRecord(pageKey, {
      __typename: "PostConnection",
      totalCount: 1,
      pageInfo: { __typename: "PageInfo", endCursor: "p1", hasNextPage: false },
      edges: [{ __ref: `${pageKey}.edges.0` }],
    });

    // minimal fragment for User→posts connection (works with useFragment)
    const USER_POSTS_FRAGMENT = /* GraphQL */ `
      fragment UserPosts on User {
        id
        posts(first: $first, after: $after) @connection {
          __typename
          totalCount
          pageInfo { __typename endCursor hasNextPage }
          edges { __typename cursor node { __typename id title } }
        }
      }
    `;

    const Comp = defineComponent({
      name: "ConnectionFragmentComp",
      setup() {
        const ref = useFragment({
          id: "User:u1",
          fragment: USER_POSTS_FRAGMENT,
          variables: { first: 2, after: null },
        });
        // render simple rows, no <ul>/<li>
        return () => (ref.value?.posts?.edges ?? []).map((e: any) =>
          h("div", {}, e?.node?.title || "")
        );
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();
    let rows = wrapper.findAll("div").map(d => d.text());
    expect(rows).toEqual(["P1"]);

    // update node → reflected
    graph.putRecord("Post:p1", { title: "P1 (Updated)" });
    await tick();
    rows = wrapper.findAll("div").map(d => d.text());
    expect(rows).toEqual(["P1 (Updated)"]);

    // add edge p2 → edges view updates
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
    graph.putRecord(`${pageKey}.edges.1`, {
      __typename: "PostEdge",
      cursor: "p2",
      node: { __ref: "Post:p2" },
    });
    // note: write a new edges array so the page's edges refs change
    const prev = graph.getRecord(pageKey)!;
    graph.putRecord(pageKey, {
      ...prev,
      totalCount: 2,
      edges: [...prev.edges, { __ref: `${pageKey}.edges.1` }],
    });

    await tick();
    rows = wrapper.findAll("div").map(d => d.text());
    expect(rows).toEqual(["P1 (Updated)", "P2"]);

    // p2 update → reactive
    graph.putRecord("Post:p2", { title: "P2 (New)" });
    await tick();
    rows = wrapper.findAll("div").map(d => d.text());
    expect(rows).toEqual(["P1 (Updated)", "P2 (New)"]);
  });

  it("useCache — writeFragment shim + identify", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    }) as any;

    const graph = (cache as any).__internals.graph;

    const Comp = defineComponent({
      name: "UseCacheComp",
      setup() {
        const c = useCache<any>();
        // writeFragment via composable
        const tx = c.writeFragment({
          id: "User:u7",
          fragment: operations.USER_FRAGMENT,
          variables: {},
          data: { __typename: "User", id: "u7", email: "seed@example.com" },
        });
        tx?.commit?.(); // should be a no-op but callable

        const ident = c.identify({ __typename: "User", id: "u7" }) || "";
        return () => h("div", {}, ident);
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();

    // identify result in DOM
    expect(wrapper.text()).toBe("User:u7");

    // snapshot present
    expect(graph.getRecord("User:u7")).toMatchObject({
      __typename: "User",
      id: "u7",
      email: "seed@example.com",
    });

    // update via writeFragment again
    const Comp2 = defineComponent({
      setup() {
        const c = useCache<any>();
        c.writeFragment({
          id: "User:u7",
          fragment: operations.USER_FRAGMENT,
          variables: {},
          data: { email: "seed2@example.com" },
        });
        return () => h("div");
      },
    });
    mount(Comp2, { global: { plugins: [provide(cache)] } });
    await tick();

    expect(graph.getRecord("User:u7")!.email).toBe("seed2@example.com");
  });
});
