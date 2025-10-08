import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { readCanonicalEdges } from "@/test/helpers/unit";

describe("Optimistic", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;

  beforeEach(() => {
    graph = createGraph();
    optimistic = createOptimistic({ graph });
  });

  describe("patch()", () => {
    it("merges via object and function, replaces", async () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });

      const tx = optimistic.modifyOptimistic((o) => {
        o.patch("Post:p1", { title: "Post 1 Updated" }, { mode: "merge" });
        o.patch({ __typename: "Post", id: "p1" }, (prev) => ({ title: (prev.title || "") + "!" }), { mode: "merge" });
        o.patch("Post:p1", { title: "REPLACED", flags: [] }, { mode: "replace" });
      });

      tx.commit();
      expect(graph.getRecord("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "REPLACED", flags: [] });
    });
  });

  describe("delete()", () => {
    it("removes record and revert restores baseline", async () => {
      graph.putRecord("User:9", { __typename: "User", id: "9", email: "x@x.com" });

      const tx = optimistic.modifyOptimistic((o) => {
        o.delete({ __typename: "User", id: "9" });
      });

      tx.commit();
      expect(graph.getRecord("User:9")).toBeUndefined();
    });
  });

  describe("connection.addNode()", () => {
    it("deduplicates by node key and updates edge meta in place", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end", edge: { score: 1 } });
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1 Updated" }, { position: "end", edge: { score: 42 } });
      });

      tx.commit();

      const edges = readCanonicalEdges(graph, key);
      expect(edges.length).toBe(1);
      expect(edges[0].meta.score).toBe(42);
      expect(graph.getRecord("Post:p1")!.title).toBe("Post 1 Updated");
    });

    it("respects start and end positions", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p0", title: "Post 0" }, { position: "start" });
      });

      tx.commit();

      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p0", "p1", "p2"]);
    });

    describe("anchored inserts (before/after)", () => {
      it("maintains order when inserting after and before specific anchors", () => {
        const key = "@connection.posts({})";

        // 1. Seed Post 1, Post 2
        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });
        tx1.commit();

        // 2. Insert Post 1.5 after Post:p1
        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });

          c.addNode({ __typename: "Post", id: "p1.5", title: "Post 1.5" }, { position: "after", anchor: "Post:p1" });
        });
        tx2.commit();

        // 3. Insert Post 0 before Post:p1
        const tx3 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });

          c.addNode({ __typename: "Post", id: "p0", title: "Post 0" }, { position: "before", anchor: { __typename: "Post", id: "p1" } });
        });
        tx3.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p0", "p1", "p1.5", "p2"]);
      });

      it("handles boundary anchors and missing anchor fallbacks", () => {
        const key = "@connection.posts({})";

        // 1. Seed Post 1, Post 2
        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });
        tx1.commit();

        // 2. Before first anchor -> start
        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });

          c.addNode({ __typename: "Post", id: "p0", title: "Post 0" }, { position: "before", anchor: "Post:p1" });
        });
        tx2.commit();

        // 3. After last anchor -> end
        const tx3 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });

          c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "after", anchor: "Post:p2" });
        });
        tx3.commit();

        // 4. Missing anchors
        const tx4 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });

          c.addNode({ __typename: "Post", id: "px", title: "Post X" }, { position: "before", anchor: "Post:p404" });
          c.addNode({ __typename: "Post", id: "py", title: "Post Y" }, { position: "after", anchor: { __typename: "Post", id: "p404" } });
        });
        tx4.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["px", "p0", "p1", "p2", "p3", "py"]);
      });
    });

    it("safely creates canonical when adding node after remove with no existing canonical", () => {
      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.removeNode({ __typename: "Post", id: "p1" }); // no-op
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      });
      tx.commit();

      const edges = readCanonicalEdges(graph, "@connection.posts({})");
      expect(edges.length).toBe(1);
      expect(graph.getRecord(edges[0].nodeKey)?.title).toBe("Post 1");
    });
  });

  describe("connection.removeNode()", () => {
    it("removes by node reference and treats missing nodes as no-op", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.removeNode({ __typename: "Post", id: "p999" }); // no-op
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.removeNode("Post:p1");
      });

      tx.commit();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
      expect(graph.getRecord("Post:p1")).toBeTruthy(); // entity remains
    });
  });

  describe("connection.patch()", () => {
    it("merges pageInfo and extras with function support", async () => {
      const key = "@connection.posts({})";

      graph.putRecord(key, {
        __typename: "PostConnection",
        totalCount: 2,
        pageInfo: { __typename: "PageInfo", endCursor: "c2", hasNextPage: true },
        edges: [],
      });

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.patch({ totalCount: 3, pageInfo: { startCursor: "c1", hasNextPage: false } });
        c.patch((prev) => ({ totalCount: (prev.totalCount || 0) + 1 }));
      });

      tx.commit();

      const connection = graph.getRecord(key)!;
      expect(connection.totalCount).toBe(4);
      expect(connection.pageInfo).toEqual({
        __typename: "PageInfo",
        endCursor: "c2",
        hasNextPage: false,
        startCursor: "c1",
      });
    });
  });

  describe("replayOptimistic()", () => {
    it("returns added and removed nodes for scoped connections idempotently", () => {
      const keyA = '@connection.posts({"category":"A"})';
      const keyB = '@connection.posts({"category":"B"})';

      graph.putRecord(keyA, { __typename: "PostConnection", edges: [], pageInfo: {} });
      graph.putRecord(keyB, { __typename: "PostConnection", edges: [], pageInfo: {} });

      expect(readCanonicalEdges(graph, keyA).map((e) => e.nodeKey)).toEqual([]);
      expect(readCanonicalEdges(graph, keyB).map((e) => e.nodeKey)).toEqual([]);

      const tx = optimistic.modifyOptimistic((o) => {
        const categoryA = o.connection({ parent: "Query", key: "posts", filters: { category: "A" } });
        categoryA.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end", edge: { tag: "x" } });

        const categoryB = o.connection({ parent: "Query", key: "posts", filters: { category: "B" } });
        categoryB.removeNode({ __typename: "Post", id: "p99" });
      });

      const resultA1 = optimistic.replayOptimistic({ connections: [keyA] });
      expect(resultA1.added).toContain("Post:p1");
      expect(resultA1.removed).toHaveLength(0);

      expect(readCanonicalEdges(graph, keyA).map((e) => e.nodeKey)).toEqual(["Post:p1"]);
      expect(readCanonicalEdges(graph, keyB).map((e) => e.nodeKey)).toEqual([]);

      const bothResults = optimistic.replayOptimistic({ connections: [keyA, keyB] });

      expect(readCanonicalEdges(graph, keyA).map((e) => e.nodeKey)).toEqual(["Post:p1"]);
      expect(readCanonicalEdges(graph, keyB).map((e) => e.nodeKey)).toEqual([]);

      expect(bothResults.added).toContain("Post:p1");
      expect(bothResults.removed).toContain("Post:p99");

      tx.commit();

      expect(readCanonicalEdges(graph, keyA).map((e) => e.nodeKey)).toEqual(["Post:p1"]);
      expect(readCanonicalEdges(graph, keyB).map((e) => e.nodeKey)).toEqual([]);
    });

    it("applies writes and deletes only to specified entity records", () => {
      graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      const tx = optimistic.modifyOptimistic((o) => {
        o.patch("User:1", { name: "U1x" });
        o.delete("User:2");
      });

      expect(graph.getRecord("User:1")?.name).toBe("U1x");
      expect(graph.getRecord("User:2")).toBeUndefined();

      graph.putRecord("User:2", { __typename: "User", id: "2", name: "U2" });

      optimistic.replayOptimistic({ entities: ["User:1"] });
      expect(graph.getRecord("User:1")?.name).toBe("U1x");
      expect(graph.getRecord("User:2")?.name).toBe("U2");

      optimistic.replayOptimistic({ entities: ["User:1", "User:2"] });
      expect(graph.getRecord("User:2")).toBeUndefined();

      tx.commit();
    });

    it("remains idempotent for the same connection scope", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      });

      // Verify replay returns expected changes
      const replayResult = optimistic.replayOptimistic({ connections: [key] });
      expect(replayResult.added).toEqual(["Post:p1", "Post:p2"]);
      expect(replayResult.removed).toEqual([]);

      // Verify idempotency - multiple replays don't change state
      const connectionBefore = graph.getRecord(key);
      optimistic.replayOptimistic({ connections: [key] });
      const connectionAfter = graph.getRecord(key);

      expect(connectionAfter).toEqual(connectionBefore);

      tx.commit();
    });
  });

  describe("layering", () => {
    it("preserves later optimistic layers when reverting, then returns to baseline after all reverted", () => {
      const key = "@connection.posts({})";

      // Layer 1: add p1, p2
      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      });

      // Layer 2: add p3
      const tx2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "end" });
      });

      // Revert the first layer → keep the later one
      tx1.revert();

      const remainingIds = readCanonicalEdges(graph, key)
        .map((e) => graph.getRecord(e.nodeKey)?.id)
        .filter(Boolean);
      expect(remainingIds).toEqual(["p3"]);

      // Revert the second layer → back to baseline
      tx2.revert();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
    });

    it("treats revert before commit as no-op", async () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      });

      tx.revert();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
      expect(graph.getRecord("Post:p1")).toBeUndefined();
    });
  });

  describe("connection(canonicalKey: string)", () => {
    it("accepts canonical key and shares state with spec calls", () => {
      const canonicalKey = "@connection.posts({})";

      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection(canonicalKey);

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end", edge: { score: 7 } });
      });

      tx1.commit();

      expect(readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id)).toEqual(["p1"]);

      const tx2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      });

      tx2.commit();

      const ids = readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1", "p2"]);
    });

    it("works with filters and cross-form operations", () => {
      const canonicalKey = '@connection.posts({"category":"tech"})';

      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection(canonicalKey);
        c.addNode({ __typename: "Post", id: "t1", title: "Tech 1" }, { position: "end" });
      });

      tx1.commit();

      expect(readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id)).toEqual(["t1"]);

      const tx2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts", filters: { category: "tech" } });

        c.removeNode("Post:t1");
      });

      tx2.commit();

      expect(readCanonicalEdges(graph, canonicalKey).length).toBe(0);
    });

    it("supports patch via string canonical key", () => {
      const canonicalKey = "@connection.posts({})";

      graph.putRecord(canonicalKey, {
        __typename: "PostConnection",
        totalCount: 1,
        pageInfo: { __typename: "PageInfo", endCursor: "e1", hasNextPage: true },
        edges: [],
      });

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection(canonicalKey);

        c.patch({ totalCount: 2, pageInfo: { startCursor: "s1", hasNextPage: false } });

        c.patch((prev) => ({ totalCount: (prev.totalCount || 0) + 1 }));
      });

      tx.commit();

      const snap = graph.getRecord(canonicalKey)!;

      expect(snap.totalCount).toBe(3);
      expect(snap.pageInfo).toEqual({
        __typename: "PageInfo",
        endCursor: "e1",
        hasNextPage: false,
        startCursor: "s1",
      });
    });

    it("supports anchored inserts via string canonical key", () => {
      const canonicalKey = "@connection.posts({})";

      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection(canonicalKey);

        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "end" });
      });

      tx1.commit();

      const tx2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection(canonicalKey);
        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "after", anchor: "Post:p1" });
      });

      tx2.commit();

      const ids = readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1", "p2", "p3"]);
    });
  });

  describe("isolation", () => {
    it("isolates canonicals with different filters", () => {
      const tx = optimistic.modifyOptimistic((o) => {
        const tech = o.connection({ parent: "Query", key: "posts", filters: { category: "tech" } });
        tech.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });

        const life = o.connection({ parent: "Query", key: "posts", filters: { category: "life" } });
        life.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      });

      tx.commit();

      const techIds = readCanonicalEdges(graph, '@connection.posts({"category":"tech"})')
        .map((e) => graph.getRecord(e.nodeKey)?.id);
      const lifeIds = readCanonicalEdges(graph, '@connection.posts({"category":"life"})')
        .map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(techIds).toEqual(["p1"]);
      expect(lifeIds).toEqual(["p2"]);
    });

    it("isolates nested parent connections from root connections", () => {
      graph.putRecord("User:42", { __typename: "User", id: "42" });

      const tx = optimistic.modifyOptimistic((o) => {
        const root = o.connection({ parent: "Query", key: "posts" });
        root.addNode({ __typename: "Post", id: "p10", title: "Post 10" }, { position: "end" });

        const user = o.connection({ parent: { __typename: "User", id: 42 }, key: "posts" });
        user.addNode({ __typename: "Post", id: "p11", title: "Post 11" }, { position: "end" });
      });

      tx.commit();

      const rootIds = readCanonicalEdges(graph, "@connection.posts({})").map((e) => graph.getRecord(e.nodeKey)?.id);
      const userIds = readCanonicalEdges(graph, "@connection.User:42.posts({})").map((e) => graph.getRecord(e.nodeKey)?.id);

      expect(rootIds).toEqual(["p10"]);
      expect(userIds).toEqual(["p11"]);
    });
  });

  describe("commit semantics", () => {
    it("revert after commit is a no-op (connection)", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "P1" }, { position: "end" });
      });

      // After commit the layer is dropped; revert must not change the graph.
      tx.commit();
      tx.revert();

      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1"]);
    });

    it("revert after commit is a no-op (entity)", () => {
      graph.putRecord("User:7", { __typename: "User", id: "7", name: "Old" });

      const tx = optimistic.modifyOptimistic((o) => {
        o.patch("User:7", { name: "New" }, { mode: "merge" });
      });

      tx.commit();
      tx.revert();

      expect(graph.getRecord("User:7")).toEqual({ __typename: "User", id: "7", name: "New" });
    });
  });

  describe("safety: invalid inputs", () => {
    it("ignores invalid nodes in addNode/removeNode/patch (no typename/id) gracefully", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        // All three should be safe no-ops
        c.addNode({ id: "x1", title: "No typename" } as any, { position: "end" });
        c.addNode({ __typename: "Post", title: "No id" } as any, { position: "end" });
        c.removeNode({ __typename: "Post" } as any);
      });

      tx.commit();

      // Nothing was written
      expect(readCanonicalEdges(graph, key).length).toBe(0);
    });
  });

  describe("commit vs live layering", () => {
    it("live layer can be reverted; once committed the same revert does nothing", () => {
      const key = "@connection.posts({})";

      // Live optimistic layer → can revert back to baseline
      const t1 = optimistic.modifyOptimistic((o) => {
        o.connection({ parent: "Query", key: "posts" })
          .addNode({ __typename: "Post", id: "p1", title: "P1" }, { position: "end" });
      });
      expect(readCanonicalEdges(graph, key).length).toBe(1);
      t1.revert();
      expect(readCanonicalEdges(graph, key).length).toBe(0);

      // New layer committed → now revert is a no-op
      const t2 = optimistic.modifyOptimistic((o) => {
        o.connection({ parent: "Query", key: "posts" })
          .addNode({ __typename: "Post", id: "p2", title: "P2" }, { position: "end" });
      });
      t2.commit();
      t2.revert();

      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p2"]);
    });
  });

  describe("commit(data)", () => {
    it("replays builder with data to replace a temp id with a server id (no dupes, temp removed)", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o, ctx?: { phase?: "optimistic" | "commit"; data?: any }) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        const id = ctx?.data?.id ?? "tmp-1";
        const title = ctx?.data?.title ?? "Temp Post";
        c.addNode({ __typename: "Post", id, title }, { position: "start" });
      });

      // First pass: temp node present
      expect(readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id)).toEqual(["tmp-1"]);

      // Second pass: commit with real id → layer is rebuilt and applied directly
      tx.commit({ id: "p9", title: "From Server" });

      // Canonical has only the real node
      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p9"]);

      // Temp entity should not linger (baseline restore + rebuilt write)
      expect(graph.getRecord("Post:tmp-1")).toBeUndefined();
      expect(graph.getRecord("Post:p9")?.title).toBe("From Server");
    });

    it("can alter edge meta across rounds (pending -> settled)", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o, ctx?: { phase?: "optimistic" | "commit"; data?: any }) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        const id = ctx?.data?.id ?? "tmp-2";
        const edgeMeta = ctx?.phase === "commit" ? { pending: false, settled: true } : { pending: true };
        c.addNode({ __typename: "Post", id, title: "Edge Meta" }, { position: "end", edge: edgeMeta });
      });

      // Round 1: pending=true
      let meta = readCanonicalEdges(graph, key)[0]?.meta || {};
      expect(meta.pending).toBe(true);
      expect(meta.settled).toBeUndefined();

      // Round 2: commit → pending=false, settled=true
      tx.commit({ id: "p10" });

      meta = readCanonicalEdges(graph, key)[0]?.meta || {};
      expect(meta.pending).toBe(false);
      expect(meta.settled).toBe(true);

      // And id is the real one (no temp)
      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p10"]);
    });

    it("patch round can use data to finalize an entity snapshot", () => {
      graph.putRecord("User:me", { __typename: "User", id: "me", name: "Draft" });

      const tx = optimistic.modifyOptimistic((o, ctx?: { data?: any }) => {
        const name = ctx?.data?.name ?? "Draft";
        o.patch("User:me", { name }, { mode: "merge" });
      });

      // optimistic
      expect(graph.getRecord("User:me")?.name).toBe("Draft");

      // commit with final name
      tx.commit({ name: "Real Name" });
      expect(graph.getRecord("User:me")?.name).toBe("Real Name");
    });

    it("preserves ordering with multiple layers when the first is committed with real data", () => {
      const key = "@connection.posts({})";

      // L1: optimistic (start) temp post
      const t1 = optimistic.modifyOptimistic((o, ctx?: { data?: any }) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        const id = ctx?.data?.id ?? "tmp-3";
        c.addNode({ __typename: "Post", id, title: "T1" }, { position: "start" });
      });

      // L2: another optimistic layer appending a stable node
      const t2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p2", title: "Stable" }, { position: "end" });
      });

      // Before commit(data): order = [tmp-3, p2]
      expect(readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id)).toEqual(["tmp-3", "p2"]);

      // Commit first layer with server id → should become [p1, p2]
      t1.commit({ id: "p1" });

      const ids = readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1", "p2"]);

      // Committing t2 (no-op semantics in your current API) should not change resulting order
      t2.commit();
      const ids2 = readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id);
      expect(ids2).toEqual(["p1", "p2"]);
    });
  });
});
