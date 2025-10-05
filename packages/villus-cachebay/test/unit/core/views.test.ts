// TODO: Needs refactor

import { computed, watchEffect, nextTick } from "vue";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createConnectionPlanField, seedConnectionPage } from "@/test/helpers/unit";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph();
    views = createViews({ graph });
  });

  it("connection.edges is a stable, reactive array (computed(() => connection.edges) updates)", async () => {
    const postsField = createConnectionPlanField("posts");

    // Seed: User:u1 with one post edge
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });
    graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "P1" });

    seedConnectionPage(
      graph,
      "@.User:u1.posts({})",
      [{ nodeRef: "Post:1", cursor: "c1" }],
      { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection",
    );

    const conn = views.getConnectionView("@.User:u1.posts({})", postsField, {}, false);

    // This is the “problematic” pattern from the app: computed returns edges array
    const edgesRef = computed(() => conn.edges);

    // Track length reactively
    let seenLen = -1;
    const stop = watchEffect(() => {
      // access .length to ensure dependency is tracked on the array
      seenLen = edgesRef.value.length;
    });

    // Initial frame
    await nextTick();
    expect(Array.isArray(edgesRef.value)).toBe(true);
    expect(seenLen).toBe(1);

    // Keep a stable reference to the edges array instance
    const stableEdges = edgesRef.value;

    // Append a second edge (simulate canonical/page merge)
    graph.putRecord("Post:2", { __typename: "Post", id: "2", title: "P2" });
    graph.putRecord("@.User:u1.posts({}).edges.1", { __typename: "PostEdge", cursor: "c2", node: { __ref: "Post:2" } });

    const prevEdges = (graph.getRecord("@.User:u1.posts({})")?.edges ?? []).slice();
    graph.putRecord("@.User:u1.posts({})", { edges: [...prevEdges, { __ref: "@.User:u1.posts({}).edges.1" }] });

    // Reactive update should flow without changing the edges array identity
    await nextTick();
    expect(edgesRef.value).toBe(stableEdges); // identity stable
    expect(seenLen).toBe(2);                  // length updated reactively
    expect(edgesRef.value[1].node.id).toBe("2");

    stop();
  });

  it("mapping over connection.edges in a computed updates when refs change", async () => {
    const postsField = createConnectionPlanField("posts");

    graph.putRecord("User:u2", { __typename: "User", id: "u2" });
    graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "A" });

    seedConnectionPage(
      graph,
      "@.User:u2.posts({})",
      [{ nodeRef: "Post:1", cursor: "c1" }],
      { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection",
    );

    const conn = views.getConnectionView("@.User:u2.posts({})", postsField, {}, false);

    // Common UI usage: computed returns a mapped list
    const titles = computed(() => conn.edges.map(e => e.node.title));

    await nextTick();
    expect(titles.value).toEqual(["A"]);

    // Add another post → titles should update
    graph.putRecord("Post:2", { __typename: "Post", id: "2", title: "B" });
    graph.putRecord("@.User:u2.posts({}).edges.1", { __typename: "PostEdge", cursor: "c2", node: { __ref: "Post:2" } });

    const prevEdges = (graph.getRecord("@.User:u2.posts({})")?.edges ?? []).slice();
    graph.putRecord("@.User:u2.posts({})", { edges: [...prevEdges, { __ref: "@.User:u2.posts({}).edges.1" }] });

    await nextTick();
    expect(titles.value).toEqual(["A", "B"]);

    // Update a node’s field → mapped value should update too
    graph.putRecord("Post:2", { title: "B2" });
    await nextTick();
    expect(titles.value).toEqual(["A", "B2"]);
  });

  it("pageInfo changes are observed when the reference is replaced", async () => {
    const postsField = createConnectionPlanField("posts");

    graph.putRecord("User:u3", { __typename: "User", id: "u3" });
    graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "P1" });

    seedConnectionPage(
      graph,
      "@.User:u3.posts({})",
      [{ nodeRef: "Post:1", cursor: "c1" }],
      { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection",
    );

    const conn = views.getConnectionView("@.User:u3.posts({})", postsField, {}, false);

    // Computed reads through pageInfo.endCursor (tracks pageInfo ref)
    const endCursor = computed(() => conn.pageInfo?.endCursor ?? null);

    await nextTick();
    expect(endCursor.value).toBe("c1");

    // Replace pageInfo (how graph writes today) → computed should update
    const prev = graph.getRecord("@.User:u3.posts({})") || {};
    graph.putRecord("@.User:u3.posts({})", {
      pageInfo: { ...(prev.pageInfo || {}), endCursor: "c2", __typename: "PageInfo" },
    });

    await nextTick();
    expect(endCursor.value).toBe("c2");
  });
});
