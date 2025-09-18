import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createInspect } from "@/src/features/inspect";

/** seed a connection page + edge records */
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

  const page: Record<string, any> = { __typename: connectionTypename, edges: edgeRefs };
  if (pageInfo) page.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(page, extra);
  graph.putRecord(pageKey, page);
}

describe("features/inspect (unified graph)", () => {
  let graph: ReturnType<typeof createGraph>;
  let inspect: ReturnType<typeof createInspect>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });
    inspect = createInspect({ graph });
  });

  it("keys() lists all record ids; entityKeys()/pageKeys()/edgeKeys() filter correctly", () => {
    // root
    graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });

    // entities
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
    graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });

    // page + edges
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

    const all = inspect.keys().sort();
    expect(all).toContain("@");
    expect(all).toContain("User:u1");
    expect(all).toContain("Post:p1");
    expect(all).toContain(pageKey);
    // there is one edge record
    const edgeList = all.filter((k) => k.includes(".edges."));
    expect(edgeList.length).toBe(1);

    // entity filtering
    const allEntities = inspect.entityKeys().sort();
    expect(allEntities).toContain("User:u1");
    expect(allEntities).toContain("Post:p1");
    expect(allEntities).not.toContain("@");
    expect(allEntities).not.toContain(pageKey);
    expect(allEntities.find((k) => k.includes(".edges."))).toBeUndefined();

    const userEntities = inspect.entityKeys("User");
    expect(userEntities).toEqual(["User:u1"]);

    // pages & edges
    const pages = inspect.pageKeys();
    expect(pages).toEqual([pageKey]);

    const edges = inspect.edgeKeys(pageKey);
    expect(edges.length).toBe(1);
    expect(edges[0].startsWith(`${pageKey}.edges.`)).toBe(true);
  });

  it("record(id) returns raw snapshot or materialized proxy", () => {
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    const raw = inspect.record("User:u1");
    expect(raw.email).toBe("a@example.com");

    const live = inspect.record("User:u1", { materialized: true });
    expect(live.email).toBe("a@example.com");

    // reactive update path (graph overlay)
    graph.putRecord("User:u1", { email: "a+1@example.com" });
    expect(live.email).toBe("a+1@example.com");
  });

  it("config() exposes keys/interfaces used by the graph", () => {
    const cfg = inspect.config();
    expect(cfg).toBeTruthy();
    expect(Object.keys(cfg.keys)).toEqual(["User", "Post"]);
    expect(Object.keys(cfg.interfaces)).toEqual(["Post"]);
  });
});
