import { describe, it, expect } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createModifyOptimistic } from "@/src/features/optimistic";

const tick = () => Promise.resolve();

describe("features/optimistic — conflict & ordering semantics (Posts)", () => {
  it("later optimistic write wins for same entity; revert restores previous snapshot", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const modifyOptimistic = createModifyOptimistic({ graph });

    const t1 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
    });

    const t2 = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 1, title: "B" }, { cursor: "c1b" });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    expect(graph.getEntity("Post:1")?.title).toBe("B");

    t2.revert?.();
    await tick();
    expect(graph.getEntity("Post:1")?.title).toBe("A");

    t1.revert?.();
    await tick();
    expect(graph.getEntity("Post:1")).toBeFalsy();
  });

  it("remove then re-add within the same optimistic layer respects final instruction", async () => {
    const graph = createGraph({
      reactiveMode: "shallow",
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const modifyOptimistic = createModifyOptimistic({ graph });

    const t = modifyOptimistic((tx) => {
      const [conn] = tx.connections({ parent: "Query", field: "posts" });
      conn.addNode({ __typename: "Post", id: 1, title: "A" }, { cursor: "c1" });
      conn.removeNode({ __typename: "Post", id: 1 });
      conn.addNode({ __typename: "Post", id: 1, title: "A-final" }, { cursor: "c1z" });
    });

    t.commit?.();
    await tick();

    expect(graph.getEntity("Post:1")).toBeTruthy();
    expect(graph.getEntity("Post:1")?.title).toBe("A-final");
  });
});
