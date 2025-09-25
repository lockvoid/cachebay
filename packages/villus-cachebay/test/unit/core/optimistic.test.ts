import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";

const tick = () => Promise.resolve();

/** Read canonical edges as {edgeRef, nodeKey, cursor, meta}. */
function readCanonicalEdges(graph: ReturnType<typeof createGraph>, canonicalKey: string) {
  const page = graph.getRecord(canonicalKey) || {};
  const refs = Array.isArray(page.edges) ? page.edges : [];
  const out: Array<{ edgeRef: string; nodeKey: string; cursor: any; meta: Record<string, any> }> = [];
  for (let i = 0; i < refs.length; i++) {
    const edgeRef = refs[i]?.__ref;
    if (!edgeRef) continue;
    const e = graph.getRecord(edgeRef) || {};
    out.push({
      edgeRef,
      nodeKey: e?.node?.__ref,
      cursor: e?.cursor,
      meta: Object.fromEntries(
        Object.keys(e || {})
          .filter((k) => k !== "cursor" && k !== "node" && k !== "__typename")
          .map((k) => [k, e[k]])
      ),
    });
  }
  return out;
}

describe("features/optimistic (entities & canonical connections)", () => {
  const makeGraph = () =>
    createGraph({
      keys: {
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
        User: (o: any) => (o?.id != null ? String(o.id) : null),
      },
      interfaces: {},
    });

  describe("entity patch/delete", () => {
    it("patch(merge): object + function(prev); then replace; revert chain", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      // Seed
      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "T" });

      const T = modifyOptimistic((tx) => {
        // merge via object
        tx.patch("Post:1", { title: "T1" }, { mode: "merge" });
        // merge via function
        tx.patch({ __typename: "Post", id: "1" }, (prev) => ({ title: (prev.title || "") + "!" }), { mode: "merge" });
        // replace fully
        tx.patch("Post:1", { title: "REPLACED", tags: [] }, { mode: "replace" });
      });
      T.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toEqual({ __typename: "Post", id: "1", title: "REPLACED", tags: [] });

      T.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")).toEqual({ __typename: "Post", id: "1", title: "T" });
    });

    it("delete removes record; revert restores", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      graph.putRecord("User:9", { __typename: "User", id: "9", email: "x@x.com" });

      const T = modifyOptimistic((tx) => {
        tx.delete({ __typename: "User", id: "9" });
      });
      T.commit?.();
      await tick();
      expect(graph.getRecord("User:9")).toBeUndefined();

      T.revert?.();
      await tick();
      expect(graph.getRecord("User:9")).toEqual({ __typename: "User", id: "9", email: "x@x.com" });
    });
  });

  describe("canonical append / prepend / remove / patch", () => {
    it("append twice (same node) dedupes by node & updates cursor/meta", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      const canKey = '@connection.posts({})';

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        c.append({ __typename: "Post", id: 1, title: "P1-new" }, { cursor: "c1b", edge: { score: 42 } });
      });
      T.commit?.();

      const edges = readCanonicalEdges(graph, canKey);
      expect(edges.length).toBe(1);
      expect(edges[0].cursor).toBe("c1b");
      expect(edges[0].meta.score).toBe(42);
      expect(graph.getRecord("Post:1")!.title).toBe("P1-new");
    });

    it("prepend inserts at front; append at end", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        c.append({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
        c.prepend({ __typename: "Post", id: 0, title: "P0" }, { cursor: "c0" });
      });
      T.commit?.();

      const edges = readCanonicalEdges(graph, canKey);
      const ids = edges.map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["0", "1", "2"]);
    });

    it("remove is by node ref; removing missing is a no-op", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.remove({ __typename: "Post", id: 999 });
        c.append({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
        c.remove("Post:1");
      });
      T.commit?.();

      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
      // entity remains in graph (no GC on optimistic)
      expect(graph.getRecord("Post:1")).toBeTruthy();
    });

    it("patch merges pageInfo/extras; supports function(prev)", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      graph.putRecord(canKey, { __typename: "PostConnection", totalCount: 2, pageInfo: { __typename: "PageInfo", endCursor: "c2", hasNextPage: true }, edges: [] });

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.patch({ totalCount: 3, pageInfo: { startCursor: "c1", hasNextPage: false } });
        c.patch((prev) => ({ totalCount: (prev.totalCount ?? 0) + 1 }));
      });
      T.commit?.();

      const canon = graph.getRecord(canKey)!;
      expect(canon.totalCount).toBe(4);
      expect(canon.pageInfo).toEqual({ __typename: "PageInfo", endCursor: "c2", hasNextPage: false, startCursor: "c1" });
    });
  });

  describe("layering", () => {
    it("revert preserves later commits; revert all → baseline", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      const T1 = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        c.append({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
      });
      const T2 = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 3, title: "P3" }, { cursor: "c3" });
      });

      T1.commit?.();
      T2.commit?.();
      await tick();

      // revert T1 → keep T2
      T1.revert?.();
      await tick();
      const idsAfter = readCanonicalEdges(graph, canKey).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(idsAfter).toEqual(["3"]);

      // revert T2 → none
      T2.revert?.();
      await tick();
      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
    });

    it("revert before commit is a no-op", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
      });

      T.revert?.();
      await tick();

      const canKey = '@connection.posts({})';
      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
      expect(graph.getRecord("Post:1")).toBeUndefined();
    });
  });

  describe("isolation: filters & parents", () => {
    it("different filters isolate canonicals", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts", filters: { category: "tech" } })
          .append({ __typename: "Post", id: 1, title: "T1" }, { cursor: "t1" });

        tx.connection({ parent: "Query", key: "posts", filters: { category: "life" } })
          .append({ __typename: "Post", id: 2, title: "L2" }, { cursor: "l2" });
      }).commit?.();

      const tech = readCanonicalEdges(graph, '@connection.posts({"category":"tech"})').map((e) => graph.getRecord(e.nodeKey)?.id);
      const life = readCanonicalEdges(graph, '@connection.posts({"category":"life"})').map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(tech).toEqual(["1"]);
      expect(life).toEqual(["2"]);
    });

    it("nested parent vs root are isolated", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      graph.putRecord("User:42", { __typename: "User", id: "42" });

      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts" })
          .append({ __typename: "Post", id: 10, title: "Root" }, { cursor: "cr" });

        tx.connection({ parent: { __typename: "User", id: 42 }, key: "posts" })
          .append({ __typename: "Post", id: 11, title: "Nested" }, { cursor: "cu" });
      }).commit?.();

      const rootIds = readCanonicalEdges(graph, '@connection.posts({})').map((e) => graph.getRecord(e.nodeKey)?.id);
      const userIds = readCanonicalEdges(graph, '@connection.User:42.posts({})').map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(rootIds).toEqual(["10"]);
      expect(userIds).toEqual(["11"]);
    });
  });

  describe("replayOptimistic()", () => {
    it("returns inserted/removed for scoped connections; idempotent", () => {
      const graph = makeGraph();
      const { modifyOptimistic, replayOptimistic } = createOptimistic({ graph });
      const canA = '@connection.posts({"category":"A"})';
      const canB = '@connection.posts({"category":"B"})';

      // Seed some canonical shells so canOps have something to touch
      graph.putRecord(canA, { __typename: "PostConnection", edges: [], pageInfo: {} });
      graph.putRecord(canB, { __typename: "PostConnection", edges: [], pageInfo: {} });

      // Build an overlay that touches both A and B
      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts", filters: { category: "A" } })
          .append({ __typename: "Post", id: 1, title: "A1" }, { cursor: "a1" });
        tx.connection({ parent: "Query", key: "posts", filters: { category: "B" } })
          .remove({ __typename: "Post", id: 99 });
      }).commit?.();

      // Reapply only for connection A
      const rA = replayOptimistic({ connections: [canA] });
      expect(rA.inserted).toContain("Post:1");
      expect(rA.removed).toHaveLength(0);
      // B shouldn't be affected in this scoped call
      const edgesA = readCanonicalEdges(graph, canA);
      const edgesB = readCanonicalEdges(graph, canB);
      expect(edgesA.map((e) => e.nodeKey)).toEqual(["Post:1"]);
      expect(edgesB).toHaveLength(0);

      // Now reapply for both
      const rAll = replayOptimistic({ connections: [canA, canB] });
      expect(rAll.inserted).toContain("Post:1");
      // Removing a non-existing node is a no-op but should be reported in 'removed'
      expect(rAll.removed).toContain("Post:99");
    });

    it("entity-only scope applies writes/deletes to those records", () => {
      const graph = makeGraph();
      const { modifyOptimistic, replayOptimistic } = createOptimistic({ graph });

      // Seed two users
      graph.putRecord("User:1", { __typename: "User", id: "1", name: "U1" });
      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      // Build overlay: write U1 and delete U2
      modifyOptimistic((tx) => {
        tx.patch("User:1", { name: "U1x" });
        tx.delete("User:2");
      }).commit?.();

      // Simulate a base rewrite (e.g., server write) that restored User:2
      // This mirrors the common "normalizeDocument" case where the base data changes,
      // and we need replayOptimistic to selectively re-apply overlays.
      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      // Apply only to User:1
      replayOptimistic({ entities: ["User:1"] });
      expect(graph.getRecord("User:1")?.name).toBe("U1x");
      // User:2 deletion should NOT be re-applied in this scoped call
      expect(graph.getRecord("User:2")?.name).toBe("U2");

      // Now apply to both → the delete for User:2 should take effect
      replayOptimistic({ entities: ["User:1", "User:2"] });
      expect(graph.getRecord("User:2")).toBeUndefined();
    });

    it("replayOptimistic(): idempotent for the same connection scope", () => {
      const graph = makeGraph();
      const optimistic = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      // add P1,P2
      const T1 = optimistic.modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.append({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
        c.append({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
      });
      T1.commit?.();

      const before = JSON.stringify(graph.getRecord(canKey));
      const r1 = (optimistic as any).replayOptimistic({ connections: [canKey] });
      const after1 = JSON.stringify(graph.getRecord(canKey));
      const r2 = (optimistic as any).replayOptimistic({ connections: [canKey] });
      const after2 = JSON.stringify(graph.getRecord(canKey));

      expect(r1.inserted.concat(r1.removed)).toBeDefined();
      expect(after1).toBe(after2);         // 2nd reapply didn't change anything
      expect(before).toBe(after1);         // and first reapply didn't either
    });
  });

  describe("safety", () => {
    it("append after remove/no canonical exists → no throw, canonical created", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.remove({ __typename: "Post", id: 1 }); // no-op
        c.append({ __typename: "Post", id: 1, title: "Hello" }, { cursor: "c1" });
      }).commit?.();

      const edges = readCanonicalEdges(graph, '@connection.posts({})');
      expect(edges.length).toBe(1);
      expect(graph.getRecord(edges[0].nodeKey)?.title).toBe("Hello");
    });
  });
});
