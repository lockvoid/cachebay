import { ROOT_ID } from "@/src/core/constants";
import {
  isObject,
  isDataDeepEqual,
  hasTypename,
  stableStringify,
  fingerprintNodes,
  buildFieldKey,
  buildConnectionKey,
  buildConnectionCanonicalKey,
  recycleSnapshots,
} from "@/src/core/utils";
import { operations, createTestPlan } from "@/test/helpers";

describe("Utils", () => {
  describe("isObject", () => {
    it("returns true for plain objects", () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
      expect(isObject({ __typename: "User" })).toBe(true);
    });

    it("returns true for arrays", () => {
      expect(isObject([])).toBe(true);
      expect(isObject([1, 2, 3])).toBe(true);
    });

    it("returns false for null", () => {
      expect(isObject(null)).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isObject(42)).toBe(false);
      expect(isObject("string")).toBe(false);
      expect(isObject(true)).toBe(false);
      expect(isObject(undefined)).toBe(false);
    });

    it("returns true for class instances", () => {
      class CustomClass {}
      expect(isObject(new CustomClass())).toBe(true);
      expect(isObject(new Date())).toBe(true);
    });
  });

  describe("isDataDeepEqual", () => {
    describe("primitives", () => {
      it("compares primitives with ===", () => {
        expect(isDataDeepEqual(42, 42)).toBe(true);
        expect(isDataDeepEqual("hello", "hello")).toBe(true);
        expect(isDataDeepEqual(true, true)).toBe(true);
        expect(isDataDeepEqual(null, null)).toBe(true);
        expect(isDataDeepEqual(undefined, undefined)).toBe(true);
      });

      it("returns false for different primitives", () => {
        expect(isDataDeepEqual(42, 43)).toBe(false);
        expect(isDataDeepEqual("hello", "world")).toBe(false);
        expect(isDataDeepEqual(true, false)).toBe(false);
      });

      it("treats null and undefined as different", () => {
        expect(isDataDeepEqual(null, undefined)).toBe(false);
        expect(isDataDeepEqual(undefined, null)).toBe(false);
      });

      it("returns false for different types", () => {
        expect(isDataDeepEqual(42, "42")).toBe(false);
        expect(isDataDeepEqual(0, false)).toBe(false);
        expect(isDataDeepEqual("", false)).toBe(false);
      });
    });

    describe("__ref objects", () => {
      it("compares __ref objects by reference value", () => {
        const a = { __ref: "User:1" };
        const b = { __ref: "User:1" };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different __ref values", () => {
        const a = { __ref: "User:1" };
        const b = { __ref: "User:2" };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("ignores other properties when __ref is present", () => {
        const a = { __ref: "User:1", extra: "ignored" };
        const b = { __ref: "User:1", different: "also ignored" };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });
    });

    describe("__refs arrays", () => {
      it("compares __refs arrays shallowly", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1", "User:2"] };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different __refs arrays", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1", "User:3"] };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("returns false for different __refs array lengths", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1"] };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });
    });

    describe("arrays", () => {
      it("compares arrays recursively", () => {
        expect(isDataDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(isDataDeepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
      });

      it("returns false for different array lengths", () => {
        expect(isDataDeepEqual([1, 2], [1, 2, 3])).toBe(false);
      });

      it("returns false for different array elements", () => {
        expect(isDataDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      });

      it("returns false when comparing array to non-array", () => {
        expect(isDataDeepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
      });
    });

    describe("objects", () => {
      it("compares plain objects recursively", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice", age: 30 };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different key counts", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice" };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("returns false for different values", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice", age: 31 };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("compares nested objects", () => {
        const a = { user: { name: "Alice", posts: [{ id: "p1" }] } };
        const b = { user: { name: "Alice", posts: [{ id: "p1" }] } };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });
    });

    describe("complex scenarios", () => {
      it("handles normalized cache data with __ref", () => {
        const a = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        const b = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("detects differences in nested cache data", () => {
        const a = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        const b = {
          __typename: "Query",
          user: { __ref: "User:2" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });
    });
  });

  describe("hasTypename", () => {
    it("returns true for objects with __typename string", () => {
      expect(hasTypename({ __typename: "User" })).toBe(true);
      expect(hasTypename({ __typename: "Post", id: "p1" })).toBe(true);
    });

    it("returns false for objects without __typename", () => {
      expect(hasTypename({ id: "u1" })).toBe(false);
      expect(hasTypename({})).toBe(false);
    });

    it("returns false for __typename with non-string value", () => {
      expect(hasTypename({ __typename: 123 })).toBe(false);
      expect(hasTypename({ __typename: null })).toBe(false);
      expect(hasTypename({ __typename: undefined })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(hasTypename(null)).toBe(false);
      expect(hasTypename(undefined)).toBe(false);
      expect(hasTypename(42)).toBe(false);
      expect(hasTypename("User")).toBe(false);
      expect(hasTypename([])).toBe(false);
    });
  });

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

  describe("fingerprintNodes", () => {
    it("combines base node with child fingerprints", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 300]);
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe("number");
    });

    it("produces different fingerprints for different base nodes", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(101, [200, 300]);
      expect(fp1).not.toBe(fp2);
    });

    it("produces different fingerprints for different child nodes", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 301]);
      expect(fp1).not.toBe(fp2);
    });

    it("is order-dependent", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [300, 200]);
      expect(fp1).not.toBe(fp2);
    });

    it("handles empty child array", () => {
      const fp1 = fingerprintNodes(100, []);
      const fp2 = fingerprintNodes(100, []);
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe("number");
    });

    it("handles base node of 0 for arrays", () => {
      const fp1 = fingerprintNodes(0, [100, 200, 300]);
      const fp2 = fingerprintNodes(0, [100, 200, 300]);
      expect(fp1).toBe(fp2);
    });

    it("handles large child arrays", () => {
      const children = Array.from({ length: 100 }, (_, i) => i);
      const fp1 = fingerprintNodes(42, children);
      const fp2 = fingerprintNodes(42, children);
      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprints for different array lengths", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 300, 400]);
      expect(fp1).not.toBe(fp2);
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

  describe("recycleSnapshots", () => {
    describe("basic behavior", () => {
      it("reuses prevData when fingerprints match", () => {
        const prevData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };
        const nextData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(prevData);
        expect(result).not.toBe(nextData);
      });

      it("returns nextData when fingerprints differ", () => {
        const prevData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };
        const nextData = { __typename: "User", __version: 124, id: "u1", name: "Bob" };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result).not.toBe(prevData);
      });

      it("returns same reference when prevData === nextData", () => {
        const data = { __version: 123, id: "u1", name: "Alice" };

        const result = recycleSnapshots(data, data);

        expect(result).toBe(data);
      });

      it("handles primitives and non-objects", () => {
        expect(recycleSnapshots(42, 42)).toBe(42);
        expect(recycleSnapshots("hello", "hello")).toBe("hello");
        expect(recycleSnapshots(true, false)).toBe(false);
        expect(recycleSnapshots(null, null)).toBe(null);
        expect(recycleSnapshots(undefined, undefined)).toBe(undefined);
      });

      it("does not recycle non-plain objects", () => {
        class CustomClass {
          value = 42;
        }

        const prevData = new CustomClass();
        const nextData = new CustomClass();

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result).not.toBe(prevData);
      });
    });

    describe("partial recycling", () => {
      it("recycles unchanged subtrees in objects", () => {
        const prevUser = { __typename: "User", __version: 200, id: "u1", name: "Alice" };
        const prevData = {
          __typename: "Query",
          __version: 100,
          user: prevUser,
          count: 10,
        };

        const nextUser = { __typename: "User", __version: 200, id: "u1", name: "Alice" };
        const nextData = {
          __typename: "Query",
          __version: 101,
          user: nextUser,
          count: 11,
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.user).toBe(prevUser); // Recycled!
      });

      it("recycles unchanged elements in arrays", () => {
        const prevItem1 = { __typename: "Post", __version: 100, id: "p1", title: "Post 1" };
        const prevItem2 = { __typename: "Post", __version: 200, id: "p2", title: "Post 2" };
        const prevData = [prevItem1, prevItem2];
        (prevData as any).__version = 500;

        const nextItem1 = { __typename: "Post", __version: 100, id: "p1", title: "Post 1" };
        const nextItem2 = { __typename: "Post", __version: 201, id: "p2", title: "Post 2 Updated" };
        const nextData = [nextItem1, nextItem2];
        (nextData as any).__version = 501;

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result[0]).toBe(prevItem1); // Recycled!
        expect(result[1]).toBe(nextItem2); // Not recycled
      });

      it("handles mixed arrays and objects with partial changes", () => {
        const prevUser1 = { __typename: "User", __version: 100, id: "u1", name: "Alice" };
        const prevUser2 = { __typename: "User", __version: 101, id: "u2", name: "Bob" };
        const prevUsers = [prevUser1, prevUser2];
        (prevUsers as any).__version = 200;

        const prevData = {
          __typename: "Query",
          __version: 300,
          users: prevUsers,
          metadata: { __typename: "Metadata", __version: 400, count: 2 },
        };

        const nextUser1 = { __typename: "User", __version: 100, id: "u1", name: "Alice" };
        const nextUser2 = { __typename: "User", __version: 102, id: "u2", name: "Bob Updated" };
        const nextUsers = [nextUser1, nextUser2];
        (nextUsers as any).__version = 201;

        const nextData = {
          __typename: "Query",
          __version: 301,
          users: nextUsers,
          metadata: { __typename: "Metadata", __version: 400, count: 2 },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.users[0]).toBe(prevUser1); // Recycled!
        expect(result.users[1]).toBe(nextUser2); // Not recycled
        expect(result.metadata).toBe(prevData.metadata); // Recycled!
      });

      it("recycles deep unchanged subtrees when middle level changes", () => {
        const prevLevel4 = { __version: 500, value: "deep" };
        const prevLevel3 = { __version: 400, level4: prevLevel4 };
        const prevLevel2 = { __version: 300, level3: prevLevel3 };
        const prevData = {
          __version: 100,
          level1: { __version: 200, level2: prevLevel2 },
        };

        const nextLevel4 = { __version: 500, value: "deep" };
        const nextLevel3 = { __version: 400, level4: nextLevel4 };
        const nextLevel2 = { __version: 301, level3: nextLevel3 }; // L2 changed!
        const nextData = {
          __version: 101,
          level1: { __version: 201, level2: nextLevel2 },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.level1.level2.level3).toBe(prevLevel3); // L3 recycled!
        expect(result.level1.level2.level3.level4).toBe(prevLevel4); // L4 not traversed
      });

      it("recycles unchanged edges and pageInfo in connections", () => {
        const prevEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "c1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const prevEdge2 = {
          __typename: "PostEdge",
          __version: 101,
          cursor: "c2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const prevEdges = [prevEdge1, prevEdge2];
        (prevEdges as any).__version = 300;

        const prevPageInfo = {
          __typename: "PageInfo",
          __version: 400,
          hasNextPage: true,
          endCursor: "c2",
        };

        const prevData = {
          __typename: "PostConnection",
          __version: 500,
          edges: prevEdges,
          pageInfo: prevPageInfo,
        };

        // Next data: edge2 changed
        const nextEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "c1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const nextEdge2 = {
          __typename: "PostEdge",
          __version: 102, // Changed!
          cursor: "c2",
          node: { __typename: "Post", __version: 202, id: "p2", title: "Post 2 Updated" },
        };
        const nextEdges = [nextEdge1, nextEdge2];
        (nextEdges as any).__version = 301; // Changed!

        const nextPageInfo = {
          __typename: "PageInfo",
          __version: 400, // Same
          hasNextPage: true,
          endCursor: "c2",
        };

        const nextData = {
          __typename: "PostConnection",
          __version: 501, // Changed!
          edges: nextEdges,
          pageInfo: nextPageInfo,
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.edges[0]).toBe(prevEdge1); // Recycled!
        expect(result.edges[1]).toBe(nextEdge2); // Not recycled
        expect(result.pageInfo).toBe(prevPageInfo); // Recycled!
      });

      it("recycles common prefix when array grows (pagination append)", () => {
        const prevEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "p1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const prevEdge2 = {
          __typename: "PostEdge",
          __version: 101,
          cursor: "p2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const prevEdges = [prevEdge1, prevEdge2];
        (prevEdges as any).__version = 300;

        // Next data: array grew from 2 to 4 edges (appended new page)
        const nextEdge1 = {
          __typename: "PostEdge",
          __version: 100, // Same!
          cursor: "p1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const nextEdge2 = {
          __typename: "PostEdge",
          __version: 101, // Same!
          cursor: "p2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const nextEdge3 = {
          __typename: "PostEdge",
          __version: 102,
          cursor: "p3",
          node: { __typename: "Post", __version: 202, id: "p3", title: "Post 3" },
        };
        const nextEdge4 = {
          __typename: "PostEdge",
          __version: 103,
          cursor: "p4",
          node: { __typename: "Post", __version: 203, id: "p4", title: "Post 4" },
        };
        const nextEdges = [nextEdge1, nextEdge2, nextEdge3, nextEdge4];
        (nextEdges as any).__version = 301;

        const result = recycleSnapshots(prevEdges, nextEdges);

        // Array reference should be nextEdges (different length)
        expect(result).toBe(nextEdges);
        // But first 2 edges should be recycled from prevEdges
        expect(result[0]).toBe(prevEdge1); // Recycled!
        expect(result[1]).toBe(prevEdge2); // Recycled!
        // New edges are not recycled (no previous version)
        expect(result[2]).toBe(nextEdge3);
        expect(result[3]).toBe(nextEdge4);
      });

      it("recycles elements when array is prepended", () => {
        const prevEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "p3",
          node: { __typename: "Post", __version: 200, id: "p3", title: "Post 3" },
        };
        const prevEdge2 = {
          __typename: "PostEdge",
          __version: 101,
          cursor: "p4",
          node: { __typename: "Post", __version: 201, id: "p4", title: "Post 4" },
        };
        const prevEdges = [prevEdge1, prevEdge2];
        (prevEdges as any).__version = 300;

        // Next data: prepended 2 new edges at the start
        const nextEdge1 = {
          __typename: "PostEdge",
          __version: 102,
          cursor: "p1",
          node: { __typename: "Post", __version: 202, id: "p1", title: "Post 1" },
        };
        const nextEdge2 = {
          __typename: "PostEdge",
          __version: 103,
          cursor: "p2",
          node: { __typename: "Post", __version: 203, id: "p2", title: "Post 2" },
        };
        const nextEdge3 = {
          __typename: "PostEdge",
          __version: 100, // Same as prevEdge1!
          cursor: "p3",
          node: { __typename: "Post", __version: 200, id: "p3", title: "Post 3" },
        };
        const nextEdge4 = {
          __typename: "PostEdge",
          __version: 101, // Same as prevEdge2!
          cursor: "p4",
          node: { __typename: "Post", __version: 201, id: "p4", title: "Post 4" },
        };
        const nextEdges = [nextEdge1, nextEdge2, nextEdge3, nextEdge4];
        (nextEdges as any).__version = 301;

        const result = recycleSnapshots(prevEdges, nextEdges);

        // Array reference should be nextEdges (different length)
        expect(result).toBe(nextEdges);
        // First 2 edges are new (not recycled)
        expect(result[0]).toBe(nextEdge1);
        expect(result[1]).toBe(nextEdge2);
        // Last 2 edges should be recycled from prevEdges
        expect(result[2]).toBe(prevEdge1); // Recycled!
        expect(result[3]).toBe(prevEdge2); // Recycled!
      });

      it("recycles common prefix when array shrinks", () => {
        const prevEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "p1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const prevEdge2 = {
          __typename: "PostEdge",
          __version: 101,
          cursor: "p2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const prevEdge3 = {
          __typename: "PostEdge",
          __version: 102,
          cursor: "p3",
          node: { __typename: "Post", __version: 202, id: "p3", title: "Post 3" },
        };
        const prevEdges = [prevEdge1, prevEdge2, prevEdge3];
        (prevEdges as any).__version = 300;

        // Next data: array shrunk from 3 to 2 edges
        const nextEdge1 = {
          __typename: "PostEdge",
          __version: 100, // Same!
          cursor: "p1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const nextEdge2 = {
          __typename: "PostEdge",
          __version: 101, // Same!
          cursor: "p2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const nextEdges = [nextEdge1, nextEdge2];
        (nextEdges as any).__version = 301;

        const result = recycleSnapshots(prevEdges, nextEdges);

        // Array reference should be nextEdges (different length)
        expect(result).toBe(nextEdges);
        // But first 2 edges should be recycled from prevEdges
        expect(result[0]).toBe(prevEdge1); // Recycled!
        expect(result[1]).toBe(prevEdge2); // Recycled!
      });

      it("recycles unchanged posts in nested connections", () => {
        const prevComment1 = {
          __typename: "Comment",
          __version: 100,
          id: "c1",
          text: "Comment 1",
        };
        const prevCommentEdges = [prevComment1];
        (prevCommentEdges as any).__version = 200;

        const prevPost1 = {
          __typename: "Post",
          __version: 300,
          id: "p1",
          title: "Post 1",
          comments: {
            __typename: "CommentConnection",
            __version: 400,
            edges: prevCommentEdges,
          },
        };

        const prevPost2 = {
          __typename: "Post",
          __version: 350,
          id: "p2",
          title: "Post 2",
          comments: {
            __typename: "CommentConnection",
            __version: 450,
            edges: [],
          },
        };

        const prevPostEdges = [prevPost1, prevPost2];
        (prevPostEdges as any).__version = 500;

        const prevData = {
          __typename: "Query",
          __version: 600,
          user: {
            __typename: "User",
            __version: 700,
            id: "u1",
            posts: {
              __typename: "PostConnection",
              __version: 800,
              edges: prevPostEdges,
            },
          },
        };

        // Next data: comment in post1 changed
        const nextComment1 = {
          __typename: "Comment",
          __version: 101, // Changed!
          id: "c1",
          text: "Comment 1 Updated",
        };
        const nextCommentEdges = [nextComment1];
        (nextCommentEdges as any).__version = 201; // Changed!

        const nextPost1 = {
          __typename: "Post",
          __version: 301, // Changed!
          id: "p1",
          title: "Post 1",
          comments: {
            __typename: "CommentConnection",
            __version: 401, // Changed!
            edges: nextCommentEdges,
          },
        };

        const nextPost2 = {
          __typename: "Post",
          __version: 350, // Same!
          id: "p2",
          title: "Post 2",
          comments: {
            __typename: "CommentConnection",
            __version: 450,
            edges: [],
          },
        };

        const nextPostEdges = [nextPost1, nextPost2];
        (nextPostEdges as any).__version = 501; // Changed!

        const nextData = {
          __typename: "Query",
          __version: 601, // Changed!
          user: {
            __typename: "User",
            __version: 701, // Changed!
            id: "u1",
            posts: {
              __typename: "PostConnection",
              __version: 801, // Changed!
              edges: nextPostEdges,
            },
          },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.user.posts.edges[1]).toBe(prevPost2); // Post2 recycled!
      });
    });
  });
});
