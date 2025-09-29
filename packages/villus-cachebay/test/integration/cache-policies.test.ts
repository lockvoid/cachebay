import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, createDetailComponent, seedCache, fixtures, operations, delay, tick, getEdges } from '@/test/helpers';

describe("Cache Policies Behavior", () => {
  describe("cache-first policy", () => {
    it("admin -> one network then render (root users connection)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "tech";
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "tech.user@example.com" }]) } };
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

        variables: {
          usersRole: "cached",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u1@example.com" }]),
        },
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
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("single object • admin → one network then render (User)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1";
          },
          respond: () => {
            return {
              data: {
                __typename: "Query",
                user: fixtures.users.buildNode({ email: "u1@example.com" }),
              },
            };
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
          id: "u1",
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").join("")).toBe("");
      expect(fx.calls.length).toBe(1);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await fx.restore();
    });

    it("single object • hit emits cached and terminates, no network (User)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USER_QUERY,

        variables: {
          id: "u1"
        },

        data: {
          __typename: "Query",
          user: fixtures.users.buildNode({ email: "u1@example.com" }),
        },
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
          id: "u1"
        },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });
  });

  describe("cache-and-network policy", () => {
    it("hit → immediate cached render then network refresh once (root users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          usersRole: "news",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "old.news@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "news";
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "fresh.news@example.com" }]) } };
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
        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null
        },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u1@example.com" }]),
        }
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "u1@example.com" }]) } } };
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
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await delay(15);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("different network → two renders (recorded)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u1@example.com" }])
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "u1+updated@example.com" }]) } };
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
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await delay(15);
      expect(Cmp.renders.length).toEqual(2);
      expect(getEdges(wrapper, "email")).toEqual(["u1+updated@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("one render on network response (root users)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "u1@example.com" }]) } };
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
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual([]);

      await delay(8);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it.only("nested Post→Comments (uuid) • hit then refresh", async () => {
      const { cache } = createTestClient();

      const data1 = {
        __typename: "Query",

        user: fixtures.user({
          id: "u1",
          email: "u1@example.com",

          posts: fixtures.posts.buildConnection([
            {
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c1",
                  text: "Comment 1"
                },
                {
                  uuid: "c2",
                  text: "Comment 2"
                }
              ]),
            },
          ]),
        }),
      };

      const data2 = {
        __typename: "Query",
        user: fixtures.user({
          id: "u1",
          email: "u1@example.com",

          posts: fixtures.posts.buildConnection([
            {
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c1",
                  text: "Comment 1"
                },
                {
                  uuid: "c2",
                  text: "Comment 2"
                },
                {
                  uuid: "c3",
                  text: "Comment 3"
                }
              ]),
            },
          ]),
        }),
      };
      console.log(JSON.stringify(data1, null, 2));

      await seedCache(cache, {
        query: operations.USER_POSTS_COMMENTS_QUERY,

        variables: {
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: "c2",
        },

        data: data1,
      });


      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1" && variables.postsCategory === "tech" && variables.commentsFirst === 2 && variables.commentsAfter == null;
          },
          respond: () => {
            return { data: data2 };
          },
          delay: 12,
        },
      ];

      const Cmp = createConnectionComponent(operations.USER_POSTS_COMMENTS_QUERY, {
        cachePolicy: "cache-and-network",

        connectionFn: (data) => {
          return data.user?.posts?.edges?.[0]?.node?.comments;
        }
      });

      const { client, fx } = createTestClient({ routes, cache });

      const wrapper = mount(Cmp, {
        props: {
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: null,
        },

        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "text")).toEqual(["Comment 1", "Comment 2"]);

      await delay(125);
      expect(getEdges(wrapper, "text")).toEqual(["Comment 1", "Comment 2", "Comment 3"]);

      await fx.restore();
    });

    it("return visit: cached union emits first, leader network collapses to leader slice (root users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u1@example.com" }, { email: "u2@example.com" }])
        }
      });

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: "u2"
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u3@example.com" }])
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin" && variables.usersAfter == null;
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "u1@example.com" }, { email: "u2@example.com" }]) } };
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

      const { client, fx } = createTestClient({ routes, cache });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["u3@example.com"]);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com", "u2@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });
  });

  describe("network-only policy", () => {
    it("no cache, renders only on network (users)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { __typename: "Query", users: fixtures.users.buildConnection([{ email: "u1@example.com" }]) } };
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
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await fx.restore();
    });

    it("single object • no cache, renders on network (User)", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1";
          },
          respond: () => {
            return { data: { __typename: "Query", user: fixtures.user({ id: "u1", email: "u1@example.com" }) } };
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
        props: {
          id: "u1",
        },
        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual([]);
      expect(fx.calls.length).toBe(1);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await fx.restore();
    });

    it("publishes terminally — simple smoke via network-only", async () => {
      const data1 = {
        __typename: "Query",

        user: fixtures.user({
          id: "u1",
          email: "user1@example.com",

          posts: fixtures.posts.buildConnection([
            {
              title: "Post 1",

              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c3",
                  text: "Comment 3",
                },
                {
                  uuid: "c4",
                  text: "Comment 4",
                }
              ]),
            },
          ]),
        }),
      };

      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1" && variables.postsCategory === "tech" && variables.commentsFirst === 2 && variables.commentsAfter === "c2";
          },
          respond: () => {
            return { data: data1 };
          },
          delay: 10,
        },
      ];

      const Cmp = createConnectionComponent(operations.USER_POSTS_COMMENTS_QUERY, {
        cachePolicy: "network-only",

        connectionFn: (data) => {
          return data.user?.posts?.edges?.[0]?.node?.comments;
        }
      });

      const { client, cache, fx } = createTestClient({ routes });

      const wrapper = mount(Cmp, {
        props: {
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: "c2",
        },

        global: {
          plugins: [client],
        },
      });

      await delay(12);

      console.log(cache.__internals.graph.inspect())
      expect(getEdges(wrapper, "text")).toEqual(["Comment 3", "Comment 4"]);

      await fx.restore();
    });
  });

  describe("cache-only policy", () => {
    it("hit renders cached data, no network call (users)", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ email: "u1@example.com" }])
        }
      });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        }
      });

      const { client, fx } = createTestClient({ cache });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("renders nothing and does not network", async () => {
      const { client, fx } = createTestClient();

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("yields CacheOnlyMiss error", async () => {
      const { client, fx } = createTestClient();

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        }
      });

      const wrapper = mount(Cmp, {
        props: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

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
});
