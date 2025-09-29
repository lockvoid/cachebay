import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createTestClient, operations, tick, fixtures, getEdges } from "@/test/helpers";
import { useFragment } from "@/src/composables/useFragment";
import { useCache } from "@/src/composables/useCache";

describe("Composables", () => {
  describe("useFragment", () => {
    it("updates component when entity data changes", async () => {
      const { cache } = createTestClient();

      cache.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
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
      const { cache } = createTestClient();

      cache.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",

        variables: {
          first: 2,
          after: null,
        },

        data: fixtures.users.buildNode({
          id: "u1",

          posts: fixtures.posts.buildConnection([
            { id: "p1", title: "Post 1" },
            { id: "p2", title: "Post 2" },
          ]),
        }),
      });

      const Cmp = defineComponent({
        setup() {
          const userPosts = useFragment({
            id: "User:u1",
            fragment: operations.USER_POSTS_FRAGMENT,
            fragmentName: "UserPosts",

            variables: {
              first: 2,
              after: null,
            },
          });

          return () => {
            const edges = userPosts.value?.posts?.edges ?? [];

            return h("ul", {}, edges.map((edge: any) =>
              h("li", { class: "edge" }, [
                h("div", { class: "title" }, edge?.node?.title || "")
              ])
            ));
          };
        },
      });

      const wrapper = mount(Cmp, { global: { plugins: [cache] } });

      await tick();
      expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2"]);

      cache.writeFragment({
        id: "Post:p1",
        fragment: operations.POST_FRAGMENT,
        data: { title: "Post 1 (Updated)" },
      });

      await tick();
      expect(getEdges(wrapper, "title")).toEqual(["Post 1 (Updated)", "Post 2"]);
    });
  });

  describe("useCache", () => {
    it("provides access to cache methods", () => {
      const { cache } = createTestClient();

      let capturedCache: any;

      const Cmp = defineComponent({
        setup() {
          capturedCache = useCache();

          return () => {
            return h("div");
          }
        },
      });

      mount(Cmp, { global: { plugins: [cache] } });

      expect(capturedCache).toBe(cache);
      expect(typeof capturedCache.dehydrate).toBe("function");
      expect(typeof capturedCache.hydrate).toBe("function");
      expect(typeof capturedCache.identify).toBe("function");
      expect(typeof capturedCache.inspect).toBe("object");
      expect(typeof capturedCache.modifyOptimistic).toBe("function");
      expect(typeof capturedCache.readFragment).toBe("function");
      expect(typeof capturedCache.writeFragment).toBe("function");
    });

    it("throws error when used outside provider context", () => {
      expect(() => {
        const Cmp = defineComponent({
          setup() {
            useCache();

            return () => {
              return h("div");
            }
          },
        });

        mount(Cmp, { global: { plugins: [] } });
      }).toThrow("[cachebay] useCache() called before provideCachebay()");
    });
  });
});
