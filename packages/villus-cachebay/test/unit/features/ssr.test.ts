import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createSSR } from "@/src/features/ssr";
import { delay } from "@/test/helpers";

// Small seeding helper: create a connection page (+ edges)
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

  const snap: Record<string, any> = {
    __typename: connectionTypename,
    edges: edgeRefs,
  };
  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);

  graph.putRecord(pageKey, snap);
}

describe("SSR (graph records)", () => {
  let graph: ReturnType<typeof createGraph>;
  let ssr: ReturnType<typeof createSSR>;

  beforeEach(() => {
    graph = createGraph({
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });
    ssr = createSSR({ hydrationTimeout: 0 }, { graph });
  });

  it("dehydrate/hydrate roundtrips all records", async () => {
    // seed root, entity, and a connection page
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
    const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
    seedPage(
      graph,
      pageKey,
      [{ nodeRef: "Post:p1", cursor: "p1" }],
      { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
      { totalCount: 1 },
      "PostEdge",
      "PostConnection"
    );

    // 1) dehydrate
    const snapshot = ssr.dehydrate();
    expect(() => JSON.stringify(snapshot)).not.toThrow();

    // 2) clear and ensure empty
    graph.clear();
    expect(graph.keys().length).toBe(0);

    // 3) hydrate
    ssr.hydrate(snapshot);
    expect(ssr.isHydrating()).toBe(true);
    await delay();
    expect(ssr.isHydrating()).toBe(false);

    // 4) verify restored records
    const restoredRoot = graph.getRecord("@");
    expect(restoredRoot['user({"id":"u1"})'].__ref).toBe("User:u1");
    expect(graph.getRecord("User:u1").email).toBe("a@example.com");

    const restoredPage = graph.getRecord(pageKey);
    expect(restoredPage.__typename).toBe("PostConnection");
    expect(restoredPage.pageInfo.endCursor).toBe("p1");

    const edgeRef = restoredPage.edges[0].__ref;
    const edgeRec = graph.getRecord(edgeRef);
    expect(edgeRec.cursor).toBe("p1");
    expect(edgeRec.node.__ref).toBe("Post:p1");
  });

  it("hydrate accepts a function (stream-friendly) and toggles isHydrating()", async () => {
    const snap = {
      records: [
        ["@", { id: "@", __typename: "@", 'user({"id":"u2"})': { __ref: "User:u2" } }],
        ["User:u2", { __typename: "User", id: "u2", email: "b@example.com" }],
      ] as Array<[string, any]>,
    };

    let emitted = false;
    ssr.hydrate((emit) => {
      emitted = true;
      emit(snap);
    });

    expect(emitted).toBe(true);
    expect(ssr.isHydrating()).toBe(true);
    await delay(0)
    expect(ssr.isHydrating()).toBe(false);

    const root = graph.getRecord("@");
    expect(root['user({"id":"u2"})'].__ref).toBe("User:u2");
    expect(graph.getRecord("User:u2").email).toBe("b@example.com");
  });

  it("hydrates gracefully on malformed snapshots (no throw)", async () => {
    ssr.hydrate({} as any);
    await delay(0)
    expect(graph.keys().length).toBe(0);

    ssr.hydrate({
      records: [null as any, ["User:x", null], ["User:y", 123], ["User:z", { __typename: "User", id: "z" }]],
    });
    await delay(0)
    expect(graph.getRecord("User:z")?.id).toBe("z");
  });

  it("dehydrate reflects runtime updates after hydrate", async () => {
    ssr.hydrate({
      records: [
        ["@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } }],
        ["User:u1", { __typename: "User", id: "u1", email: "a@example.com" }],
      ],
    });
    await delay(0)

    graph.putRecord("User:u1", { email: "a+1@example.com" });

    const next = ssr.dehydrate();
    const recs = new Map(next.records);
    expect(recs.get("User:u1").email).toBe("a+1@example.com");
  });
});
