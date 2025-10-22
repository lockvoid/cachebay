import { mount } from "@vue/test-utils";
import { createTestClient, createConnectionComponent, createDetailComponent, seedCache, getEdges, fixtures, operations, delay, tick } from "@/test/helpers";

describe("Cache Policies Behavior", () => {
  describe("network-only policy", () => {
    it("ignores cache and always fetches from network", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ email: "u1@example.com" }]) } };
          },
          delay: 20,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "network-only",

        connectionFn: (data) => {
          return data.users;
        },
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
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);

      await fx.restore();
    });

    it("fetches single user from network ignoring cache", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1";
          },
          respond: () => {
            return { data: { user: fixtures.user({ id: "u1", email: "u1@example.com" }) } };
          },
          delay: 15,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "network-only",

        detailFn: (data) => {
          return data.user;
        },
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

    it("handles paginated comments with cursor-based navigation", async () => {
      const data1 = {
        __typename: "Query",

        user: fixtures.user({
          id: "u1",
          email: "user1@example.com",

          posts: fixtures.posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",

              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c3",
                  text: "Comment 3",
                },
                {
                  uuid: "c4",
                  text: "Comment 4",
                },
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
        },
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

      expect(getEdges(wrapper, "text")).toEqual(["Comment 3", "Comment 4"]);

      await fx.restore();
    });
  });

  describe("cache-first policy", () => {
    it("makes network request and renders when cache is empty", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "tech";
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ email: "tech.user@example.com" }]) } };
          },
          delay: 30,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",

        connectionFn: (data) => {
          return data.users;
        },
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

    it("returns cached data immediately without network request", async () => {
      const { client, cache, fx } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          role: "cached",
          first: 2,
          after: null,
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",

        connectionFn: (data) => {
          return data.users;
        },
      });

      const wrapper = mount(Cmp, {
        props: {
          role: "cached",
          first: 2,
          after: null,
        },

        global: {
          plugins: [client],
        },
      });

      await delay(50);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });

    it("fetches single user from network when not cached", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.id === "u1";
          },
          respond: () => {
            return {
              data: {
                user: fixtures.users.buildNode({ email: "u1@example.com" }),
              },
            };
          },
          delay: 15,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",

        detailFn: (data) => {
          return data.user;
        },
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

    it("returns cached single user without network request", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USER_QUERY,

        variables: {
          id: "u1",
        },

        data: {
          user: fixtures.users.buildNode({ email: "u1@example.com" }),
        },
      });

      const { client, fx } = createTestClient({ cache });

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",

        detailFn: (data) => {
          return data.user;
        },
      });

      const wrapper = mount(Cmp, {
        props: {
          id: "u1",
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
    it.only("renders cached data first then updates with network response", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          role: "news",
          first: 2,
          after: null,
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.role === "news";
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ id: "u1", email: "u1+updated@example.com" }]) } };
          },
          delay: 15,
        },
      ];

      const { client, fx } = createTestClient({ routes, cache });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",

        connectionFn: (data) => {
          return data.users;
        },
      });

      const wrapper = mount(Cmp, {
        props: {
          role: "news",
          first: 2,
          after: null,
        },

        global: {
          plugins: [client],
        },
      });

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
      expect(fx.calls.length).toBe(0);

      await delay(20);
      expect(getEdges(wrapper, "email")).toEqual(["u1+updated@example.com"]);
      expect(fx.calls.length).toBe(1);

      await fx.restore();
    });

    it("renders only once when network data matches cache", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: {
          role: "admin",
          first: 2,
          after: null,
        },
        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.role === "admin";
          },
          respond: () => {
            return { data: { data: { users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]) } } };
          },
          delay: 10,
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
          role: "admin",
          first: 2,
          after: null,
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

    it("renders twice when network data differs from cache", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          role: "admin",
          first: 2,
          after: null,
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.role === "admin";
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ id: "u1", email: "u1+updated@example.com" }]) } };
          },
          delay: 10,
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
          role: "admin",
          first: 2,
          after: null,
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

    it("renders once when cache is empty and network responds", async () => {
      const routes = [
        {
          when: ({ variables }) => {
            return variables.usersRole === "admin";
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ email: "u1@example.com" }]) } };
          },
          delay: 5,
        },
      ];

      const { client, fx } = createTestClient({ routes });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",

        connectionFn: (data) => {
          return data.users;
        },
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

    it("handles nested comments with custom uuid keys", async () => {
      const { cache } = createTestClient();

      const data1 = {
        __typename: "Query",

        user: fixtures.user({
          id: "u1",
          email: "u1@example.com",

          posts: fixtures.posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c1",
                  text: "Comment 1",
                  author: { __typename: "User", id: "u1" },
                },
                {
                  uuid: "c2",
                  text: "Comment 2",
                  author: { __typename: "User", id: "u1" },
                },
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
              id: "p1",
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                {
                  uuid: "c1",
                  text: "Comment 1",
                  author: { __typename: "User", id: "u1" },
                },
                {
                  uuid: "c2",
                  text: "Comment 2",
                  author: { __typename: "User", id: "u1" },
                },
                {
                  uuid: "c3",
                  text: "Comment 3",
                  author: { __typename: "User", id: "u1" },
                },
              ]),
            },
          ]),
        }),
      };

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
        },
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

      await delay(15);
      expect(getEdges(wrapper, "text")).toEqual(["Comment 1", "Comment 2", "Comment 3"]);

      await fx.restore();
    });

    it("merges paginated cache data with network response", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          role: "admin",
          first: 2,
          after: null,
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }]),
        },
      });

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          role: "admin",
          first: 2,
          after: "u2",
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u3", email: "u3@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }) => {
            return variables.role === "admin" && variables.after == null;
          },
          respond: () => {
            return { data: { users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }, { id: "u2", email: "u2@example.com" }]) } };
          },
          delay: 15,
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
          role: "admin",
          first: 2,
          after: null,
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

  describe("cache-only policy", () => {
    it("returns cached data without making network requests", async () => {
      const { cache } = createTestClient();

      await seedCache(cache, {
        query: operations.USERS_QUERY,

        variables: {
          usersRole: "admin",
          usersFirst: 2,
          usersAfter: null,
        },

        data: {
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        },
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

    it("renders empty state when cache is empty", async () => {
      const { client, fx } = createTestClient();

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        },
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

    it("displays error when cache miss occurs", async () => {
      const { client, fx } = createTestClient();

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",

        connectionFn: (data) => {
          return data.users;
        },
      });

      const wrapper = mount(Cmp, {
        props: {
          role: "admin",
          first: 2,
          after: null,
        },

        global: {
          plugins: [client],
        },
      });

      await tick();
      expect(wrapper.text()).toContain("CacheMiss");
      expect(fx.calls.length).toBe(0);

      await fx.restore();
    });
  });
});
