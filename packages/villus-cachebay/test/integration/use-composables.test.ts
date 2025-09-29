import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createTestClient, operations, tick } from "@/test/helpers";
import { useFragment } from "@/src/composables/useFragment";
import { useCache } from "@/src/composables/useCache";

describe("Composables", () => {
  describe("useFragment", () => {
    it("updates component when entity data changes", async () => {
      const { cache } = createTestClient();

      cache.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "u1", email: "u1@example.com" },
      });

      const Cmp = defineComponent({
        setup() {
          const user = useFragment({
            id: "User:u1",
            fragment: operations.USER_FRAGMENT,
          });

          return () => {
            return h("div", {}, user.value?.email);
          };
        },
      });

      const wrapper = mount(Cmp, { global: { plugins: [cache] } });

      await tick();
      expect(wrapper.text()).toBe("u1@example.com");

      cache.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: { email: "u1+updated@example.com" },
      });

      await tick();
      expect(wrapper.text()).toBe("u1+updated@example.com");
    });

    it("updates component when connection data changes", async () => {
      const USER_POSTS_FRAGMENT = `
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

      const { cache } = createTestClient({
        cacheOptions: {
          keys: {
            User: (o: any) => (o?.id != null ? String(o.id) : null),
            Post: (o: any) => (o?.id != null ? String(o.id) : null),
          },
        },
      });

      // Write initial connection data
      cache.writeFragment({
        id: "User:u1",
        fragment: USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { first: 2, after: null },
        data: {
          __typename: "User",
          id: "u1",
          posts: {
            __typename: "PostConnection",
            totalCount: 1,
            pageInfo: { __typename: "PageInfo", endCursor: "p1", hasNextPage: false },
            edges: [
              {
                __typename: "PostEdge",
                cursor: "p1",
                node: { __typename: "Post", id: "p1", title: "P1" },
              },
            ],
          },
        },
      });

      const Cmp = defineComponent({
        setup() {
          const userPosts = useFragment({
            id: "User:u1",
            fragment: USER_POSTS_FRAGMENT,
            fragmentName: "UserPosts",
            variables: { first: 2, after: null },
          });

          return () => (userPosts.value?.posts?.edges ?? []).map((e: any) =>
            h("div", {}, e?.node?.title || "")
          );
        },
      });

      const wrapper = mount(Cmp, { global: { plugins: [cache] } });
      await tick();
      let rows = wrapper.findAll("div").map(d => d.text());
      expect(rows).toEqual(["P1"]);

      // Update existing post
      cache.writeFragment({
        id: "Post:p1",
        fragment: operations.POST_FRAGMENT,
        data: { title: "P1 (Updated)" },
      });
      await tick();
      rows = wrapper.findAll("div").map(d => d.text());
      expect(rows).toEqual(["P1 (Updated)"]);
    });
  });

  describe("useCache", () => {
    it("provides writeFragment and identify methods", async () => {
      const { cache } = createTestClient({
        cacheOptions: {
          keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
        },
      });

      const Cmp = defineComponent({
        setup() {
          const c = useCache<any>();

          c.writeFragment({
            id: "User:u7",
            fragment: operations.USER_FRAGMENT,
            data: { __typename: "User", id: "u7", email: "seed@example.com" },
          });

          const ident = c.identify({ __typename: "User", id: "u7" }) || "";
          return () => h("div", {}, ident);
        },
      });

      const wrapper = mount(Cmp, { global: { plugins: [cache] } });
      await tick();

      expect(wrapper.text()).toBe("User:u7");

      const user = cache.readFragment({
        id: "User:u7",
        fragment: operations.USER_FRAGMENT,
      });
      expect(user).toMatchObject({
        __typename: "User",
        id: "u7",
        email: "seed@example.com",
      });

      const Comp2 = defineComponent({
        setup() {
          const c = useCache<any>();
          c.writeFragment({
            id: "User:u7",
            fragment: operations.USER_FRAGMENT,
            data: { email: "seed2@example.com" },
          });
          return () => h("div");
        },
      });
      mount(Comp2, { global: { plugins: [cache] } });
      await tick();

      const updatedUser = cache.readFragment({
        id: "User:u7",
        fragment: operations.USER_FRAGMENT,
      });
      expect(updatedUser?.email).toBe("seed2@example.com");
    });
  });
});
