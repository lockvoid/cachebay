import { mount } from "@vue/test-utils";
import { defineComponent, h, computed, watch, Suspense } from "vue";
import { createTestClient, createConnectionComponent, getEdges, fixtures, operations, delay, tick } from "@/test/helpers";
import { useQuery } from "@/src/adapters/vue/useQuery";

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

    expect(post1).toBeUndefined(); // Deleted entity returns undefined
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
            { id: "pa2", title: "A2", author: { id: "1", email: "u1@example.com", __typename: "User" } }
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
});
