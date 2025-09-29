import { describe, it, expect } from "vitest";
import { defineComponent, h, watch } from "vue";
import { mount } from '@vue/test-utils';
import {
  mountWithClient,
  createTestClient,
  fixtures,
  seedCache,
  operations,
  delay,
  tick,
  getEdges,
  getPageInfo,
  createConnectionComponent,
  createDetailComponent,
} from '@/test/helpers';
import { provideCachebay } from '@/src/core/plugin';

describe("Cache Policies Behavior", () => {
  describe("cache-first policy", () => {
    it("miss → one network then render (root users connection)", async () => {
      const routes = [
        {
          when: ({ variables }) => variables.usersRole === "tech",
          delay: 30,
          respond: () => fixtures.users.query(["tech.user@example.com"]),
        },
      ];

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",
        connectionFn: (data) => data.users
      });

      const { wrapper, fx } = await mountWithClient(Cmp, routes, { usersRole: "tech", usersFirst: 2, usersAfter: null });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(40);
      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["tech.user@example.com"]);

      await fx.restore();
    });

    it("hit emits cached and terminates, no network call (root users)", async () => {
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "cached", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["cached.user@example.com"]).data,
      });

      await delay(5);

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-first",
        connectionFn: (data) => data.users
      });

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient([]);
      const wrapper = mount(Cmp, {
        props: { usersRole: "cached", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["cached.user@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("single object • miss → one network then render (User)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.id === "42", delay: 15, respond: () => fixtures.singleUser.query("42", "answer@example.com") },
      ];

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",
        detailFn: (data) => data.user
      });
      const { wrapper, fx } = await mountWithClient(Cmp, routes, { id: "42" });

      await tick();
      expect(getEdges(wrapper, "email").join("")).toBe("");
      expect(fx.calls.length).toBe(1);

      await delay(20);
      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["answer@example.com"]);
      await fx.restore();
    });

    it("single object • hit emits cached and terminates, no network (User)", async () => {
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

      await seedCache(cache, {
        query: operations.USER_QUERY,
        variables: { id: "7" },
        data: fixtures.singleUser.query("7", "cached@example.com").data,
      });

      await delay(5);

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "cache-first",
        detailFn: (data) => data.user
      });

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient([]);
      const wrapper = mount(Cmp, {
        props: { id: "7" },
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["cached@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });
  });

  describe("cache-and-network policy", () => {
    it("hit → immediate cached render then network refresh once (root users)", async () => {
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

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

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => data.users
      });

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient(routes);
      const wrapper = mount(Cmp, {
        props: { usersRole: "news", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["old.news@example.com"]);

      await delay(20);
      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["fresh.news@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("identical network as cache → single render", async () => {
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);
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

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => data.users
      });

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient(routes);
      const wrapper = mount(Cmp, {
        props: { usersRole: "same", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["same.user@example.com"]);

      await delay(15);
      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["same.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("different network → two renders (recorded)", async () => {
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

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

      // Create a tracking component using createConnectionComponent with watch
      const Cmp = defineComponent({
        name: "UsersDiffTracker",
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

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient(routes);
      const wrapper = mount(Cmp, {
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["initial.user@example.com"]);

      await delay(15);
      await tick();
      expect(renders).toEqual([["initial.user@example.com"], ["updated.user@example.com"]]);
      expect(getEdges(wrapper, "email")).toEqual(["updated.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("miss → one render on network response (root users)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "miss", delay: 5, respond: () => fixtures.users.query(["new.user@example.com"]) },
      ];

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-and-network",
        connectionFn: (data) => data.users
      });
      const { wrapper, fx } = await mountWithClient(Cmp, routes, { usersRole: "miss", usersFirst: 2, usersAfter: null });

      await tick();
      expect(getEdges(wrapper, "email")).toEqual([]);

      await delay(8);
      await tick();
      expect(getEdges(wrapper, "email")).toEqual(["new.user@example.com"]);
      expect(fx.calls.length).toBe(1);
      await fx.restore();
    });

    it("nested Post→Comments (uuid) • hit then refresh", async () => {

      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

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

      const { wrapper, fx } = await mountWithClient(Cmp, routes, cache);

      await tick();
      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2"]);

      await delay(125);

      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 1", "Comment 2", "Comment 3"]);

      await fx.restore();
    });
  });

  describe("network-only policy", () => {
    it("no cache, renders only on network (users)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.usersRole === "network", delay: 20, respond: () => fixtures.users.query(["network.user@example.com"]) },
      ];

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "network-only",
        connectionFn: (data) => data.users
      });
      const { wrapper, fx } = await mountWithClient(Cmp, routes, { usersRole: "network", usersFirst: 2, usersAfter: null });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(getEdges(wrapper, "email")).toEqual(["network.user@example.com"]);
      await fx.restore();
    });

    it("single object • no cache, renders on network (User)", async () => {
      const routes: Route[] = [
        { when: ({ variables }) => variables.id === "501", delay: 15, respond: () => fixtures.singleUser.query("501", "net@example.com") },
      ];

      const Cmp = createDetailComponent(operations.USER_QUERY, {
        cachePolicy: "network-only",
        detailFn: (data) => data.user
      });
      const { wrapper, fx } = await mountWithClient(Cmp, routes, { id: "501" });

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
      const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

      await seedCache(cache, {
        query: operations.USERS_QUERY,
        variables: { usersRole: "hit", usersFirst: 2, usersAfter: null },
        data: fixtures.users.query(["hit.user@example.com"]).data,
      });

      await delay(5);

      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",
        connectionFn: (data) => data.users
      });

      // Create client with existing cache
      const { client, fx: fx2 } = createTestClient([]);
      const wrapper = mount(Cmp, {
        props: { usersRole: "hit", usersFirst: 2, usersAfter: null },
        global: {
          plugins: [
            client,
            {
              install(app) {
                provideCachebay(app, cache);
              },
            },
          ],
        },
      });
      const fx = fx2;

      await delay(10);
      expect(getEdges(wrapper, "email")).toEqual(["hit.user@example.com"]);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("miss renders nothing and does not network", async () => {
      const Cmp = createConnectionComponent(operations.USERS_QUERY, {
        cachePolicy: "cache-only",
        connectionFn: (data) => data.users
      });
      const { wrapper, fx } = await mountWithClient(Cmp, [], { usersRole: "miss", usersFirst: 2, usersAfter: null });

      await tick();
      expect(getEdges(wrapper, "email").length).toBe(0);
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });

    it("miss yields CacheOnlyMiss error", async () => {
      const Cmp = defineComponent({
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

      const { wrapper, fx } = await mountWithClient(Cmp, []);
      await tick();
      expect(wrapper.text()).toContain("CacheOnlyMiss");
      expect(fx.calls.length).toBe(0);
      await fx.restore();
    });
  });

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

      const { wrapper, fx } = await mountWithClient(Cmp, routes);
      await delay(12);
      await tick();
      expect(wrapper.findAll("div").map((d) => d.text())).toEqual(["Comment 3", "Comment 4"]);
      await fx.restore();
    });
  });

  it("return visit: cached union emits first, leader network collapses to leader slice (root users)", async () => {

    const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

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

    const routes: Route[] = [
      {
        when: ({ variables }) =>
          variables.usersRole === "revisit" && variables.usersAfter == null,
        delay: 15,
        respond: () => fixtures.users.query(["a1@example.com", "a2@example.com"]),
      },
    ];

    const Cmp = createConnectionComponent(operations.USERS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => data.users
    });

    // Create client with existing cache
    const { client, fx: fx2 } = createTestClient(routes);
    const wrapper = mount(Cmp, {
      props: { usersRole: "revisit", usersFirst: 2, usersAfter: null },
      global: {
        plugins: [
          client,
          {
            install(app) {
              provideCachebay(app, cache);
            },
          },
        ],
      },
    });
    const fx = fx2;

    await tick();
    expect(getEdges(wrapper, "email")).toEqual(["a3@example.com"]);

    await delay(20);
    await tick();
    expect(getEdges(wrapper, "email")).toEqual(["a1@example.com", "a2@example.com"]);
    expect(fx.calls.length).toBe(1);

    await fx.restore();
  });

  it.skip("asking next page again: cache shows instantly; network slice replaces without dupes", async () => {
    const { cache } = await mountWithClient(defineComponent({ render: () => h("div") }), []);

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

    const routes: Route[] = [
      {
        when: ({ variables }) =>
          variables.usersRole === "again" && variables.usersAfter === "l2",
        delay: 12,
        respond: () => fixtures.users.query(["n1@example.com"]),
      },
    ];

    const Cmp = createConnectionComponent(operations.USERS_QUERY, {
      cachePolicy: "cache-and-network",
      connectionFn: (data) => data.users
    });

    // Create client with existing cache
    const { client, fx: fx2 } = createTestClient(routes);
    const wrapper = mount(Cmp, {
      props: { usersRole: "again", usersFirst: 2, usersAfter: "l2" },
      global: {
        plugins: [
          client,
          {
            install(app) {
              provideCachebay(app, cache);
            },
          },
        ],
      },
    });
    const fx = fx2;

    await tick();
    expect(getEdges(wrapper, "email")).toEqual([
      "l1@example.com",
      "l2@example.com",
      "n1@example.com",
      "n2@example.com",
    ]);

    await delay(20);
    await tick();
    expect(getEdges(wrapper, "email")).toEqual([
      "l1@example.com",
      "l2@example.com",
      "n1@example.com",
    ]);

    expect(fx.calls.length).toBe(1);
    await fx.restore();
  });
});
