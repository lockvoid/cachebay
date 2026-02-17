import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  seedCache,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

describe("Cache Policies Behavior (Svelte)", () => {
  describe("network-only policy", () => {
    it("ignores cache and always fetches from network", async () => {
      const routes = [
        {
          when: ({ variables }: any) => variables.usersRole === "admin",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ usersRole: "admin", usersFirst: 2, usersAfter: null }),
        cachePolicy: "network-only",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);
      expect(q.dataUpdates.length).toBe(1);
      expect(q.errorUpdates.length).toBe(0);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);
      expect(q.dataUpdates.length).toBe(2);
      expect(q.errorUpdates.length).toBe(0);

      q.dispose();
      await fx.restore();
    });

    it("fetches single user from network ignoring cache", async () => {
      const routes = [
        {
          when: ({ variables }: any) => variables.id === "u1",
          respond: () => ({
            data: {
              __typename: "Query",
              user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USER_QUERY, {
        variables: () => ({ id: "u1" }),
        cachePolicy: "network-only",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.user.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("handles paginated comments with cursor-based navigation", async () => {
      const data1 = {
        __typename: "Query",
        user: fixtures.users.buildNode({
          id: "u1",
          email: "user1@example.com",
          posts: fixtures.posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                { uuid: "c3", text: "Comment 3", author: { __typename: "User", id: "u2", name: "User 2" } },
                { uuid: "c4", text: "Comment 4", author: { __typename: "User", id: "u2", name: "User 2" } },
              ]),
            },
          ]),
        }),
      };

      const routes = [
        {
          when: ({ variables }: any) =>
            variables.id === "u1" && variables.postsCategory === "tech" && variables.commentsFirst === 2 && variables.commentsAfter === "c2",
          respond: () => ({ data: data1 }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USER_POSTS_COMMENTS_QUERY, {
        variables: () => ({
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: "c2",
        }),
        cachePolicy: "network-only",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      const comments = q.data.user?.posts?.edges?.[0]?.node?.comments;
      expect(comments.edges.map((e: any) => e.node.text)).toEqual(["Comment 3", "Comment 4"]);
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });
  });

  describe("cache-first policy", () => {
    it("makes network request and renders when cache is empty", async () => {
      const routes = [
        {
          when: ({ variables }: any) => variables.usersRole === "tech",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "tech.user@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ usersRole: "tech", usersFirst: 2, usersAfter: null }),
        cachePolicy: "cache-first",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("tech.user@example.com");
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("returns cached data immediately without network request", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { role: "cached", first: 2, after: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const { cache, fx } = createTestClient({ cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "cached", first: 2, after: null }),
        cachePolicy: "cache-first",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(0);
      // dataUpdates includes initial undefined + cache hit = 2
      expect(q.dataUpdates.filter((d: any) => d !== "undefined").length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("fetches single user from network when not cached", async () => {
      const routes = [
        {
          when: ({ variables }: any) => variables.id === "u1",
          respond: () => ({
            data: {
              __typename: "Query",
              user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USER_QUERY, {
        variables: () => ({ id: "u1" }),
        cachePolicy: "cache-first",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.user.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("returns cached single user without network request", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USER_QUERY,
        variables: { id: "u1" },
        data: {
          __typename: "Query",
          user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      const { cache, fx } = createTestClient({ cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USER_QUERY, {
        variables: () => ({ id: "u1" }),
        cachePolicy: "cache-first",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.user.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(0);
      expect(q.dataUpdates.filter((d: any) => d !== "undefined").length).toBe(1);

      q.dispose();
      await fx.restore();
    });
  });

  describe("cache-and-network policy", () => {
    it("renders cached data first then updates with network response", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { role: "news", first: 2, after: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }: any) => variables.role === "news",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "u1+updated@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes, cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "news", first: 2, after: null }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1+updated@example.com");
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("renders once when network data matches cache", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { role: "admin", first: 2, after: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }: any) => variables.role === "admin",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes, cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "admin", first: 2, after: null }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);
      const countBeforeNetwork = q.dataUpdates.filter((d: any) => d !== "undefined").length;
      expect(countBeforeNetwork).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      // No additional update since data is the same
      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);
      expect(q.dataUpdates.filter((d: any) => d !== "undefined").length).toBe(countBeforeNetwork);

      q.dispose();
      await fx.restore();
    });

    it("renders twice when network data differs from cache", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { role: "admin", first: 2, after: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }: any) => variables.role === "admin",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "u1+updated@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes, cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "admin", first: 2, after: null }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1+updated@example.com");
      expect(q.dataUpdates.filter((d: any) => d !== "undefined").length).toBe(2);

      q.dispose();
      await fx.restore();
    });

    it("renders twice when cache is empty and network responds", async () => {
      const routes = [
        {
          when: ({ variables }: any) => variables.usersRole === "admin",
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ usersRole: "admin", usersFirst: 2, usersAfter: null }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(1);
      expect(q.dataUpdates.length).toBe(2);

      q.dispose();
      await fx.restore();
    });

    it("handles nested comments with custom uuid keys", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      const data1 = {
        __typename: "Query",
        user: fixtures.users.buildNode({
          id: "u1",
          email: "u1@example.com",
          posts: fixtures.posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                { uuid: "c1", text: "Comment 1", author: { __typename: "User", id: "u1" } },
                { uuid: "c2", text: "Comment 2", author: { __typename: "User", id: "u1" } },
              ]),
            },
          ]),
        }),
      };

      const data2 = {
        __typename: "Query",
        user: fixtures.users.buildNode({
          id: "u1",
          email: "u1@example.com",
          posts: fixtures.posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              comments: fixtures.comments.buildConnection([
                { uuid: "c1", text: "Comment 1", author: { __typename: "User", id: "u1" } },
                { uuid: "c2", text: "Comment 2", author: { __typename: "User", id: "u1" } },
                { uuid: "c3", text: "Comment 3", author: { __typename: "User", id: "u1" } },
              ]),
            },
          ]),
        }),
      };

      await seedCache(seedCacheInstance, {
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
          when: ({ variables }: any) =>
            variables.id === "u1" && variables.postsCategory === "tech" && variables.commentsFirst === 2 && variables.commentsAfter == null,
          respond: () => ({ data: data2 }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes, cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USER_POSTS_COMMENTS_QUERY, {
        variables: () => ({
          id: "u1",
          postsCategory: "tech",
          postsFirst: 1,
          postsAfter: null,
          commentsFirst: 2,
          commentsAfter: null,
        }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      const getComments = () => q.data?.user?.posts?.edges?.[0]?.node?.comments?.edges?.map((e: any) => e.node.text) ?? [];

      expect(getComments()).toEqual(["Comment 1", "Comment 2"]);
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(getComments()).toEqual(["Comment 1", "Comment 2", "Comment 3"]);
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("merges paginated cache data with network response", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { role: "admin", first: 2, after: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "cached-u1@example.com" }]),
        },
      });

      const routes = [
        {
          when: ({ variables }: any) => variables.role === "admin" && variables.after == null,
          respond: () => ({
            data: {
              __typename: "Query",
              users: fixtures.users.buildConnection([
                { id: "u1", email: "fresh-u1@example.com" },
                { id: "u2", email: "fresh-u2@example.com" },
              ]),
            },
          }),
          delay: 20,
        },
      ];

      const { cache, fx } = createTestClient({ routes, cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "admin", first: 2, after: null }),
        cachePolicy: "cache-and-network",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("cached-u1@example.com");
      expect(fx.calls.length).toBe(1);

      await delay(30);
      await tick();
      flushSync();

      expect(q.data.users.edges.map((e: any) => e.node.email)).toEqual([
        "fresh-u1@example.com",
        "fresh-u2@example.com",
      ]);
      expect(fx.calls.length).toBe(1);

      q.dispose();
      await fx.restore();
    });
  });

  describe("cache-only policy", () => {
    it("returns cached data without making network requests", async () => {
      const { cache: seedCacheInstance } = createTestClient();

      await seedCache(seedCacheInstance, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "admin", usersFirst: 2, usersAfter: null },
        data: {
          __typename: "Query",
          users: fixtures.users.buildConnection([{ id: "u1", email: "u1@example.com" }]),
        },
      });

      const { cache, fx } = createTestClient({ cache: seedCacheInstance });

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ usersRole: "admin", usersFirst: 2, usersAfter: null }),
        cachePolicy: "cache-only",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data.users.edges[0].node.email).toBe("u1@example.com");
      expect(fx.calls.length).toBe(0);
      expect(q.dataUpdates.filter((d: any) => d !== "undefined").length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("renders empty state when cache is empty", async () => {
      const { cache, fx } = createTestClient();

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ usersRole: "admin", usersFirst: 2, usersAfter: null }),
        cachePolicy: "cache-only",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.data).toBeUndefined();
      expect(fx.calls.length).toBe(0);
      expect(q.errorUpdates.length).toBe(1);

      q.dispose();
      await fx.restore();
    });

    it("displays error when cache miss occurs", async () => {
      const { cache, fx } = createTestClient();

      const q = createTestQuery(cache, operations.USERS_QUERY, {
        variables: () => ({ role: "admin", first: 2, after: null }),
        cachePolicy: "cache-only",
      });

      await tick();
      flushSync();
      await delay(10);
      flushSync();

      expect(q.error).toBeTruthy();
      expect(q.error!.message).toContain("Cache miss");
      expect(fx.calls.length).toBe(0);

      q.dispose();
      await fx.restore();
    });
  });
});
