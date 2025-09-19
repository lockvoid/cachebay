import { describe, it, expect } from "vitest";
import { defineComponent, h, watch } from "vue";
import {
  mountWithClient,
  seedCache,
  tick,
  delay,
  type Route,
  fixtures,
  operations,
} from "@/test/helpers";

// tiny helper to read rendered rows (each row is a bare <div> with text)
const rows = (wrapper: any) =>
  wrapper.findAll("div").map((n: any) => n.text()).filter((t: string) => t !== "");

/* -----------------------------------------------------------------------------
 * Components
 * -------------------------------------------------------------------------- */

const UsersList = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
  vars: any
) =>
  defineComponent({
    name: "UsersList",
    setup() {
      const { useQuery } = require("villus");
      const { data } = useQuery({ query: operations.USERS_QUERY, variables: vars, cachePolicy: policy });
      return () => {
        const usersEdges = data.value?.users?.edges ?? [];
        return usersEdges.map((e: any) => h("div", {}, e?.node?.email ?? ""));
      };
    },
  });

const UserTitle = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
  id: string
) =>
  defineComponent({
    name: "UserTitle",
    setup() {
      const { useQuery } = require("villus");
      const { data } = useQuery({ query: operations.USER_QUERY, variables: { id }, cachePolicy: policy });
      return () => h("div", {}, data.value?.user?.email ?? "");
    },
  });

// Nested: User -> Posts(tech) -> first post -> Comments (uuid identity)
// Renders comment texts
const UserPostComments = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only"
) =>
  defineComponent({
    name: "UserPostComments",
    setup() {
      const { useQuery } = require("villus");
      const vars = {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      };
      const { data } = useQuery({ query: operations.USER_POSTS_COMMENTS_QUERY, variables: vars, cachePolicy: policy });
      return () => {
        const postEdges = data.value?.user?.posts?.edges ?? [];
        const firstPost = postEdges[0]?.node;
        const commentEdges = firstPost?.comments?.edges ?? [];
        return commentEdges.map((e: any) => h("div", {}, e?.node?.text ?? ""));
      };
    },
  });

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

