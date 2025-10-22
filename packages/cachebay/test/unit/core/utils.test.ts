import { ROOT_ID } from "@/src/core/constants";
import { LRU, traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, TRAVERSE_SKIP, TRAVERSE_SCALAR, TRAVERSE_ARRAY, TRAVERSE_OBJECT, isObject } from "@/src/core/utils";
import { operations, createTestPlan } from "@/test/helpers";

describe("Utils", () => {
  describe("LRU", () => {
    it("stores and retrieves values", () => {
      const lru = new LRU<string, number>(3);
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      expect(lru.get("a")).toBe(1);
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
      expect(lru.size).toBe(3);
    });

    it("evicts oldest item when capacity exceeded", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.set("d", 4); // Should evict "a"
      
      expect(lru.get("a")).toBeUndefined();
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
      expect(lru.size).toBe(3);
      expect(evicted).toEqual([["a", 1]]);
    });

    it("moves accessed items to end (most recent)", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      // Access "a" to make it most recent
      lru.get("a");
      
      // Add "d" - should evict "b" (oldest), not "a"
      lru.set("d", 4);
      
      expect(lru.get("a")).toBe(1);
      expect(lru.get("b")).toBeUndefined();
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
      expect(evicted).toEqual([["b", 2]]);
    });

    it("updates existing keys without eviction", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.set("a", 10); // Update "a"
      
      expect(lru.get("a")).toBe(10);
      expect(lru.size).toBe(3);
      expect(evicted).toEqual([]);
    });

    it("clears all items and calls onEvict for each", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      lru.clear();
      
      expect(lru.size).toBe(0);
      expect(lru.get("a")).toBeUndefined();
      expect(evicted).toHaveLength(3);
      expect(evicted).toContainEqual(["a", 1]);
      expect(evicted).toContainEqual(["b", 2]);
      expect(evicted).toContainEqual(["c", 3]);
    });

    it("handles capacity of 1", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(1, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      expect(lru.size).toBe(1);
      
      lru.set("b", 2);
      expect(lru.size).toBe(1);
      expect(lru.get("a")).toBeUndefined();
      expect(lru.get("b")).toBe(2);
      expect(evicted).toEqual([["a", 1]]);
    });
  });

  describe("traverseFast", () => {
    let visitedNodes: Array<{ parentNode: any; valueNode: any; fieldKey: string | number | null; kind: any; frameContext: any }>;
    let visitMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      visitedNodes = [];

      visitMock = vi.fn((parentNode, valueNode, fieldKey, kind, frameContext) => {
        visitedNodes.push({ parentNode, valueNode, fieldKey, kind, frameContext });
      });
    });

    it("traverses a simple object", () => {
      traverseFast({ a: { value: 1 }, b: { value: 2 } }, { initial: true }, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(5);
      expect(visitMock).toHaveBeenCalledWith(null, { a: { value: 1 }, b: { value: 2 } }, null, TRAVERSE_OBJECT, { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 1 }, "a", TRAVERSE_OBJECT, { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ value: 1 }, 1, "value", TRAVERSE_SCALAR, { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 2 }, "b", TRAVERSE_OBJECT, { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ value: 2 }, 2, "value", TRAVERSE_SCALAR, { initial: true });
    });

    it("traverses nested objects", () => {
      traverseFast({ level1: { level2: { level3: { value: "deep" } } } }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(5);
      expect(visitedNodes[0]).toEqual({
        parentNode: null,
        valueNode: { level1: { level2: { level3: { value: "deep" } } } },
        fieldKey: null,
        kind: TRAVERSE_OBJECT,
        frameContext: {},
      });
      expect(visitedNodes[1].fieldKey).toBe("level1");
      expect(visitedNodes[2].fieldKey).toBe("level2");
      expect(visitedNodes[3].fieldKey).toBe("level3");
      expect(visitedNodes[4].fieldKey).toBe("value");
      expect(visitedNodes[4].kind).toBe(TRAVERSE_SCALAR);
    });

    it("traverses arrays", () => {
      traverseFast([{ id: 1 }, { id: 2 }, { id: 3 }], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(7);
      expect(visitMock).toHaveBeenCalledWith(null, [{ id: 1 }, { id: 2 }, { id: 3 }], null, TRAVERSE_ARRAY, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 1 }, 0, TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ id: 1 }, 1, "id", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 2 }, 1, TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ id: 2 }, 2, "id", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 3 }, 2, TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ id: 3 }, 3, "id", TRAVERSE_SCALAR, {});
    });

    it("traverses mixed objects and arrays", () => {
      traverseFast({ items: [{ name: "Item1", details: { color: "black" } }, { name: "Item2", details: { color: "white" } }] }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(10);

      const arrayNode = visitedNodes.find(v => Array.isArray(v.valueNode));
      expect(arrayNode).toBeDefined();
      expect(arrayNode?.fieldKey).toBe("items");
      expect(arrayNode?.kind).toBe(TRAVERSE_ARRAY);
    });

    it("visits primitives in objects with TRAVERSE_SCALAR", () => {
      traverseFast({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(7);
      expect(visitMock).toHaveBeenCalledWith(null, { string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, null, TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, "string", "string", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, 42, "number", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, true, "boolean", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, null, "null", TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith({ string: "string", number: 42, boolean: true, null: null, object: { nested: true } }, { nested: true }, "object", TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ nested: true }, true, "nested", TRAVERSE_SCALAR, {});
    });

    it("visits primitives in arrays with TRAVERSE_SCALAR", () => {
      traverseFast(["string", 42, true, null, { id: 1 }], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(7);
      expect(visitMock).toHaveBeenCalledWith(null, ["string", 42, true, null, { id: 1 }], null, TRAVERSE_ARRAY, {});
      expect(visitMock).toHaveBeenCalledWith(["string", 42, true, null, { id: 1 }], "string", 0, TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith(["string", 42, true, null, { id: 1 }], 42, 1, TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith(["string", 42, true, null, { id: 1 }], true, 2, TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith(["string", 42, true, null, { id: 1 }], null, 3, TRAVERSE_SCALAR, {});
      expect(visitMock).toHaveBeenCalledWith(["string", 42, true, null, { id: 1 }], { id: 1 }, 4, TRAVERSE_OBJECT, {});
      expect(visitMock).toHaveBeenCalledWith({ id: 1 }, 1, "id", TRAVERSE_SCALAR, {});
    });

    it("handles TRAVERSE_SKIP for objects", () => {
      const skipVisit = vi.fn((parentNode, valueNode, fieldKey, kind) => {
        if (fieldKey === "skipMe") {
          return TRAVERSE_SKIP;
        }
      });

      traverseFast({ skipMe: { child: { value: "should not visit" } }, visitMe: { child: { value: "should visit" } } }, {}, skipVisit);

      expect(skipVisit).toHaveBeenCalledTimes(5);
      expect(skipVisit).toHaveBeenCalledWith(null, { skipMe: { child: { value: "should not visit" } }, visitMe: { child: { value: "should visit" } } }, null, TRAVERSE_OBJECT, {});
      expect(skipVisit).toHaveBeenCalledWith({ skipMe: { child: { value: "should not visit" } }, visitMe: { child: { value: "should visit" } } }, { child: { value: "should not visit" } }, "skipMe", TRAVERSE_OBJECT, {});
      expect(skipVisit).toHaveBeenCalledWith({ skipMe: { child: { value: "should not visit" } }, visitMe: { child: { value: "should visit" } } }, { child: { value: "should visit" } }, "visitMe", TRAVERSE_OBJECT, {});
      expect(skipVisit).toHaveBeenCalledWith({ child: { value: "should visit" } }, { value: "should visit" }, "child", TRAVERSE_OBJECT, {});
      expect(skipVisit).toHaveBeenCalledWith({ value: "should visit" }, "should visit", "value", TRAVERSE_SCALAR, {});

      expect(skipVisit).not.toHaveBeenCalledWith({ child: { value: "should not visit" } }, { value: "should not visit" }, "child", TRAVERSE_OBJECT, {});
    });

    it("respects TRAVERSE_SKIP for arrays", () => {
      const skipVisit = vi.fn((parentNode, valueNode, fieldKey, kind) => {
        if (Array.isArray(valueNode)) {
          return TRAVERSE_SKIP;
        }
      });

      traverseFast([{ id: 1, children: [{ nested: true }] }, { id: 2 }], {}, skipVisit);

      expect(skipVisit).toHaveBeenCalledTimes(1);
      expect(skipVisit).toHaveBeenCalledWith(null, [{ id: 1, children: [{ nested: true }] }, { id: 2 }], null, TRAVERSE_ARRAY, {});
    });

    it("updates context when visitor returns new context", () => {
      const contextVisit = vi.fn((parentNode, valueNode, fieldKey, kind, frameContext) => {
        if (fieldKey === "a") {
          return { count: frameContext.count + 1 };
        }
      });

      traverseFast({ a: { b: { value: 1 } } }, { count: 0 }, contextVisit);

      expect(contextVisit).toHaveBeenCalledTimes(4);
      expect(contextVisit).toHaveBeenNthCalledWith(1, null, { a: { b: { value: 1 } } }, null, TRAVERSE_OBJECT, { count: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(2, { a: { b: { value: 1 } } }, { b: { value: 1 } }, "a", TRAVERSE_OBJECT, { count: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(3, { b: { value: 1 } }, { value: 1 }, "b", TRAVERSE_OBJECT, { count: 1 });
      expect(contextVisit).toHaveBeenNthCalledWith(4, { value: 1 }, 1, "value", TRAVERSE_SCALAR, { count: 1 });
    });

    it("passes updated context to nested objects", () => {
      const contextVisit = vi.fn((parentNode, valueNode, fieldKey, kind, frameContext) => {
        return { level: frameContext.level + 1 };
      });

      traverseFast({ parent: { child: {} } }, { level: 0 }, contextVisit);

      expect(contextVisit).toHaveBeenCalledTimes(3);
      expect(contextVisit).toHaveBeenNthCalledWith(1, null, { parent: { child: {} } }, null, TRAVERSE_OBJECT, { level: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(2, { parent: { child: {} } }, { child: {} }, "parent", TRAVERSE_OBJECT, { level: 1 });
      expect(contextVisit).toHaveBeenNthCalledWith(3, { child: {} }, {}, "child", TRAVERSE_OBJECT, { level: 2 });
    });

    it("handles empty objects", () => {
      traverseFast({}, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, {}, null, TRAVERSE_OBJECT, {});
    });

    it("handles empty arrays", () => {
      traverseFast([], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, [], null, TRAVERSE_ARRAY, {});
    });

    it("handles null root", () => {
      traverseFast(null, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, null, null, TRAVERSE_SCALAR, {});
    });

    it("handles undefined root", () => {
      traverseFast(undefined, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, undefined, null, TRAVERSE_SCALAR, {});
    });

    it("handles primitive root values", () => {
      traverseFast("string", {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, "string", null, TRAVERSE_SCALAR, {});

      visitMock.mockClear();

      traverseFast(42, {}, visitMock);
      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, 42, null, TRAVERSE_SCALAR, {});

      visitMock.mockClear();

      traverseFast(true, {}, visitMock);
      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, true, null, TRAVERSE_SCALAR, {});
    });

    it("maintains correct parent-child relationships", () => {
      const root = { parent1: { child1: {}, child2: {} }, parent2: { child3: {} } };

      traverseFast(root, {}, visitMock);

      const parent1Visits = visitedNodes.filter(v => v.parentNode === root.parent1);

      expect(parent1Visits).toHaveLength(2);
      // Stack-based traversal visits in reverse order
      expect(parent1Visits[0].fieldKey).toBe("child2");
      expect(parent1Visits[1].fieldKey).toBe("child1");

      const parent2Visits = visitedNodes.filter(v => v.parentNode === root.parent2);

      expect(parent2Visits).toHaveLength(1);
      expect(parent2Visits[0].fieldKey).toBe("child3");
    });

    it("visits nodes in stack order for objects", () => {
      traverseFast({ first: {}, second: {}, third: {} }, {}, visitMock);

      const keys = visitedNodes.map(v => v.fieldKey).filter(k => k !== null);
      // Stack-based traversal processes object keys in reverse order
      expect(keys).toEqual(["third", "second", "first"]);
    });

    it("visits array elements in correct order", () => {
      traverseFast([{ index: 0 }, { index: 1 }, { index: 2 }], {}, visitMock);

      const indices = visitedNodes.filter(v => typeof v.fieldKey === "number" && v.kind === TRAVERSE_OBJECT).map(v => v.fieldKey);
      expect(indices).toEqual([0, 1, 2]);
    });

    it("correctly identifies node kinds", () => {
      traverseFast({ obj: { nested: 1 }, arr: [1, 2], scalar: "test" }, {}, visitMock);

      const objectNodes = visitedNodes.filter(v => v.kind === TRAVERSE_OBJECT);
      const arrayNodes = visitedNodes.filter(v => v.kind === TRAVERSE_ARRAY);
      const scalarNodes = visitedNodes.filter(v => v.kind === TRAVERSE_SCALAR);

      expect(objectNodes.length).toBeGreaterThan(0);
      expect(arrayNodes.length).toBeGreaterThan(0);
      expect(scalarNodes.length).toBeGreaterThan(0);
    });

    it("handles deeply nested structures", () => {
      const deep = { a: { b: { c: { d: { e: { value: "deep" } } } } } };

      traverseFast(deep, {}, visitMock);

      const depthLevels = visitedNodes.filter(v => v.kind === TRAVERSE_OBJECT).length;
      expect(depthLevels).toBe(6); // root + a + b + c + d + e
    });

    it("handles mixed array and object nesting", () => {
      const mixed = { users: [{ name: "Alice", tags: ["admin", "user"] }, { name: "Bob", tags: ["user"] }] };

      traverseFast(mixed, {}, visitMock);

      const arrayKinds = visitedNodes.filter(v => v.kind === TRAVERSE_ARRAY);
      const objectKinds = visitedNodes.filter(v => v.kind === TRAVERSE_OBJECT);
      const scalarKinds = visitedNodes.filter(v => v.kind === TRAVERSE_SCALAR);

      expect(arrayKinds.length).toBe(3); // users array + 2 tags arrays
      expect(objectKinds.length).toBeGreaterThan(0);
      expect(scalarKinds.length).toBeGreaterThan(0);
    });

    it("context propagates through TRAVERSE_SKIP", () => {
      const contextVisit = vi.fn((parentNode, valueNode, fieldKey, kind, frameContext) => {
        if (fieldKey === null) {
          return { counter: 1 };
        }
        if (fieldKey === "skip") {
          return TRAVERSE_SKIP;
        }
        return { counter: frameContext.counter + 1 };
      });

      traverseFast({ skip: { nested: {} }, visit: { nested: {} } }, {}, contextVisit);

      const visitedContexts = contextVisit.mock.calls.map(call => call[4]);
      const maxCounter = Math.max(...visitedContexts.map(ctx => ctx.counter || 0));

      expect(maxCounter).toBeGreaterThan(1);
    });

    it("handles arrays with only primitive values in reverse order due to stack", () => {
      traverseFast([1, 2, 3, "four", true], {}, visitMock);

      const scalarCalls = visitedNodes.filter(v => v.kind === TRAVERSE_SCALAR);
      expect(scalarCalls).toHaveLength(5);
      expect(scalarCalls.map(v => v.valueNode)).toEqual([true, "four", 3, 2, 1]);
    });

    it("handles objects with only primitive values", () => {
      traverseFast({ a: 1, b: "two", c: true, d: null }, {}, visitMock);

      const scalarCalls = visitedNodes.filter(v => v.kind === TRAVERSE_SCALAR);
      expect(scalarCalls).toHaveLength(4);
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
  });
});
