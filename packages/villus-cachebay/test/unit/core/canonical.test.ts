import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { ROOT_ID } from "@/src/core/constants";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import type { PlanField } from "@/src/compiler";
import { buildConnectionCanonicalKey } from "@/src/core/utils";

/** ------------------------------------------------------------------ helpers */

const fieldPostsInfinite: PlanField = {
  fieldName: "posts",
  responseKey: "posts",
  isConnection: true,
  connectionMode: "infinite",
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
} as any;

function writePageSnapshot(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: (number | string)[],
  opts?: { start?: string | null; end?: string | null; hasNext?: boolean; hasPrev?: boolean; typename?: string }
) {
  const pageInfo = {
    __typename: "PageInfo",
    startCursor: opts?.start ?? (nodeIds.length ? `p${nodeIds[0]}` : null),
    endCursor: opts?.end ?? (nodeIds.length ? `p${nodeIds[nodeIds.length - 1]}` : null),
    hasNextPage: !!opts?.hasNext,
    hasPreviousPage: !!opts?.hasPrev,
  };
  const edgeRefs = nodeIds.map((id, i) => {
    const edgeKey = `${pageKey}.edges.${i}`;
    const nodeKey = `Post:${id}`;
    graph.putRecord(nodeKey, { __typename: "Post", id: String(id), title: `Post ${id}` });
    graph.putRecord(edgeKey, { __typename: "PostEdge", cursor: `p${id}`, node: { __ref: nodeKey } });
    return { __ref: edgeKey };
  });
  const page = { __typename: opts?.typename ?? "PostConnection", edges: edgeRefs, pageInfo };
  graph.putRecord(pageKey, page);
  return { page, edgeRefs };
}

function readCanonicalNodeIds(graph: ReturnType<typeof createGraph>, canKey: string): string[] {
  const can = graph.getRecord(canKey) || {};
  const refs = Array.isArray(can.edges) ? can.edges : [];
  const ids: string[] = [];
  for (const r of refs) {
    const eref = r?.__ref;
    const e = eref ? graph.getRecord(eref) : null;
    const nref = e?.node?.__ref;
    const n = nref ? graph.getRecord(nref) : null;
    if (n?.id) ids.push(String(n.id));
  }
  return ids;
}

const makeSystem = () => {
  const graph = createGraph({
    keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    interfaces: {},
  });
  const optimistic = createOptimistic({ graph });
  const canonical = createCanonical({ graph, optimistic });
  return { graph, optimistic, canonical };
};

/** ------------------------------------------------------------------ tests */

