import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createInspect } from "@/src/features/inspect";
import { seedConnectionPage } from "@/test/helpers/unit";

describe("Inspect", () => {
  let graph: ReturnType<typeof createGraph>;
  let inspect: ReturnType<typeof createInspect>;

  beforeEach(() => {
    graph = createGraph();
    inspect = createInspect({ graph });
  });

  describe("entityKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.entityKeys()).toEqual([]);
    });

    it("filters entity records excluding pages and edges", () => {
      graph.putRecord("@", { id: "@", __typename: "@" });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });

      const pageKey = '@.User:u1.posts({"first":1})';

      seedConnectionPage(
        graph,
        pageKey,
        [{ nodeRef: "Post:p1", cursor: "p1" }],
      );

      const entityRecordKeys = inspect.entityKeys().sort();
      expect(entityRecordKeys).toContain("User:u1");
      expect(entityRecordKeys).toContain("Post:p1");
      expect(entityRecordKeys).toContain("Post:p2");
      expect(entityRecordKeys.find((key) => key === "@")).toBeUndefined();
      expect(entityRecordKeys.find((key) => key === pageKey)).toBeUndefined();
      expect(entityRecordKeys.find((key) => key.includes(".edges."))).toBeUndefined();
    });

    it("filters by typename when provided", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });

      const userEntities = inspect.entityKeys("User");
      expect(userEntities).toEqual(["User:u1", "User:u2"]);

      const postEntities = inspect.entityKeys("Post");
      expect(postEntities).toEqual(["Post:p1"]);

      const nonExistentEntities = inspect.entityKeys("Comment");
      expect(nonExistentEntities).toEqual([]);
    });
  });

  describe("connectionPageKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.connectionPageKeys()).toEqual([]);
    });

    it("filters connection page records with @. prefix", () => {
      graph.putRecord("@", { id: "@", __typename: "@" });
      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });

      const userPostsPageKey = '@.User:u1.posts({"first":1})';
      const techPostsPageKey = '@.posts({"category":"tech"})';

      seedConnectionPage(graph, userPostsPageKey, [{ nodeRef: "Post:p1" }]);
      seedConnectionPage(graph, techPostsPageKey, [{ nodeRef: "Post:p1" }]);

      const pageKeys = inspect.connectionPageKeys().sort();
      expect(pageKeys).toEqual([userPostsPageKey, techPostsPageKey].sort());
      expect(pageKeys).not.toContain("@");
      expect(pageKeys).not.toContain("User:u1");
      expect(pageKeys).not.toContain("Post:p1");
    });

    it("filters by parent and key", () => {
      const u1PostsA = '@.User:u1.posts({"first":2})';
      const u1PostsB = '@.User:u1.posts({"after":"p2","first":2})';
      const u2Posts = '@.User:u2.posts({"first":1})';
      const rootTech = '@.posts({"category":"tech","first":1})';

      seedConnectionPage(graph, u1PostsA, [{ nodeRef: "Post:p1" }]);
      seedConnectionPage(graph, u1PostsB, [{ nodeRef: "Post:p2" }]);
      seedConnectionPage(graph, u2Posts, [{ nodeRef: "Post:p3" }]);
      seedConnectionPage(graph, rootTech, [{ nodeRef: "Post:p4" }]);

      const u1PostsPages = inspect.connectionPageKeys({ parent: { __typename: "User", id: "u1" }, key: "posts" }).sort();
      expect(u1PostsPages).toEqual([u1PostsA, u1PostsB].sort());

      const rootPostsPages = inspect.connectionPageKeys({ parent: "Query", key: "posts" });
      expect(rootPostsPages).toEqual([rootTech]);
    });

    it("applies argsFn predicate when provided", () => {
      const tech = '@.posts({"category":"tech","first":1})';
      const life = '@.posts({"category":"lifestyle","first":1})';

      seedConnectionPage(graph, tech, [{ nodeRef: "Post:t1" }]);
      seedConnectionPage(graph, life, [{ nodeRef: "Post:l1" }]);

      const onlyTech = inspect.connectionPageKeys({
        parent: "Query",
        key: "posts",
        argsFn: (raw) => raw.includes('"category":"tech"'),
      });

      expect(onlyTech).toEqual([tech]);
    });
  });

  describe("connectionEdgeKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.connectionEdgeKeys()).toEqual([]);
    });

    it("filters all edge records when no filter provided", () => {
      const userPostsPageKey = '@.User:u1.posts({"first":2})';
      const techPostsPageKey = '@.posts({"category":"tech"})';

      seedConnectionPage(
        graph,
        userPostsPageKey,
        [
          { nodeRef: "Post:p1", cursor: "p1" },
          { nodeRef: "Post:p2", cursor: "p2" },
        ],
      );
      seedConnectionPage(
        graph,
        techPostsPageKey,
        [{ nodeRef: "Post:p3", cursor: "p3" }],
      );

      const edgeKeys = inspect.connectionEdgeKeys();
      expect(edgeKeys.length).toBe(3);
      expect(edgeKeys.every(key => key.includes(".edges."))).toBe(true);
    });

    it("filters edge records for specific parent/key", () => {
      const u1 = '@.User:u1.posts({"first":2})';
      const u2 = '@.User:u2.posts({"first":1})';

      seedConnectionPage(graph, u1, [
        { nodeRef: "Post:p1", cursor: "p1" },
        { nodeRef: "Post:p2", cursor: "p2" },
      ]);
      seedConnectionPage(graph, u2, [{ nodeRef: "Post:p3", cursor: "p3" }]);

      const u1Edges = inspect.connectionEdgeKeys({ parent: { __typename: "User", id: "u1" }, key: "posts" });
      expect(u1Edges.length).toBe(2);
      expect(u1Edges.every(key => key.startsWith(`${u1}.edges.`))).toBe(true);

      const u2Edges = inspect.connectionEdgeKeys({ parent: { __typename: "User", id: "u2" }, key: "posts" });
      expect(u2Edges.length).toBe(1);
      expect(u2Edges[0].startsWith(`${u2}.edges.`)).toBe(true);
    });

    it("returns empty array when there are no pages matching the filter", () => {
      seedConnectionPage(
        graph,
        '@.User:u1.posts({"first":1})',
        [{ nodeRef: "Post:p1" }],
      );

      const none = inspect.connectionEdgeKeys({ parent: { __typename: "User", id: "nope" }, key: "posts" });
      expect(none).toEqual([]);
    });
  });

  describe("connectionKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.connectionKeys()).toEqual([]);
    });

    it("returns canonical keys for root connection ignoring pagination args", () => {
      const pageA = '@.posts({"category":"tech","first":1})';
      const pageB = '@.posts({"category":"tech","after":"p1","first":1})';
      const pageC = '@.posts({"category":"lifestyle","first":1})';

      seedConnectionPage(graph, pageA, [{ nodeRef: "Post:t1" }]);
      seedConnectionPage(graph, pageB, [{ nodeRef: "Post:t2" }]);
      seedConnectionPage(graph, pageC, [{ nodeRef: "Post:l1" }]);

      const keys = inspect.connectionKeys({ parent: "Query", key: "posts" }).sort();

      expect(keys).toEqual(['@.posts({"category":"lifestyle"})', '@.posts({"category":"tech"})'].sort());
    });

    it("scopes canonical keys by parent entity", () => {
      const u1A = '@.User:u1.posts({"category":"tech","first":1})';
      const u1B = '@.User:u1.posts({"category":"tech","after":"p2","first":1})';
      const u2A = '@.User:u2.posts({"category":"tech","first":1})';

      seedConnectionPage(graph, u1A, [{ nodeRef: "Post:u1t1" }]);
      seedConnectionPage(graph, u1B, [{ nodeRef: "Post:u1t2" }]);
      seedConnectionPage(graph, u2A, [{ nodeRef: "Post:u2t1" }]);

      const user1_postKeys = inspect.connectionKeys({ parent: { __typename: "User", id: "u1" }, key: "posts" });
      const user2_postKeys = inspect.connectionKeys({ parent: { __typename: "User", id: "u2" }, key: "posts" });

      expect(user1_postKeys).toEqual(['@.User:u1.posts({"category":"tech"})']);
      expect(user2_postKeys).toEqual(['@.User:u2.posts({"category":"tech"})']);
    });

    it("can be narrowed by argsFn predicate", () => {
      const tech = '@.posts({"category":"tech","first":1})';
      const life = '@.posts({"category":"lifestyle","first":1})';

      seedConnectionPage(graph, tech, [{ nodeRef: "Post:t1" }]);
      seedConnectionPage(graph, life, [{ nodeRef: "Post:l1" }]);

      const onlyTech = inspect.connectionKeys({
        parent: "Query",
        key: "posts",
        argsFn: (raw) => raw.includes('"category":"tech"'),
      });

      expect(onlyTech).toEqual(['@.posts({"category":"tech"})']);
    });
  });

  describe("record", () => {
    it("returns undefined for non-existent record", () => {
      expect(inspect.record("User:nonexistent")).toBeUndefined();
    });

    it("returns raw snapshot by default", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

      const rawUserRecord = inspect.record("User:u1");
      expect(rawUserRecord).toEqual({ __typename: "User", id: "u1", email: "a@example.com" });
      expect(rawUserRecord.email).toBe("a@example.com");
    });

    it("reflects current graph state", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "original@example.com" });

      const userRecordBefore = inspect.record("User:u1");
      expect(userRecordBefore.email).toBe("original@example.com");

      graph.putRecord("User:u1", { email: "updated@example.com" });

      const userRecordAfter = inspect.record("User:u1");
      expect(userRecordAfter.email).toBe("updated@example.com");
    });
  });

  describe("config", () => {
    it("exposes keys and interfaces used by the graph", () => {
      const cfg = inspect.config();

      expect(cfg).toBeTruthy();
      expect(cfg).toHaveProperty("keys");
      expect(cfg).toHaveProperty("interfaces");
      expect(typeof cfg.keys).toBe("object");
      expect(typeof cfg.interfaces).toBe("object");
    });
  });
});
