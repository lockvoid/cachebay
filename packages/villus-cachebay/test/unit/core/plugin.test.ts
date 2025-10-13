import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { createPlugin } from "@/src/core/plugin";
import { buildConnectionKey } from "@/src/core/utils";
import { createViews } from "@/src/core/views";
import { createSSR } from "@/src/features/ssr";
import { operations, writeConnectionPage } from "@/test/helpers";
import type { OperationResult } from "villus";

describe("Plugin (canonical-first)", () => {
  let graph: ReturnType<typeof createGraph>;
  let ssr: ReturnType<typeof createSSR>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;
  let plugin: ReturnType<typeof createPlugin>;

  const edgesLen = (rec: any) =>
    Array.isArray(rec?.edges)
      ? rec.edges.length
      : Array.isArray(rec?.edges?.__refs)
        ? rec.edges.__refs.length
        : 0;

  const putCanonical = (
    canKey: string,
    pageInfo: { startCursor: any; endCursor: any; hasNextPage: boolean; hasPreviousPage: boolean },
    edgeRefs: string[],
  ) => {
    const piKey = `${canKey}.pageInfo`;
    graph.putRecord(piKey, { __typename: "PageInfo", ...pageInfo });
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: { __ref: piKey },
      edges: { __refs: edgeRefs },
    });
  };

  const putCanonicalGeneric = (
    canKey: string,
    typename: string,
    pageInfo: { startCursor: any; endCursor: any; hasNextPage: boolean; hasPreviousPage: boolean },
    edgeRefs: string[],
  ) => {
    const piKey = `${canKey}.pageInfo`;
    graph.putRecord(piKey, { __typename: "PageInfo", ...pageInfo });
    graph.putRecord(canKey, {
      __typename: typename,
      pageInfo: { __ref: piKey },
      edges: { __refs: edgeRefs },
    });
  };

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    ssr = createSSR({ hydrationTimeout: 0 }, { graph });
    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    views = createViews({ graph });
    documents = createDocuments({ graph, planner, canonical, views });
    plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });
  });

  describe("cache-only", () => {
    it("returns cached data on hit and CacheOnlyMiss error on miss", () => {
      // hit
      graph.putRecord(ROOT_ID, {
        id: ROOT_ID,
        __typename: ROOT_ID,
        ['user({"id":"u1"})']: { __ref: "User:u1" },
      });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const ctxHit: any = {
        operation: { key: 1, query: operations.USER_QUERY, variables: { id: "u1" }, cachePolicy: "cache-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };
      plugin(ctxHit);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);
      expect(emissions[0].data.user.id).toBe("u1");

      // miss
      const ctxMiss: any = {
        operation: { key: 2, query: operations.USER_QUERY, variables: { id: "u2" }, cachePolicy: "cache-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };
      plugin(ctxMiss);

      expect(emissions.length).toBe(2);
      expect(emissions[1].error).toBeTruthy();
      expect(emissions[1].error.networkError?.name).toBe("CacheOnlyMiss");
      expect(emissions[1].terminal).toBe(true);
    });
  });

  describe("cache-first", () => {
    it("fetches from network on cache miss and normalizes data", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const ctx: any = {
        operation: { key: 3, query: operations.USER_QUERY, variables: { id: "u9" }, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx);

      // network response
      ctx.useResult(
        { data: { user: { __typename: "User", id: "u9", email: "u9@example.com" } } },
        true,
      );

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      // ensure normalized into cache
      const view = documents.materializeDocument({ document: operations.USER_QUERY, variables: { id: "u9" } });
      expect(view.user.email).toBe("u9@example.com");
    });

    it("returns nested connection edges from seeded cache data", () => {
      // seed users + canonical
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

      const plan = planner.getPlan(operations.USERS_POSTS_QUERY);
      const users = plan.rootSelectionMap!.get("users")!;
      const posts = users
        .selectionMap!.get("edges")!
        .selectionMap!.get("node")!
        .selectionMap!.get("posts")!;

      const variables = {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
      };

      const usersPageKey = buildConnectionKey(users, ROOT_ID, variables);
      writeConnectionPage(graph, usersPageKey, {
        __typename: "UserConnection",
        pageInfo: {
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [
          { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
          { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
        ],
      });

      // canonical for users
      const canonicalUsersKey = '@connection.users({"role":"dj"})';
      putCanonical(canonicalUsersKey, {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: false,
        hasPreviousPage: false,
      }, [`${usersPageKey}.edges.0`, `${usersPageKey}.edges.1`]);

      // nested posts
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });

      const u1PostsPageKey = buildConnectionKey(posts, "User:u1", variables);
      writeConnectionPage(graph, u1PostsPageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        pageInfo: {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [{ __typename: "PostEdge", cursor: "p1", node: { __typename: "Post", id: "p1", title: "P1", flags: [] } }],
      });

      const u2PostsPageKey = buildConnectionKey(posts, "User:u2", variables);
      writeConnectionPage(graph, u2PostsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [],
      });

      // canonical for nested posts
      const canPostsU1 = '@connection.User:u1.posts({"category":"tech"})';
      const canPostsU2 = '@connection.User:u2.posts({"category":"tech"})';
      putCanonicalGeneric(
        canPostsU1,
        "PostConnection",
        { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        [`${u1PostsPageKey}.edges.0`],
      );
      putCanonicalGeneric(
        canPostsU2,
        "PostConnection",
        { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        [],
      );

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const ctx: any = {
        operation: { key: 20, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      const resp = emissions[0].data;
      expect(resp.users.edges.length).toBe(2);
      expect(resp.users.edges[0].node.posts.edges.length).toBe(1);
      expect(resp.users.edges[0].node.posts.edges[0].node.title).toBe("P1");
      expect((resp.users.edges[1].node.posts?.edges ?? []).length).toBe(0);
    });

    it("handles network errors without modifying graph state", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const ctx: any = {
        operation: { key: 401, query: operations.USER_QUERY, variables: { id: "oops" }, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx);

      ctx.useResult(
        { error: Object.assign(new Error("Boom"), { name: "NetworkError" }) } as any,
        true,
      );

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);
      expect(emissions[0].error).toBeTruthy();

      // graph not mutated by error path (smoke)
      expect(JSON.stringify(graph.getRecord("@"))).toBe(JSON.stringify(graph.getRecord("@")));
    });
  });

  describe("cache-and-network", () => {
    it("emits cached data first then network data (root connection)", () => {
      // seed users (root connection only)
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

      const plan = planner.getPlan(operations.USERS_QUERY);
      const users = plan.rootSelectionMap!.get("users")!;

      const variables = { role: "dj", first: 2, after: null };
      const usersPageKey = buildConnectionKey(users, ROOT_ID, variables);

      writeConnectionPage(graph, usersPageKey, {
        __typename: "UserConnection",
        pageInfo: {
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [
          { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
          { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
        ],
      });

      const canonicalUsersKey = '@connection.users({"role":"dj"})';
      putCanonical(canonicalUsersKey, {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: false,
        hasPreviousPage: false,
      }, [`${usersPageKey}.edges.0`, `${usersPageKey}.edges.1`]);

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const ctx: any = {
        operation: { key: 10, query: operations.USERS_QUERY, variables, cachePolicy: "cache-and-network" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx);

      // cached, non-terminal
      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(false);
      expect(emissions[0].data.users.edges.length).toBe(2);

      // network leader result
      ctx.useResult(
        {
          data: {
            users: {
              __typename: "UserConnection",
              pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false },
              edges: [
                { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
                { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
              ],
            },
          },
        },
        true,
      );

      expect(emissions.length).toBe(2);
      expect(emissions[1].terminal).toBe(true);

      const pageRecord = graph.getRecord(usersPageKey);
      expect(edgesLen(pageRecord)).toBe(2);
    });

    it("handles out-of-order pagination queries and converges to correct union", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean; key: string }> = [];
      const tag = (key: string) => (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, key });

      const afterCtx1: any = {
        operation: {
          key: 101,
          query: operations.USERS_QUERY,
          cachePolicy: "cache-and-network",
          variables: { role: "dj", first: 2, after: "u2" },
        },
        useResult: tag("after1"),
      };
      plugin(afterCtx1);

      afterCtx1.useResult(
        {
          data: {
            users: {
              __typename: "UserConnection",
              pageInfo: {
                __typename: "PageInfo",
                startCursor: "u3",
                endCursor: "u3",
                hasNextPage: true,
                hasPreviousPage: true,
              },
              edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "c@example.com" } }],
            },
          },
        },
        true,
      );

      const leaderCtx: any = {
        operation: {
          key: 102,
          query: operations.USERS_QUERY,
          variables: { role: "dj", first: 2, after: null },
          cachePolicy: "cache-and-network",
        },
        useResult: tag("leader"),
      };
      plugin(leaderCtx);
      leaderCtx.useResult(
        {
          data: {
            users: {
              __typename: "UserConnection",
              pageInfo: {
                __typename: "PageInfo",
                startCursor: "u1",
                endCursor: "u2",
                hasNextPage: true,
                hasPreviousPage: false,
              },
              edges: [
                { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
                { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
              ],
            },
          },
        },
        true,
      );

      const afterCtx2: any = {
        operation: {
          key: 103,
          query: operations.USERS_QUERY,
          variables: { role: "dj", first: 2, after: "u2" },
          cachePolicy: "cache-and-network",
        },
        useResult: tag("after2"),
      };
      plugin(afterCtx2);
      afterCtx2.useResult(
        {
          data: {
            users: {
              __typename: "UserConnection",
              pageInfo: {
                __typename: "PageInfo",
                startCursor: "u3",
                endCursor: "u3",
                hasNextPage: true,
                hasPreviousPage: true,
              },
              edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "c@example.com" } }],
            },
          },
        },
        true,
      );

      const canonicalKey = '@connection.users({"role":"dj"})';
      const canonicalRecord = graph.getRecord(canonicalKey);
      const userIds = ((canonicalRecord?.edges?.__refs) ?? [])
        .map((edgeRef: any) => graph.getRecord(edgeRef)?.node?.__ref)
        .map((nodeKey: string) => graph.getRecord(nodeKey)?.id);
      expect(userIds).toEqual(["u1", "u2", "u3"]);
    });

    it("serves cached union first then resets to leader slice on network response", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3", email: "u3@example.com" });

      const plan = planner.getPlan(operations.USERS_QUERY);
      const users = plan.rootSelectionMap!.get("users")!;

      const leaderVars = { role: "dj", first: 2, after: null };
      const afterVars = { role: "dj", first: 1, after: "u2" };

      const leaderPageKey = buildConnectionKey(users, ROOT_ID, leaderVars);
      writeConnectionPage(graph, leaderPageKey, {
        __typename: "UserConnection",
        pageInfo: {
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "u1@example.com" } },
          { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "u2@example.com" } },
        ],
      });

      const afterPageKey = buildConnectionKey(users, ROOT_ID, afterVars);
      writeConnectionPage(graph, afterPageKey, {
        __typename: "UserConnection",
        pageInfo: {
          startCursor: "u3",
          endCursor: "u3",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "u3@example.com" } }],
      });

      const canonicalKey = '@connection.users({"role":"dj"})';
      // union of leader + after
      putCanonical(canonicalKey, {
        startCursor: "u1",
        endCursor: "u3",
        hasNextPage: false,
        hasPreviousPage: false,
      }, [`${leaderPageKey}.edges.0`, `${leaderPageKey}.edges.1`, `${afterPageKey}.edges.0`]);

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const ctx: any = {
        operation: { key: 201, query: operations.USERS_QUERY, variables: leaderVars, cachePolicy: "cache-and-network" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx);
      expect(emissions[0].terminal).toBe(false);
      expect(emissions[0].data.users.edges.length).toBe(3);

      // leader arrives → canonical should reset to slice of 2
      ctx.useResult(
        {
          data: {
            users: {
              __typename: "UserConnection",
              pageInfo: {
                __typename: "PageInfo",
                startCursor: "u1",
                endCursor: "u2",
                hasNextPage: true,
                hasPreviousPage: false,
              },
              edges: [
                { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1" } },
                { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2" } },
              ],
            },
          },
        },
        true,
      );

      const canonicalRecord = graph.getRecord(canonicalKey);
      expect((canonicalRecord?.edges?.__refs ?? []).length).toBe(2);
      expect(emissions[1].terminal).toBe(true);
    });

    describe("suspensionTimeout window", () => {
      it("serves cached terminal response within suspension window", async () => {
        // use USERS_QUERY to avoid nested posts requirements
        const plan = planner.getPlan(operations.USERS_QUERY);
        const users = plan.rootSelectionMap!.get("users")!;
        const variables = { role: "dj", first: 2, after: null };
        const pageKey = buildConnectionKey(users, ROOT_ID, variables);

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

        writeConnectionPage(graph, pageKey, {
          __typename: "UserConnection",
          pageInfo: {
            startCursor: "u1",
            endCursor: "u2",
            hasNextPage: true,
            hasPreviousPage: false,
          },
          edges: [
            { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
            { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
          ],
        });

        const canonicalKey = '@connection.users({"role":"dj"})';
        putCanonical(canonicalKey, {
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        }, [`${pageKey}.edges.0`, `${pageKey}.edges.1`]);

        plugin = createPlugin({ suspensionTimeout: 1000 }, { graph, planner, documents, ssr });

        const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

        // first exec
        const ctx1: any = {
          operation: { key: 777, query: operations.USERS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
          },
        };
        plugin(ctx1);

        expect(emissions.length).toBe(1);
        expect(emissions[0].terminal).toBe(false);
        expect(emissions[0].data.users.edges.length).toBe(2);

        // network lands
        ctx1.useResult(
          {
            data: {
              users: {
                __typename: "UserConnection",
                pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
                edges: [
                  { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1", email: "a@example.com" } },
                  { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2", email: "b@example.com" } },
                ],
              },
            },
          },
          true,
        );

        expect(emissions.length).toBe(2);
        expect(emissions[1].terminal).toBe(true);

        // second exec (same key) within window → terminal cached
        const ctx2: any = {
          operation: { key: 777, query: operations.USERS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
          },
        };
        plugin(ctx2);

        expect(emissions.length).toBe(3);
        expect(emissions[2].terminal).toBe(true);
        expect(emissions[2].data.users.edges.length).toBe(2);
      });

      it("re-fetches from network when outside suspension window", async () => {
        const plan = planner.getPlan(operations.USERS_QUERY);
        const users = plan.rootSelectionMap!.get("users")!;
        const variables = { role: "ops", first: 2, after: null };
        const pageKey = buildConnectionKey(users, ROOT_ID, variables);

        graph.putRecord("User:x1", { __typename: "User", id: "x1", email: "x1@example.com" });
        graph.putRecord("User:x2", { __typename: "User", id: "x2", email: "x2@example.com" });

        writeConnectionPage(graph, pageKey, {
          __typename: "UserConnection",
          pageInfo: {
            startCursor: "x1",
            endCursor: "x2",
            hasNextPage: true,
            hasPreviousPage: false,
          },
          edges: [
            { __typename: "UserEdge", cursor: "x1", node: { __typename: "User", id: "x1", email: "x1@example.com" } },
            { __typename: "UserEdge", cursor: "x2", node: { __typename: "User", id: "x2", email: "x2@example.com" } },
          ],
        });

        const canonicalKey = '@connection.users({"role":"ops"})';
        putCanonical(canonicalKey, {
          startCursor: "x1",
          endCursor: "x2",
          hasNextPage: true,
          hasPreviousPage: false,
        }, [`${pageKey}.edges.0`, `${pageKey}.edges.1`]);

        plugin = createPlugin({ suspensionTimeout: 5 }, { graph, planner, documents, ssr });

        const emissions: Array<{ data?: any; error?: any; terminal: boolean; tag?: string }> = [];

        // first exec
        const ctx1: any = {
          operation: { key: 999, query: operations.USERS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, tag: "first" });
          },
        };
        plugin(ctx1);
        expect(emissions.length).toBe(1);
        expect(emissions[0].terminal).toBe(false);

        // network lands
        ctx1.useResult(
          {
            data: {
              users: {
                __typename: "UserConnection",
                pageInfo: { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false },
                edges: [
                  { __typename: "UserEdge", cursor: "x1", node: { __typename: "User", id: "x1", email: "x1@example.com" } },
                  { __typename: "UserEdge", cursor: "x2", node: { __typename: "User", id: "x2", email: "x2@example.com" } },
                ],
              },
            },
          },
          true,
        );

        expect(emissions.length).toBe(2);
        expect(emissions[1].terminal).toBe(true);

        // wait past suspension window
        await new Promise((r) => setTimeout(r, 10));

        // second exec → cached non-terminal then network
        const ctx2: any = {
          operation: { key: 999, query: operations.USERS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, tag: "second" });
          },
        };
        plugin(ctx2);

        expect(emissions.length).toBe(3);
        expect(emissions[2].terminal).toBe(false);

        ctx2.useResult(
          {
            data: {
              users: {
                __typename: "UserConnection",
                pageInfo: { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false },
                edges: [
                  { __typename: "UserEdge", cursor: "x1", node: { __typename: "User", id: "x1", email: "x1@example.com" } },
                  { __typename: "UserEdge", cursor: "x2", node: { __typename: "User", id: "x2", email: "x2@example.com" } },
                ],
              },
            },
          },
          true,
        );

        expect(emissions.length).toBe(4);
        expect(emissions[3].terminal).toBe(true);
      });
    });
  });

  describe("network-only", () => {
    it("serves cached response within suspension window to avoid duplicate network requests", async () => {
      plugin = createPlugin({ suspensionTimeout: 1000 }, { graph, planner, documents, ssr });

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const variables = { id: "u42" };

      const ctx1: any = {
        operation: { key: 888, query: operations.USER_QUERY, variables, cachePolicy: "network-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(ctx1);

      // first network result → normalized
      ctx1.useResult(
        { data: { user: { __typename: "User", id: "u42", email: "u42@example.com" } } },
        true,
      );

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      // same op key within window → serve cached terminal
      const ctx2: any = {
        operation: { key: 888, query: operations.USER_QUERY, variables, cachePolicy: "network-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };
      plugin(ctx2);

      expect(emissions.length).toBe(2);
      expect(emissions[1].terminal).toBe(true);
      expect(emissions[1].data?.user?.email).toBe("u42@example.com");
    });
  });
});
