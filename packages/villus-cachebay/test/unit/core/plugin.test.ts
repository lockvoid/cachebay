import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import type { OperationResult } from "villus";

import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createCanonical } from "@/src/core/canonical";
import { createViews } from "@/src/core/views";
import { createDocuments } from "@/src/core/documents";
import { createPlugin } from "@/src/core/plugin";
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
    user(id: $id) {
            id
      email
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

  const snap: Record<string, any> = {
    __typename: connectionTypename,
    edges: edgeRefs,
  };

  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);

  graph.putRecord(pageKey, snap);
}

/* canonical key helpers used in tests */
const canUsers = (role: string) => `@connection.users({"role":"${role}"})`;
const canPosts = (userId: string, category: string) =>
  `@connection.User:${userId}.posts({"category":"${category}"})`;

/* ────────────────────────────────────────────────────────────────────────────
 * Test Setup
 * -------------------------------------------------------------------------- */

describe("plugin (villus) — canonical materialization, no sessions", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    canonical = createCanonical({ graph });
    views = createViews({ graph });
    documents = createDocuments({ graph, planner, canonical, views });

    // ensure root record exists
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  });

  it("cache-only: hit publishes cached frame; miss publishes CacheOnlyMiss error", () => {
    const plugin = createPlugin({}, { graph, planner, documents });

    // seed link for USER_QUERY (user u1)
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
    const plugin = createPlugin({}, { graph, planner, documents });

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 3, query: USER_QUERY, variables: { id: "u9" }, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) =>
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal }),
    };

    plugin(ctx);

    // simulate network success
    const network = {
      data: { user: { __typename: "User", id: "u9", email: "x@example.com" } },
    };
    ctx.useResult(network, true);

    const view = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u9" } });
    expect(view.user.email).toBe("x@example.com");

    // final publish happened
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);
  });

  it("cache-and-network: cached frame first (terminal=false), then network (terminal=true)", () => {
    const plugin = createPlugin({}, { graph, planner, documents });

    // seed a concrete root page for users(role:dj) AND its CANONICAL, so cached frame exists
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
    // seed CANONICAL for users(role:dj)
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
    // cached frame should be emitted from CANONICAL
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);
    expect(Array.isArray(emissions[0].data.users.edges)).toBe(true);
    expect(emissions[0].data.users.edges.length).toBe(2);

    // now simulate network returning the SAME page again
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

    // final frame from CANONICAL
    expect(emissions.length).toBe(2);
    expect(emissions[1].terminal).toBe(true);

    // Graph still contains a single page record; no duplicates added by plugin
    const page = graph.getRecord(usersPageKey);
    expect(Array.isArray(page.edges)).toBe(true);
    expect(page.edges.length).toBe(2);
  });

  it("cache-first with nested connection seeded (page + canonical): returns nested edges from cache", () => {
    const plugin = createPlugin({}, { graph, planner, documents });

    // seed users page (u1,u2) + CANONICAL
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

    // nested posts for u1: seed page + CANONICAL
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
    const canPostsKey = canPosts("u1", "tech");
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
    // cache-first emits one terminal frame from CANONICAL cache
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);

    const data = emissions[0].data;
    expect(Array.isArray(data.users.edges)).toBe(true);
    expect(data.users.edges.length).toBe(2);

    // nested posts for u1 present (canonical seeded); u2 missing
    expect(Array.isArray(data.users.edges[0].node.posts.edges)).toBe(true);
    expect(data.users.edges[0].node.posts.edges.length).toBe(1);
    expect(data.users.edges[0].node.posts.edges[0].node.title).toBe("P1");

    expect((data.users.edges[1].node.posts?.edges ?? []).length).toBe(0);
  });
});
