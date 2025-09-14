// test/unit/core/selections.test.ts
import { describe, it, expect } from "vitest";
import { createSelections } from "@/src/core/selections";

describe("selections.ts — selection keys + heuristic compiler", () => {
  // Minimal mock graph that provides `identify`
  const graph = {
    identify: (o: any) =>
      o && typeof o === "object" && typeof o.__typename === "string" && o.id != null
        ? `${o.__typename}:${String(o.id)}`
        : null,
  };

  const selections = createSelections({
    config: {},
    dependencies: { graph },
  });

  describe("buildRootSelectionKey", () => {
    it("drops undefined args and produces a stable key", () => {
      const k = selections.buildRootSelectionKey("user", { id: "1", skip: undefined });
      expect(k).toBe('user({"id":"1"})');
    });

    it("stabilizes nested object key ordering", () => {
      const a = selections.buildRootSelectionKey("list", { where: { b: 2, a: 1 } });
      const b = selections.buildRootSelectionKey("list", { where: { a: 1, b: 2 } });
      expect(a).toBe(b);
      expect(a).toBe('list({"where":{"a":1,"b":2}})');
    });

    it("emits an empty-object suffix when args are omitted", () => {
      const k = selections.buildRootSelectionKey("stats");
      expect(k).toBe("stats({})");
    });
  });

  describe("buildFieldSelectionKey", () => {
    it("uses the parent entity key and drops undefined args", () => {
      const k = selections.buildFieldSelectionKey("User:1", "posts", { first: 10, after: undefined });
      expect(k).toBe('User:1.posts({"first":10})');
    });

    it("stabilizes nested object key ordering", () => {
      const a = selections.buildFieldSelectionKey("User:1", "posts", {
        first: 10,
        where: { x: 1, y: 2 },
      });
      const b = selections.buildFieldSelectionKey("User:1", "posts", {
        where: { y: 2, x: 1 },
        first: 10,
      });
      expect(a).toBe(b);
      expect(a).toBe('User:1.posts({"first":10,"where":{"x":1,"y":2}})');
    });

    it("emits an empty-object suffix when args are omitted", () => {
      const k = selections.buildFieldSelectionKey("User:1", "profile");
      expect(k).toBe("User:1.profile({})");
    });
  });

  describe("compileSelections", () => {
    it("emits a root key for each top-level field (entity or not)", () => {
      const data = {
        user: { __typename: "User", id: "1", name: "John" },
        stats: { totalUsers: 12, totalPosts: 34 }, // non-entity root field
      };
      const compiled = selections.compileSelections({ data });
      const keys = compiled.map((c) => c.key);
      expect(keys).toContain("user({})");
      expect(keys).toContain("stats({})");
    });

    it("emits nested connection keys for entity subtrees using graph.identify()", () => {
      const data = {
        user: {
          __typename: "User",
          id: "1",
          name: "John",
          // connection-like: edges[] + pageInfo{}
          posts: {
            __typename: "PostConnection",
            edges: [
              { cursor: "c1", node: { __typename: "Post", id: "p1", title: "A" } },
              { cursor: "c2", node: { __typename: "Post", id: "p2", title: "B" } },
            ],
            pageInfo: { hasNextPage: true, endCursor: "c2" },
          },
        },
      };

      const compiled = selections.compileSelections({ data });
      const keys = compiled.map((c) => c.key);

      // root
      expect(keys).toContain("user({})");
      // nested connection under identified parent User:1
      expect(keys).toContain("User:1.posts({})");

      const postsEntry = compiled.find((c) => c.key === "User:1.posts({})")!;
      expect(postsEntry.subtree.edges.length).toBe(2);
      expect(postsEntry.subtree.pageInfo.hasNextPage).toBe(true);
    });

    it("does NOT emit keys for arbitrary nested objects that are not connections", () => {
      const data = {
        user: {
          __typename: "User",
          id: "1",
          name: "John",
          profile: { __typename: "Profile", id: "profile-1", bio: "dev" }, // not a connection (no edges/pageInfo)
        },
      };
      const compiled = selections.compileSelections({ data });
      const keys = compiled.map((c) => c.key);
      // root present
      expect(keys).toContain("user({})");
      // no connection key for profile
      expect(keys.find((k) => k.includes(".profile("))).toBeUndefined();
    });

    it("returns an empty array when data is falsy or non-object", () => {
      expect(selections.compileSelections({ data: null as any })).toEqual([]);
      expect(selections.compileSelections({ data: undefined as any })).toEqual([]);
      expect(selections.compileSelections({ data: 123 as any })).toEqual([]);
      expect(selections.compileSelections({ data: "x" as any })).toEqual([]);
    });
  });
});
