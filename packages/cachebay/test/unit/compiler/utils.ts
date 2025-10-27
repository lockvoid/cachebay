import {
  stableStringify,
  buildFieldKey,
  buildConnectionKey,
  buildConnectionCanonicalKey,
} from "@/src/compiler/utils";
import { operations, createTestPlan } from "@/test/helpers";

describe("Utils", () => {
  describe("stableStringify", () => {
    it("produces stable output for objects with different key order", () => {
      const a = { b: 2, a: 1, c: 3 };
      const b = { c: 3, a: 1, b: 2 };
      expect(stableStringify(a)).toBe(stableStringify(b));
      expect(stableStringify(a)).toBe('{"a":1,"b":2,"c":3}');
    });

    it("handles nested objects", () => {
      const obj = { z: { y: 2, x: 1 }, a: 1 };
      expect(stableStringify(obj)).toBe('{"a":1,"z":{"x":1,"y":2}}');
    });

    it("handles arrays", () => {
      const obj = { items: [3, 1, 2], name: "test" };
      expect(stableStringify(obj)).toBe('{"items":[3,1,2],"name":"test"}');
    });

    it("handles primitives", () => {
      expect(stableStringify(42)).toBe("42");
      expect(stableStringify("hello")).toBe('"hello"');
      expect(stableStringify(true)).toBe("true");
      expect(stableStringify(null)).toBe("null");
    });

    it("returns empty string for circular references", () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      expect(stableStringify(obj)).toBe("");
    });

    it("handles complex nested structures", () => {
      const obj = {
        filters: { category: "tech", sort: "hot" },
        pagination: { first: 10, after: null },
      };
      const result = stableStringify(obj);
      expect(result).toBe('{"filters":{"category":"tech","sort":"hot"},"pagination":{"after":null,"first":10}}');
    });
  });

  describe("buildFieldKey", () => {
    it("uses field.stringifyArgs with raw variables mapped to field argument names", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key = buildFieldKey(posts, { category: "tech", first: 2, after: null });
      // Order is from plan's expectedArgNames, not alphabetical
      expect(key).toBe("posts({\"category\":\"tech\",\"first\":2,\"after\":null})");
    });

    it("returns bare field name when the field has no args (e.g., author)", () => {
      const plan = createTestPlan(operations.USER_POSTS_COMMENTS_QUERY);

      const user = plan.rootSelectionMap!.get("user")!;
      const posts = user.selectionMap!.get("posts")!;
      const postEdges = posts.selectionMap!.get("edges")!;
      const pNode = postEdges.selectionMap!.get("node")!;
      const comments = pNode.selectionMap!.get("comments")!;
      const commentEdges = comments.selectionMap!.get("edges")!;
      const commentNode = commentEdges.selectionMap!.get("node")!;
      const author = commentNode.selectionMap!.get("author")!;

      const key = buildFieldKey(author, {});
      expect(key).toBe("author");
    });

    it("returns bare field name when all args are missing/undefined (stringifyArgs → '{}')", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key1 = buildFieldKey(posts, {});
      expect(key1).toBe("posts");

      const key2 = buildFieldKey(posts, { category: undefined, sort: undefined, first: undefined, after: undefined, last: undefined, before: undefined });
      expect(key2).toBe("posts");
    });

    it("ignores unrelated variables and only serializes declared args", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key = buildFieldKey(posts, { category: "tech", unrelated: "ignored" } as any);
      expect(key).toBe('posts({"category":"tech"})');
    });
  });

  describe("buildConnectionKey", () => {
    it("builds concrete page key for root parent", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      // Order is from plan's expectedArgNames
      expect(postsKey).toBe("@.posts({\"category\":\"tech\",\"first\":2,\"after\":null})");
    });

    it("builds concrete page key for nested parent", () => {
      const plan = createTestPlan(operations.USER_POSTS_QUERY);
      const user = plan.rootSelectionMap!.get("user")!;
      const posts = user.selectionMap!.get("posts")!;

      const userPostsKey = buildConnectionKey(posts, "User:u1", { id: "u1", postsFirst: 1, postsAfter: "p2" });
      // Order is from plan's expectedArgNames
      expect(userPostsKey).toBe("@.User:u1.posts({\"first\":1,\"after\":\"p2\"})");
    });
  });

  describe("buildConnectionCanonicalKey", () => {
    it("respects filters and uses directive key under @connection", () => {
      const plan = createTestPlan(operations.POSTS_WITH_KEY_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      expect(postsKey).toBe("@connection.KeyedPosts({\"category\":\"tech\"})");

      const userPostsKey = buildConnectionCanonicalKey(posts, "User:u1", { category: "tech", first: 2, after: "p2" });
      expect(userPostsKey).toBe("@connection.User:u1.KeyedPosts({\"category\":\"tech\"})");
    });

    it("defaults filters to all non-pagination args when filters omitted", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      expect(postsKey).toBe("@connection.posts({\"category\":\"tech\"})");
    });

    it("produces stable stringify identity regardless of variable order", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const keyA = buildConnectionCanonicalKey(posts, ROOT_ID, {
        category: "tech",
        first: 2,
        after: null,
      });
      const keyB = buildConnectionCanonicalKey(posts, ROOT_ID, {
        category: "tech",
        after: null,
        first: 2,
      });

      expect(keyA).toBe(keyB);
      expect(keyA).toBe("@connection.posts({\"category\":\"tech\"})");
    });

    it("filters out pagination fields even when explicitly included in connectionFilters", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      // Simulate a field where connectionFilters mistakenly includes pagination fields
      // This could happen if someone writes: @connection(filters: ["category", "first"])
      const postsWithBadFilters = {
        ...posts,
        connectionFilters: ["category", "first", "after", "sort"], // Includes pagination fields!
      };

      const key = buildConnectionCanonicalKey(postsWithBadFilters, ROOT_ID, {
        category: "tech",
        sort: "hot",
        first: 10,
        after: "cursor1",
      });

      // Should only include non-pagination fields (category, sort)
      // Pagination fields (first, after) should be filtered out
      expect(key).toBe("@connection.posts({\"category\":\"tech\",\"sort\":\"hot\"})");
      expect(key).not.toContain("first");
      expect(key).not.toContain("after");
    });
  });
});