describe("Cache Policies Behavior", () => {
  // ────────────────────────────────────────────────────────────────────────────
  // cache-first
  // ────────────────────────────────────────────────────────────────────────────
  describe("cache-first policy", () => {
    it("miss → one network then render (root users connection)", async () => {
      const routes: Route[] = [
        {
          when: ({ variables }) => variables.usersRole === "tech",
          delay: 30,
          respond: () => fixtures.users.query(["tech.user@example.com"]),
        },
      ];

      const Comp = UsersList("cache-first", { usersRole: "tech", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, routes);

      await tick();
      expect(rows(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(40);
      await tick();
      expect(rows(wrapper)).toEqual(["tech.user@example.com"]);
      await fx.restore();
    });

    it("hit emits cached and terminates, no network call (root users)", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "cached", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["cached.user@example.com"]).data,
      });

      await delay(5);

      const Comp = UsersList("cache-first", { usersRole: "cached", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, [], cache);

      await delay(10);
      expect(rows(wrapper)).toEqual(["cached.user@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("single object • miss → one network then render (User)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.id === "42", delay: 15, respond: () => fixtures.singleUser.query("42", "answer@example.com") },
      ];

      const Comp = UserTitle("cache-first", "42");
      const { wrapper, fx } = await mountWithClient(Comp, routes);

      await tick();
      expect(rows(wrapper).join("")).toBe("");
      expect(fx.calls.length).toBe(1);

      await delay(20);
      await tick();
      expect(rows(wrapper)).toEqual(["answer@example.com"]);
      await fx.restore();
    });

    it("single object • hit emits cached and terminates, no network (User)", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;

      await seedCache(cache, {
        query: operations.USER_QUERY,
        variables: { id: "7" },
        data: fixtures.singleUser.query("7", "cached@example.com").data,
      });

      await delay(5);

      const Comp = UserTitle("cache-first", "7");
      const { wrapper, fx } = await mountWithClient(Comp, [], cache);

      await delay(10);
      expect(rows(wrapper)).toEqual(["cached@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // cache-and-network
  // ────────────────────────────────────────────────────────────────────────────
  describe("cache-and-network policy", () => {
    it("hit → immediate cached render then network refresh once (root users)", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "news", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["old.news@example.com"]).data,
      });

      await delay(5);

      const routes: Route[] = [
        {
          when: ({ variables }) => variables.usersRole === "news",
          delay: 15,
          respond: () => fixtures.users.query(["fresh.news@example.com"]),
        },
      ];

      const Comp = UsersList("cache-and-network", { usersRole: "news", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

      await delay(10);
      expect(rows(wrapper)).toEqual(["old.news@example.com"]);

      await delay(20);
      await tick();
      expect(rows(wrapper)).toEqual(["fresh.news@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("identical network as cache → single render", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;
      const cached = fixtures.users.query(["same.user@example.com"]).data;

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "same", usersFirst: 2, usersAfter: null },
        data: cached,
      });

      await delay(5);

      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "same", delay: 10, respond: () => ({ data: cached }) },
      ];

      const Comp = UsersList("cache-and-network", { usersRole: "same", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

      await delay(10);
      expect(rows(wrapper)).toEqual(["same.user@example.com"]);

      await delay(15);
      await tick();
      expect(rows(wrapper)).toEqual(["same.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("different network → two renders (recorded)", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "diff", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["initial.user@example.com"]).data,
      });

      await delay(5);

      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "diff", delay: 10, respond: () => fixtures.users.query(["updated.user@example.com"]) },
      ];

      const renders: string[][] = [];
      const Comp = defineComponent({
        name: "UsersDiff",
        setup() {
          const { useQuery } = require("villus");
          const { data } = useQuery({
            query: operations.USERS_QUERY,
            variables: { usersRole: "diff", usersFirst: 2, usersAfter: null },
            cachePolicy: "cache-and-network",
          });
          watch(
            () => data.value,
            (v) => {
              const emails = (v?.users?.edges ?? []).map((e: any) => e?.node?.email ?? "");
              if (emails.length) renders.push(emails);
            },
            { immediate: true }
          );
          return () => (data.value?.users?.edges ?? []).map((e: any) => h("div", {}, e?.node?.email ?? ""));
        },
      });

      const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

      await tick();
      expect(rows(wrapper)).toEqual(["initial.user@example.com"]);

      await delay(15);
      await tick();
      expect(renders).toEqual([["initial.user@example.com"], ["updated.user@example.com"]]);
      expect(rows(wrapper)).toEqual(["updated.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("miss → one render on network response (root users)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "miss", delay: 5, respond: () => fixtures.users.query(["new.user@example.com"]) },
      ];

      const Comp = UsersList("cache-and-network", { usersRole: "miss", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, routes);

      await tick();
      expect(rows(wrapper)).toEqual([]);

      await delay(8);
      await tick();
      expect(rows(wrapper)).toEqual(["new.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("nested Post→Comments (uuid) • hit then refresh", async () => {
      // bootstrap a cache instance we can seed directly
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

      // Seed: User u1 with Posts(tech) page → P1 that already has Comments(C1, C2) canonicalized
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
                  title: "P1",
                  extras: {
                    comments: fixtures.comments.connection(["Comment 1", "Comment 2"], { postId: "p1", fromId: 1 }),
                  },
                },
              ],
              { fromId: 1 }
            ),
          },
        },
      });

      await delay(5);

      // Network: we revalidate the SAME leader (no cursor) and server now includes C3 as well.
      // (We don't auto-fire an 'after' request; canonical union grows because the leader payload changed.)
      const routes: Route[] = [
        {
          when: ({ variables }) =>
            variables.id === "u1" &&
            variables.postsCategory === "tech" &&
            variables.commentsFirst === 2 &&
            variables.commentsAfter == null,
          delay: 12,
          respond: () => ({
            data: {
              __typename: "Query",
              user: {
                __typename: "User",
                id: "u1",
                posts: fixtures.posts.connection(
                  [
                    {
                      title: "P1",
                      extras: {
                        comments: fixtures.comments.connection(["Comment 1", "Comment 2", "Comment 3"], {
                          postId: "p1",
                          fromId: 1,
                        }),
                      },
                    },
                  ],
                  { fromId: 1 }
                ),
              },
            },
          }),
        },
      ];

      // Component that reads: User(u1) → posts(tech first:1) → edges[0].node.comments(first:2, after:null)
      const Comp = defineComponent({
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

      const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

      // Immediate cached render (C1, C2)
      await tick();
      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2"]);

      // After network revalidate, canonical shows C1, C2, C3
      await delay(125);


      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2", "Comment 3"]);

      await fx.restore();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // network-only
  // ────────────────────────────────────────────────────────────────────────────
  describe("network-only policy", () => {
    it("no cache, renders only on network (users)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "network", delay: 20, respond: () => fixtures.users.query(["network.user@example.com"]) },
      ];

      const Comp = UsersList("network-only", { usersRole: "network", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, routes);

      await tick();
      expect(rows(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(rows(wrapper)).toEqual(["network.user@example.com"]);
      await fx.restore();
    });

    it("single object • no cache, renders on network (User)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.id === "501", delay: 15, respond: () => fixtures.singleUser.query("501", "net@example.com") },
      ];

      const Comp = UserTitle("network-only", "501");
      const { wrapper, fx } = await mountWithClient(Comp, routes);

      await tick();
      expect(rows(wrapper)).toEqual([]);
      expect(fx.calls.length).toBe(1);

      await delay(20);
      expect(rows(wrapper)).toEqual(["net@example.com"]);
      await fx.restore();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // cache-only
  // ────────────────────────────────────────────────────────────────────────────
  describe("cache-only policy", () => {
    it("hit renders cached data, no network call (users)", async () => {
      const cache = (await mountWithClient(defineComponent({ render: () => h("div") }), [])).cache;

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "hit", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["hit.user@example.com"]).data,
      });

      await delay(5);

      const Comp = UsersList("cache-only", { usersRole: "hit", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, [], cache);

      await delay(10);
      expect(rows(wrapper)).toEqual(["hit.user@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("miss renders nothing and does not network", async () => {
      const Comp = UsersList("cache-only", { usersRole: "miss", usersFirst: 2, usersAfter: null });
      const { wrapper, fx } = await mountWithClient(Comp, []);

      await tick();
      expect(rows(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("miss yields CacheOnlyMiss error", async () => {
      const Comp = defineComponent({
        name: "CacheOnlyMissComp",
        setup() {
          const { useQuery } = require("villus");
          const { data, error } = useQuery({
            query: operations.USERS_QUERY,
            variables: { usersRole: "miss", usersFirst: 2, usersAfter: null },
            cachePolicy: "cache-only",
          });
          return () => h("div", {}, error?.value?.networkError?.name || String((data?.value?.users?.edges ?? []).length));
        },
      });

      const { wrapper, fx } = await mountWithClient(Comp, []);
      await tick();
      expect(wrapper.text()).toContain("CacheOnlyMiss");
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // cursor replay (simple smoke via network-only)
  // ────────────────────────────────────────────────────────────────────────────
  describe("cursor replay (network-only) — nested comments page", () => {
    it("publishes terminally — simple smoke via network-only", async () => {
      const routes: Route[] = [
        {
          when: ({ variables }) =>
            variables.id === "u1" &&
            variables.postsCategory === "tech" &&
            variables.commentsFirst === 2 &&
            variables.commentsAfter === "c2",
          delay: 10,
          respond: () => ({
            data: {
              __typename: "Query",
              user: {
                __typename: "User",
                id: "u1",
                posts: fixtures.posts.connection(
                  [
                    {
                      title: "P1",
                      extras: {
                        comments: fixtures.comments.connection(["Comment 3", "Comment 4"], { postId: "p1", fromId: 3 }),
                      },
                    },
                  ],
                  { fromId: 1 }
                ),
              },
            },
          }),
        },
      ];

      const Comp = defineComponent({
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

      const { wrapper, fx } = await mountWithClient(Comp, routes);
      await delay(12);
      await tick();
      expect(rows(wrapper)).toEqual(["Comment 3", "Comment 4"]);
      await fx.restore();
    });
  });
});
