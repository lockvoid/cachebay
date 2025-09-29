import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, createDetailComponent, seedCache, fixtures, operations, delay, tick, getEdges } from '@/test/helpers';

describe("Cache Policies Behavior", () => {
  describe("cache-first policy", () => {
    it("miss -> one network then render (root users connection)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "tech";
          },
          respond: () => {
            return fixtures.users.query(["tech.user@example.com"]);
          },
          delay: 30,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "tech",
          usersFirst: 2,
          usersAfter: null,
        },

        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(40);
      expect(getEdges(wrapper, "email")).toEqual(["tech.user@example.com"]);


      await fx.restore();
    });

    it("hit emits cached and terminates, no network call (root users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "cached", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["cached.user@example.com"]).data,
      });

      const { client, fx } = createTestClient({ cache });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",

        connectionFn: (data) => {
          return data.users;
        },
      });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "cached",
          usersFirst: 2,
          usersAfter: null,
        },

        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["cached.user@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("single object • miss → one network then render (User)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "42";
          },
          respond: () => {
            return fixtures.singleUser.query("42", "answer@example.com");
          },
          delay: 15
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",
        detailFn: (data) => {
          return data.user;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          id: "42",
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").join("")).toBe("");
      expect(fx.calls.length).toBe(1);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["answer@example.com"]);

      await fx.restore();
    });

    it("single object • hit emits cached and terminates, no network (User)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USER_QUERY,
        variables: { id: "7" },
        data: fixtures.singleUser.query("7", "cached@example.com").data,
      });

      const { client, fx } = createTestClient({ cache });

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",
        detailFn: (data) => {
          return data.user;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          id: "7"
        },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["cached@example.com"]);
      expect(fx.calls.length).toBe(0);


      await fx.restore();
    });
  });

  describe("cache-and-network policy", () => {
    it("hit → immediate cached render then network refresh once (root users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "news", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["old.news@example.com"]).data,
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "news";
          },
          respond: () => {
            return fixtures.users.query(["fresh.news@example.com"]);
          },
          delay: 15,
        },
      ];

      const { client, fx } = createTestClient({ routes, cache });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "news",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["old.news@example.com"]);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["fresh.news@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("identical network as cache → single render", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "same", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["same.user@example.com"]),
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "same";
          },
          respond: () => {
            return { data: fixtures.users.query(["same.user@example.com"]) };
          },
          delay: 10
        },
      ];

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const { client, fx } = createTestClient({ routes, cache });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "same",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["same.user@example.com"]);

      await delay(15);
      expect(getEdges(wrapper, "email")).toEqual(["same.user@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("different network → two renders (recorded)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "diff", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["initial.user@example.com"]).data,
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "diff";
          },
          respond: () => {
            return fixtures.users.query(["updated.user@example.com"]);
          },
          delay: 10
        },
      ];

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => {
          return data.users;
        },
      });

      const { client, fx } = createTestClient({ routes, cache });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "diff",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["initial.user@example.com"]);

      await delay(15);
      expect(Cmp.renders.length).toEqual(2);
      expect(getEdges(wrapper, "email")).toEqual(["updated.user@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("miss → one render on network response (root users)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "miss";
          },
          respond: () => {
            return fixtures.users.query(["new.user@example.com"]);
          },
          delay: 5
        },
      ];

      const { client, fx } = createTestClient({ routes });
      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: { usersRole: "miss", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual([]);

      await delay(8);
      expect(getEdges(wrapper, "email")).toEqual(["new.user@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("nested Post→Comments (uuid) • hit then refresh", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USER_POSTS_COMMENTS_QUERY,
        variables: {
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: null,
        },
        data: {
          __typename: "Query",
          user: {
            __typename: "User",
            id: "u1",
            posts: fixtures.posts.connection(
              [
                {
                  title: "Post 1",

                  extras: {
                    comments: fixtures.comments.connection(["Comment 1", "Comment 2"], { postId: "Post 1", fromId: 1 }),
                  },
                },
              ],
              { fromId: 1 }
            ),
          },
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1" && variables.postsCategory === "tech" && variables.commentsFirst === 2 && variables.commentsAfter == null;
          },
          respond: () => {
            return {
              data: {
                __typename: "Query",
                user: {
                  __typename: "User",
                  id: "u1",
                  posts: fixtures.posts.connection(
                    [
                      {
                        title: "Post 1",
                        extras: {
                          comments: fixtures.comments.connection(["Comment 1", "Comment 2", "Comment 3"], {
                            postId: "Post 1",
                            fromId: 1,
                          }),
                        },
                      },
                    ],
                    { fromId: 1 }
                  ),
                },
              },
            };
          },
          delay: 12,
        },
      ];

      const Cmp = defineComponent({
        name: "UserPostComments",
        setup() {
          const { useQuery } = require("villus");
          const { data } = useQuery({
            query: operations.USER_POSTS_COMMENTS_QUERY,
            variables: {
              id: "u1",
              postsCategory: "tech",
              postsFirst: 1,
              postsAfter: null,
              commentsFirst: 2,
              commentsAfter: null,
            },
            cachePolicy: "cache-and-network",
          });
          return () => {
            const edges =
              data.value?.user?.posts?.edges?.[0]?.node?.comments?.edges ?? [];
            return edges.map((e: any) => h("div", {}, e?.node?.text ?? ""));
          };
        },
      });

      const { client, fx } = createTestClient({ routes, cache });
      const wrapper = mount(Cmp, {
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2"]);

      await delay(125);

      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2", "Comment 3"]);


      await fx.restore();
    });
  });

  describe("network-only policy", () => {
    it("no cache, renders only on network (users)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "network";
          },
          respond: () => {
            return fixtures.users.query(["network.user@example.com"]);
          },
          delay: 20
        },
      ];

      const { client, fx } = createTestClient({ routes });
      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "network-only",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: { usersRole: "network", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(getEdges(wrapper, "email")).toEqual(["network.user@example.com"]);

      await fx.restore();
    });

    it("single object • no cache, renders on network (User)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "501";
          },
          respond: () => {
            return fixtures.singleUser.query("501", "net@example.com");
          },
          delay: 15
        },
      ];

      const { client, fx } = createTestClient({ routes });
      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "network-only",
        detailFn: (data) => {
          return data.user;
        }
      });

      const wrapper = mount(Cmp, {
        props: { id: "501" },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual([]);
      expect(fx.calls.length).toBe(1);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["net@example.com"]);

      await fx.restore();
    });
  });

  describe("cache-only policy", () => {
    it("hit renders cached data, no network call (users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "hit", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["hit.user@example.com"]).data,
      });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",
        connectionFn: (data) => {
          return data.users;
        }
      });

      // Create client with existing cache
      const { client, fx } = createTestClient({ cache });
      const wrapper = mount(Cmp, {
        props: { usersRole: "hit", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["hit.user@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("miss renders nothing and does not network", async () => {
      const { client, fx } = createTestClient();
      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",
        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: { usersRole: "miss", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("miss yields CacheOnlyMiss error", async () => {
      const { client, fx } = createTestClient();
      const Cmp = defineComponent({
        name: "CacheOnlyMissComp",
        setup() {
          const { useQuery } = require("villus");
          const { data, error } = useQuery({
            query: operations.USERS_QUERY,
            variables: { usersRole: "miss", usersFirst: 2, usersAfter: null },
            cachePolicy: "cache-only",
          });
          return () => h("div", {}, error.value ? JSON.stringify(error.value) : "no error");
        },
      });

      const wrapper = mount(Cmp, {
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(wrapper.text()).toContain("CacheOnlyMiss");
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });
  });

  describe("cursor replay (network-only) — nested comments page", () => {
    it("publishes terminally — simple smoke via network-only", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1" &&
              variables.postsCategory === "tech" &&
              variables.commentsFirst === 2 &&
              variables.commentsAfter === "c2";
          },
          respond: () => {
            return {
              data: {
                __typename: "Query",
                user: {
                  __typename: "User",
                  id: "u1",
                  posts: fixtures.posts.connection(
                    [
                      {
                        title: "Post 1",
                        extras: {
                          comments: fixtures.comments.connection(["Comment 3", "Comment 4"], { postId: "Post 1", fromId: 3 }),
                        },
                      },
                    ],
                    { fromId: 1 }
                  ),
                },
              },
            };
          },
          delay: 10,
        },
      ];

      const Cmp = defineComponent({
        name: "NetworkOnlyComments",
        setup() {
          const { useQuery } = require("villus");
          const vars = { id: "u1", postsCategory: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: "c2" };
          const { data } = useQuery({ query: operations.USER_POSTS_COMMENTS_QUERY, variables: vars, cachePolicy: "network-only" });
          return () => {
            const postEdges = data.value?.user?.posts?.edges ?? [];
            const first = postEdges[0]?.node;
            const commentEdges = first?.comments?.edges ?? [];
            return commentEdges.map((e: any) => h("div", {}, e?.node?.text ?? ""));
          };
        },
      });

      const { client, fx } = createTestClient({ routes });
      const wrapper = mount(Cmp, {
        global: {
          plugins: [client],
        },
      });

      await delay(12);
      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 3", "Comment 4"]);

      await fx.restore();
    });
  });

  it("return visit: cached union emits first, leader network collapses to leader slice (root users)", async () => {

    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.USERS_QUERY,
      variables: { usersRole: "revisit", usersFirst: 2, usersAfter: null },
      data: fixtures.users.query(["a1@example.com", "a2@example.com"]).data,
    });
    await seedCache(cache, {
      query: operations.USERS_QUERY,
      variables: { usersRole: "revisit", usersFirst: 2, usersAfter: "a2" },
      data: fixtures.users.query(["a3@example.com"]).data,
    });

    const routes = [
      {
        when: ({ variables }) => {
          return variables.usersRole === "revisit" && variables.usersAfter == null;
        },
        respond: () => {
          return fixtures.users.query(["a1@example.com", "a2@example.com"]);
        },
        delay: 15,
      },
    ];

    const Cmp = createConnectionComponent(operations.USERS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => {
        return data.users;
      }
    });

    // Create client with existing cache
    const { client, fx } = createTestClient({ routes, cache });
    const wrapper = mount(Cmp, {
      props: { usersRole: "revisit", usersFirst: 2, usersAfter: null },
      global: {
        plugins: [client],
      },
    });

    await tick();
    expect(getEdges(wrapper, "email")).toEqual(["a3@example.com"]);

    await delay(20);
    expect(getEdges(wrapper, "email")).toEqual(["a1@example.com", "a2@example.com"]);
    expect(fx.calls.length).toBe(1);


    await fx.restore();
  });

  it.skip("asking next page again: cache shows instantly; network slice replaces without dupes", async () => {
    const { cache } = createTestClient();

    await seedCache(cache, {
      query: operations.USERS_QUERY,
      variables: { usersRole: "again", usersFirst: 2, usersAfter: null },
      data: fixtures.users.query(["l1@example.com", "l2@example.com"]).data,
    });
    await seedCache(cache, {
      query: operations.USERS_QUERY,
      variables: { usersRole: "again", usersFirst: 2, usersAfter: "l2" },
      data: fixtures.users.query(["n1@example.com", "n2@example.com"]).data,
    });

    const routes = [
      {
        when: ({ variables }) => {
          return variables.usersRole === "again" && variables.usersAfter === "l2";
        },
        respond: () => {
          return fixtures.users.query(["n1@example.com"]);
        },
        delay: 12,
      },
    ];

    const Cmp = createConnectionComponent(operations.USERS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => {
        return data.users;
      }
    });

    // Create client with existing cache
    const { client, fx } = createTestClient({ routes, cache });
    const wrapper = mount(Cmp, {
      props: { usersRole: "again", usersFirst: 2, usersAfter: "l2" },
      global: {
        plugins: [client],
      },
    });

    await tick();
    expect(getEdges(wrapper, "email")).toEqual([
      "l1@example.com",
      "l2@example.com",
      "n1@example.com",
      "n2@example.com",
    ]);

    await delay(20);
    expect(getEdges(wrapper, "email")).toEqual([
      "l1@example.com",
      "l2@example.com",
      "n1@example.com",
    ]);

    expect(fx.calls.length).toBe(1);

    await fx.restore();
  });
});
