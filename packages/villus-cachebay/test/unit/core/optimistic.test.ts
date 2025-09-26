import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";

const tick = () => Promise.resolve();

/** Read canonical edges as {edgeRef, nodeKey, meta}. (cursor not asserted) */
function readCanonicalEdges(graph: ReturnType<typeof createGraph>, canonicalKey: string) {
  const page = graph.getRecord(canonicalKey) || {};
  const refs = Array.isArray(page.edges) ? page.edges : [];
  const out: Array<{ edgeRef: string; nodeKey: string; meta: Record<string, any> }> = [];
  for (let i = 0; i < refs.length; i++) {
    const edgeRef = refs[i]?.__ref;
    if (!edgeRef) continue;
    const e = graph.getRecord(edgeRef) || {};
    out.push({
      edgeRef,
      nodeKey: e?.node?.__ref,
      meta: Object.fromEntries(
        Object.keys(e || {})
          .filter((k) => k !== "cursor" && k !== "node" && k !== "__typename")
          .map((k) => [k, e[k]])
      ),
    });
  }
  return out;
}

const makeGraph = () =>
  createGraph({
    keys: {
      Post: (o: any) => (o?.id != null ? String(o.id) : null),
      User: (o: any) => (o?.id != null ? String(o.id) : null),
    },
    interfaces: {},
  });

