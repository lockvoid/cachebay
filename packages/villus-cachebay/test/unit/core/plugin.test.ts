// TODO: Needs refactoring.

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
import { operations, seedConnectionPage } from "@/test/helpers";
import type { OperationResult } from "villus";

describe("Plugin", () => {
  let graph: ReturnType<typeof createGraph>;
  let ssr: ReturnType<typeof createSSR>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;
  let plugin: ReturnType<typeof createPlugin>;

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
      graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID, ['user({"id":"u1"})']: { __ref: "User:u1" } });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const context1: any = {
        operation: { key: 1, query: operations.USER_QUERY, variables: { id: "u1" }, cachePolicy: "cache-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context1);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);
      expect(emissions[0].data.user.id).toBe("u1");

      const context2: any = {
        operation: { key: 2, query: operations.USER_QUERY, variables: { id: "u2" }, cachePolicy: "cache-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context2);

      expect(emissions.length).toBe(2);
      expect(emissions[1].error).toBeTruthy();
      expect(emissions[1].error.networkError?.name).toBe("CacheOnlyMiss");
      expect(emissions[1].terminal).toBe(true);
    });
  });

  describe("cache-first", () => {
    it("fetches from network on cache miss and normalizes data", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const context: any = {
        operation: { key: 3, query: operations.USER_QUERY, variables: { id: "u9" }, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);

      context.useResult({ data: { user: { __typename: "User", id: "u9", email: "u9@example.com" } } }, true);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      const userView = documents.materializeDocument({ document: operations.USER_QUERY, variables: { id: "u9" } });
      expect(userView.user.email).toBe("u9@example.com");
    });

    it("returns nested connection edges from seeded cache data", () => {
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
      seedConnectionPage(
        graph,
        usersPageKey,
        [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
        { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        {},
        "UserEdge",
        "UserConnection",
      );

      const canonicalUsersKey = "@connection.users({\"role\":\"dj\"})";
      graph.putRecord(canonicalUsersKey, {
        __typename: "UserConnection",
        pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __ref: `${usersPageKey}.edges.0` }, { __ref: `${usersPageKey}.edges.1` }],
      });

      // Seed nested posts for BOTH users (deep hasDocument requires the concrete page)
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });

      const u1PostsPageKey = buildConnectionKey(posts, "User:u1", variables);
      seedConnectionPage(
        graph,
        u1PostsPageKey,
        [{ nodeRef: "Post:p1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        { totalCount: 1 },
        "PostEdge",
        "PostConnection",
      );

      const u2PostsPageKey = buildConnectionKey(posts, "User:u2", variables);
      seedConnectionPage(
        graph,
        u2PostsPageKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );


      // Nested posts canonical (User:u1)
      const canPostsU1 = '@connection.User:u1.posts({"category":"tech"})';
      graph.putRecord(canPostsU1, {
        __typename: "PostConnection",
        pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __ref: `${u1PostsPageKey}.edges.0` }],
      });

      // Nested posts canonical (User:u2) — empty
      const canPostsU2 = '@connection.User:u2.posts({"category":"tech"})';
      graph.putRecord(canPostsU2, {
        __typename: "PostConnection",
        pageInfo: { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        edges: [],
      });

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const context: any = {
        operation: { key: 20, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      const responseData = emissions[0].data;
      expect(responseData.users.edges.length).toBe(2);
      expect(responseData.users.edges[0].node.posts.edges.length).toBe(1);
      expect(responseData.users.edges[0].node.posts.edges[0].node.title).toBe("P1");
      expect((responseData.users.edges[1].node.posts?.edges ?? []).length).toBe(0);
    });

    it("handles network errors without modifying graph state", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

      const context: any = {
        operation: { key: 401, query: operations.USER_QUERY, variables: { id: "oops" }, cachePolicy: "cache-first" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);

      context.useResult({ error: Object.assign(new Error("Boom"), { name: "NetworkError" }) } as any, true);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);
      expect(emissions[0].error).toBeTruthy();

      expect(JSON.stringify(graph.getRecord("@"))).toBe(JSON.stringify(graph.getRecord("@")));
    });
  });

  describe("cache-and-network", () => {
    it("emits cached data first then network data", () => {
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
      seedConnectionPage(
        graph,
        usersPageKey,
        [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
        { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        {},
        "UserEdge",
        "UserConnection",
      );

      const canonicalUsersKey = "@connection.users({\"role\":\"dj\"})";
      graph.putRecord(canonicalUsersKey, {
        __typename: "UserConnection",
        pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __ref: `${usersPageKey}.edges.0` }, { __ref: `${usersPageKey}.edges.1` }],
      });

      // Seed nested posts pages (empty is fine) with totalCount for deep check
      const u1PostsPageKey = buildConnectionKey(posts, "User:u1", variables);
      seedConnectionPage(
        graph,
        u1PostsPageKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );

      const u2PostsPageKey = buildConnectionKey(posts, "User:u2", variables);
      seedConnectionPage(
        graph,
        u2PostsPageKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const context: any = {
        operation: { key: 10, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(false);
      expect(emissions[0].data.users.edges.length).toBe(2);

      const usersData = {
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
      };

      context.useResult(usersData, true);

      expect(emissions.length).toBe(2);
      expect(emissions[1].terminal).toBe(true);

      const pageRecord = graph.getRecord(usersPageKey);
      expect(pageRecord.edges.length).toBe(2);
    });

    it("handles out-of-order pagination queries and converges to correct union", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean; key: string }> = [];

      const createResultHandler = (key: string) => (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, key });
      };

      const afterContext1: any = {
        operation: {
          key: 101,
          query: operations.USERS_POSTS_QUERY,
          cachePolicy: "cache-and-network",
          variables: { usersRole: "dj", usersFirst: 2, usersAfter: "u2" },
        },
        useResult: createResultHandler("after1"),
      };

      plugin(afterContext1);

      afterContext1.useResult({
        data: {
          users: {
            __typename: "UserConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: true, hasPreviousPage: true },
            edges: [{
              __typename: "UserEdge",
              cursor: "u3",
              node: { __typename: "User", id: "u3", email: "c@example.com" },
            }],
          },
        },
      }, true);

      const leaderContext: any = {
        operation: { key: 102, query: operations.USERS_POSTS_QUERY, variables: { usersRole: "dj", usersFirst: 2, usersAfter: null }, cachePolicy: "cache-and-network" },
        useResult: createResultHandler("leader"),
      };
      plugin(leaderContext);
      leaderContext.useResult({
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
      }, true);

      const afterContext2: any = {
        operation: { key: 103, query: operations.USERS_POSTS_QUERY, variables: { usersRole: "dj", usersFirst: 2, usersAfter: "u2" }, cachePolicy: "cache-and-network" },
        useResult: createResultHandler("after2"),
      };
      plugin(afterContext2);
      afterContext2.useResult({
        data: {
          users: {
            __typename: "UserConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: true, hasPreviousPage: true },
            edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "c@example.com" } }],
          },
        },
      }, true);

      const canonicalKey = "@connection.users({\"role\":\"dj\"})";
      const canonicalRecord = graph.getRecord(canonicalKey);
      const userIds = (canonicalRecord?.edges ?? [])
        .map((edgeRef: any) => graph.getRecord(edgeRef.__ref)?.node?.__ref)
        .map((nodeKey: string) => graph.getRecord(nodeKey)?.id);
      expect(userIds).toEqual(["u1", "u2", "u3"]);
    });

    it("serves cached union first then resets to leader slice on network response", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3", email: "u3@example.com" });

      const plan = planner.getPlan(operations.USERS_POSTS_QUERY);
      const users = plan.rootSelectionMap!.get("users")!;
      const posts = users
        .selectionMap!.get("edges")!
        .selectionMap!.get("node")!
        .selectionMap!.get("posts")!;

      const leaderVariables = { usersRole: "dj", usersFirst: 2, usersAfter: null };
      const afterVariables = { usersRole: "dj", usersFirst: 1, usersAfter: "u2" };

      const leaderPageKey = buildConnectionKey(users, ROOT_ID, leaderVariables);
      seedConnectionPage(
        graph,
        leaderPageKey,
        [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
        { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        {},
        "UserEdge",
        "UserConnection",
      );

      const afterPageKey = buildConnectionKey(users, ROOT_ID, afterVariables);
      seedConnectionPage(
        graph,
        afterPageKey,
        [{ nodeRef: "User:u3", cursor: "u3" }],
        { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
        {},
        "UserEdge",
        "UserConnection",
      );

      const canonicalKey = "@connection.users({\"role\":\"dj\"})";
      graph.putRecord(canonicalKey, {
        __typename: "UserConnection",
        pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __ref: `${leaderPageKey}.edges.0` }, { __ref: `${leaderPageKey}.edges.1` }, { __ref: `${afterPageKey}.edges.0` }],
      });

      // Seed nested posts pages with default args {} for both users in leader slice
      const u1PostsEmptyKey = buildConnectionKey(posts, "User:u1", { postsCategory: undefined, postsFirst: undefined, postsAfter: undefined });
      seedConnectionPage(
        graph,
        u1PostsEmptyKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );
      const u2PostsEmptyKey = buildConnectionKey(posts, "User:u2", { postsCategory: undefined, postsFirst: undefined, postsAfter: undefined });
      seedConnectionPage(
        graph,
        u2PostsEmptyKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const context: any = {
        operation: { key: 201, query: operations.USERS_POSTS_QUERY, variables: leaderVariables, cachePolicy: "cache-and-network" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);
      expect(emissions[0].terminal).toBe(false);
      expect(emissions[0].data.users.edges.length).toBe(3);

      context.useResult({
        data: {
          users: {
            __typename: "UserConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
            edges: [
              { __typename: "UserEdge", cursor: "u1", node: { __typename: "User", id: "u1" } },
              { __typename: "UserEdge", cursor: "u2", node: { __typename: "User", id: "u2" } },
            ],
          },
        },
      }, true);

      const canonicalRecord = graph.getRecord(canonicalKey);
      expect(canonicalRecord.edges.length).toBe(2);
      expect(emissions[1].terminal).toBe(true);
    });

    it("replaces pages in page-mode when leader query overrides after query", () => {
      const emissions: Array<{ data?: any; error?: any; terminal: boolean; tag: string }> = [];
      const createTaggedHandler = (tag: string) => (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, tag });
      };

      const afterContext: any = {
        operation: { key: 301, query: operations.USERS_QUERY, variables: { role: "moderator", first: 2, after: "m2" }, cachePolicy: "cache-and-network" },
        useResult: createTaggedHandler("after"),
      };
      plugin(afterContext);
      afterContext.useResult({
        data: {
          users: {
            __typename: "UserConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "m3", endCursor: "m4", hasNextPage: false, hasPreviousPage: true },
            edges: [
              { __typename: "UserEdge", cursor: "m3", node: { __typename: "User", id: "m3", email: "3@example.com" } },
              { __typename: "UserEdge", cursor: "m4", node: { __typename: "User", id: "m4", email: "4@example.com" } },
            ],
          },
        },
      }, true);

      const canonicalKey = "@connection.users({\"role\":\"moderator\"})";
      expect(graph.getRecord(canonicalKey)?.edges.length).toBe(2);

      const leaderContext: any = {
        operation: { key: 302, query: operations.USERS_QUERY, variables: { role: "moderator", first: 2, after: null }, cachePolicy: "cache-and-network" },
        useResult: createTaggedHandler("leader"),
      };
      plugin(leaderContext);
      leaderContext.useResult({
        data: {
          users: {
            __typename: "UserConnection",
            pageInfo: { __typename: "PageInfo", startCursor: "m1", endCursor: "m2", hasNextPage: true, hasPreviousPage: false },
            edges: [
              { __typename: "UserEdge", cursor: "m1", node: { __typename: "User", id: "m1", email: "1@example.com" } },
              { __typename: "UserEdge", cursor: "m2", node: { __typename: "User", id: "m2", email: "2@example.com" } },
            ],
          },
        },
      }, true);

      const userIds = (graph.getRecord(canonicalKey)?.edges ?? [])
        .map((edgeRef: any) => graph.getRecord(edgeRef.__ref)?.node?.__ref)
        .map((nodeKey: string) => graph.getRecord(nodeKey)?.id);
      expect(userIds).toEqual(["m1", "m2"]);
    });

    it("emits cached data immediately when page exists but canonical is missing", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@a" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "y@b" });

      const plan = planner.getPlan(operations.USERS_POSTS_QUERY);
      const users = plan.rootSelectionMap!.get("users")!;
      const posts = users
        .selectionMap!.get("edges")!
        .selectionMap!.get("node")!
        .selectionMap!.get("posts")!;

      const variables = { usersRole: "sales", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };
      const pageKey = buildConnectionKey(users, "@", variables);

      seedConnectionPage(
        graph,
        pageKey,
        [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
        { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        {},
        "UserEdge",
        "UserConnection",
      );

      // Seed nested posts pages so deep hasDocument passes
      const u1PostsPageKey = buildConnectionKey(posts, "User:u1", variables);
      seedConnectionPage(
        graph,
        u1PostsPageKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: true, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );

      const u2PostsPageKey = buildConnectionKey(posts, "User:u2", variables);
      seedConnectionPage(
        graph,
        u2PostsPageKey,
        [],
        { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: true, hasPreviousPage: false },
        { totalCount: 0 },
        "PostEdge",
        "PostConnection",
      );

      const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
      const context: any = {
        operation: { key: 30, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(false);
      expect(emissions[0].data.users.edges.length).toBe(2);
    });

    describe("suspensionTimeout window", () => {
      it("serves cached terminal response within suspension window", async () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

        const plan = planner.getPlan(operations.USERS_POSTS_QUERY);
        const users = plan.rootSelectionMap!.get("users")!;
        const posts = users
          .selectionMap!.get("edges")!
          .selectionMap!.get("node")!
          .selectionMap!.get("posts")!;
        const variables = { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };

        const pageKey = buildConnectionKey(users, ROOT_ID, variables);
        seedConnectionPage(
          graph,
          pageKey,
          [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
          { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
          {},
          "UserEdge",
          "UserConnection",
        );

        const canonicalKey = "@connection.users({\"role\":\"dj\"})";
        graph.putRecord(canonicalKey, {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
          edges: [{ __ref: `${pageKey}.edges.0` }, { __ref: `${pageKey}.edges.1` }],
        });

        // Seed nested posts pages (empty + totalCount) for deep check
        const u1PostsPageKey = buildConnectionKey(posts, "User:u1", variables);
        seedConnectionPage(
          graph,
          u1PostsPageKey,
          [],
          { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
          { totalCount: 0 },
          "PostEdge",
          "PostConnection",
        );
        const u2PostsPageKey = buildConnectionKey(posts, "User:u2", variables);
        seedConnectionPage(
          graph,
          u2PostsPageKey,
          [],
          { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
          { totalCount: 0 },
          "PostEdge",
          "PostConnection",
        );

        plugin = createPlugin({ suspensionTimeout: 1000 }, { graph, planner, documents, ssr });
        const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

        const firstContext: any = {
          operation: { key: 777, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
          },
        };
        plugin(firstContext);

        expect(emissions.length).toBe(1);
        expect(emissions[0].terminal).toBe(false);
        expect(emissions[0].data.users.edges.length).toBe(2);

        firstContext.useResult({
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
        }, true);

        expect(emissions.length).toBe(2);
        expect(emissions[1].terminal).toBe(true);

        const secondContext: any = {
          operation: { key: 777, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
          },
        };
        plugin(secondContext);

        expect(emissions.length).toBe(3);
        expect(emissions[2].terminal).toBe(true);
        expect(emissions[2].data.users.edges.length).toBe(2);
      });

      it("re-fetches from network when outside suspension window", async () => {
        graph.putRecord("User:x1", { __typename: "User", id: "x1", email: "x1@example.com" });
        graph.putRecord("User:x2", { __typename: "User", id: "x2", email: "x2@example.com" });

        const plan = planner.getPlan(operations.USERS_POSTS_QUERY);
        const users = plan.rootSelectionMap!.get("users")!;
        const posts = users
          .selectionMap!.get("edges")!
          .selectionMap!.get("node")!
          .selectionMap!.get("posts")!;
        const variables = { usersRole: "ops", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };
        const pageKey = buildConnectionKey(users, ROOT_ID, variables);

        seedConnectionPage(
          graph,
          pageKey,
          [{ nodeRef: "User:x1", cursor: "x1" }, { nodeRef: "User:x2", cursor: "x2" }],
          { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false },
          {},
          "UserEdge",
          "UserConnection",
        );

        const canonicalKey = "@connection.users({\"role\":\"ops\"})";
        graph.putRecord(canonicalKey, {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false },
          edges: [{ __ref: `${pageKey}.edges.0` }, { __ref: `${pageKey}.edges.1` }],
        });

        // Seed nested posts pages for deep check
        const u1PostsPageKey = buildConnectionKey(posts, "User:x1", variables);
        seedConnectionPage(
          graph,
          u1PostsPageKey,
          [],
          { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
          { totalCount: 0 },
          "PostEdge",
          "PostConnection",
        );
        const u2PostsPageKey = buildConnectionKey(posts, "User:x2", variables);
        seedConnectionPage(
          graph,
          u2PostsPageKey,
          [],
          { __typename: "PageInfo", startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
          { totalCount: 0 },
          "PostEdge",
          "PostConnection",
        );

        plugin = createPlugin({ suspensionTimeout: 5 }, { graph, planner, documents, ssr });
        const emissions: Array<{ data?: any; error?: any; terminal: boolean; tag?: string }> = [];

        const firstContext: any = {
          operation: { key: 999, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, tag: "first" });
          },
        };
        plugin(firstContext);

        expect(emissions.length).toBe(1);
        expect(emissions[0].terminal).toBe(false);

        firstContext.useResult({
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
        }, true);

        expect(emissions.length).toBe(2);
        expect(emissions[1].terminal).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 10));

        const secondContext: any = {
          operation: { key: 999, query: operations.USERS_POSTS_QUERY, variables, cachePolicy: "cache-and-network" },
          useResult: (payload: OperationResult, terminal?: boolean) => {
            emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, tag: "second" });
          },
        };
        plugin(secondContext);

        expect(emissions.length).toBe(3);
        expect(emissions[2].terminal).toBe(false);

        secondContext.useResult({
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
        }, true);

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

      const context1: any = {
        operation: { key: 888, query: operations.USER_QUERY, variables, cachePolicy: "network-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };

      plugin(context1);
      context1.useResult({ data: { user: { __typename: "User", id: "u42", email: "u42@example.com" } } }, true);

      expect(emissions.length).toBe(1);
      expect(emissions[0].terminal).toBe(true);

      const context2: any = {
        operation: { key: 888, query: operations.USER_QUERY, variables, cachePolicy: "network-only" },
        useResult: (payload: OperationResult, terminal?: boolean) => {
          emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
        },
      };
      plugin(context2);

      expect(emissions.length).toBe(2);
      expect(emissions[1].terminal).toBe(true);
      expect(emissions[1].data?.user?.email).toBe("u42@example.com");
    });
  });
});
