import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import type { OperationResult } from "villus";

import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { createViews } from "@/src/core/views";
import { createDocuments } from "@/src/core/documents";
import { createPlugin } from "@/src/core/plugin";
import { createSSR } from "@/src/features/ssr";
import { ROOT_ID } from "@/src/core/constants";
import { buildConnectionKey } from "@/src/core/utils";

/* ────────────────────────────────────────────────────────────────────────────
 * Documents
 * -------------------------------------------------------------------------- */

const USERS_POSTS_QUERY = gql`
  query UsersPosts(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          id
          email
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges { cursor node { id title } }
          }
        }
      }
    }
  }
`;

const USER_QUERY = gql`
  query User($id: ID!) {
    user(id: $id) { id email }
  }
`;

// page-mode variant for users
const USERS_PAGE_QUERY = gql`
  query UsersPage($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) @connection(args: ["role"], mode: "page") {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node { id email } }
    }
  }
`;

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * -------------------------------------------------------------------------- */

function seedPage(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection",
) {
  const edgeRefs: Array<{ __ref: string }> = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });
    edgeRefs.push({ __ref: edgeKey });
  }
  const snap: Record<string, any> = { __typename: connectionTypename, edges: edgeRefs };
  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);
  graph.putRecord(pageKey, snap);
}

const canUsers = (role: string) => `@connection.users({"role":"${role}"})`;

/* ────────────────────────────────────────────────────────────────────────────
 * Test Setup
 * -------------------------------------------------------------------------- */