describe("Optimistic", () => {
  /* ------------------------------------------------------------------------ */
  /* patch()                                                                  */
  /* ------------------------------------------------------------------------ */
  describe("patch()", () => {
    it("merge via object + function(prev); then replace; revert chain", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "T" });

      const T = modifyOptimistic((tx) => {
        tx.patch("Post:1", { title: "T1" }, { mode: "merge" });
        tx.patch({ __typename: "Post", id: "1" }, (prev) => ({ title: (prev.title || "") + "!" }), { mode: "merge" });
        tx.patch("Post:1", { title: "REPLACED", tags: [] }, { mode: "replace" });
      });
      T.commit?.();
      await tick();

      expect(graph.getRecord("Post:1")).toEqual({ __typename: "Post", id: "1", title: "REPLACED", tags: [] });

      T.revert?.();
      await tick();
      expect(graph.getRecord("Post:1")).toEqual({ __typename: "Post", id: "1", title: "T" });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* delete()                                                                 */
  /* ------------------------------------------------------------------------ */
  describe("delete()", () => {
    it("removes record; revert restores baseline", async () => {
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

  /* ------------------------------------------------------------------------ */
  /* connection.addNode()                                                     */
  /* ------------------------------------------------------------------------ */
  describe("connection.addNode()", () => {
    it("dedupes by node key & updates edge meta in place", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end", edge: { score: 1 } });
        c.addNode({ __typename: "Post", id: 1, title: "P1-new" }, { position: "end", edge: { score: 42 } });
      }).commit?.();

      const edges = readCanonicalEdges(graph, canKey);
      expect(edges.length).toBe(1);
      expect(edges[0].meta.score).toBe(42);
      expect(graph.getRecord("Post:1")!.title).toBe("P1-new");
    });

    it("respects 'start'/'end' positions", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: 2, title: "P2" }, { position: "end" });
        c.addNode({ __typename: "Post", id: 0, title: "P0" }, { position: "start" });
      }).commit?.();

      const ids = readCanonicalEdges(graph, canKey).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["0", "1", "2"]);
    });

    describe("anchored inserts (before/after)", () => {
      it("after 'Post:1' and before { __typename:'Post', id:1 } keep order", () => {
        const graph = makeGraph();
        const { modifyOptimistic } = createOptimistic({ graph });
        const canKey = '@connection.posts({})';

        // Seed P1, P2
        modifyOptimistic((tx) => {
          const c = tx.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: 2, title: "P2" }, { position: "end" });
        }).commit?.();

        // Insert P1_5 after Post:1
        modifyOptimistic((tx) => {
          tx.connection({ parent: "Query", key: "posts" })
            .addNode({ __typename: "Post", id: 15, title: "P1.5" }, { position: "after", anchor: "Post:1" });
        }).commit?.();

        // Insert P0 before Post:1
        modifyOptimistic((tx) => {
          tx.connection({ parent: "Query", key: "posts" })
            .addNode({ __typename: "Post", id: 0, title: "P0" }, { position: "before", anchor: { __typename: "Post", id: 1 } });
        }).commit?.();

        const ids = readCanonicalEdges(graph, canKey).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["0", "1", "15", "2"]);
      });

      it("boundary anchors & missing anchor fallback (before→start, after→end)", () => {
        const graph = makeGraph();
        const { modifyOptimistic } = createOptimistic({ graph });
        const canKey = '@connection.posts({})';

        // Seed P1, P2
        modifyOptimistic((tx) => {
          const c = tx.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: 2, title: "P2" }, { position: "end" });
        }).commit?.();

        // before first anchor → start
        modifyOptimistic((tx) => {
          tx.connection({ parent: "Query", key: "posts" })
            .addNode({ __typename: "Post", id: 0, title: "P0" }, { position: "before", anchor: "Post:1" });
        }).commit?.();

        // after last anchor → end
        modifyOptimistic((tx) => {
          tx.connection({ parent: "Query", key: "posts" })
            .addNode({ __typename: "Post", id: 3, title: "P3" }, { position: "after", anchor: "Post:2" });
        }).commit?.();

        // missing anchors
        modifyOptimistic((tx) => {
          const c = tx.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: 99, title: "PX" }, { position: "before", anchor: "Post:404" });
          c.addNode({ __typename: "Post", id: 100, title: "PY" }, { position: "after", anchor: { __typename: "Post", id: 404 } });
        }).commit?.();

        const ids = readCanonicalEdges(graph, canKey).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["99", "0", "1", "2", "3", "100"]);
      });
    });

    it("safety: addNode after remove/no canonical exists → creates canonical, no throw", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.removeNode({ __typename: "Post", id: 1 }); // no-op
        c.addNode({ __typename: "Post", id: 1, title: "Hello" }, { position: "end" });
      }).commit?.();

      const edges = readCanonicalEdges(graph, '@connection.posts({})');
      expect(edges.length).toBe(1);
      expect(graph.getRecord(edges[0].nodeKey)?.title).toBe("Hello");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* connection.removeNode()                                                  */
  /* ------------------------------------------------------------------------ */
  describe("connection.removeNode()", () => {
    it("works by node ref; removing missing is a no-op", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.removeNode({ __typename: "Post", id: 999 }); // no-op
        c.addNode({ __typename: "Post", id: 1, title: "A" }, { position: "end" });
        c.removeNode("Post:1");
      }).commit?.();

      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
      expect(graph.getRecord("Post:1")).toBeTruthy(); // entity remains
    });
  });

  /* ------------------------------------------------------------------------ */
  /* connection.patch()                                                       */
  /* ------------------------------------------------------------------------ */
  describe("connection.patch()", () => {
    it("merges pageInfo and extras; supports function(prev)", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      graph.putRecord(canKey, {
        __typename: "PostConnection",
        totalCount: 2,
        pageInfo: { __typename: "PageInfo", endCursor: "c2", hasNextPage: true },
        edges: [],
      });

      modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.patch({ totalCount: 3, pageInfo: { startCursor: "c1", hasNextPage: false } });
        c.patch((prev) => ({ totalCount: (prev.totalCount ?? 0) + 1 }));
      }).commit?.();

      const canon = graph.getRecord(canKey)!;
      expect(canon.totalCount).toBe(4);
      expect(canon.pageInfo).toEqual({
        __typename: "PageInfo",
        endCursor: "c2",
        hasNextPage: false,
        startCursor: "c1",
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* replayOptimistic()                                                       */
  /* ------------------------------------------------------------------------ */
  describe("replayOptimistic()", () => {
    it("returns added/removed for scoped connections; idempotent", () => {
      const graph = makeGraph();
      const { modifyOptimistic, replayOptimistic } = createOptimistic({ graph });
      const canA = '@connection.posts({"category":"A"})';
      const canB = '@connection.posts({"category":"B"})';

      graph.putRecord(canA, { __typename: "PostConnection", edges: [], pageInfo: {} });
      graph.putRecord(canB, { __typename: "PostConnection", edges: [], pageInfo: {} });

      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts", filters: { category: "A" } })
          .addNode({ __typename: "Post", id: 1, title: "A1" }, { position: "end", edge: { tag: "x" } });
        tx.connection({ parent: "Query", key: "posts", filters: { category: "B" } })
          .removeNode({ __typename: "Post", id: 99 });
      }).commit?.();

      const rA = replayOptimistic({ connections: [canA] });
      expect(rA.added).toContain("Post:1");
      expect(rA.removed).toHaveLength(0);
      const edgesA = readCanonicalEdges(graph, canA);
      const edgesB = readCanonicalEdges(graph, canB);
      expect(edgesA.map((e) => e.nodeKey)).toEqual(["Post:1"]);
      expect(edgesB).toHaveLength(0);

      const rAll = replayOptimistic({ connections: [canA, canB] });
      expect(rAll.added).toContain("Post:1");
      expect(rAll.removed).toContain("Post:99");
    });

    it("entity-only scope applies writes/deletes to those records", () => {
      const graph = makeGraph();
      const { modifyOptimistic, replayOptimistic } = createOptimistic({ graph });

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "U1" });
      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      modifyOptimistic((tx) => {
        tx.patch("User:1", { name: "U1x" });
        tx.delete("User:2");
      }).commit?.();

      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      replayOptimistic({ entities: ["User:1"] });
      expect(graph.getRecord("User:1")?.name).toBe("U1x");
      expect(graph.getRecord("User:2")?.name).toBe("U2");

      replayOptimistic({ entities: ["User:1", "User:2"] });
      expect(graph.getRecord("User:2")).toBeUndefined();
    });

    it("idempotent for the same connection scope", () => {
      const graph = makeGraph();
      const optimistic = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      const T1 = optimistic.modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: 2, title: "P2" }, { position: "end" });
      });
      T1.commit?.();

      const before = JSON.stringify(graph.getRecord(canKey));
      const r1 = (optimistic as any).replayOptimistic({ connections: [canKey] });
      const after1 = JSON.stringify(graph.getRecord(canKey));
      const r2 = (optimistic as any).replayOptimistic({ connections: [canKey] });
      const after2 = JSON.stringify(graph.getRecord(canKey));

      expect(r1.added.concat(r1.removed)).toBeDefined();
      expect(after1).toBe(after2);
      expect(before).toBe(after1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Layering                                                                 */
  /* ------------------------------------------------------------------------ */
  describe("Layering (commit / revert)", () => {
    it("revert preserves later commits; revert all → baseline", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });
      const canKey = '@connection.posts({})';

      const T1 = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: 2, title: "P2" }, { position: "end" });
      });
      const T2 = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 3, title: "P3" }, { position: "end" });
      });

      T1.commit?.();
      T2.commit?.();
      await tick();

      T1.revert?.();
      await tick();
      const idsAfter = readCanonicalEdges(graph, canKey)
        .map((e) => graph.getRecord(e.nodeKey)?.id)
        .filter(Boolean);
      expect(idsAfter).toEqual(["3"]);

      T2.revert?.();
      await tick();
      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
    });

    it("revert before commit is a no-op", async () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      const T = modifyOptimistic((tx) => {
        const c = tx.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: 1, title: "P1" }, { position: "end" });
      });

      T.revert?.();
      await tick();

      const canKey = '@connection.posts({})';
      expect(readCanonicalEdges(graph, canKey).length).toBe(0);
      expect(graph.getRecord("Post:1")).toBeUndefined();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Isolation                                                                */
  /* ------------------------------------------------------------------------ */
  describe("Isolation (filters & parents)", () => {
    it("different filters isolate canonicals", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts", filters: { category: "tech" } })
          .addNode({ __typename: "Post", id: 1, title: "T1" }, { position: "end" });

        tx.connection({ parent: "Query", key: "posts", filters: { category: "life" } })
          .addNode({ __typename: "Post", id: 2, title: "L2" }, { position: "end" });
      }).commit?.();

      const tech = readCanonicalEdges(graph, '@connection.posts({"category":"tech"})')
        .map((e) => graph.getRecord(e.nodeKey)?.id);
      const life = readCanonicalEdges(graph, '@connection.posts({"category":"life"})')
        .map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(tech).toEqual(["1"]);
      expect(life).toEqual(["2"]);
    });

    it("nested parent vs root are isolated", () => {
      const graph = makeGraph();
      const { modifyOptimistic } = createOptimistic({ graph });

      graph.putRecord("User:42", { __typename: "User", id: "42" });

      modifyOptimistic((tx) => {
        tx.connection({ parent: "Query", key: "posts" })
          .addNode({ __typename: "Post", id: 10, title: "Root" }, { position: "end" });

        tx.connection({ parent: { __typename: "User", id: 42 }, key: "posts" })
          .addNode({ __typename: "Post", id: 11, title: "Nested" }, { position: "end" });
      }).commit?.();

      const rootIds = readCanonicalEdges(graph, '@connection.posts({})').map((e) => graph.getRecord(e.nodeKey)?.id);
      const userIds = readCanonicalEdges(graph, '@connection.User:42.posts({})').map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(rootIds).toEqual(["10"]);
      expect(userIds).toEqual(["11"]);
    });
  });
});