describe("core/canonical (flat edges[] union + per-page slice replacement)", () => {
  it("leader refetch replaces; forward after appends; pageInfo aggregates head/tail", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // Leader P1 (1,2,3)
    const p1Key = '@.posts({"after":null,"first":3})';
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { start: "p1", end: "p3", hasNext: true });

    canonical.updateConnection({
      field: fieldPostsInfinite,
      parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null },
      pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3"]);
    expect(graph.getRecord(canKey)?.pageInfo?.endCursor).toBe("p3");

    // Forward P2 (4,5,6)
    const p2Key = '@.posts({"after":"p3","first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [4, 5, 6], { start: "p4", end: "p6", hasNext: false });

    canonical.updateConnection({
      field: fieldPostsInfinite,
      parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" },
      pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });

    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);
    const pi = graph.getRecord(canKey)?.pageInfo;
    expect(pi.startCursor).toBe("p1");
    expect(pi.endCursor).toBe("p6");
    expect(pi.hasNextPage).toBe(false);
  });

  it("prewarm (cache path) merges multiple out-of-order pages and keeps leader-first order", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // Cache pages: we only wrote the concrete pages (simulate returning to screen)
    const p2Key = '@.posts({"after":"p3","first":3})';
    const p1Key = '@.posts({"after":null,"first":3})';
    const p3Key = '@.posts({"after":"p6","first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [4, 5, 6], { start: "p4", end: "p6", hasNext: true });
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { start: "p1", end: "p3", hasNext: true });
    const P3 = writePageSnapshot(graph, p3Key, [7, 8], { start: "p7", end: "p8", hasNext: false });

    // Prewarm out of order: P2 → P3 → P1
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p6" }, pageKey: p3Key, pageSnap: P3.page, pageEdgeRefs: P3.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    // Expect leader-first order and then forward pages in anchor order
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

    // Head/tail pageInfo should reflect leader/tail
    const pi = graph.getRecord(canKey)?.pageInfo;
    expect(pi.startCursor).toBe("p1");
    expect(pi.endCursor).toBe("p8");
  });

  it("prewarm with BEFORE (previous page) + AFTER (next page) yields consistent order P0,P1,P2", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // P1 (leader), P0 (before), P2 (after)
    const p1Key = '@.posts({"after":null,"first":3})';
    const p0Key = '@.posts({"before":"p1","last":3})';
    const p2Key = '@.posts({"after":"p3","first":3})';
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { start: "p1", end: "p3", hasNext: true, hasPrev: true });
    const P0 = writePageSnapshot(graph, p0Key, [-2, -1, 0], { start: "p-2", end: "p0", hasPrev: false, hasNext: true });
    const P2 = writePageSnapshot(graph, p2Key, [4, 5], { start: "p4", end: "p5", hasNext: true });

    // Prewarm AFTER first (out of order), then BEFORE, then LEADER
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 2, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { last: 3, before: "p1" }, pageKey: p0Key, pageSnap: P0.page, pageEdgeRefs: P0.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["-2", "-1", "0", "1", "2", "3", "4", "5"]);
    const pi = graph.getRecord(canKey)?.pageInfo;
    expect(pi.startCursor).toBe("p-2");
    expect(pi.endCursor).toBe("p5");
  });

  it("slice replacement: reloading P2 replaces its edges (remove 5, add 7)", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // P1 + first P2
    const p1Key = '@.posts({"after":null,"first":3})';
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { end: "p3", hasNext: true });
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    const p2Key = '@.posts({"after":"p3","first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [4, 5, 6], { end: "p6", hasNext: true });
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

    // Updated P2: [4,6,7]
    const P2b = writePageSnapshot(graph, p2Key, [4, 6, 7], { end: "p7", hasNext: false });
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2b.page, pageEdgeRefs: P2b.edgeRefs,
    });

    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "6", "7"]);
    const pi = graph.getRecord(canKey)?.pageInfo;
    expect(pi.endCursor).toBe("p7");
    expect(pi.hasNextPage).toBe(false);
  });

  it("leader network call after prewarm resets to leader slice only", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // Prewarm two pages
    const p1Key = '@.posts({"after":null,"first":3})';
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { end: "p3", hasNext: true });
    const p2Key = '@.posts({"after":"p3","first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [4, 5, 6], { end: "p6", hasNext: false });

    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

    // Network leader arrives → replace with leader slice only
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3"]);
  });

  it("dedup across pages: duplicate node in P2 refreshes edge meta but not duplicated", () => {
    const { graph, canonical } = makeSystem();
    const canKey = '@connection.posts({})';

    // Leader P1 with node 3
    const p1Key = '@.posts({"after":null,"first":3})';
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { end: "p3", hasNext: true });
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    // P2 repeats node 3 (should dedup)
    const p2Key = '@.posts({"after":"p3","first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [3, 4, 5], { end: "p5", hasNext: false });
    canonical.updateConnection({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });

    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("optimistic overlay re-applies after base writes & prewarm", () => {
    const { graph, canonical, optimistic } = makeSystem();
    const canKey = '@connection.posts({})';

    // Prepare overlay: remove Post:2; add Post:9 at front
    optimistic.modifyOptimistic((tx) => {
      const c = tx.connection({ parent: "Query", key: "posts" });
      c.remove({ __typename: "Post", id: 2 });
      c.prepend({ __typename: "Post", id: 9, title: "P9" }, { cursor: "p9" });
    }).commit?.();

    // Prewarm out-of-order P2 then P1
    const p2Key = '@.posts({"after":"p3","first":3})';
    const p1Key = '@.posts({"after":null,"first":3})';
    const P2 = writePageSnapshot(graph, p2Key, [4, 5, 6], { end: "p6", hasNext: true });
    const P1 = writePageSnapshot(graph, p1Key, [1, 2, 3], { end: "p3", hasNext: true });

    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: "p3" }, pageKey: p2Key, pageSnap: P2.page, pageEdgeRefs: P2.edgeRefs,
    });
    canonical.mergeFromCache({
      field: fieldPostsInfinite, parentRecordId: ROOT_ID,
      requestVars: { first: 3, after: null }, pageKey: p1Key, pageSnap: P1.page, pageEdgeRefs: P1.edgeRefs,
    });

    // Overlay should be applied on top: Post:2 removed; Post:9 at front
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["9", "1", "3", "4", "5", "6"]);
  });

  it("refresh of the same page updates edge meta without dupes; keeps order", () => {
    const graph = createGraph({ interfaces: {} });
    const optimistic = createOptimistic({ graph });
    const canonical = createCanonical({ graph, optimistic });

    // Pretend leader page P1 edges (1,2)
    const field: any = {
      isConnection: true, connectionKey: "posts", connectionFilters: [],
      connectionMode: "infinite", fieldName: "posts", responseKey: "posts",
      buildArgs: (v: any) => v || {}
    };
    const pageKeyP1 = '@.posts({"after":null,"first":2})';
    graph.putRecord("Post:1", { __typename: "Post", id: "1" });
    graph.putRecord("Post:2", { __typename: "Post", id: "2" });
    graph.putRecord(`${pageKeyP1}.edges.0`, { __typename: "PostEdge", cursor: "c1", node: { __ref: "Post:1" }, score: 1 });
    graph.putRecord(`${pageKeyP1}.edges.1`, { __typename: "PostEdge", cursor: "c2", node: { __ref: "Post:2" }, score: 1 });

    canonical.updateConnection({
      field, parentRecordId: "@", requestVars: { first: 2, after: null }, pageKey: pageKeyP1,
      pageSnap: { __typename: "PostConnection", pageInfo: { __typename: "PageInfo", startCursor: "c1", endCursor: "c2" } },
      pageEdgeRefs: [{ __ref: `${pageKeyP1}.edges.0` }, { __ref: `${pageKeyP1}.edges.1` }],
    });

    // Refresh P1 with same nodes but new meta (scores, cursors)
    graph.putRecord(`${pageKeyP1}.edges.0`, { score: 9, cursor: "c1x", node: { __ref: "Post:1" } });
    graph.putRecord(`${pageKeyP1}.edges.1`, { score: 8, cursor: "c2x", node: { __ref: "Post:2" } });

    canonical.updateConnection({
      field, parentRecordId: "@", requestVars: { first: 2, after: null }, pageKey: pageKeyP1,
      pageSnap: { __typename: "PostConnection", pageInfo: { __typename: "PageInfo", startCursor: "c1x", endCursor: "c2x" } },
      pageEdgeRefs: [{ __ref: `${pageKeyP1}.edges.0` }, { __ref: `${pageKeyP1}.edges.1` }],
    });

    const canKey = '@connection.posts({})';
    const can = graph.getRecord(canKey);
    expect(can.edges.length).toBe(2);
    const e0 = graph.getRecord(can.edges[0].__ref);
    const e1 = graph.getRecord(can.edges[1].__ref);
    expect(e0.cursor).toBe("c1x");
    expect(e0.score).toBe(9);
    expect(e1.cursor).toBe("c2x");
    expect(e1.score).toBe(8);
    // order is still 1,2
    const ids = can.edges.map((r: any) => graph.getRecord(graph.getRecord(r.__ref).node.__ref).id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("leader refetch after forward pages keeps leader-first order & anchored pageInfo", () => {
    const graph = createGraph({ interfaces: {} });
    const optimistic = createOptimistic({ graph });
    const canonical = createCanonical({ graph, optimistic });

    const field: any = {
      isConnection: true, connectionKey: "users", connectionFilters: ["role"],
      connectionMode: "infinite", fieldName: "users", responseKey: "users",
      buildArgs: (v: any) => v || {}
    };

    // leader P1: u1,u2
    ["u1", "u2", "u3", "u4"].forEach(u => graph.putRecord(`User:${u}`, { __typename: "User", id: u }));
    const p1 = '@.users({"after":null,"first":2,"role":"admin"})';
    graph.putRecord(`${p1}.edges.0`, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
    graph.putRecord(`${p1}.edges.1`, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });
    canonical.updateConnection({
      field, parentRecordId: "@",
      requestVars: { usersRole: "admin", first: 2, after: null },
      pageKey: p1,
      pageSnap: { __typename: "UserConnection", pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false } },
      pageEdgeRefs: [{ __ref: `${p1}.edges.0` }, { __ref: `${p1}.edges.1` }],
    });

    // after P2: u3,u4
    const p2 = '@.users({"after":"u2","first":2,"role":"admin"})';
    graph.putRecord(`${p2}.edges.0`, { __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u3" } });
    graph.putRecord(`${p2}.edges.1`, { __typename: "UserEdge", cursor: "u4", node: { __ref: "User:u4" } });
    canonical.updateConnection({
      field, parentRecordId: "@",
      requestVars: { usersRole: "admin", first: 2, after: "u2" },
      pageKey: p2,
      pageSnap: { __typename: "UserConnection", pageInfo: { __typename: "PageInfo", startCursor: "u3", endCursor: "u4", hasNextPage: false, hasPreviousPage: true } },
      pageEdgeRefs: [{ __ref: `${p2}.edges.0` }, { __ref: `${p2}.edges.1` }],
    });

    // leader refetch (still u1,u2)
    canonical.updateConnection({
      field, parentRecordId: "@",
      requestVars: { usersRole: "admin", first: 2, after: null },
      pageKey: p1,
      pageSnap: { __typename: "UserConnection", pageInfo: { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false } },
      pageEdgeRefs: [{ __ref: `${p1}.edges.0` }, { __ref: `${p1}.edges.1` }],
    });

    const canKey = buildConnectionCanonicalKey(field, "@", { usersRole: "admin" });
    const ids = (graph.getRecord(canKey).edges || []).map((r: any) => {
      const edge = graph.getRecord(r.__ref);
      const node = graph.getRecord(edge.node.__ref);
      return node.id;
    });
    expect(ids).toEqual(["u1", "u2"]);
    const pi = graph.getRecord(canKey).pageInfo;
    expect(pi.startCursor).toBe("u1");
    expect(pi.endCursor).toBe("u2"); // anchored to leader
  });

  it("prewarm P1,P2 from cache → network P2 arrives and union stays 1..6", () => {
    const graph = createGraph({ interfaces: {} });
    const optimistic = createOptimistic({ graph });
    const canonical = createCanonical({ graph, optimistic });

    const field: any = {
      isConnection: true, connectionKey: "posts", connectionFilters: [],
      connectionMode: "infinite", fieldName: "posts", responseKey: "posts",
      buildArgs: (v: any) => v || {}
    };

    const canKey = '@connection.posts({})';

    // P1 (leader): 1,2,3
    const p1 = '@.posts({"after":null,"first":3})';
    graph.putRecord("Post:1", { __typename: "Post", id: "1" });
    graph.putRecord("Post:2", { __typename: "Post", id: "2" });
    graph.putRecord("Post:3", { __typename: "Post", id: "3" });
    graph.putRecord(`${p1}.edges.0`, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:1" } });
    graph.putRecord(`${p1}.edges.1`, { __typename: "PostEdge", cursor: "p2", node: { __ref: "Post:2" } });
    graph.putRecord(`${p1}.edges.2`, { __typename: "PostEdge", cursor: "p3", node: { __ref: "Post:3" } });
    const P1 = {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
      edges: [{ __ref: `${p1}.edges.0` }, { __ref: `${p1}.edges.1` }, { __ref: `${p1}.edges.2` }],
    };

    // P2 (after): 4,5,6
    const p2 = '@.posts({"after":"p3","first":3})';
    graph.putRecord("Post:4", { __typename: "Post", id: "4" });
    graph.putRecord("Post:5", { __typename: "Post", id: "5" });
    graph.putRecord("Post:6", { __typename: "Post", id: "6" });
    graph.putRecord(`${p2}.edges.0`, { __typename: "PostEdge", cursor: "p4", node: { __ref: "Post:4" } });
    graph.putRecord(`${p2}.edges.1`, { __typename: "PostEdge", cursor: "p5", node: { __ref: "Post:5" } });
    graph.putRecord(`${p2}.edges.2`, { __typename: "PostEdge", cursor: "p6", node: { __ref: "Post:6" } });
    const P2 = {
      __typename: "PostConnection",
      pageInfo: { __typename: "PageInfo", startCursor: "p4", endCursor: "p6", hasNextPage: false, hasPreviousPage: true },
      edges: [{ __ref: `${p2}.edges.0` }, { __ref: `${p2}.edges.1` }, { __ref: `${p2}.edges.2` }],
    };

    // Prewarm (cache path): P1 then P2 → union 1..6
    canonical.mergeFromCache({ field, parentRecordId: ROOT_ID, requestVars: { first: 3, after: null }, pageKey: p1, pageSnap: P1, pageEdgeRefs: P1.edges });
    canonical.mergeFromCache({ field, parentRecordId: ROOT_ID, requestVars: { first: 3, after: "p3" }, pageKey: p2, pageSnap: P2, pageEdgeRefs: P2.edges });
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

    // Network P2 arrives (same slice) → union still 1..6, pageInfo unchanged
    canonical.updateConnection({ field, parentRecordId: ROOT_ID, requestVars: { first: 3, after: "p3" }, pageKey: p2, pageSnap: P2, pageEdgeRefs: P2.edges });
    expect(readCanonicalNodeIds(graph, canKey)).toEqual(["1", "2", "3", "4", "5", "6"]);

    const pi = graph.getRecord(canKey)?.pageInfo;
    expect(pi.startCursor).toBe("p1");
    expect(pi.endCursor).toBe("p6");
  });
});
