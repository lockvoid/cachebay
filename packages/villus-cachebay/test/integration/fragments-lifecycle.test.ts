import { describe, it, expect } from "vitest";
import { defineComponent, h, ref, isReactive } from "vue";
import gql from "graphql-tag";
import { mount } from "@vue/test-utils";
import { createCache, type CachebayInstance } from "@/src/core/internals";
import { provideCachebay } from "@/src/core/plugin";
import { useFragment } from "@/src/composables/useFragment";
import { tick } from "@/test/helpers";
import { operations } from "@/test/helpers";

const provide = (cache: CachebayInstance) => ({
  install(app: any) {
    provideCachebay(app, cache);
  },
});

describe("Fragments lifecycle", () => {
  it("identify returns normalized key", () => {
    const cache: CachebayInstance = createCache();
    expect(cache.identify({ __typename: "User", id: 1 })).toBe("User:1");
  });

  it("writeFragment → readFragment roundtrip (entity fields only, reactive)", async () => {
    const cache: CachebayInstance = createCache();

    cache.writeFragment({
      id: "User:1",
      fragment: operations.USER_FRAGMENT, // id + email
      data: { __typename: "User", id: "1", email: "ann@example.com" },
    });

    const view = cache.readFragment({
      id: "User:1",
      fragment: operations.USER_FRAGMENT,
    });

    // reactive live view
    expect(view).toEqual({ __typename: "User", id: "1", email: "ann@example.com" });
    expect(isReactive(view)).toBe(true);
  });

  it("readFragment returns a reactive view and updates with further writes", async () => {
    const cache: CachebayInstance = createCache();

    cache.writeFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
      data: { __typename: "User", id: "2", email: "bob@example.com" },
    });

    const view = cache.readFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
    });

    expect(view.email).toBe("bob@example.com");
    expect(isReactive(view)).toBe(true);

    cache.writeFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
      data: { email: "bobby@example.com" },
    });
    await tick();
    expect(view.email).toBe("bobby@example.com");
  });

  it("writeFragment twice updates readFragment result", async () => {
    const cache: CachebayInstance = createCache();

    cache.writeFragment({
      id: "User:3",
      fragment: operations.USER_FRAGMENT,
      data: { __typename: "User", id: "3", email: "alpha@example.com" },
    });
    cache.writeFragment({
      id: "User:3",
      fragment: operations.USER_FRAGMENT,
      data: { email: "bravo@example.com" },
    });

    const view = cache.readFragment({
      id: "User:3",
      fragment: operations.USER_FRAGMENT,
    });
    expect(view.email).toBe("bravo@example.com");
    expect(isReactive(view)).toBe(true);
  });

  it("fragment with nested connection: writes & reads a page via fragment (selection stored)", () => {
    const cache: CachebayInstance = createCache();

    const FRAG_USER_POSTS_PAGE = gql`
      fragment UserPostsPage on User {
        posts(first: 2) @connection {
          __typename
          edges { __typename cursor node { __typename id title } }
          pageInfo { __typename hasNextPage endCursor }
        }
      }
    `;

    cache.writeFragment({
      id: "User:1",
      fragment: FRAG_USER_POSTS_PAGE,
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

    const result = cache.readFragment({
      id: "User:1",
      fragment: FRAG_USER_POSTS_PAGE,
    });

    const snapshot = {
      typename: result.posts.__typename,
      titles: result.posts.edges.map((e: any) => e.node.title),
      pageInfo: result.posts.pageInfo,
    };

    expect(snapshot).toEqual({
      typename: "PostConnection",
      titles: ["Hello", "World"],
      pageInfo: { __typename: "PageInfo", endCursor: "c2", hasNextPage: true },
    });

    expect(isReactive(result.posts)).toBe(true);
  });

  it("component updates when a fragment changes (dynamic id)", async () => {
    const cache: CachebayInstance = createCache();

    // Use a tiny local fragment for "name", since operations.USER_FRAGMENT is email-based
    const FRAG_USER_NAME = gql`fragment U on User { id name }`;

    cache.writeFragment({
      id: "User:10",
      fragment: FRAG_USER_NAME,
      data: { __typename: "User", id: "10", name: "Initial Name" },
    });

    const Comp = defineComponent({
      setup() {
        const id = ref("User:10");
        const live = useFragment({ id, fragment: FRAG_USER_NAME });
        return { live };
      },
      render() {
        return h("div", {}, this.live?.name || "");
      },
    });

    const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
    await tick();
    expect(wrapper.text()).toBe("Initial Name");

    cache.writeFragment({
      id: "User:10",
      fragment: FRAG_USER_NAME,
      data: { name: "Updated Name" },
    });
    await tick();
    expect(wrapper.text()).toBe("Updated Name");
  });

  it("multiple fragments manually • read multiple via repeated readFragment calls", async () => {
    const cache: CachebayInstance = createCache();

    const FRAG_USER_NAME = gql`fragment U on User { id name }`;

    cache.writeFragment({
      id: "User:1",
      fragment: FRAG_USER_NAME,
      data: { __typename: "User", id: "1", name: "Alice" },
    });
    cache.writeFragment({
      id: "User:2",
      fragment: FRAG_USER_NAME,
      data: { __typename: "User", id: "2", name: "Bob" },
    });
    cache.writeFragment({
      id: "User:3",
      fragment: FRAG_USER_NAME,
      data: { __typename: "User", id: "3", name: "Charlie" },
    });

    const items = ["User:1", "User:2", "User:3"]
      .map((k) => cache.readFragment({ id: k, fragment: FRAG_USER_NAME }))
      .filter(Boolean);

    expect(items.map((u: any) => u?.name)).toEqual(["Alice", "Bob", "Charlie"]);
    items.forEach((u: any) => {
      if (u) expect(isReactive(u)).toBe(true);
    });
  });

  it("multiple fragments manual • missing ones materialize as empty reactive views — filter by id to select present", () => {
    const cache: CachebayInstance = createCache();

    const FRAG_USER_NAME = gql`fragment U on User { id name }`;

    cache.writeFragment({
      id: "User:1",
      fragment: FRAG_USER_NAME,
      data: { __typename: "User", id: "1", name: "Alice" },
    });

    const raws = ["User:1", "User:999", "User:2"].map((k) =>
      cache.readFragment({ id: k, fragment: FRAG_USER_NAME }),
    );

    // treat reactive-empty as "missing": filter by existence of id
    const present = raws.filter((u: any) => u && u.id);
    expect(present.length).toBe(1);
    expect(present[0]?.name).toBe("Alice");
  });

  it("custom key: Comment uses uuid identity (write/read/reactive)", async () => {
    const cache: CachebayInstance = createCache({
      keys: { Comment: (c: any) => (c?.uuid ? String(c.uuid) : null) },
    });

    cache.writeFragment({
      id: "Comment:abc-123",
      fragment: operations.COMMENT_FRAGMENT,
      data: { __typename: "Comment", uuid: "abc-123", text: "First!" },
    });

    const v1 = cache.readFragment({
      id: "Comment:abc-123",
      fragment: operations.COMMENT_FRAGMENT,
    });

    expect(v1).toEqual({ __typename: "Comment", uuid: "abc-123", text: "First!" });
    expect(isReactive(v1)).toBe(true);

    // reactive update
    cache.writeFragment({
      id: "Comment:abc-123",
      fragment: operations.COMMENT_FRAGMENT,
      data: { text: "Edited" },
    });
    await tick();

    const v2 = cache.readFragment({
      id: "Comment:abc-123",
      fragment: operations.COMMENT_FRAGMENT,
    });
    expect(v2.text).toBe("Edited");
  });
});
