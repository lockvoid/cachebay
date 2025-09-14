// test/unit/core/views.test.ts
import { describe, it, expect } from "vitest";
import { isReactive } from "vue";
import { createGraph, type GraphAPI } from "@/src/core/graph";
import { createSelections } from "@/src/core/selections";
import { createViews } from "@/src/core/views";

const makeGraph = (): GraphAPI => {
  return createGraph({
    reactiveMode: "shallow",
    keys: {
      User: (o) => o?.id ?? null,
      Profile: (o) => o?.id ?? null,
      Post: (o) => o?.id ?? null,
      AudioPost: (o) => o?.id ?? null,
      VideoPost: (o) => o?.id ?? null,
      Comment: (o) => o?.id ?? null,
      Tag: (o) => o?.id ?? null,
    },
    interfaces: { Post: ["AudioPost", "VideoPost"] },
  });
};

describe("views.ts — per-session mounting of selections/entities", () => {
  it("mounts an entity and returns the canonical reactive proxy", () => {
    const graph = makeGraph();
    const views = createViews({ dependencies: { graph } });
    const session = views.createSession();

    // seed
    graph.putEntity({ __typename: "User", id: "1", name: "Ada" });

    const prox = session.mountEntity("User:1");
    expect(isReactive(prox)).toBe(true);
    expect(prox.__typename).toBe("User");
    expect(prox.id).toBe("1");
    expect(prox.name).toBe("Ada");

    // update entity → proxy reflects
    graph.putEntity({ __typename: "User", id: "1", name: "Ada Lovelace" });
    expect(prox.name).toBe("Ada Lovelace");

    // session bookkeeping
    expect(session._mountedEntities.has("User:1")).toBe(true);
    session.destroy();
    expect(session._mountedEntities.size).toBe(0);
  });

  it("mounts a selection and returns a reactive view wrapper that tracks entity updates", () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const views = createViews({ dependencies: { graph } });
    const session = views.createSession();

    // Seed: user and a connection page selection
    graph.putEntity({ __typename: "User", id: "1", name: "John" });
    const selKey = 'User:1.posts({"first":2})';
    graph.putSelection(selKey, {
      __typename: "PostConnection",
      edges: [
        { __typename: "PostEdge", cursor: "c1", node: { __typename: "AudioPost", id: "101", title: "Audio One" } },
        { __typename: "PostEdge", cursor: "c2", node: { __typename: "VideoPost", id: "102", title: "Video Two" } },
      ],
      pageInfo: { __typename: "PageInfo", hasNextPage: true, endCursor: "c2" },
    });

    const view = session.mountSelection(selKey);
    expect(isReactive(view)).toBe(true);
    expect(Array.isArray(view.edges)).toBe(true);
    expect(view.edges[0].node.__typename).toBe("AudioPost");
    expect(view.edges[0].node.title).toBe("Audio One");

    // entity update reflects in the selection view
    graph.putEntity({ __typename: "AudioPost", id: "101", title: "Audio One (Upd)" });
    expect(view.edges[0].node.title).toBe("Audio One (Upd)");

    expect(session._mountedSelections.has(selKey)).toBe(true);
    session.destroy();
    expect(session._mountedSelections.size).toBe(0);
  });

  it("refreshSelection re-overlays the same selection proxy identity", () => {
    const graph = makeGraph();
    const views = createViews({ dependencies: { graph } });
    const session = views.createSession();

    const selKey = 'user({"id":"1"})';
    // write a simple selection that’s just an entity ref
    graph.putEntity({ __typename: "User", id: "1", name: "X" });
    graph.putSelection(selKey, { __typename: "User", id: "1" }); // will normalize to { __ref: "User:1" }

    const a = session.mountSelection(selKey);
    const b = session.refreshSelection(selKey);
    // same wrapper identity from graph’s cache
    expect(a).toBe(b);

    // update entity and refresh again (identity stable)
    graph.putEntity({ __typename: "User", id: "1", name: "Y" });
    const c = session.refreshSelection(selKey);
    expect(c).toBe(a);
    expect(a.name).toBe("Y");

    session.destroy();
  });
});
