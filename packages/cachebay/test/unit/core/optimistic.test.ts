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

  describe("Entity Operations", () => {
    describe("patch()", () => {
      it("merges entity via object patch", () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.patch("Post:p1", { title: "Post 1 Updated" }, { mode: "merge" });
        });

        tx.commit();

        expect(graph.getRecord("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "Post 1 Updated" });
      });

      it("merges entity via function patch", () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.patch({ __typename: "Post", id: "p1" }, (prev) => ({ title: (prev.title || "") + "!" }), { mode: "merge" });
        });

        tx.commit();

        expect(graph.getRecord("Post:p1")?.title).toBe("Post 1!");
      });

      it("replaces entity completely", () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.patch("Post:p1", { title: "Post 1 Replaced", flags: [] }, { mode: "replace" });
        });

        tx.commit();

        expect(graph.getRecord("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "Post 1 Replaced", flags: [] });
      });

      it("uses data from commit phase to finalize entity", () => {
        graph.putRecord("User:me", { __typename: "User", id: "me", name: "Draft" });

        const tx = optimistic.modifyOptimistic((o, ctx) => {
          o.patch("User:me", { name: ctx?.data?.name ?? "Draft" }, { mode: "merge" });
        });

        expect(graph.getRecord("User:me")?.name).toBe("Draft");

        tx.commit({ name: "Real Name" });

        expect(graph.getRecord("User:me")?.name).toBe("Real Name");
      });
    });

    describe("delete()", () => {
      it("removes entity record", () => {
        graph.putRecord("User:9", { __typename: "User", id: "9", email: "x@x.com" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.delete({ __typename: "User", id: "9" });
        });

        tx.commit();

        expect(graph.getRecord("User:9")).toBeUndefined();
      });

      it("restores entity on revert", () => {
        graph.putRecord("User:7", { __typename: "User", id: "7", name: "Old" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.patch("User:7", { name: "New" }, { mode: "merge" });
        });

        expect(graph.getRecord("User:7")?.name).toBe("New");

        tx.revert();

        expect(graph.getRecord("User:7")?.name).toBe("Old");
      });

      it("ignores revert after commit", () => {
        graph.putRecord("User:7", { __typename: "User", id: "7", name: "Old" });

        const tx = optimistic.modifyOptimistic((o) => {
          o.patch("User:7", { name: "New" }, { mode: "merge" });
        });

        tx.commit();
        tx.revert();

        expect(graph.getRecord("User:7")).toEqual({ __typename: "User", id: "7", name: "New" });
      });
    });
  });

  describe("Connection Operations", () => {
    describe("addNode()", () => {
      it("adds node to connection", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        });

        tx.commit();

        const edges = readCanonicalEdges(graph, key);
        expect(edges.length).toBe(1);
        expect(graph.getRecord("Post:p1")?.title).toBe("Post 1");
      });

      it("deduplicates by node key and updates edge metadata", () => {
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
        expect(graph.getRecord("Post:p1")?.title).toBe("Post 1 Updated");
      });

      it("respects start position", () => {
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

      it("respects end position", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });

        tx.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p1", "p2"]);
      });

      it("inserts after specific anchor", () => {
        const key = "@connection.posts({})";

        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });

        tx1.commit();

        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "after", anchor: "Post:p1" });
        });

        tx2.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p1", "p3", "p2"]);
      });

      it("inserts before specific anchor", () => {
        const key = "@connection.posts({})";

        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });

        tx1.commit();

        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p0", title: "Post 0" }, { position: "before", anchor: { __typename: "Post", id: "p1" } });
        });

        tx2.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p0", "p1", "p2"]);
      });

      it("falls back to start when anchor missing and position is before", () => {
        const key = "@connection.posts({})";

        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        });

        tx1.commit();

        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "px", title: "Post X" }, { position: "before", anchor: "Post:p404" });
        });

        tx2.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["px", "p1"]);
      });

      it("falls back to end when anchor missing and position is after", () => {
        const key = "@connection.posts({})";

        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        });

        tx1.commit();

        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "py", title: "Post Y" }, { position: "after", anchor: { __typename: "Post", id: "p404" } });
        });

        tx2.commit();

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p1", "py"]);
      });

      it("creates canonical when adding after remove with no existing canonical", () => {
        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.removeNode({ __typename: "Post", id: "p1" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        });

        tx.commit();

        const edges = readCanonicalEdges(graph, "@connection.posts({})");
        expect(edges.length).toBe(1);
        expect(graph.getRecord(edges[0].nodeKey)?.title).toBe("Post 1");
      });

      it("replaces temporary id with server id on commit", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o, ctx) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: ctx?.data?.id ?? "tmp-1", title: ctx?.data?.title ?? "Temp Post" }, { position: "start" });
        });

        expect(readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id)).toEqual(["tmp-1"]);

        tx.commit({ id: "p9", title: "From Server" });

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p9"]);
        expect(graph.getRecord("Post:tmp-1")).toBeUndefined();
        expect(graph.getRecord("Post:p9")?.title).toBe("From Server");
      });

      it("updates edge metadata between optimistic and commit phases", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o, ctx) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode(
            { __typename: "Post", id: ctx?.data?.id ?? "tmp-2", title: "Edge Meta" },
            { position: "end", edge: ctx?.phase === "commit" ? { pending: false, settled: true } : { pending: true } },
          );
        });

        let meta = readCanonicalEdges(graph, key)[0]?.meta || {};
        expect(meta.pending).toBe(true);
        expect(meta.settled).toBeUndefined();

        tx.commit({ id: "p10" });

        meta = readCanonicalEdges(graph, key)[0]?.meta || {};
        expect(meta.pending).toBe(false);
        expect(meta.settled).toBe(true);

        const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p10"]);
      });

      it("ignores nodes without typename", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ id: "x1", title: "No typename" } as any, { position: "end" });
        });

        tx.commit();

        expect(readCanonicalEdges(graph, key).length).toBe(0);
      });

      it("ignores nodes without id", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", title: "No id" } as any, { position: "end" });
        });

        tx.commit();

        expect(readCanonicalEdges(graph, key).length).toBe(0);
      });
    });

    describe("removeNode()", () => {
      it("removes node by reference", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
          c.removeNode("Post:p1");
        });

        tx.commit();

        expect(readCanonicalEdges(graph, key).length).toBe(0);
        expect(graph.getRecord("Post:p1")).toBeTruthy();
      });

      it("treats missing nodes as no-op", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.removeNode({ __typename: "Post", id: "p999" });
        });

        tx.commit();

        expect(readCanonicalEdges(graph, key).length).toBe(0);
      });

      it("ignores invalid node references", () => {
        const key = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.removeNode({ __typename: "Post" } as any);
        });

        tx.commit();

        expect(readCanonicalEdges(graph, key).length).toBe(0);
      });
    });

    describe("patch()", () => {
      it("merges pageInfo fields", () => {
        const key = "@connection.posts({})";

        graph.putRecord(key, {
          __typename: "PostConnection",
          totalCount: 2,
          pageInfo: { __ref: `${key}.pageInfo` },
          edges: { __refs: [] },
        });

        graph.putRecord(`${key}.pageInfo`, {
          __typename: "PageInfo",
          endCursor: "c2",
          hasNextPage: true,
        });

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.patch({ pageInfo: { startCursor: "c1", hasNextPage: false } });
        });

        tx.commit();

        const pageInfo = graph.getRecord(`${key}.pageInfo`)!;
        expect(pageInfo).toEqual({
          __typename: "PageInfo",
          endCursor: "c2",
          hasNextPage: false,
          startCursor: "c1",
        });
      });

      it("merges extra connection fields", () => {
        const key = "@connection.posts({})";

        graph.putRecord(key, {
          __typename: "PostConnection",
          totalCount: 2,
          pageInfo: { __ref: `${key}.pageInfo` },
          edges: { __refs: [] },
        });

        graph.putRecord(`${key}.pageInfo`, {
          __typename: "PageInfo",
        });

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.patch({ totalCount: 3 });
        });

        tx.commit();

        const connection = graph.getRecord(key)!;
        expect(connection.totalCount).toBe(3);
      });

      it("supports function-based patches", () => {
        const key = "@connection.posts({})";

        graph.putRecord(key, {
          __typename: "PostConnection",
          totalCount: 2,
          pageInfo: { __ref: `${key}.pageInfo` },
          edges: { __refs: [] },
        });

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.patch((prev) => ({ totalCount: (prev.totalCount || 0) + 1 }));
        });

        tx.commit();

        const connection = graph.getRecord(key)!;
        expect(connection.totalCount).toBe(3);
      });
    });
  });

  describe("Connection Resolution", () => {
    describe("by canonical key string", () => {
      it("accepts canonical key string", () => {
        const canonicalKey = "@connection.posts({})";

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection(canonicalKey);
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end", edge: { score: 7 } });
        });

        tx.commit();

        expect(readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id)).toEqual(["p1"]);
      });

      it("shares state between canonical key and spec-based calls", () => {
        const canonicalKey = "@connection.posts({})";

        const tx1 = optimistic.modifyOptimistic((o) => {
          const c = o.connection(canonicalKey);
          c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        });

        tx1.commit();

        const tx2 = optimistic.modifyOptimistic((o) => {
          const c = o.connection({ parent: "Query", key: "posts" });
          c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });

        tx2.commit();

        const ids = readCanonicalEdges(graph, canonicalKey).map((e) => graph.getRecord(e.nodeKey)?.id);
        expect(ids).toEqual(["p1", "p2"]);
      });

      it("works with filters in canonical key", () => {
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

      it("supports patch via canonical key", () => {
        const canonicalKey = "@connection.posts({})";

        graph.putRecord(canonicalKey, {
          __typename: "PostConnection",
          totalCount: 1,
          pageInfo: { __ref: `${canonicalKey}.pageInfo` },
          edges: { __refs: [] },
        });

        graph.putRecord(`${canonicalKey}.pageInfo`, {
          __typename: "PageInfo",
          endCursor: "e1",
          hasNextPage: true,
        });

        const tx = optimistic.modifyOptimistic((o) => {
          const c = o.connection(canonicalKey);
          c.patch({ totalCount: 2, pageInfo: { startCursor: "s1", hasNextPage: false } });
          c.patch((prev) => ({ totalCount: (prev.totalCount || 0) + 1 }));
        });

        tx.commit();

        const snap = graph.getRecord(canonicalKey)!;
        expect(snap.totalCount).toBe(3);

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`)!;
        expect(pageInfo).toEqual({
          __typename: "PageInfo",
          endCursor: "e1",
          hasNextPage: false,
          startCursor: "s1",
        });
      });

      it("supports anchored inserts via canonical key", () => {
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
      it("isolates connections by filter arguments", () => {
        const tx = optimistic.modifyOptimistic((o) => {
          const tech = o.connection({ parent: "Query", key: "posts", filters: { category: "tech" } });
          tech.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });

          const life = o.connection({ parent: "Query", key: "posts", filters: { category: "life" } });
          life.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
        });

        tx.commit();

        const techIds = readCanonicalEdges(graph, '@connection.posts({"category":"tech"})').map((edge) => graph.getRecord(edge.nodeKey)?.id);
        const lifeIds = readCanonicalEdges(graph, '@connection.posts({"category":"life"})').map((edge) => graph.getRecord(edge.nodeKey)?.id);

        expect(techIds).toEqual(["p1"]);
        expect(lifeIds).toEqual(["p2"]);
      });

      it("isolates connections by parent entity", () => {
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
  });

  describe("Replay Optimistic", () => {
    it("returns added and removed nodes for scoped connections", () => {
      const keyA = '@connection.posts({"category":"A"})';
      const keyB = '@connection.posts({"category":"B"})';

      graph.putRecord(keyA, { __typename: "PostConnection", edges: { __refs: [] }, pageInfo: { __ref: `${keyA}.pageInfo` } });
      graph.putRecord(`${keyA}.pageInfo`, { __typename: "PageInfo" });
      graph.putRecord(keyB, { __typename: "PostConnection", edges: { __refs: [] }, pageInfo: { __ref: `${keyB}.pageInfo` } });
      graph.putRecord(`${keyB}.pageInfo`, { __typename: "PageInfo" });

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

    it("applies operations only to specified entity records", () => {
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

      const replayResult = optimistic.replayOptimistic({ connections: [key] });
      expect(replayResult.added).toEqual(["Post:p1", "Post:p2"]);
      expect(replayResult.removed).toEqual([]);

      const connectionBefore = graph.getRecord(key);
      optimistic.replayOptimistic({ connections: [key] });
      const connectionAfter = graph.getRecord(key);

      expect(connectionAfter).toEqual(connectionBefore);

      tx.commit();
    });
  });

  describe("Layer Management", () => {
    it("preserves later layers when reverting earlier layer", () => {
      const key = "@connection.posts({})";

      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
        c.addNode({ __typename: "Post", id: "p2", title: "Post 2" }, { position: "end" });
      });

      const tx2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p3", title: "Post 3" }, { position: "end" });
      });

      tx1.revert();

      const remainingIds = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id).filter(Boolean);
      expect(remainingIds).toEqual(["p3"]);

      tx2.revert();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
    });

    it("restores baseline after all layers reverted", () => {
      const key = "@connection.posts({})";

      const tx1 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      });

      expect(readCanonicalEdges(graph, key).length).toBe(1);

      tx1.revert();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
    });

    it("treats revert before commit as immediate cleanup", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "Post 1" }, { position: "end" });
      });

      tx.revert();

      expect(readCanonicalEdges(graph, key).length).toBe(0);
      expect(graph.getRecord("Post:p1")).toBeUndefined();
    });

    it("ignores revert after commit for connections", () => {
      const key = "@connection.posts({})";

      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p1", title: "P1" }, { position: "end" });
      });

      tx.commit();
      tx.revert();

      const ids = readCanonicalEdges(graph, key).map((e) => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1"]);
    });

    it("preserves ordering when first layer committed with real data", () => {
      const key = "@connection.posts({})";

      const t1 = optimistic.modifyOptimistic((o, ctx) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: ctx?.data?.id ?? "tmp-3", title: "T1" }, { position: "start" });
      });

      const t2 = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });
        c.addNode({ __typename: "Post", id: "p2", title: "Stable" }, { position: "end" });
      });

      expect(readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id)).toEqual(["tmp-3", "p2"]);

      t1.commit({ id: "p1" });

      const ids = readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id);
      expect(ids).toEqual(["p1", "p2"]);

      t2.commit();

      const ids2 = readCanonicalEdges(graph, key).map(e => graph.getRecord(e.nodeKey)?.id);
      expect(ids2).toEqual(["p1", "p2"]);
    });
  });
});
