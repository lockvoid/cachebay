import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────────────

type PlanField = {
  responseKey: string;
  fieldName: string;
  isConnection: boolean;
  buildArgs: (vars: Record<string, any>) => Record<string, any>;
  stringifyArgs: (vars: Record<string, any>) => string;
  selectionSet: PlanField[] | null;
  selectionMap?: Map<string, PlanField>;
};

const stableStringify = (obj: any) => {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
};

function mkField(
  name: string,
  isConnection = false,
  children: PlanField[] | null = null
): PlanField {
  const map = new Map<string, PlanField>();
  if (children) {
    for (let i = 0; i < children.length; i++) {
      map.set(children[i].responseKey, children[i]);
    }
  }
  return {
    responseKey: name,
    fieldName: name,
    isConnection,
    buildArgs: () => ({}),
    stringifyArgs: () => stableStringify({}),
    selectionSet: children,
    selectionMap: children ? map : undefined,
  };
}

function mkConnectionField(name: string): PlanField {
  // connection needs edges.node at minimum
  const node = mkField("node", false, [mkField("id"), mkField("__typename")]);
  const edges = mkField("edges", false, [mkField("__typename"), mkField("cursor"), node]);
  return mkField(name, true, [mkField("__typename"), mkField("pageInfo"), edges]);
}

/** Seed a connection page and its edge records */
function seedPage(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection"
) {
  const edgeRefs: Array<{ __ref: string }> = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });
    edgeRefs.push({ __ref: edgeKey });
  }

  const snap: Record<string, any> = { __typename: connectionTypename, edges: edgeRefs };
  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);

  graph.putRecord(pageKey, snap);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("views helpers", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });
    views = createViews({ graph });
  });

  it("getEntityView: dereferences __ref fields and arrays of refs (with selection), and lazily reads connection field", () => {
    // Seed two users, one referencing the other + array of refs
    graph.putRecord("User:u1", {
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      bestFriend: { __ref: "User:u2" },
      friends: [{ __ref: "User:u2" }],
    });
    graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

    // Create an entity-only selection so arrays map items (friends[])
    const friendLeaf = mkField("email");
    const friendSel = mkField("friends", false, [friendLeaf]);
    const bestFriendSel = mkField("bestFriend", false, [friendLeaf]);
    const postsConn = mkConnectionField("posts");
    const rootFields: PlanField[] = [mkField("__typename"), mkField("id"), bestFriendSel, friendSel, postsConn];
    const rootMap = new Map<string, PlanField>();
    rootFields.forEach((f) => rootMap.set(f.responseKey, f));

    const u1Proxy = graph.materializeRecord("User:u1")!;
    const view = views.getEntityView(u1Proxy, rootFields, rootMap, {}, /* canonical */ false);

    // __ref deref
    expect(view.bestFriend.email).toBe("u2@example.com");
    // arrays of refs map when selection exists
    expect(Array.isArray(view.friends)).toBe(true);
    expect(view.friends[0].email).toBe("u2@example.com");

    // Connection posts: page must exist for a view to mount
    const pageKey = '@.User:u1.posts({})';
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    seedPage(
      graph,
      pageKey,
      [{ nodeRef: "Post:p1", cursor: "p1" }],
      { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection"
    );

    const postsView = view.posts; // lazy
    expect(Array.isArray(postsView.edges)).toBe(true);
    expect(postsView.edges[0].node.__typename).toBe("Post");
    expect(postsView.edges[0].node.id).toBe("p1");

    // live update: change email of u2 → view reflects
    graph.putRecord("User:u2", { email: "u2+1@example.com" });
    expect(view.bestFriend.email).toBe("u2+1@example.com");
    expect(view.friends[0].email).toBe("u2+1@example.com");
  });

  it("getConnectionView: returns a memoized edges array until refs change", () => {
    const postsField = mkConnectionField("posts");
    const pageKey = '@.User:u1.posts({})';

    // prepare user and page with 1 edge
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    seedPage(
      graph,
      pageKey,
      [{ nodeRef: "Post:p1", cursor: "p1" }],
      { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
      {},
      "PostEdge",
      "PostConnection"
    );

    const pageView = views.getConnectionView(pageKey, postsField, {}, /* canonical */ false);
    const edges1 = pageView.edges;
    const edges2 = pageView.edges;
    expect(edges1).toBe(edges2); // memoized

    // add a second edge → refs change → new array instance
    graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
    const edgeKey = `${pageKey}.edges.1`;
    graph.putRecord(edgeKey, { __typename: "PostEdge", cursor: "p2", node: { __ref: "Post:p2" } });

    // IMPORTANT: write a new edges array so the view sees different refs
    const prevEdges = (graph.getRecord(pageKey)?.edges ?? []).slice();
    graph.putRecord(pageKey, { edges: [...prevEdges, { __ref: edgeKey }] });

    const edges3 = pageView.edges;
    expect(edges3).not.toBe(edges1);
    expect(edges3.length).toBe(2);
    expect(edges3[1].node.id).toBe("p2");
  });

  it("getEdgeView: node is an entity view; updates flow through", () => {
    const nodeField = mkField("node", false, [mkField("id"), mkField("title")]);

    // Edge record
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    graph.putRecord("@.X", { __typename: "X" });
    const edgeKey = "@.X.edges.0";
    graph.putRecord(edgeKey, { __typename: "PostEdge", cursor: "c1", node: { __ref: "Post:p1" } });

    const edgeView = views.getEdgeView(edgeKey, nodeField, {}, /* canonical */ false);
    expect(edgeView.cursor).toBe("c1");
    expect(edgeView.node.title).toBe("P1");

    // live update
    graph.putRecord("Post:p1", { title: "P1 (Updated)" });
    expect(edgeView.node.title).toBe("P1 (Updated)");
  });

  it("getEntityView caches per (entityProxy, selection key) — different selections produce different view instances; canonical dimension separated", () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
    const u1Proxy = graph.materializeRecord("User:u1")!;

    // selection A: only id
    const selA = [mkField("id")];
    const mapA = new Map<string, PlanField>([["id", selA[0]]]);

    // selection B: id + email
    const selB = [mkField("id"), mkField("email")];
    const mapB = new Map<string, PlanField>([
      ["id", selB[0]],
      ["email", selB[1]],
    ]);

    const a1 = views.getEntityView(u1Proxy, selA, mapA, {}, /* canonical */ false);
    const a2 = views.getEntityView(u1Proxy, selA, mapA, {}, /* canonical */ false);
    const b1 = views.getEntityView(u1Proxy, selB, mapB, {}, /* canonical */ false);
    const aCanon = views.getEntityView(u1Proxy, selA, mapA, {}, /* canonical */ true);

    expect(a1).toBe(a2);       // same view for same selection key & canonical
    expect(a1).not.toBe(b1);   // different selection → different view
    expect(a1).not.toBe(aCanon); // same selection, different canonical → different cached view
  });
});
