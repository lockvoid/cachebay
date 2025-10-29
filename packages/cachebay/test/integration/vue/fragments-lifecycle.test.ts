import { mount } from "@vue/test-utils";
import { defineComponent, ref, h } from "vue";
import { useFragment } from "@/src/adapters/vue/useFragment";
import { createTestClient, operations, tick } from "@/test/helpers";

describe("Fragments lifecycle", () => {
  describe("identify", () => {
    it("returns normalized key", () => {
      const { cache } = createTestClient();

      expect(cache.identify({ __typename: "User", id: 1 })).toBe("User:1");
    });
  });

  describe("writeFragment", () => {
    it("writes and reads fragment roundtrip with reactive result", async () => {
      const { cache } = createTestClient();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "ann@example.com" },
      });

      const view = cache.readFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
      });

      expect(view).toEqual({__typename: "User", id: "1", email: "ann@example.com" });
    });

    it("updates existing fragments with partial data", async () => {
      const { cache } = createTestClient();

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

      cache.writeFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
        data: { email: "u1+updated@example.com" },
      });

      const updatedView = cache.readFragment({
        id: "User:2",
        fragment: operations.USER_FRAGMENT,
      });

      expect(updatedView).toEqual({__typename: "User", id: "2", email: "u1+updated@example.com" });
    });

    it("applies multiple writes correctly with latest data winning", async () => {
      const { cache } = createTestClient();

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
    });

    it("handles nested connections with pageInfo correctly", () => {
      const { cache } = createTestClient();

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
        pageInfo: {
          __typename: "PageInfo",
          hasNextPage: true,
          hasPreviousPage: false,
          endCursor: "c2",
          startCursor: "c1",
        },
      });
    });

    it("supports custom entity keys", async () => {
      const { cache } = createTestClient({
        cacheOptions: {
          keys: { Comment: (c: any) => (c?.uuid ? String(c.uuid) : null) },
        },
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
      const { cache } = createTestClient();

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

      const user1 = cache.readFragment({ id: "User:1", fragment: operations.USER_FRAGMENT });
      const user2 = cache.readFragment({ id: "User:2", fragment: operations.USER_FRAGMENT });
      const user3 = cache.readFragment({ id: "User:3", fragment: operations.USER_FRAGMENT });

      expect(user1?.email).toBe("alice@example.com");
      expect(user2?.email).toBe("bob@example.com");
      expect(user3?.email).toBe("charlie@example.com");
    });

    it("returns null for missing fragments", () => {
      const { cache } = createTestClient();

      cache.writeFragment({
        id: "User:1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      const user1 = cache.readFragment({ id: "User:1", fragment: operations.USER_FRAGMENT });
      const user2 = cache.readFragment({ id: "User:2", fragment: operations.USER_FRAGMENT });

      expect(user1?.email).toBe("alice@example.com");
      expect(user2).toBe(null);
    });
  });

  describe("useFragment", () => {
    it("updates component when fragment data changes", async () => {
      const { client, cache } = createTestClient();

      cache.writeFragment({
        id: "User:10",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "10", email: "u1@example.com" },
      });

      const Cmp = defineComponent({
        setup() {
          const id = ref("User:10");

          const user = useFragment({ id, fragment: operations.USER_FRAGMENT });

          return { user };
        },

        render() {
          return h("div", {}, this.user?.email || "");
        },
      });

      const wrapper = mount(Cmp, { global: { plugins: [client] } });

      await tick();
      expect(wrapper.text()).toBe("u1@example.com");

      cache.writeFragment({
        id: "User:10",
        fragment: operations.USER_FRAGMENT,
        data: { email: "u1+updated@example.com" },
      });

      await tick();
      expect(wrapper.text()).toBe("u1+updated@example.com");
    });
  });
});
