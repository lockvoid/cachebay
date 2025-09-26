import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createInspect } from "@/src/features/inspect";
import { seedConnectionPage } from "@/test/helpers/unit";

describe("Inspect", () => {
  let graph: ReturnType<typeof createGraph>;
  let inspect: ReturnType<typeof createInspect>;

  beforeEach(() => {
    graph = createGraph({});
    inspect = createInspect({ graph });
  });

  describe("keys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.keys()).toEqual([]);
    });

    it("lists all record ids including root, entities, pages, and edges", () => {
      graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });

      const connectionPageKey = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
      
      seedConnectionPage(
        graph,
        connectionPageKey,
        [{ nodeRef: "Post:p1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
        { totalCount: 1 },
        "PostEdge",
        "PostConnection"
      );

      const graphRecordKeys = inspect.keys().sort();
      expect(graphRecordKeys).toContain("@");
      expect(graphRecordKeys).toContain("User:u1");
      expect(graphRecordKeys).toContain("Post:p1");
      expect(graphRecordKeys).toContain(connectionPageKey);
      
      const edgeRecordKeys = graphRecordKeys.filter((key) => key.includes(".edges."));
      expect(edgeRecordKeys.length).toBe(1);
    });
  });

  describe("entityKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.entityKeys()).toEqual([]);
    });

    it("filters entity records excluding root, pages, and edges", () => {
      graph.putRecord("@", { id: "@", __typename: "@" });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });

      const connectionPageKey = '@.User:u1.posts({"first":1})';

      seedConnectionPage(
        graph,
        connectionPageKey,
        [{ nodeRef: "Post:p1", cursor: "p1" }]
      );

      const entityRecordKeys = inspect.entityKeys().sort();
      expect(entityRecordKeys).toContain("User:u1");
      expect(entityRecordKeys).toContain("Post:p1");
      expect(entityRecordKeys).toContain("Post:p2");
      expect(entityRecordKeys).not.toContain("@");
      expect(entityRecordKeys).not.toContain(connectionPageKey);
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

  describe("pageKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.pageKeys()).toEqual([]);
    });

    it("filters connection page records with @. prefix", () => {
      graph.putRecord("@", { id: "@", __typename: "@" });
      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });

      const userPostsPageKey = '@.User:u1.posts({"first":1})';
      const techPostsPageKey = '@.posts({"category":"tech"})';

      seedConnectionPage(
        graph,
        userPostsPageKey,
        [{ nodeRef: "Post:p1" }]
      );
      seedConnectionPage(
        graph,
        techPostsPageKey,
        [{ nodeRef: "Post:p1" }]
      );

      const connectionPageKeys = inspect.pageKeys().sort();
      expect(connectionPageKeys).toEqual([userPostsPageKey, techPostsPageKey].sort());
      expect(connectionPageKeys).not.toContain("@");
      expect(connectionPageKeys).not.toContain("User:u1");
      expect(connectionPageKeys).not.toContain("Post:p1");
    });
  });

  describe("edgeKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.edgeKeys()).toEqual([]);
    });

    it("filters all edge records when no pageKey provided", () => {
      const userPostsPageKey = '@.User:u1.posts({"first":1})';
      const techPostsPageKey = '@.posts({"category":"tech"})';
      
      seedConnectionPage(
        graph,
        userPostsPageKey,
        [
          { nodeRef: "Post:p1", cursor: "p1" },
          { nodeRef: "Post:p2", cursor: "p2" }
        ]
      );
      seedConnectionPage(
        graph,
        techPostsPageKey,
        [{ nodeRef: "Post:p3", cursor: "p3" }]
      );

      const edgeKeys = inspect.edgeKeys();
      expect(edgeKeys.length).toBe(3);
      expect(edgeKeys.every(key => key.includes(".edges."))).toBe(true);
    });

    it("filters edge records for specific page when pageKey provided", () => {
      const userPostsPageKey = '@.User:u1.posts({"first":2})';
      const techPostsPageKey = '@.posts({"category":"tech"})';
      
      seedConnectionPage(
        graph,
        userPostsPageKey,
        [
          { nodeRef: "Post:p1", cursor: "p1" },
          { nodeRef: "Post:p2", cursor: "p2" }
        ]
      );
      seedConnectionPage(
        graph,
        techPostsPageKey,
        [{ nodeRef: "Post:p3", cursor: "p3" }]
      );

      const userPostsEdgeKeys = inspect.edgeKeys(userPostsPageKey);
      expect(userPostsEdgeKeys.length).toBe(2);
      expect(userPostsEdgeKeys.every(key => key.startsWith(`${userPostsPageKey}.edges.`))).toBe(true);

      const techPostsEdgeKeys = inspect.edgeKeys(techPostsPageKey);
      expect(techPostsEdgeKeys.length).toBe(1);
      expect(techPostsEdgeKeys[0].startsWith(`${techPostsPageKey}.edges.`)).toBe(true);
    });

    it("returns empty array for non-existent pageKey", () => {
      seedConnectionPage(
        graph,
        '@.User:u1.posts({"first":1})',
        [{ nodeRef: "Post:p1" }]
      );

      const nonExistentPageEdgeKeys = inspect.edgeKeys('@.nonexistent.posts({})');
      expect(nonExistentPageEdgeKeys).toEqual([]);
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

    it("returns materialized proxy when materialized: true", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

      const userRecord = inspect.record("User:u1", { materialized: true });
      expect(userRecord.email).toBe("a@example.com");

      graph.putRecord("User:u1", { email: "a+1@example.com" });
      expect(userRecord.email).toBe("a+1@example.com");
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
      const config = inspect.config();

      expect(config).toBeTruthy();
      expect(config).toHaveProperty("keys");
      expect(config).toHaveProperty("interfaces");
      expect(typeof config.keys).toBe("object");
      expect(typeof config.interfaces).toBe("object");
    });
  });
});
