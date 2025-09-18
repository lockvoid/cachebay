// test/integration/fragments-lifecycle.test.ts
import { describe, it, expect } from "vitest";
import { defineComponent, h, ref, isReactive } from "vue";
import gql from "graphql-tag";

import { createCache } from "@/src/core/internals";
import { useFragment } from "@/src/composables/useFragment";
import { tick, type Route } from "@/test/helpers";
import { mountWithClient } from "@/test/helpers/integration";

describe("Integration • Fragments Behavior (selection-first, reactive readFragment)", () => {
  it("Fragment API Basics • identify returns normalized key", () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    expect((cache as any).identify({ __typename: "User", id: 1 })).toBe("User:1");
  });

  it("Fragment API Basics • writeFragment → readFragment roundtrip (entity fields only, reactive)", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "1", name: "Ann" },
    });

    const out = (cache as any).readFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
    });

    // reactive live view
    expect(out).toEqual({ __typename: "User", id: "1", name: "Ann" });
    expect(isReactive(out)).toBe(true);
  });

  it("Fragment API Basics • readFragment returns a reactive view and updates with further writes", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:2",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "2", name: "Bob" },
    });

    const view = (cache as any).readFragment({
      id: "User:2",
      fragment: gql`fragment U on User { id name }`,
    });

    expect(view).toBeTruthy();
    expect(view.name).toBe("Bob");
    expect(isReactive(view)).toBe(true);

    (cache as any).writeFragment({
      id: "User:2",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "2", name: "Bobby" },
    });
    await tick();
    expect(view.name).toBe("Bobby");
  });

  it("Fragment API Basics • writeFragment twice updates readFragment result", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:3",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "3", name: "Charlie" },
    });
    (cache as any).writeFragment({
      id: "User:3",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "3", name: "Charles" },
    });

    const out = (cache as any).readFragment({
      id: "User:3",
      fragment: gql`fragment U on User { id name }`,
    });
    expect(out.name).toBe("Charles");
    expect(isReactive(out)).toBe(true);
  });

  it("Fragment with nested field + args • writes & reads a nested connection subtree via fragment (selection stored)", () => {
    const cache = createCache({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    });

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`
        fragment UserPostsPage on User {
          posts(first: 2) @connection {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename hasNextPage endCursor }
          }
        }
      `,
      data: {
        __typename: "User",
        id: "1",
        posts: {
          __typename: "PostConnection",
          edges: [
            { __typename: "PostEdge", cursor: "c1", node: { __typename: "Post", id: "101", title: "Hello" } },
            { __typename: "PostEdge", cursor: "c2", node: { __typename: "Post", id: "102", title: "World" } },
          ],
          pageInfo: { __typename: "PageInfo", hasNextPage: true, endCursor: "c2" },
        },
      },
    });

    const result = (cache as any).readFragment({
      id: "User:1",
      fragment: gql`
        fragment UserPostsPage on User {
          posts(first: 2) @connection {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename hasNextPage endCursor }
          }
        }
      `,
    });

    expect(result.posts.__typename).toBe("PostConnection");
    expect(Array.isArray(result.posts.edges)).toBe(true);
    expect(result.posts.edges.map((e: any) => e.node.title)).toEqual(["Hello", "World"]);
    expect(result.posts.pageInfo).toEqual({ __typename: "PageInfo", endCursor: "c2", hasNextPage: true });
    expect(isReactive(result.posts)).toBe(true);
  });

  it("Fragment Reactivity in Components (single, dynamic id) • component updates when a fragment changes", async () => {
    const routes: Route[] = [];
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "1", name: "Initial Name" },
    });

    const Comp = defineComponent({
      setup() {
        const id = ref("User:1");
        const live = useFragment({ id, fragment: gql`fragment U on User { id name }` });
        return { live };
      },
      render() {
        return h("div", {}, this.live?.name || "");
      },
    });

    const { wrapper } = await mountWithClient(Comp, routes, cache);
    await tick();
    expect(wrapper.text()).toBe("Initial Name");

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "1", name: "Updated Name" },
    });
    await tick();
    expect(wrapper.text()).toBe("Updated Name");
  });

  it("Multiple fragments (manual) • read multiple via repeated readFragment calls", async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "1", name: "Alice" },
    });
    (cache as any).writeFragment({
      id: "User:2",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "2", name: "Bob" },
    });
    (cache as any).writeFragment({
      id: "User:3",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "3", name: "Charlie" },
    });

    const items = ["User:1", "User:2", "User:3"]
      .map((k) =>
        (cache as any).readFragment({
          id: k,
          fragment: gql`fragment U on User { id name }`,
        }),
      )
      .filter(Boolean);

    expect(items.map((u: any) => u?.name)).toEqual(["Alice", "Bob", "Charlie"]);
    items.forEach((u: any) => {
      if (u) expect(isReactive(u)).toBe(true);
    });
  });

  it("Multiple fragments (manual) • missing ones materialize as empty reactive views — filter by id to select present", () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: "User:1",
      fragment: gql`fragment U on User { id name }`,
      data: { __typename: "User", id: "1", name: "Alice" },
    });

    const raws = ["User:1", "User:999", "User:2"].map((k) =>
      (cache as any).readFragment({
        id: k,
        fragment: gql`fragment U on User { id name }`,
      }),
    );

    // treat reactive-empty as "missing": filter by existence of id
    const present = raws.filter((u: any) => u && u.id);
    expect(present.length).toBe(1);
    expect(present[0]?.name).toBe("Alice");
  });
});
