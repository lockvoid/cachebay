// test/unit/features/ssr.test.ts
import { describe, it, expect } from "vitest";
import { createSSR } from "@/src/features/ssr";

// Minimal graph stub that implements ONLY the public API SSR uses
function makeGraph() {
  const entityStore = new Map<string, any>();
  const selectionStore = new Map<string, any>();

  const graph = {
    // entities
    listEntityKeys: () => Array.from(entityStore.keys()),
    getEntity: (key: string) => entityStore.get(key),
    putEntity: (obj: any) => {
      if (!obj || typeof obj !== "object" || !obj.__typename) return null;
      const id = obj.id != null ? String(obj.id) : null;
      if (id == null) return null;
      const key = `${obj.__typename}:${id}`;
      entityStore.set(key, JSON.parse(JSON.stringify(obj)));
      return key;
    },
    removeEntity: (key: string) => entityStore.delete(key),
    clearAllEntities: () => {
      entityStore.clear();
    },

    // selections
    listSelectionKeys: () => Array.from(selectionStore.keys()),
    getSelection: (key: string) => selectionStore.get(key),
    putSelection: (key: string, subtree: any) => {
      selectionStore.set(key, JSON.parse(JSON.stringify(subtree)));
    },
    removeSelection: (key: string) => selectionStore.delete(key),
    clearAllSelections: () => {
      selectionStore.clear();
    },
  };

  return graph;
}

// tiny helper to flush one microtask
const waitMicrotask = async () =>
  await new Promise<void>((resolve) => queueMicrotask(resolve));

describe("features/ssr — entities + selections", () => {
  it("dehydrates empty stores", () => {
    const graph = makeGraph();
    const ssr = createSSR({ graph });

    const snap = ssr.dehydrate();
    expect(Array.isArray(snap.entities)).toBe(true);
    expect(Array.isArray(snap.selections)).toBe(true);
    expect(snap.entities.length).toBe(0);
    expect(snap.selections.length).toBe(0);
  });

  it("round-trips entities and selections", async () => {
    // Seed (using public API)
    const graph1 = makeGraph();
    graph1.putEntity({ __typename: "User", id: "1", name: "Ada" });
    graph1.putEntity({ __typename: "Post", id: "101", title: "Hello" });
    graph1.putSelection('user({"id":"1"})', { __ref: "User:1" });
    graph1.putSelection('User:1.posts({"first":2})', {
      __typename: "PostConnection",
      edges: [{ cursor: "c1", node: { __ref: "Post:101" } }],
      pageInfo: { endCursor: "c1", hasNextPage: true },
    });

    const ssr1 = createSSR({ graph: graph1 });
    const snapshot = ssr1.dehydrate();

    // Hydrate into a fresh graph
    const graph2 = makeGraph();
    const ssr2 = createSSR({ graph: graph2 });

    expect(ssr2.isHydrating()).toBe(false);
    ssr2.hydrate(snapshot);
    expect(ssr2.isHydrating()).toBe(true);

    // flips to false on the next microtask
    await waitMicrotask();
    expect(ssr2.isHydrating()).toBe(false);

    // Entities restored (public API)
    expect(graph2.getEntity("User:1")).toEqual({
      __typename: "User",
      id: "1",
      name: "Ada",
    });
    expect(graph2.getEntity("Post:101")).toEqual({
      __typename: "Post",
      id: "101",
      title: "Hello",
    });

    // Selections restored (public API)
    expect(graph2.getSelection('user({"id":"1"})')).toEqual({ __ref: "User:1" });
    expect(graph2.getSelection('User:1.posts({"first":2})')).toEqual({
      __typename: "PostConnection",
      edges: [{ cursor: "c1", node: { __ref: "Post:101" } }],
      pageInfo: { endCursor: "c1", hasNextPage: true },
    });

    // Tickets populated by default
    expect(ssr2.hydrateSelectionTicket.size).toBe(2);
    expect(ssr2.hydrateSelectionTicket.has('user({"id":"1"})')).toBe(true);
  });

  it("hydrate accepts a streaming-style function and can disable tickets", async () => {
    const graph = makeGraph();
    const ssr = createSSR({ graph });

    const emitted = {
      entities: [["User:1", { __typename: "User", id: "1", name: "Ada" }]],
      selections: [['user({"id":"1"})', { __ref: "User:1" }]],
    };

    ssr.hydrate((emit) => {
      emit(emitted);
    }, { tickets: false });

    await waitMicrotask();

    expect(graph.getEntity("User:1")).toEqual({
      __typename: "User",
      id: "1",
      name: "Ada",
    });
    expect(graph.getSelection('user({"id":"1"})')).toEqual({ __ref: "User:1" });
    expect(ssr.hydrateSelectionTicket.size).toBe(0); // tickets disabled
  });

  it("materialize option warms selection clones with resolvers.applyOnObject (if provided)", async () => {
    const graph = makeGraph();
    graph.putSelection("stats({})", { __typename: "Stats", total: 1 });

    let calls = 0;
    const resolvers = {
      applyOnObject: (root: any) => {
        if (root && root.__typename === "Stats") {
          root.total = (root.total ?? 0) + 1;
          calls++;
        }
      },
    };

    const ssr = createSSR({ graph, resolvers });

    const snapshot = ssr.dehydrate();
    ssr.hydrate(snapshot, { materialize: true });

    await waitMicrotask();

    // Store is unchanged (warming happened on clones)
    expect(graph.getSelection("stats({})")).toEqual({ __typename: "Stats", total: 1 });
    expect(calls).toBe(1);
  });
});
