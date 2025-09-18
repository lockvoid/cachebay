import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import gql from "graphql-tag";

import { createCache } from "@/src/core/internals";
import { provideCachebay } from "@/src/core/plugin";
import { useFragment } from "@/src/composables/useFragment";
import { useCache } from "@/src/composables/useCache";
import { tick } from "@/test/helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Fragments used by the tests
// ─────────────────────────────────────────────────────────────────────────────

const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

const USER_POSTS_FRAGMENT = gql`
  fragment UserPosts on User {
    id
    posts(first: $first, after: $after) @connection {
      __typename
      totalCount
      pageInfo {
        __typename
        endCursor
        hasNextPage
      }
      edges {
        __typename
        cursor
        node {
          __typename
          id
          title
        }
      }
    }
  }
`;

// Provide helper for the cache plugin (calls provideCachebay with the instance)
const provide = (cache: any) => ({
  install(app: any) {
    provideCachebay(app, cache);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Integration • useFragment / useCache", () => {
  it("useFragment — reactive entity view (updates flow)", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    }) as any;

    // seed entity through internals graph (plain, no network)
    const graph = (cache as any).__internals.graph;
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const Comp = defineComponent({
      name: "EntityFragmentComp",
      setup() {
        const data = useFragment({
          id: "User:u1",
          fragment: USER_FRAGMENT,
          variables: {},
        });
        return () => h("div", {}, data.value?.email || "");
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

    // seed user and a page with one edge
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

    const Comp = defineComponent({
      name: "ConnectionFragmentComp",
      setup() {
        const data = useFragment({
          id: "User:u1",
          fragment: USER_POSTS_FRAGMENT,
          variables: { first: 2, after: null },
        });

        return () =>
          h(
            "ul",
            {},
            (data.value?.posts?.edges ?? []).map((e: any) =>
              h("li", {}, e?.node?.title || "")
            )
          );
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });

    await tick();
    let items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1"]);

    // update node → reflected
    graph.putRecord("Post:p1", { title: "P1 (Updated)" });
    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)"]);

    // add edge for p2 → reflected; edges array is new reactive projection
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
    graph.putRecord(`${pageKey}.edges.1`, {
      __typename: "PostEdge",
      cursor: "p2",
      node: { __ref: "Post:p2" },
    });
    const snap = graph.getRecord(pageKey)!;
    graph.putRecord(pageKey, {
      ...snap,
      totalCount: 2,
      edges: [...snap.edges, { __ref: `${pageKey}.edges.1` }],
    });

    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)", "P2"]);

    // update p2 → reflected
    graph.putRecord("Post:p2", { title: "P2 (New)" });
    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)", "P2 (New)"]);
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
          fragment: USER_FRAGMENT,
          variables: {},
          data: { __typename: "User", id: "u7", email: "seed@example.com" },
        });

        // ensure tx object exists and methods are callable (no-ops ok)
        tx?.commit?.();

        const ident = c.identify({ __typename: "User", id: "u7" }) || "";
        return () => h("div", {}, ident);
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();

    // identify result in DOM
    expect(wrapper.text()).toBe("User:u7");

    // snapshot present
    const snap = graph.getRecord("User:u7");
    expect(snap).toMatchObject({ __typename: "User", id: "u7", email: "seed@example.com" });

    // update via writeFragment again
    const Comp2 = defineComponent({
      setup() {
        const c = useCache<any>();
        c.writeFragment({
          id: "User:u7",
          fragment: USER_FRAGMENT,
          variables: {},
          data: { email: "seed2@example.com" },
        });
        return () => h("div", {}, "");
      },
    });

    mount(Comp2, { global: { plugins: [provide(cache)] } });
    await tick();
    expect(graph.getRecord("User:u7")!.email).toBe("seed2@example.com");
  });
});
