// test/unit/features/optimistic.test.ts
import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createModifyOptimistic } from "@/src/features/optimistic";

// tiny microtask helper (ops are sync, but we keep the pattern)
const tick = () => Promise.resolve();

/** Read edge refs of a page and map to {edgeKey, nodeKey, cursor, meta} for convenience. */
function readEdges(graph: ReturnType<typeof createGraph>, pageKey: string) {
  const page = graph.getRecord(pageKey) || {};
  const refs = Array.isArray(page.edges) ? page.edges : [];
  const out: Array<{ edgeKey: string; nodeKey: string; cursor: any; meta: Record<string, any> }> = [];
  for (let i = 0; i < refs.length; i++) {
    const edgeKey = refs[i]?.__ref;
    if (!edgeKey) continue;
    const e = graph.getRecord(edgeKey) || {};
    out.push({
      edgeKey,
      nodeKey: e?.node?.__ref,
      cursor: e?.cursor,
      meta: Object.fromEntries(
        Object.keys(e || {})
          .filter((k) => k !== "cursor" && k !== "node")
          .map((k) => [k, e[k]])
      ),
    });
  }
  return out;
}

describe("features/optimistic", () => {
  describe("entity operations + conflict/order", () => {
    it("later optimistic write wins for same entity; revert restores previous snapshot", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });

      const pageKey = '@.posts({})';

      const t1 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
      });

      const t2 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "B" }, { cursor: "c1b" });
      });

      t1.commit?.();
      t2.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")?.title).toBe("B");

      t2.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")?.title).toBe("A");

      t1.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")).toBeUndefined();
    });

    it("remove then re-add within the same optimistic layer respects final instruction", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const t = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
        conn.removeNode({ __typename: "Post", id: 1 });
        conn.addNode({ __typename: "Post", id: 1, title: "A-final" }, { cursor: "c1z" });
      });

      t.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toBeTruthy();
      expect(graph.getRecord("Post:1")?.title).toBe("A-final");
    });
  });

  describe("connection operations (edge dedupe / order / pageInfo)", () => {
    const makeGraph = () =>
      createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
        interfaces: {},
      });

    it("deduplicates by entity key and updates cursor/edge meta in place", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "A1" }, { cursor: "c1" });
        conn.addNode(
          { __typename: "Post", id: 1, title: "A1-new" },
          { cursor: "c1b", edge: { score: 42 } }
        );
      });

      txn.commit?.();

      const edges = readEdges(graph, pageKey);
      expect(edges.length).toBe(1);
      expect(edges[0].cursor).toBe("c1b");
      expect(edges[0].meta.score).toBe(42);

      // entity snapshot merged
      expect(graph.getRecord("Post:1")!.title).toBe("A1-new");
    });

    it("removeNode is a no-op when entity missing and works by id+typename", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });

        // remove non-existing
        conn.removeNode({ __typename: "Post", id: 999 });

        // Add then remove
        conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
        conn.removeNode({ __typename: "Post", id: 1 });
      });

      txn.commit?.();

      expect(readEdges(graph, pageKey).length).toBe(0);
      // entity remains; optimistic ops don't GC entities
      expect(graph.getRecord("Post:1")).toBeTruthy();
    });

    it("default addNode position is end; explicit start inserts at the front", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" }); // end
        conn.addNode({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" }); // end
        conn.addNode({ __typename: "Post", id: 0, title: "P0" }, { cursor: "c0", position: "start" });
      });

      txn.commit?.();

      const edges = readEdges(graph, pageKey);
      const ids = edges.map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["0", "1", "2"]);
    });

    it("ignores invalid nodes (missing __typename or id)", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ id: 1, title: "NoType" } as any, { cursor: "x" });
        conn.addNode({ __typename: "Post", title: "NoId" } as any, { cursor: "y" });
      });

      txn.commit?.();

      expect(readEdges(graph, pageKey).length).toBe(0);
      expect(graph.getRecord("Post:1")).toBeUndefined();
    });

    it("re-adding after removal places node according to latest position hint", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        conn.removeNode({ __typename: "Post", id: 1 });
        conn.addNode(
          { __typename: "Post", id: 1, title: "P1-again" },
          { cursor: "c1b", position: "start" }
        );
      });

      txn.commit?.();

      const edges = readEdges(graph, pageKey);
      const ids = edges.map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["1"]);
      expect(graph.getRecord("Post:1")!.title).toBe("P1-again");
    });

    it("patches pageInfo on this page", () => {
      const graph = makeGraph();
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({"first":2})';

      const txn = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
        conn.patch({ endCursor: "c1", hasNextPage: true });
        conn.removeNode({ __typename: "Post", id: 1 });
      });

      txn.commit?.();

      const page = graph.getRecord(pageKey)!;
      expect(page.pageInfo).toEqual({ endCursor: "c1", hasNextPage: true });

      const edgesLen = Array.isArray(page.edges) ? page.edges.length : 0;
      expect(edgesLen).toBe(0);
    });
  });

  describe("layering / stacking semantics", () => {
    it("supports multiple layers; revert preserves later commits", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const t1 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        conn.addNode({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
      });
      const t2 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 3, title: "P3" }, { cursor: "c3" });
      });

      t1.commit?.();
      t2.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toBeTruthy();
      expect(graph.getRecord("Post:2")).toBeTruthy();
      expect(graph.getRecord("Post:3")).toBeTruthy();

      t1.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")).toBeUndefined();
      expect(graph.getRecord("Post:2")).toBeUndefined();
      expect(graph.getRecord("Post:3")).toBeTruthy();

      t2.revert?.();
      await tick();
      expect(graph.getRecord("Post:3")).toBeUndefined();
    });

    it("revert before commit is a no-op", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });
      const pageKey = '@.posts({})';

      const t = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
      });

      t.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")).toBeUndefined();
    });

    it("ops to different pages (same identity, different cursors) both apply (entities exist)", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });

      const p1 = '@.posts({"first":2,"after":null})';
      const p2 = '@.posts({"first":2,"after":"c1"})';

      const t1 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey: p1 });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
      });

      const t2 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey: p2 });
        conn.addNode({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
      });

      t1.commit?.();
      t2.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toBeTruthy();
      expect(graph.getRecord("Post:2")).toBeTruthy();
    });

    it("ops to different pages (same identity) also work for 1 + 3", async () => {
      const graph = createGraph({
        keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      });
      const optimistic = createModifyOptimistic({ graph });

      const p1 = '@.posts({"first":2,"after":null})';
      const p2 = '@.posts({"first":2,"after":"c1"})';

      const t1 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey: p1 });
        conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
      });

      const t2 = optimistic((tx) => {
        const [conn] = tx.connection({ pageKey: p2 });
        conn.addNode({ __typename: "Post", id: 3, title: "P3" }, { cursor: "c2" });
      });

      t1.commit?.();
      t2.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toBeTruthy();
      expect(graph.getRecord("Post:3")).toBeTruthy();
    });
  });
});
