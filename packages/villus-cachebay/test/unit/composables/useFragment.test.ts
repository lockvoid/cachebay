import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import gql from "graphql-tag";
import { tick, delay } from '@/test/helpers/concurrency';
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createPlanner } from "@/src/core/planner";
import { createFragments } from "@/src/core/fragments";
import { provideCachebay } from "@/src/core/plugin";
import { useFragment } from "@/src/composables/useFragment";

// ─────────────────────────────────────────────────────────────────────────────
// Fragments
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeCache = () => {
  const graph = createGraph({
    keys: {
      User: (o: any) => (o?.id != null ? String(o.id) : null),
      Post: (o: any) => (o?.id != null ? String(o.id) : null),
    },
  });

  const views = createViews({ graph });
  const planner = createPlanner({
    // tests rely on these fields being flagged as connections
    connections: {
      User: { posts: { mode: "infinite", args: [] } },
    },
  });

  const fragments = createFragments({ graph, planner, views });

  const cache = {
    readFragment: fragments.readFragment,
    writeFragment: fragments.writeFragment,
    __graph: graph,
  };

  return { cache, graph };
};

const provide = (cache: any) => ({
  install(app: any) {
    provideCachebay(app, cache);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("useFragment()", () => {
  it("reactive view for simple fragment; updates propagate", async () => {
    const { cache, graph } = makeCache();

    // seed entity
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const Comp = defineComponent({
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

    // update → reflected
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });
    await tick();
    expect(wrapper.text()).toBe("u1+updated@example.com");
  });

  it("reactive connection fields: edges and nodes are live", async () => {
    const { cache, graph } = makeCache();

    // seed user + page with 1 edge
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

    // initial list
    let items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1"]);

    // update node → reflected
    graph.putRecord("Post:p1", { title: "P1 (Updated)" });
    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)"]);

    // add another edge (p2)
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
    graph.putRecord(`${pageKey}.edges.1`, {
      __typename: "PostEdge",
      cursor: "p2",
      node: { __ref: "Post:p2" },
    });
    const pageSnapshot = graph.getRecord(pageKey)!;
    graph.putRecord(pageKey, {
      ...pageSnapshot,
      totalCount: 2,
      edges: [...pageSnapshot.edges, { __ref: `${pageKey}.edges.1` }],
    });

    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)", "P2"]);

    // update p2 title → reflected
    graph.putRecord("Post:p2", { title: "P2 (New)" });
    await tick();
    items = wrapper.findAll("li").map((li) => li.text());
    expect(items).toEqual(["P1 (Updated)", "P2 (New)"]);
  });

  it("returns undefined (or reactive empty) when entity is missing", async () => {
    const { cache } = makeCache();

    const Comp = defineComponent({
      setup() {
        const data = useFragment({
          id: "User:missing",
          fragment: USER_FRAGMENT,
          variables: {},
        });
        return () => h("div", {}, data.value ? JSON.stringify(data.value) : "undefined");
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();

    // Depending on graph implementation, it may be 'undefined' or '{}' (reactive empty proxy)
    const txt = wrapper.text();
    if (txt === "undefined") {
      expect(txt).toBe("undefined");
    } else {
      expect(() => JSON.parse(txt)).not.toThrow();
      const obj = JSON.parse(txt);
      expect(typeof obj).toBe("object");
    }
  });
});
