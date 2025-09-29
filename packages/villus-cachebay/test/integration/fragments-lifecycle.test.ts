import { describe, it, expect } from "vitest";
import { defineComponent, ref, isReactive, h } from "vue";
import { mount } from "@vue/test-utils";
import { createCache } from "@/src/core/internals";
import { operations, fixtures, tick } from "@/test/helpers";
import type { CachebayInstance } from "@/src/core/types";
import { provideCachebay } from "@/src/core/plugin";
import { useFragment } from "@/src/composables/useFragment";

const provide = (cache: CachebayInstance) => ({
  install(app: any) {
    provideCachebay(app, cache);
  },
});

describe("Fragments lifecycle", () => {
  describe("identify", () => {
    it("returns normalized key", () => {
      const cache = createCache();

      expect(cache.identify({ __typename: "User", id: 1 })).toBe("User:1");
    });
  });

  describe("writeFragment", () => {
    it("writes and reads fragment roundtrip with reactive result", async () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "ann@example.com" },
      });

      const view = cache.readFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
      });

      expect(isReactive(view)).toBe(true);
      expect(view).toEqual({ __typename: "User", id: "1", email: "ann@example.com" });
    });

    it("updates existing fragments with partial data", async () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "2", email: "u1@example.com" },
      });

      const view = cache.readFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
      });

      expect(view).toEqual({ __typename: "User", id: "2", email: "u1@example.com" });
      expect(isReactive(view)).toBe(true);

      cache.writeFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
        data: { email: "u1+updated@example.com" },
      });

      expect(view).toEqual({ __typename: "User", id: "2", email: "u1+updated@example.com" });
      expect(isReactive(view)).toBe(true);
    });

    it("applies multiple writes correctly with latest data winning", async () => {
      const cache = createCache();

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

    it("handles nested connections with pageInfo correctly", () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
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
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
      });

      const snapshot = {
        typename: result.posts.__typename,
        titles: result.posts.edges.map((e: any) => e.node.title),
        pageInfo: result.posts.pageInfo,
      };

      expect(snapshot).toEqual({
        typename: "PostConnection",
        titles: ["Hello", "World"],
        pageInfo: { __typename: "PageInfo", hasNextPage: true, endCursor: "c2" },
      });

      expect(isReactive(result.posts)).toBe(true);
    });

    it("supports custom entity keys", async () => {
      const cache = createCache({
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

      cache.writeFragment({
        id: "Comment:abc-123",
        fragment: operations.COMMENT_FRAGMENT,
        data: { text: "Edited" },
      });

      const v2 = cache.readFragment({
        id: "Comment:abc-123",
        fragment: operations.COMMENT_FRAGMENT,
      });
      expect(v2.text).toBe("Edited");
    });
  });

  describe("readFragment", () => {
    it("reads multiple fragments via repeated calls", async () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });
      cache.writeFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "2", email: "bob@example.com" },
      });
      cache.writeFragment({
        id: "User:3",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "3", email: "charlie@example.com" },
      });

      const items = ["User:1", "User:2", "User:3"]
        .map((k) => cache.readFragment({ id: k, fragment: operations.USER_FRAGMENT }))
        .filter(Boolean);

      expect(items.map((u: any) => u?.email)).toEqual(["alice@example.com", "bob@example.com", "charlie@example.com"]);
      items.forEach((u: any) => {
        if (u) expect(isReactive(u)).toBe(true);
      });
    });

    it("filters missing fragments and returns only present ones", () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      const raws = ["User:1", "User:999", "User:2"].map((k) =>
        cache.readFragment({ id: k, fragment: operations.USER_FRAGMENT }),
      );

      const present = raws.filter((u: any) => u && u.id);
      expect(present.length).toBe(1);
      expect(present[0]?.email).toBe("alice@example.com");
    });
  });

  describe("useFragment", () => {
    it("updates component when fragment data changes", async () => {
      const cache = createCache();

      cache.writeFragment({
        id: "User:10",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "10", email: "initial@example.com" },
      });

      const Comp = defineComponent({
        setup() {
          const id = ref("User:10");
          const live = useFragment({ id, fragment: operations.USER_FRAGMENT });
          return { live };
        },
        render() {
          return h("div", {}, this.live?.email || "");
        },
      });

      const wrapper = mount(Comp, { global: { plugins: [provide(cache)] } });
      await tick();
      expect(wrapper.text()).toBe("initial@example.com");

      cache.writeFragment({
        id: "User:10",
        fragment: operations.USER_FRAGMENT,
        data: { email: "updated@example.com" },
      });
      await tick();
      expect(wrapper.text()).toBe("updated@example.com");
    });
  });
});
