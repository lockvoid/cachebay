import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createModifyOptimistic } from "@/src/features/optimistic";

// tiny microtask helper (kept for symmetry with prior tests, though ops are sync now)
const tick = () => Promise.resolve();

describe("features/optimistic — stacking / layering (Posts)", () => {
  it("supports multiple optimistic layers with isolation; revert preserves later commits", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    // T1: add 1,2
    const modifyOptimistic = createModifyOptimistic({ graph });
    const t1 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1", position: "end" });
      conn.addNode({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2", position: "end" });
    });

    // T2: add 3
    const t2 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 3, title: "P3" }, { cursor: "c3", position: "end" });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    // Check presence
    expect(graph.getEntity("Post:1")).toBeTruthy();
    expect(graph.getEntity("Post:2")).toBeTruthy();
    expect(graph.getEntity("Post:3")).toBeTruthy();

    // Revert T1 — T2 remains
    t1.revert?.();
    await tick();
    expect(graph.getEntity("Post:1")).toBeFalsy();
    expect(graph.getEntity("Post:2")).toBeFalsy();
    expect(graph.getEntity("Post:3")).toBeTruthy();

    // Revert T2 — back to baseline
    t2.revert?.();
    await tick();
    expect(graph.getEntity("Post:3")).toBeFalsy();
  });

  it("revert before commit is a no-op and does not throw", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const modifyOptimistic = createModifyOptimistic({ graph });
    const t = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
    });

    // Revert without commit
    t.revert?.();
    await tick();

    expect(graph.getEntity("Post:1")).toBeFalsy();
  });

  it("ops to identical connection key (ignoring cursors) aggregate correctly (1 + 2)", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const modifyOptimistic = createModifyOptimistic({ graph });

    // (first:2, after:null)
    const t1 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({
        parent: "Query",
        field: "posts",
        variables: { first: 2, after: null },
      });
      conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
    });

    // (first:2, after:'c1') — same connection identity (cursor args ignored)
    const t2 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({
        parent: "Query",
        field: "posts",
        variables: { first: 2, after: "c1" },
      });
      conn.addNode({ __typename: "Post", id: 2, title: "P2" }, { cursor: "c2" });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    expect(graph.getEntity("Post:1")).toBeTruthy();
    expect(graph.getEntity("Post:2")).toBeTruthy();
  });

  it("ops to identical connection key (ignoring cursors) aggregate correctly (1 + 3)", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const modifyOptimistic = createModifyOptimistic({ graph });

    const t1 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({
        parent: "Query",
        field: "posts",
        variables: { first: 2, after: null },
      });
      conn.addNode({ __typename: "Post", id: 1, title: "P1" }, { cursor: "c1" });
    });

    const t2 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({
        parent: "Query",
        field: "posts",
        variables: { first: 2, after: "c1" },
      });
      conn.addNode({ __typename: "Post", id: 3, title: "P3" }, { cursor: "c2" });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    expect(graph.getEntity("Post:1")).toBeTruthy();
    expect(graph.getEntity("Post:3")).toBeTruthy();
  });
});
