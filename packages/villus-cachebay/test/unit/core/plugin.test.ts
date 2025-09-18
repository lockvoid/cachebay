import { describe, it, expect, beforeEach } from "vitest";
import gql from "graphql-tag";
import type { ClientPluginContext, OperationResult } from "villus";

import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { createSessions } from "@/src/core/sessions";
import { createDocuments } from "@/src/core/documents";
import { createPlugin } from "@/src/core/plugin";
import { ROOT_ID } from "@/src/core/constants";
import { buildConnectionKey, buildConnectionIdentity } from "@/src/core/utils";

const USERS_POSTS_QUERY = gql`
  query UsersPosts($usersRole: String, $usersFirst: Int, $usersAfter: String, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      __typename
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        __typename
        cursor
        node {
          __typename
          id
          email
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
            __typename
            pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
            edges { __typename cursor node { __typename id title } }
          }
        }
      }
    }
  }
`;

const USER_QUERY = gql`
  query User($id: ID!) {
    user(id: $id) {
      __typename
      id
      email
    }
  }
`;

// Seed a page into graph
function seedPage(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection"
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

describe("plugin (villus)", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let views: ReturnType<typeof createViews>;
  let sessions: ReturnType<typeof createSessions>;
  let documents: ReturnType<typeof createDocuments>;

  // capture created sessions to inspect composers
  let createdSessions: Array<ReturnType<typeof sessions.createSession>>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    views = createViews({ graph });
    sessions = createSessions({ graph, views });
    documents = createDocuments({ graph, views, planner });

    createdSessions = [];
    const orig = sessions.createSession;
    // wrap createSession to capture the session the plugin allocates
    (sessions as any).createSession = () => {
      const s = orig();
      createdSessions.push(s);
      return s;
    };

    // root present
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  });

  it("cache-only: hit publishes cached frame; miss publishes CacheOnlyMiss error", () => {
    const plugin = createPlugin({}, { graph, planner, documents, sessions });

    // seed link for USER_QUERY
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    // ctx harness
    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 1, query: USER_QUERY, variables: { id: "u1" }, cachePolicy: "cache-only" },
      useResult: (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
      },
    };

    plugin(ctx); // cache-only hit
    expect(emissions.length).toBe(1);
    expect(emissions[0].data.user.id).toBe("u1");
    expect(emissions[0].terminal).toBe(true);

    // miss
    const ctxMiss: any = {
      operation: { key: 2, query: USER_QUERY, variables: { id: "u2" }, cachePolicy: "cache-only" },
      useResult: (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
      },
    };
    plugin(ctxMiss);
    expect(emissions.length).toBe(2);
    expect(emissions[1].error).toBeTruthy();
    expect((emissions[1].error as any).networkError?.name).toBe("CacheOnlyMiss");
    expect(emissions[1].terminal).toBe(true);
  });

  it("cache-first: miss → network normalized and published", () => {
    const plugin = createPlugin({}, { graph, planner, documents, sessions });

    const ctx: any = {
      operation: { key: 3, query: USER_QUERY, variables: { id: "u9" }, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) => { }, // will be wrapped
    };

    plugin(ctx);

    // simulate network success
    const result = {
      data: { user: { __typename: "User", id: "u9", email: "x@example.com" } },
    };
    ctx.useResult(result, true);

    const view = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u9" } });
    expect(view.user.email).toBe("x@example.com");
  });

  it("cache-and-network: cached frame first (terminal=false), then network (terminal=true); no double addPage", () => {
    const plugin = createPlugin({}, { graph, planner, documents, sessions });

    // seed a root connection page for users(role:dj)
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const usersPageKey = buildConnectionKey(usersField, ROOT_ID, {
      usersRole: "dj",
      usersFirst: 2,
      usersAfter: null,
      postsCategory: "tech",
      postsFirst: 1,
      postsAfter: null,
    });

    seedPage(
      graph,
      usersPageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false },
      {},
      "UserEdge",
      "UserConnection"
    );

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: {
        key: 10,
        query: USERS_POSTS_QUERY,
        variables: {
          usersRole: "dj", usersFirst: 2, usersAfter: null,
          postsCategory: "tech", postsFirst: 1, postsAfter: null,
        },
        cachePolicy: "cache-and-network",
      },
      useResult: (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
      },
    };

    plugin(ctx);
    // cached frame emitted
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(false);
    expect(Array.isArray(emissions[0].data.users.edges)).toBe(true);

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
    // final frame emitted
    expect(emissions.length).toBe(2);
    expect(emissions[1].terminal).toBe(true);

    // Inspect the created session → ensure the root composer did not add the same page twice
    const session = (createdSessions[0] as any);
    const usersIdentity = buildConnectionIdentity(usersField, ROOT_ID, {
      usersRole: "dj", usersFirst: 2, usersAfter: null,
      postsCategory: "tech", postsFirst: 1, postsAfter: null,
    });
    const composer = session.getConnection(usersIdentity);
    expect(composer).toBeTruthy();
    const info = composer.inspect();
    // should be exactly 1 page
    expect(info.pages.length).toBe(1);
    expect(info.pages[0]).toBe(usersPageKey);
  });

  it("multi-parent nested mounting: root users page → mount per-user posts child connections", () => {
    const plugin = createPlugin({}, { graph, planner, documents, sessions });

    // seed users page with two users
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });

    const plan = planner.getPlan(USERS_POSTS_QUERY);
    const usersField = plan.rootSelectionMap!.get("users")!;
    const postsField = plan.rootSelectionMap!.get("users")!
      .selectionMap!.get("edges")!
      .selectionMap!.get("node")!
      .selectionMap!.get("posts")!;

    const usersVars = {
      usersRole: "dj", usersFirst: 2, usersAfter: null,
      postsCategory: "tech", postsFirst: 1, postsAfter: null,
    };

    const usersPageKey = buildConnectionKey(usersField, ROOT_ID, usersVars);
    seedPage(
      graph,
      usersPageKey,
      [{ nodeRef: "User:u1", cursor: "u1" }, { nodeRef: "User:u2", cursor: "u2" }],
      { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false },
      {},
      "UserEdge",
      "UserConnection"
    );

    // seed nested posts page for u1 only
    const u1PostsKey = buildConnectionKey(postsField, "User:u1", usersVars);
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    seedPage(
      graph,
      u1PostsKey,
      [{ nodeRef: "Post:p1", cursor: "p1" }],
      { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection"
    );

    const emissions: Array<{ data?: any; error?: any; terminal: boolean }> = [];
    const ctx: any = {
      operation: { key: 20, query: USERS_POSTS_QUERY, variables: usersVars, cachePolicy: "cache-first" },
      useResult: (payload: OperationResult, terminal?: boolean) => {
        emissions.push({ data: payload.data, error: payload.error, terminal: !!terminal });
      },
    };

    plugin(ctx);
    // cache-first should emit cached frame immediately
    expect(emissions.length).toBe(1);
    expect(emissions[0].terminal).toBe(true);

    // the plugin created one session; verify nested composer exists for u1.posts, not for u2.posts
    const session = (createdSessions[0] as any);

    const u1PostsIdentity = buildConnectionIdentity(postsField, "User:u1", usersVars);
    const u2PostsIdentity = buildConnectionIdentity(postsField, "User:u2", usersVars);

    const u1Composer = session.getConnection(u1PostsIdentity);
    const u2Composer = session.getConnection(u2PostsIdentity);

    expect(u1Composer).toBeTruthy();
    expect(u2Composer).toBeUndefined();

    const info = u1Composer.inspect();
    expect(info.pages.length).toBe(1);
    expect(info.pages[0]).toBe(u1PostsKey);
  });
});
