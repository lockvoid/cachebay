import { vi } from "vitest";
import type { PlanField } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { writePageSnapshot } from "@/test/helpers/unit";

const POSTS_PLAN_FIELD: PlanField = {
  fieldName: "posts",
  responseKey: "posts",
  isConnection: true,
  connectionMode: "infinite",
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

const USERS_PLAN_FIELD: PlanField = {
  fieldName: "users",
  responseKey: "users",
  isConnection: true,
  connectionMode: "infinite",
  connectionFilters: ["role"],
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

const TAGS_PLAN_FIELD: PlanField = {
  fieldName: "tags",
  responseKey: "tags",
  isConnection: true,
  connectionMode: "page",
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

// Helper to write Post pages
const writePostPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: number[],
  pageInfo?: { start?: string; end?: string; hasNext?: boolean; hasPrev?: boolean },
) => {
  return writePageSnapshot(graph, pageKey, nodeIds, {
    typename: "Post",
    createNode: (id) => ({ id: String(id), title: `Post ${id}`, flags: [] }),
    createCursor: (id) => `p${id}`,
    pageInfo,
  });
};

// Helper to write User pages
const writeUserPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  userIds: string[],
  pageInfo?: { start?: string; end?: string; hasNext?: boolean; hasPrev?: boolean },
) => {
  return writePageSnapshot(graph, pageKey, userIds, {
    typename: "User",
    createNode: (id) => ({ id, name: `User ${id}` }),
    createCursor: (id) => id,
    pageInfo,
  });
};

// Helper to write Tag pages
const writeTagPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  tagIds: string[],
  pageInfo?: { start?: string; end?: string; hasNext?: boolean; hasPrev?: boolean },
) => {
  return writePageSnapshot(graph, pageKey, tagIds, {
    typename: "Tag",
    createNode: (id) => ({ id, name: `Tag ${id}` }),
    createCursor: (id) => id,
    pageInfo,
  });
};

