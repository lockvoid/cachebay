import { describe, it, expect } from "vitest";
import { createSSR } from "@/src/features/ssr";

const makeGraph = () => ({
  entityStore: new Map<string, any>(),
  selectionStore: new Map<string, any>(),
});

// tiny helper to flush one microtask
const waitMicrotask = async () =>
  await new Promise<void>(resolve => queueMicrotask(resolve));

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
    // Seed
    const graph1 = makeGraph();
    graph1.entityStore.set("User:1", { __typename: "User", id: "1", name: "Ada" });
    graph1.entityStore.set("Post:101", { __typename: "Post", id: "101", title: "Hello" });
    graph1.selectionStore.set('user({"id":"1"})', { __ref: "User:1" });
    graph1.selectionStore.set('User:1.posts({"first":2})', {
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

    // Entities restored
    expect(graph2.entityStore.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Ada" });
    expect(graph2.entityStore.get("Post:101")).toEqual({ __typename: "Post", id: "101", title: "Hello" });

    // Selections restored
    expect(graph2.selectionStore.get('user({"id":"1"})')).toEqual({ __ref: "User:1" });
    expect(graph2.selectionStore.get('User:1.posts({"first":2})')).toEqual({
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

    expect(graph.entityStore.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Ada" });
    expect(graph.selectionStore.get('user({"id":"1"})')).toEqual({ __ref: "User:1" });
    expect(ssr.hydrateSelectionTicket.size).toBe(0); // tickets disabled
  });

  it("materialize option warms selection clones with resolvers.applyOnObject (if provided)", async () => {
    const graph = makeGraph();
    graph.selectionStore.set("stats({})", { __typename: "Stats", total: 1 });

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
    expect(graph.selectionStore.get("stats({})")).toEqual({ __typename: "Stats", total: 1 });
    expect(calls).toBe(1);
  });
});
