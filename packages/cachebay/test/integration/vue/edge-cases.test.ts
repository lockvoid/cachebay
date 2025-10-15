import { mount } from "@vue/test-utils";
import { defineComponent, h, computed, watch, Suspense } from "vue";
import { useFragment } from "@/src/adapters/vue/useFragment";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createTestClient, createConnectionComponent, getEdges, fixtures, operations, delay, tick } from "@/test/helpers";

describe("Edge cases", () => {
  it("reflects in-place entity updates across all edges (no union dedup)", async () => {
    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data: any) => data.posts,
    });

    const routes = [
      // First page (leader)
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1", id: "1" },
              { title: "Post 2", id: "2" },
            ]),
          },
        }),
        delay: 5,
      },
      // Second page (append)
      {
        when: ({ variables }: any) => variables.first === 2 && variables.after === "c2",
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 3", id: "3" },
              { title: "Post 4", id: "4" },
            ]),
          },
        }),
        delay: 10,
      },
      // Third page after c4, returns an UPDATED version of the same entity id: "1"
      // (This intentionally creates a duplicate edge pointing to the same node.)
      {
        when: ({ variables }: any) => variables.after === "c4" && variables.first === 1,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1 Updated", id: "1", content: "Updated content", authorId: "1" },
            ]),
          },
        }),
        delay: 10,
      },
    ];

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] },
    });

    // Leader lands
    await delay(9);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2"]);

    // Append lands
    await wrapper.setProps({ first: 2, after: "c2" });
    await delay(12);
    expect(getEdges(wrapper, "title")).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    // After c4, server sends another edge pointing to the SAME node (id "1") with updated fields
    await wrapper.setProps({ first: 1, after: "c4" });
    await delay(12);

    const titles = getEdges(wrapper, "title");
    // No dedup: both edges that reference Post:1 show the updated title
    expect(titles).toEqual(["Post 1 Updated", "Post 2", "Post 3", "Post 4", "Post 1 Updated"]);
    expect(titles.filter((t) => t === "Post 1 Updated").length).toBe(2);

    await fx.restore();
  });

  it("renders concrete fragment implementations without phantom keys", async () => {
    const { cache, client } = createTestClient();

    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "1", title: "Post 1" }),
    });

    cache.writeFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
      data: fixtures.user({ id: "2", email: "u2@example.com" }),
    });

    const postFragment = cache.readFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
    });

    const userFragment = cache.readFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
    });

    expect(postFragment?.title).toBe("Post 1");
    expect(userFragment?.email).toBe("u2@example.com");
  });

  it("hides deleted entities from live fragment readers", async () => {
    const { cache, client } = createTestClient();

    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "1", title: "Post 1" }),
    });

    cache.writeFragment({
      id: "Post:2",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "2", title: "Post 2" }),
    });

    let post1 = cache.readFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
    });

    let post2 = cache.readFragment({
      id: "Post:2",
      fragment: operations.POST_FRAGMENT,
    });

    expect(post1?.title).toBe("Post 1");
    expect(post2?.title).toBe("Post 2");

    const tx = cache.modifyOptimistic((o) => {
      o.delete("Post:1");
    });

    tx.commit?.();

    post1 = cache.readFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
    });

    post2 = cache.readFragment({
      id: "Post:2",
      fragment: operations.POST_FRAGMENT,
    });

    expect(post1).toBe(null);
    expect(post2?.title).toBe("Post 2");
  });

  it("sends two requests even if the root the same", async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.userId === "1" && variables.postsCategory === "A" && !variables.postsAfter && variables.postsFirst === 2;
        },

        respond: () => {
          const connection = fixtures.posts.buildConnection([
            { id: "pa1", title: "A1", author: { id: "1", email: "u1@example.com", __typename: "User" } },
            { id: "pa2", title: "A2", author: { id: "1", email: "u1@example.com", __typename: "User" } },
          ]);

          // Add missing score field to edges
          connection.edges = connection.edges.map((edge: any) => ({
            ...edge,
            score: 100,
          }));

          return {
            data: {
              __typename: "Query",

              user: fixtures.users.buildNode({
                id: "1",
                email: "u1@example.com",
                posts: connection,
              }),
            },
          };
        },
      },

      {
        when: ({ variables }) => {
          return variables.id === "1";
        },

        respond: () => {
          return {
            data: {
              __typename: "Query",

              user: fixtures.users.buildNode({
                id: "1",
                email: "u1@example.com",
              }),
            },
          };
        },
      },
    ];

    const { client, cache, fx } = createTestClient({
      routes,

      cacheOptions: {
        suspensionTimeout: 1000,
        hydrationTimeout: 1000,
      },
    });

    const Cmp = defineComponent({
      name: "Cmp",

      inheritAttrs: false,

      setup() {
        const userQuery = useQuery({ query: operations.USER_QUERY, variables: { id: "1" }, cachePolicy: "cache-and-network" });

        const userPostsQuery = useQuery({ query: operations.USER_POSTS_QUERY, variables: { userId: "1", postsCategory: "A", postsFirst: 2, postsAfter: null }, cachePolicy: "cache-and-network" });

        return () => {
          return h("div", {});
        };
      },
    });

    const wrapper = mount(Cmp, {
      global: {
        plugins: [client],
      },
    });

    await delay(10);

    expect(fx.calls.length).toBe(2);
  });

  it("invalidates query cache when last watcher unmounts and remount gets fresh data", async () => {
    const { cache, client } = createTestClient();

    // Write initial connection data
    cache.writeQuery({
      query: operations.POSTS_QUERY,
      variables: { first: 3 },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([
          { id: "p1", title: "Post 1" },
          { id: "p2", title: "Post 2" },
          { id: "p3", title: "Post 3" },
        ]),
      },
    });

    const PostsComponent = defineComponent({
      name: "PostsComponent",
      setup() {
        const { data } = useQuery({
          query: operations.POSTS_QUERY,
          variables: { first: 3 },
          cachePolicy: "cache-only",
        });

        return () => {
          const titles = data.value?.posts?.edges?.map((e: any) => e.node.title) || [];
          return h("div", { class: "posts" }, titles.join(", "));
        };
      },
    });

    // 1. Mount app with watcher
    const wrapper = mount(PostsComponent, {
      global: { plugins: [client] },
    });

    await tick();

    // 2. Verify initial data
    expect(wrapper.find(".posts").text()).toBe("Post 1, Post 2, Post 3");

    // 3. Update data while mounted (using optimistic removeNode)
    const tx1 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.removeNode({ __typename: "Post", id: "p2" });
    });
    tx1.commit?.();

    await tick();

    // Check data changed (Post 2 removed)
    expect(wrapper.find(".posts").text()).toBe("Post 1, Post 3");

    // 4. Unmount (should invalidate cache)
    wrapper.unmount();

    // 5. Update data while unmounted (using optimistic addNode)
    const tx2 = cache.modifyOptimistic((o) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p4", title: "Post 4" }, { position: "end" });
    });
    tx2.commit?.();

    await tick();

    // 6. Remount app - should get fresh data (not stale cached version)
    const wrapper2 = mount(PostsComponent, {
      global: { plugins: [client] },
    });

    await tick();

    // Data should be fresh: Post 1, Post 3 (from step 3), Post 4 (from step 5)
    // NOT the stale cache from step 3 which was just "Post 1, Post 3"
    expect(wrapper2.find(".posts").text()).toBe("Post 1, Post 3, Post 4");
  });

  it("invalidates fragment cache when last watcher unmounts and remount gets fresh data", async () => {
    const { cache, client } = createTestClient();

    // Write initial fragment data
    cache.writeFragment({
      id: "User:u1",
      fragment: operations.USER_FRAGMENT,
      data: fixtures.users.buildNode({ id: "u1", email: "initial@example.com" }),
    });

    const UserFragmentComponent = defineComponent({
      name: "UserFragmentComponent",
      setup() {
        const data = useFragment({
          id: "User:u1",
          fragment: operations.USER_FRAGMENT,
        });

        return () => h("div", { class: "user-email" }, data.value?.email || "");
      },
    });

    // 1. Mount app with watcher
    const wrapper = mount(UserFragmentComponent, {
      global: { plugins: [client] },
    });

    await tick();

    // 2. Verify initial data
    expect(wrapper.find(".user-email").text()).toBe("initial@example.com");

    // 3. Update data while mounted (using optimistic update)
    const tx1 = cache.modifyOptimistic((o) => {
      o.patch("User:u1", {
        __typename: "User",
        id: "u1",
        email: "updated@example.com",
      });
    });
    tx1.commit?.();

    await tick();

    // Check data changed
    expect(wrapper.find(".user-email").text()).toBe("updated@example.com");

    // 4. Unmount (should invalidate cache)
    wrapper.unmount();

    // 5. Update data while unmounted (using optimistic update)
    const tx2 = cache.modifyOptimistic((o) => {
      o.patch("User:u1", {
        __typename: "User",
        id: "u1",
        email: "fresh@example.com",
      });
    });
    tx2.commit?.();

    await tick();

    // 6. Remount app - should get fresh data (not stale cached version)
    const wrapper2 = mount(UserFragmentComponent, {
      global: { plugins: [client] },
    });

    await tick();

    // Data should be fresh because cache was invalidated on unmount
    expect(wrapper2.find(".user-email").text()).toBe("fresh@example.com");
  });
});