describe("Canonical", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let canonical: ReturnType<typeof createCanonical>;

  const getNodeIds = (connectionKey: string): string[] => {
    const canonicalConnection = graph.getRecord(connectionKey);
    const refs: string[] = canonicalConnection?.edges?.__refs || [];
    return refs
      .map((edgeRef: string) => {
        const edge = graph.getRecord(edgeRef);
        const node = graph.getRecord(edge?.node?.__ref);
        return node?.id;
      })
      .filter(Boolean);
  };

  const getMeta = (canKey: string) => {
    return graph.getRecord(`${canKey}::meta`);
  };

  beforeEach(() => {
    graph = createGraph();
    optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
  });

  describe("updateConnection - infinite mode", () => {
    describe("leader pages", () => {
      it("creates canonical record with ::meta for leader page on first network fetch", () => {
        const { page, edgeRefs } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true, hasPrev: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        const canKey = "@connection.posts({})";
        const canonicalConnection = graph.getRecord(canKey);

        expect(canonicalConnection).toBeDefined();
        expect(canonicalConnection.__typename).toBe("PostConnection");
        expect(getNodeIds(canKey)).toEqual(["1", "2", "3"]);

        const meta = getMeta(canKey);
        expect(meta).toBeDefined();
        expect(meta.__typename).toBe("__ConnMeta");
        expect(meta.pages).toEqual(['@.posts({"after":null,"first":3})']);
        expect(meta.leader).toBe('@.posts({"after":null,"first":3})');
        expect(meta.hints).toEqual({ '@.posts({"after":null,"first":3})': "leader" });
        expect(meta.origin).toEqual({ '@.posts({"after":null,"first":3})': "network" });
      });

      it("unconditionally collapses to leader slice on network leader refetch", () => {
        const { page: page0, edgeRefs: page0EdgeRefs } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: page0,
          pageEdgeRefs: page0EdgeRefs,
        });

        const { page: page1, edgeRefs: page1EdgeRefs } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { start: "p4", end: "p6", hasNext: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: page1,
          pageEdgeRefs: page1EdgeRefs,
        });

        expect(getNodeIds("@connection.posts({})")).toEqual(["1", "2", "3", "4", "5", "6"]);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: page0,
          pageEdgeRefs: page0EdgeRefs,
        });

        const canKey = "@connection.posts({})";
        expect(getNodeIds(canKey)).toEqual(["1", "2", "3"]);

        const meta = getMeta(canKey);
        expect(meta.pages).toEqual(['@.posts({"after":null,"first":3})']);
        expect(meta.leader).toBe('@.posts({"after":null,"first":3})');
        expect(meta.hints).toEqual({ '@.posts({"after":null,"first":3})': "leader" });
      });

      it("resets meta to just leader page on leader refetch", () => {
        const canKey = "@connection.posts({})";
        const leaderPageKey = '@.posts({"after":null,"first":2})';

        const { page: p0, edgeRefs: e0 } = writePostPage(graph, leaderPageKey, [1, 2], { hasNext: true });
        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: null },
          pageKey: leaderPageKey,
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const afterPageKey = '@.posts({"after":"p2","first":2})';
        const { page: p1, edgeRefs: e1 } = writePostPage(graph, afterPageKey, [3, 4], { hasNext: false });
        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: "p2" },
          pageKey: afterPageKey,
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        let meta = getMeta(canKey);
        expect(meta.pages).toHaveLength(2);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: null },
          pageKey: leaderPageKey,
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        meta = getMeta(canKey);
        expect(meta.pages).toEqual([leaderPageKey]);
        expect(meta.leader).toBe(leaderPageKey);
        expect(meta.hints).toEqual({ [leaderPageKey]: "leader" });
        expect(meta.origin).toEqual({ [leaderPageKey]: "network" });
      });

      it("copies extra fields from page snapshot to canonical on leader fetch", () => {
        const pageKey = '@.posts({"after":null,"first":3})';
        const { page, edgeRefs } = writePostPage(graph, pageKey, [1, 2, 3], { hasNext: true });

        page.totalCount = 100;
        page.aggregations = { scoring: 88 };

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        const canKey = "@connection.posts({})";
        const canonicalConnection = graph.getRecord(canKey);

        expect(canonicalConnection.totalCount).toBe(100);
        expect(canonicalConnection.aggregations).toEqual({ scoring: 88 });
      });
    });

    describe("forward pagination", () => {
      it("appends forward page and updates meta with after hint", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { end: "p3", hasNext: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { end: "p6", hasNext: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        const meta = getMeta(canKey);
        expect(meta.pages).toEqual([
          '@.posts({"after":null,"first":3})',
          '@.posts({"after":"p3","first":3})',
        ]);
        expect(meta.leader).toBe('@.posts({"after":null,"first":3})');
        expect(meta.hints).toEqual({
          '@.posts({"after":null,"first":3})': "leader",
          '@.posts({"after":"p3","first":3})': "after",
        });
        expect(meta.origin['@.posts({"after":"p3","first":3})']).toBe("network");
      });

      it("aggregates pageInfo correctly with forward pagination", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true, hasPrev: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { start: "p4", end: "p6", hasNext: false, hasPrev: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        const pageInfo = graph.getRecord(canKey).pageInfo;
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p6");
        expect(pageInfo.hasPreviousPage).toBe(false);
        expect(pageInfo.hasNextPage).toBe(false);
      });

      it("replaces edges when reloading a forward slice", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { end: "p3", hasNext: true },
        );
        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { end: "p6", hasNext: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        const { page: updatedP1, edgeRefs: updatedE1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 6, 7],
          { end: "p7", hasNext: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: updatedP1,
          pageEdgeRefs: updatedE1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "6", "7"]);

        const pageInfo = graph.getRecord(canKey).pageInfo;
        expect(pageInfo.endCursor).toBe("p7");
        expect(pageInfo.hasNextPage).toBe(false);
      });
    });

    describe("backward pagination", () => {
      it("prepends before page and preserves order in canonical", () => {
        const canKey = "@connection.posts({})";

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [4, 5, 6],
          { start: "p4", end: "p6", hasNext: true, hasPrev: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"before":"p4","last":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true, hasPrev: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p4" },
          pageKey: '@.posts({"before":"p4","last":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        const meta = getMeta(canKey);
        expect(meta.hints['@.posts({"before":"p4","last":3})']).toBe("before");
      });

      it("aggregates pageInfo correctly with before pagination", () => {
        const canKey = "@connection.posts({})";

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [4, 5, 6],
          { start: "p4", end: "p6", hasNext: true, hasPrev: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"before":"p4","last":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true, hasPrev: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p4" },
          pageKey: '@.posts({"before":"p4","last":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const pageInfo = graph.getRecord(canKey).pageInfo;
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p6");
        expect(pageInfo.hasPreviousPage).toBe(false);
        expect(pageInfo.hasNextPage).toBe(true);
      });
    });

    describe("deduplication", () => {
      it("deduplicates nodes by reference across pages", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { end: "p3", hasNext: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [3, 4, 5],
          { end: "p5", hasNext: false },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5"]);
      });

      it("refreshes edge meta from duplicate without adding duplicate edge", () => {
        const canKey = "@connection.posts({})";
        const page1Key = '@.posts({"after":null,"first":2})';
        const page2Key = '@.posts({"after":"c2","first":2})';

        // Create first page with initial edge metadata
        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          page1Key,
          [1, 2],
          { start: "c1", end: "c2", hasNext: true },
        );

        // Override first page edges with custom metadata
        graph.putRecord(`${page1Key}.edges:0`, {
          __typename: "PostEdge",
          cursor: "c1",
          node: { __ref: "Post:1" },
          score: 1,
        });
        graph.putRecord(`${page1Key}.edges:1`, {
          __typename: "PostEdge",
          cursor: "c2",
          node: { __ref: "Post:2" },
          score: 1,
        });

        // Update concrete page record
        graph.putRecord(page1Key, {
          __typename: "PostConnection",
          edges: {
            __refs: [`${page1Key}.edges:0`, `${page1Key}.edges:1`],
          },
          pageInfo: p0.pageInfo,
        });

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: null },
          pageKey: page1Key,
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        // Verify initial state
        expect(getNodeIds(canKey)).toEqual(["1", "2"]);
        const canonicalAfterP1 = graph.getRecord(canKey);
        const edge1RefAfterP1 = canonicalAfterP1.edges.__refs[1];
        const edge1AfterP1 = graph.getRecord(edge1RefAfterP1);
        expect(edge1AfterP1.cursor).toBe("c2");
        expect(edge1AfterP1.score).toBe(1);

        // Create second page with duplicate node 2 but updated metadata
        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          page2Key,
          [2, 3],
          { start: "c2x", end: "c3", hasNext: false },
        );

        // Override second page edges with updated metadata for node 2
        graph.putRecord(`${page2Key}.edges:0`, {
          __typename: "PostEdge",
          cursor: "c2x",
          node: { __ref: "Post:2" },
          score: 9,
        });
        graph.putRecord(`${page2Key}.edges:1`, {
          __typename: "PostEdge",
          cursor: "c3",
          node: { __ref: "Post:3" },
          score: 8,
        });

        // Update concrete page record
        graph.putRecord(page2Key, {
          __typename: "PostConnection",
          edges: {
            __refs: [`${page2Key}.edges:0`, `${page2Key}.edges:1`],
          },
          pageInfo: p1.pageInfo,
        });

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: "c2" },
          pageKey: page2Key,
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        // Verify deduplication and metadata refresh
        const canonicalConnection = graph.getRecord(canKey);
        expect(canonicalConnection.edges.__refs.length).toBe(3);
        expect(getNodeIds(canKey)).toEqual(["1", "2", "3"]);

        // The canonical should still reference the first page's edge for node 2
        // but ALL metadata (including cursor) should be refreshed from the later occurrence
        const keptEdge = graph.getRecord(canonicalConnection.edges.__refs[1]);
        expect(keptEdge.cursor).toBe("c2x"); // Cursor IS refreshed (metadata)
        expect(keptEdge.score).toBe(9);      // Score IS refreshed (metadata)
        expect(keptEdge.node.__ref).toBe("Post:2"); // Node reference stays the same
      });
    });

    describe("connection filters", () => {
      it("creates separate canonical keys for different filter values", () => {
        const adminKey = '@connection.users({"role":"admin"})';
        const userKey = '@connection.users({"role":"user"})';

        const { page: adminPage, edgeRefs: adminEdges } = writeUserPage(
          graph,
          '@.users({"after":null,"first":2,"role":"admin"})',
          ["u1", "u2"],
          { hasNext: false },
        );

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: '@.users({"after":null,"first":2,"role":"admin"})',
          pageSnapshot: adminPage,
          pageEdgeRefs: adminEdges,
        });

        const { page: userPage, edgeRefs: userEdges } = writeUserPage(
          graph,
          '@.users({"after":null,"first":2,"role":"user"})',
          ["u3", "u4"],
          { hasNext: false },
        );

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "user", first: 2, after: null },
          pageKey: '@.users({"after":null,"first":2,"role":"user"})',
          pageSnapshot: userPage,
          pageEdgeRefs: userEdges,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2"]);
        expect(getNodeIds(userKey)).toEqual(["u3", "u4"]);
        expect(getMeta(adminKey)).toBeDefined();
        expect(getMeta(userKey)).toBeDefined();
      });

      it("maintains separate state for filtered connections after leader refetch", () => {
        const adminKey = '@connection.users({"role":"admin"})';

        const { page: page0, edgeRefs: page0EdgeRefs } = writeUserPage(
          graph,
          '@.users({"after":null,"first":2,"role":"admin"})',
          ["u1", "u2"],
          { start: "u1", end: "u2", hasNext: true, hasPrev: false },
        );

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: '@.users({"after":null,"first":2,"role":"admin"})',
          pageSnapshot: page0,
          pageEdgeRefs: page0EdgeRefs,
        });

        const { page: page1, edgeRefs: page1EdgeRefs } = writeUserPage(
          graph,
          '@.users({"after":"u2","first":2,"role":"admin"})',
          ["u3", "u4"],
          { start: "u3", end: "u4", hasNext: false, hasPrev: true },
        );

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: "u2" },
          pageKey: '@.users({"after":"u2","first":2,"role":"admin"})',
          pageSnapshot: page1,
          pageEdgeRefs: page1EdgeRefs,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2", "u3", "u4"]);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: '@.users({"after":null,"first":2,"role":"admin"})',
          pageSnapshot: page0,
          pageEdgeRefs: page0EdgeRefs,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2"]);

        const pageInfo = graph.getRecord(adminKey).pageInfo;
        expect(pageInfo.startCursor).toBe("u1");
        expect(pageInfo.endCursor).toBe("u2");
      });
    });

    describe("optimistic integration", () => {
      it("triggers optimistic replay after network update", () => {
        const replaySpy = vi.spyOn(optimistic, "replayOptimistic");

        const { page, edgeRefs } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { hasNext: true },
        );

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        expect(replaySpy).toHaveBeenCalledWith({
          connections: ["@connection.posts({})"],
        });
      });
    });
  });

  describe("updateConnection - page mode", () => {
    it("directly replaces canonical with page snapshot without meta", () => {
      const canKey = "@connection.tags({})";
      const pageKey = '@.tags({"after":null,"first":10})';

      const { page, edgeRefs } = writeTagPage(
        graph,
        pageKey,
        ["t1", "t2", "t3"],
        { start: "t1", end: "t3", hasNext: false },
      );

      page.totalCount = 3;

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey,
        pageSnapshot: page,
        pageEdgeRefs: edgeRefs,
      });

      const canonicalConnection = graph.getRecord(canKey);
      expect(canonicalConnection.__typename).toBe("TagConnection");
      expect(getNodeIds(canKey)).toEqual(["t1", "t2", "t3"]);
      expect(canonicalConnection.totalCount).toBe(3);

      const pageInfo = canonicalConnection.pageInfo;
      expect(pageInfo.startCursor).toBe("t1");
      expect(pageInfo.endCursor).toBe("t3");
      expect(pageInfo.hasNextPage).toBe(false);

      const meta = getMeta(canKey);
      expect(meta).toBeUndefined();
    });

    it("replaces entire canonical on each page mode update", () => {
      const canKey = "@connection.tags({})";

      const { page: p0, edgeRefs: e0 } = writeTagPage(
        graph,
        '@.tags({"after":null,"first":10})',
        ["t1", "t2"],
        { hasNext: true },
      );

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey: '@.tags({"after":null,"first":10})',
        pageSnapshot: p0,
        pageEdgeRefs: e0,
      });

      expect(getNodeIds(canKey)).toEqual(["t1", "t2"]);

      const { page: p1, edgeRefs: e1 } = writeTagPage(
        graph,
        '@.tags({"after":"t2","first":10})',
        ["t3", "t4", "t5"],
        { hasNext: false },
      );

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: "t2" },
        pageKey: '@.tags({"after":"t2","first":10})',
        pageSnapshot: p1,
        pageEdgeRefs: e1,
      });

      expect(getNodeIds(canKey)).toEqual(["t3", "t4", "t5"]);
    });
  });

  describe("mergeFromCache", () => {
    describe("infinite mode", () => {
      it("creates canonical with cache origin in meta", () => {
        const canKey = "@connection.posts({})";
        const pageKey = '@.posts({"after":null,"first":3})';

        const { page, edgeRefs } = writePostPage(
          graph,
          pageKey,
          [1, 2, 3],
          { hasNext: true },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3"]);

        const meta = getMeta(canKey);
        expect(meta.origin[pageKey]).toBe("cache");
        expect(meta.leader).toBe(pageKey);
      });

      it("merges multiple out-of-order pages and maintains leader-first order", () => {
        const canKey = "@connection.posts({})";

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { start: "p4", end: "p6", hasNext: true },
        );
        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true },
        );
        const { page: p2, edgeRefs: e2 } = writePostPage(
          graph,
          '@.posts({"after":"p6","first":3})',
          [7, 8],
          { start: "p7", end: "p8", hasNext: false },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p6" },
          pageKey: '@.posts({"after":"p6","first":3})',
          pageSnapshot: p2,
          pageEdgeRefs: e2,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

        const pageInfo = graph.getRecord(canKey).pageInfo;
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p8");

        const meta = getMeta(canKey);
        expect(meta.leader).toBe('@.posts({"after":null,"first":3})');
      });

      it("handles before/after pages consistently in prewarm", () => {
        const canKey = "@connection.posts({})";

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { start: "p1", end: "p3", hasNext: true, hasPrev: true },
        );
        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"before":"p1","last":3})',
          [-2, -1, 0],
          { start: "p-2", end: "p0", hasPrev: false, hasNext: true },
        );
        const { page: p2, edgeRefs: e2 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5],
          { start: "p4", end: "p5", hasNext: true },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p2,
          pageEdgeRefs: e2,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p1" },
          pageKey: '@.posts({"before":"p1","last":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["-2", "-1", "0", "1", "2", "3", "4", "5"]);

        const pageInfo = graph.getRecord(canKey).pageInfo;
        expect(pageInfo.startCursor).toBe("p-2");
        expect(pageInfo.endCursor).toBe("p5");

        const meta = getMeta(canKey);
        expect(meta.hints['@.posts({"before":"p1","last":3})']).toBe("before");
        expect(meta.hints['@.posts({"after":null,"first":3})']).toBe("leader");
        expect(meta.hints['@.posts({"after":"p3","first":3})']).toBe("after");
      });

      it("network leader call resets prewarm union to leader only", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { end: "p3", hasNext: true },
        );
        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { end: "p6", hasNext: false },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3"]);

        const meta = getMeta(canKey);
        expect(meta.pages).toEqual(['@.posts({"after":null,"first":3})']);
        expect(meta.origin['@.posts({"after":null,"first":3})']).toBe("network");
      });

      it("network forward call after prewarm maintains union", () => {
        const canKey = "@connection.posts({})";

        const { page: p0, edgeRefs: e0 } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { hasNext: true, hasPrev: false },
        );

        const { page: p1, edgeRefs: e1 } = writePostPage(
          graph,
          '@.posts({"after":"p3","first":3})',
          [4, 5, 6],
          { hasNext: false, hasPrev: true },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: p0,
          pageEdgeRefs: e0,
        });
        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: '@.posts({"after":"p3","first":3})',
          pageSnapshot: p1,
          pageEdgeRefs: e1,
        });

        expect(getNodeIds(canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

        const meta = getMeta(canKey);
        expect(meta.origin['@.posts({"after":"p3","first":3})']).toBe("network");
      });

      it("triggers optimistic replay after cache merge", () => {
        const replaySpy = vi.spyOn(optimistic, "replayOptimistic");

        const { page, edgeRefs } = writePostPage(
          graph,
          '@.posts({"after":null,"first":3})',
          [1, 2, 3],
          { hasNext: true },
        );

        canonical.mergeFromCache({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: '@.posts({"after":null,"first":3})',
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        expect(replaySpy).toHaveBeenCalledWith({
          connections: ["@connection.posts({})"],
        });
      });
    });

    describe("page mode", () => {
      it("directly replaces canonical without meta in page mode", () => {
        const canKey = "@connection.tags({})";
        const pageKey = '@.tags({"after":null,"first":10})';

        const { page, edgeRefs } = writeTagPage(graph, pageKey, ["t1", "t2"], { hasNext: false });

        canonical.mergeFromCache({
          field: TAGS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 10, after: null },
          pageKey,
          pageSnapshot: page,
          pageEdgeRefs: edgeRefs,
        });

        expect(getNodeIds(canKey)).toEqual(["t1", "t2"]);
        expect(getMeta(canKey)).toBeUndefined();
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty page gracefully", () => {
      const canKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      const { page, edgeRefs } = writePostPage(
        graph,
        pageKey,
        [],
        { start: null, end: null, hasNext: false, hasPrev: false },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        pageSnapshot: page,
        pageEdgeRefs: edgeRefs,
      });

      expect(getNodeIds(canKey)).toEqual([]);
      const meta = getMeta(canKey);
      expect(meta).toBeDefined();
      expect(meta.leader).toBe(pageKey);
    });

    it("handles page with no pageInfo", () => {
      const canKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      graph.putRecord("Post:1", { __typename: "Post", id: "1" });
      graph.putRecord(`${pageKey}.edges:0`, {
        __typename: "PostEdge",
        node: { __ref: "Post:1" },
      });

      const page = {
        __typename: "PostConnection",
        edges: { __refs: [`${pageKey}.edges:0`] },
        pageInfo: {}, // intentionally minimal
      };

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        pageSnapshot: page,
        pageEdgeRefs: [{ __ref: `${pageKey}.edges:0` }],
      });

      expect(getNodeIds(canKey)).toEqual(["1"]);
      const canonicalPageInfo = graph.getRecord(canKey).pageInfo;
      expect(canonicalPageInfo).toBeDefined();
    });

    it("ensures canonical record exists even before any pages", () => {
      const canKey = "@connection.posts({})";

      let canonicalConnection = graph.getRecord(canKey);
      expect(canonicalConnection).toBeUndefined();

      const { page, edgeRefs } = writePostPage(
        graph,
        '@.posts({"after":null,"first":3})',
        [1],
        { hasNext: false },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page,
        pageEdgeRefs: edgeRefs,
      });

      canonicalConnection = graph.getRecord(canKey);
      expect(canonicalConnection).toBeDefined();
      expect(canonicalConnection.__typename).toBe("PostConnection");
    });
  });
});