describe("plugin (villus) — canonical materialization, no sessions", () => {
  let graph: ReturnType<typeof createGraph>;
  let ssr: ReturnType<typeof createSSR>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    ssr = createSSR({ hydrationTimeout: 0 }, { graph });
    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    views = createViews({ graph });
    documents = createDocuments({ graph, planner, canonical, views });
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  });

  it("cache-only: hit publishes cached frame; miss publishes CacheOnlyMiss error", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

    // hit
    const ctxHit: any = {
      operation: { key: 1, query: USER_QUERY, variables: { id: "u1" }, cachePolicy: "cache-only" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };
    plugin(ctxHit);
    expect(emissions.length).toBe(1);
    expect(emissions[0].data.user.id).toBe("u1");
    expect(emissions[0].terminal).toBe(true);

    // miss
    const ctxMiss: any = {
      operation: { key: 2, query: USER_QUERY, variables: { id: "u2" }, cachePolicy: "cache-only" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };
    plugin(ctxMiss);
    expect(emissions.length).toBe(2);
    expect(emissions[1].error).toBeTruthy();
    expect((emissions[1].error as any).networkError?.name).toBe("CacheOnlyMiss");
    expect(emissions[1].terminal).toBe(true);
  });

  it("cache-first: miss → network normalized and published", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 3, query: USER_QUERY, variables: { id: "u9" }, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);

    const network = {
      data: { user: { __typename: "User", id: "u9", email: "x@example.com" } },
    };
    ctx.useResult(network, true);

    const view = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u9" } });
    expect(view.user.email).toBe("x@example.com");

    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);
  });

  it("cache-and-network: cached frame first (terminal=false), then network (terminal=true)", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const usersVars = {
      usersRole: "dj",
      usersFirst: 2,
      usersAfter: null,
      postsCategory: "tech",
      postsFirst: 1,
      postsAfter: null,
    };
    const usersPageKey = buildConnectionKey(usersField, ROOT_ID, usersVars);
    seedPage(
      graph,
      usersPageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false },
      {},
      "UserEdge",
      "UserConnection",
    );
    const canUsersKey = canUsers("dj");
    graph.putRecord(canUsersKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
      edges: [
        { __ref: `${usersPageKey}.edges.0` },
        { __ref: `${usersPageKey}.edges.1` },
      ],
    });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 10, query: USERS_POSTS_QUERY, variables: usersVars, cachePolicy: "cache-and-network" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);
    expect(emissions[0].data.users.edges.length).toBe(2);

    const networkData = {
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

    ctx.useResult(networkData, true);

    expect(emissions.length).toBe(2);
    expect(emissions[1].terminal).toBe(true);

    const page = graph.getRecord(usersPageKey);
    expect(Array.isArray(page.edges)).toBe(true);
    expect(page.edges.length).toBe(2);
  });

  it("cache-first with nested connection seeded (page + canonical): returns nested edges from cache", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const postsField = usersField
      .selectionMap!.get("edges")!
      .selectionMap!.get("node")!
      .selectionMap!.get("posts")!;

    const vars = {
      usersRole: "dj",
      usersFirst: 2,
      usersAfter: null,
      postsCategory: "tech",
      postsFirst: 1,
      postsAfter: null,
    };

    const usersPageKey = buildConnectionKey(usersField, ROOT_ID, vars);
    seedPage(
      graph,
      usersPageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false },
      {},
      "UserEdge",
      "UserConnection",
    );
    const canUsersKey = canUsers("dj");
    graph.putRecord(canUsersKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
      edges: [
        { __ref: `${usersPageKey}.edges.0` },
        { __ref: `${usersPageKey}.edges.1` },
      ],
    });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    const u1PostsPage = buildConnectionKey(postsField, "User:u1", vars);
    seedPage(
      graph,
      u1PostsPage,
      [{ nodeRef: "Post:p1", cursor: "p1" }],
      { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection",
    );
    const canPostsKey = `@connection.User:u1.posts({"category":"tech"})`;
    graph.putRecord(canPostsKey, {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: `${u1PostsPage}.edges.0` }],
    });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 20, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);

    const data = emissions[0].data;
    expect(data.users.edges.length).toBe(2);
    expect(data.users.edges[0].node.posts.edges.length).toBe(1);
    expect(data.users.edges[0].node.posts.edges[0].node.title).toBe("P1");
    expect((data.users.edges[1].node.posts?.edges ?? []).length).toBe(0);
  });

  /* ───────────────────────────── new scenarios ───────────────────────────── */

  it("cache-and-network (out-of-order): AFTER first → LEADER → AFTER replay converges to leader-first order", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });
    const emissions: Array<{ data?: any; error?: any; terminal: boolean; key: string }> = [];

    // helpers
    const push = (k: string) => (payload: OperationResult, terminal?: boolean) =>
      emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal, key: k });

    // AFTER first (no cached frame)
    const ctxAfter1: any = {
      operation: { key: 101, query: USERS_POSTS_QUERY, variables: { usersRole: "dj", usersFirst: 2, usersAfter: "u2" }, cachePolicy: "cache-and-network" },
      useResult: push("after1"),
    };
    plugin(ctxAfter1);
    // network returns page2 (u3)
    ctxAfter1.useResult({
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: true, hasPreviousPage: true },
          edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "c@example.com" } }],
        },
      },
    }, true);

    // LEADER next (no cached leader page)
    const ctxLeader: any = {
      operation: { key: 102, query: USERS_POSTS_QUERY, variables: { usersRole: "dj", usersFirst: 2, usersAfter: null }, cachePolicy: "cache-and-network" },
      useResult: push("leader"),
    };
    plugin(ctxLeader);
    // leader network returns u1,u2
    ctxLeader.useResult({
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

    // AFTER replay (page2 again) should append behind leader slice → union [u1,u2,u3]
    const ctxAfter2: any = {
      operation: { key: 103, query: USERS_POSTS_QUERY, variables: { usersRole: "dj", usersFirst: 2, usersAfter: "u2" }, cachePolicy: "cache-and-network" },
      useResult: push("after2"),
    };
    plugin(ctxAfter2);
    ctxAfter2.useResult({
      data: {
        users: {
          __typename: "UserConnection",
          pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: true, hasPreviousPage: true },
          edges: [{ __typename: "UserEdge", cursor: "u3", node: { __typename: "User", id: "u3", email: "c@example.com" } }],
        },
      },
    }, true);

    // assert canonical union is leader-first u1,u2,u3
    const canKey = canUsers("dj");
    const can = graph.getRecord(canKey);
    const ids = (can?.edges ?? []).map((r: any) => graph.getRecord(r.__ref)?.node?.__ref).map((k: string) => graph.getRecord(k)?.id);
    expect(ids).toEqual(["u1", "u2", "u3"]);
  });

  it("cache-and-network return visit: cached union emits first, leader network resets to leader slice", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    // Prepare cached leader+after union
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2" });
    graph.putRecord("User:u3", { __typename: "User", id: "u3" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const leaderVars = { usersRole: "dj", usersFirst: 2, usersAfter: null };
    const afterVars = { usersRole: "dj", usersFirst: 1, usersAfter: "u2" };

    const p1 = buildConnectionKey(usersField, ROOT_ID, leaderVars);
    seedPage(graph, p1, [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }], { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true }, {}, "UserEdge", "UserConnection");
    const p2 = buildConnectionKey(usersField, ROOT_ID, afterVars);
    seedPage(graph, p2, [{ nodeRef: "User:u3", cursor: "u3" }], { __typename: "PageInfo", startCursor: "u3", endCursor: "u3", hasNextPage: false }, {}, "UserEdge", "UserConnection");

    // Manually build canonical union (as if a previous run merged them)
    const canKey = canUsers("dj");
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
      edges: [{ __ref: `${p1}.edges.0` }, { __ref: `${p1}.edges.1` }, { __ref: `${p2}.edges.0` }],
    });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 201, query: USERS_POSTS_QUERY, variables: leaderVars, cachePolicy: "cache-and-network" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    // cached union frame first
    createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr })(ctx);
    expect(emissions[0].terminal).toBe(false);
    expect(emissions[0].data.users.edges.length).toBe(3);

    // leader network arrives → canonical resets to leader slice (2 items)
    ctx.useResult({
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

    const can = graph.getRecord(canKey);
    expect(can.edges.length).toBe(2);
    expect(emissions[1].terminal).toBe(true);
  });

  it("page-mode (replacement): out-of-order after → leader keeps only last fetched page", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean; tag: string }> = [];
    const tag = (t: string) => (p: OperationResult, term?: boolean) => emissions.push({ data: p.data, error: p.error, terminal: !!term, tag: t });

    // AFTER first
    const ctxAfter: any = {
      operation: { key: 301, query: USERS_PAGE_QUERY, variables: { usersRole: "mod", first: 2, after: "m2" }, cachePolicy: "cache-and-network" },
      useResult: tag("after"),
    };
    createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr })(ctxAfter);
    ctxAfter.useResult({
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

    const canKey = canUsers("mod");
    expect(graph.getRecord(canKey)?.edges.length).toBe(2);

    // LEADER next → replaces (page-mode)
    const ctxLeader: any = {
      operation: { key: 302, query: USERS_PAGE_QUERY, variables: { usersRole: "mod", first: 2, after: null }, cachePolicy: "cache-and-network" },
      useResult: tag("leader"),
    };
    createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr })(ctxLeader);
    ctxLeader.useResult({
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

    const ids = (graph.getRecord(canKey)?.edges ?? []).map((r: any) => graph.getRecord(r.__ref)?.node?.__ref).map((k: string) => graph.getRecord(k)?.id);
    expect(ids).toEqual(["m1", "m2"]);
  });

  it("network error path: terminal error, no graph writes", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });
    const beforeSnap = JSON.stringify(graph.getRecord("@"));

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 401, query: USER_QUERY, variables: { id: "oops" }, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);

    // Simulate a network error
    ctx.useResult({ error: Object.assign(new Error("Boom"), { name: "NetworkError" }) } as any, true);

    expect(emissions.length).toBe(1);
    expect(emissions[0].error).toBeTruthy();
    expect(emissions[0].terminal).toBe(true);
    expect(JSON.stringify(graph.getRecord("@"))).toBe(beforeSnap); // unchanged
  });

  it("cache-and-network when canonical missing but concrete page exists: prewarms then emits cached union", () => {
    const plugin = createPlugin({ suspensionTimeout: 0 }, { graph, planner, documents, ssr });

    // Prepare root users page (u1,u2) but NO canonical
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@a" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "y@b" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const vars = { usersRole: "sales", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };
    const pageKey = buildConnectionKey(usersField, "@", vars);

    seedPage(
      graph,
      pageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true },
      {},
      "UserEdge",
      "UserConnection",
    );
    // canonical intentionally missing here

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 30, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-and-network" },
      useResult: (payload: OperationResult, terminal?: boolean) => emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);

    // prewarm created canonical -> cached frame emitted first
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);
    expect(emissions[0].data.users.edges.length).toBe(2);
  });

  it("suspensionTimeout (cache-and-network): within window second exec serves cached terminal & skips network", async () => {
    // Seed users leader page + canonical
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const vars = { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };

    const pageKey = buildConnectionKey(usersField, ROOT_ID, vars);
    seedPage(
      graph,
      pageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true },
      {},
      "UserEdge",
      "UserConnection",
    );

    const canKey = canUsers("dj");
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: `${pageKey}.edges.0` }, { __ref: `${pageKey}.edges.1` }],
    });

    const plugin = createPlugin({ suspensionTimeout: 1000 }, { graph, planner, documents, ssr });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];

    // First execution (cache-and-network): cached (non-terminal), then network (terminal)
    const ctx1: any = {
      operation: { key: 777, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-and-network" },
      useResult: (payload: OperationResult, t?: boolean) => emissions.push({ data: payload.data, error: payload.error, terminal: !!t }),
    };
    plugin(ctx1);
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);
    expect(emissions[0].data.users.edges.length).toBe(2);

    // Simulate network result (stamps lastResultAtMs for the key)
    ctx1.useResult({
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

    // Second execution within suspension window: cached terminal, no network
    const ctx2: any = {
      operation: { key: 777, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-and-network" },
      useResult: (payload: OperationResult, t?: boolean) => emissions.push({ data: payload.data, error: payload.error, terminal: !!t }),
    };
    plugin(ctx2);
    // No extra ctx2.useResult() (network) should be required/triggered
    expect(emissions.length).toBe(3);
    expect(emissions[2].terminal).toBe(true);
    expect(emissions[2].data.users.edges.length).toBe(2);
  });

  it("suspensionTimeout (network-only): within window second exec is served from cache (no extra fetch)", async () => {
    const plugin = createPlugin({ suspensionTimeout: 1000 }, { graph, planner, documents, ssr });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const vars = { id: "u42" };

    // 1) First exec (network-only): simulate network result → normalize + stamp lastResultAtMs
    const ctx1: any = {
      operation: { key: 888, query: USER_QUERY, variables: vars, cachePolicy: "network-only" },
      useResult: (payload: OperationResult, t?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!t });
      },
    };
    plugin(ctx1);
    ctx1.useResult({ data: { user: { __typename: "User", id: "u42", email: "u42@example.com" } } }, true);

    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);

    // 2) Second exec within suspension window: plugin should emit terminal cached frame and skip a new fetch
    const ctx2: any = {
      operation: { key: 888, query: USER_QUERY, variables: vars, cachePolicy: "network-only" },
      useResult: (payload: OperationResult, t?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!t });
      },
    };
    plugin(ctx2);

    expect(emissions.length).toBe(2);
    expect(emissions[1].terminal).toBe(true);
    expect(emissions[1].data?.user?.email).toBe("u42@example.com"); // served from cache
  });

  it("suspensionTimeout (cache-and-network): outside window second exec re-fetches (cached non-terminal → network terminal)", async () => {
    // Seed minimal canonical for cached frame
    graph.putRecord("User:x1", { __typename: "User", id: "x1", email: "x1@example.com" });
    graph.putRecord("User:x2", { __typename: "User", id: "x2", email: "x2@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const vars = { usersRole: "ops", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null };
    const pageKey = buildConnectionKey(usersField, ROOT_ID, vars);
    seedPage(graph, pageKey, [{ nodeRef: "User:x1", cursor: "x1" }, { nodeRef: "User:x2", cursor: "x2" }],
      { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true }, {}, "UserEdge", "UserConnection");
    const canKey = canUsers("ops");
    graph.putRecord(canKey, {
      __typename: "UserConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "x1", endCursor: "x2", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: `${pageKey}.edges.0` }, { __ref: `${pageKey}.edges.1` }],
    });

    // Small timeout so we fall outside the window after a short delay
    const plugin = createPlugin({ suspensionTimeout: 5 }, { graph, planner, documents, ssr });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean; tag?: string }> = [];

    // First run: cached non-terminal + network terminal
    const ctx1: any = {
      operation: { key: 999, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-and-network" },
      useResult: (p: OperationResult, t?: boolean) => emissions.push({ data: p.data, error: p.error, terminal: !!t, tag: "first" }),
    };
    plugin(ctx1);
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);

    ctx1.useResult({
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

    // Wait to pass the tiny suspension window
    await new Promise((r) => setTimeout(r, 10));

    // Second run (outside window): cached non-terminal again + network terminal
    const ctx2: any = {
      operation: { key: 999, query: USERS_POSTS_QUERY, variables: vars, cachePolicy: "cache-and-network" },
      useResult: (p: OperationResult, t?: boolean) => emissions.push({ data: p.data, error: p.error, terminal: !!t, tag: "second" }),
    };
    plugin(ctx2);
    expect(emissions.length).toBe(3);
    expect(emissions[2].terminal).toBe(false);

    ctx2.useResult({
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
