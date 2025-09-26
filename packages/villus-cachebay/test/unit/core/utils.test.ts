import { traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, TRAVERSE_SKIP, isObject } from '@/src/core/utils';
import { ROOT_ID } from "@/src/core/constants";
import { TEST_QUERIES, createTestPlan } from "@/test/helpers/unit";

describe('Utils', () => {
  describe('traverseFast', () => {
    let visitedNodes: Array<{ parentNode: any; valueNode: any; fieldKey: string | number | null; frameContext: any }>;
    let visitMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      visitedNodes = [];

      visitMock = vi.fn((parentNode, valueNode, fieldKey, frameContext) => {
        visitedNodes.push({ parentNode, valueNode, fieldKey, frameContext });
      });
    });

    it('traverses a simple object', () => {
      traverseFast({ a: { value: 1 }, b: { value: 2 } }, { initial: true }, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(3);
      expect(visitMock).toHaveBeenCalledWith(null, { a: { value: 1 }, b: { value: 2 } }, null, { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 1 }, 'a', { initial: true });
      expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 2 }, 'b', { initial: true });
    });

    it('traverses nested objects', () => {
      traverseFast({ level1: { level2: { level3: { value: 'deep' } } } }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(4);
      expect(visitedNodes[0]).toEqual({ parentNode: null, valueNode: { level1: { level2: { level3: { value: 'deep' } } } }, fieldKey: null, frameContext: {} });
      expect(visitedNodes[1].fieldKey).toBe('level1');
      expect(visitedNodes[2].fieldKey).toBe('level2');
      expect(visitedNodes[3].fieldKey).toBe('level3');
    });

    it('traverses arrays', () => {
      traverseFast([{ id: 1 }, { id: 2 }, { id: 3 }], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(4);
      expect(visitMock).toHaveBeenCalledWith(null, [{ id: 1 }, { id: 2 }, { id: 3 }], null, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 1 }, 0, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 2 }, 1, {});
      expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 3 }, 2, {});
    });

    it('traverses mixed objects and arrays', () => {
      traverseFast({ items: [{ name: 'Item1', details: { color: 'black' } }, { name: 'Item2', details: { color: 'white' } }] }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(6);

      const arrayNode = visitedNodes.find(v => Array.isArray(v.valueNode));
      expect(arrayNode).toBeDefined();
      expect(arrayNode?.fieldKey).toBe('items');
    });

    it('skips non-object primitives in objects', () => {
      traverseFast({ string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(2);
      expect(visitMock).toHaveBeenCalledWith(null, { string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, null, {});
      expect(visitMock).toHaveBeenCalledWith({ string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, { nested: true }, 'object', {});
    });

    it('skips non-object primitives in arrays', () => {
      traverseFast(['string', 42, true, null, { id: 1 }], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(2);
      expect(visitMock).toHaveBeenCalledWith(null, ['string', 42, true, null, { id: 1 }], null, {});
      expect(visitMock).toHaveBeenCalledWith(['string', 42, true, null, { id: 1 }], { id: 1 }, 4, {});
    });

    it('handles TRAVERSE_SKIP for objects', () => {
      const skipVisit = vi.fn((parentNode, valueNode, fieldKey) => {
        if (fieldKey === 'skipMe') {
          return TRAVERSE_SKIP;
        }
      });

      traverseFast({ skipMe: { child: { value: 'should not visit' } }, visitMe: { child: { value: 'should visit' } } }, {}, skipVisit);

      expect(skipVisit).toHaveBeenCalledTimes(4);
      expect(skipVisit).toHaveBeenCalledWith(null, { skipMe: { child: { value: 'should not visit' } }, visitMe: { child: { value: 'should visit' } } }, null, {});
      expect(skipVisit).toHaveBeenCalledWith({ skipMe: { child: { value: 'should not visit' } }, visitMe: { child: { value: 'should visit' } } }, { child: { value: 'should not visit' } }, 'skipMe', {});
      expect(skipVisit).toHaveBeenCalledWith({ skipMe: { child: { value: 'should not visit' } }, visitMe: { child: { value: 'should visit' } } }, { child: { value: 'should visit' } }, 'visitMe', {});
      expect(skipVisit).toHaveBeenCalledWith({ child: { value: 'should visit' } }, { value: 'should visit' }, 'child', {});

      expect(skipVisit).not.toHaveBeenCalledWith({ child: { value: 'should not visit' } }, { value: 'should not visit' }, 'child', {});
    });

    it('respects TRAVERSE_SKIP for arrays', () => {
      const skipVisit = vi.fn((parentNode, valueNode) => {
        if (Array.isArray(valueNode)) {
          return TRAVERSE_SKIP;
        }
      });

      traverseFast([{ id: 1, children: [{ nested: true }] }, { id: 2 }], {}, skipVisit);

      expect(skipVisit).toHaveBeenCalledTimes(1);
      expect(skipVisit).toHaveBeenCalledWith(null, [{ id: 1, children: [{ nested: true }] }, { id: 2 }], null, {});
    });

    it('updates context when visitor returns new context', () => {
      const contextVisit = vi.fn((parentNode, valueNode, fieldKey, frameContext) => {
        if (fieldKey === 'a') {
          return { count: frameContext.count + 1 }
        };
      });

      traverseFast({ a: { b: { value: 1 } } }, { count: 0 }, contextVisit);

      expect(contextVisit).toHaveBeenCalledTimes(3);
      expect(contextVisit).toHaveBeenNthCalledWith(1, null, { a: { b: { value: 1 } } }, null, { count: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(2, { a: { b: { value: 1 } } }, { b: { value: 1 } }, 'a', { count: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(3, { b: { value: 1 } }, { value: 1 }, 'b', { count: 1 });
    });

    it('passes updated context to nested objects', () => {
      const contextVisit = vi.fn((parentNode, valueNode, fieldKey, frameContext) => {
        return { level: frameContext.level + 1 };
      });

      traverseFast({ parent: { child: {} } }, { level: 0 }, contextVisit);

      expect(contextVisit).toHaveBeenCalledTimes(3);
      expect(contextVisit).toHaveBeenNthCalledWith(1, null, { parent: { child: {} } }, null, { level: 0 });
      expect(contextVisit).toHaveBeenNthCalledWith(2, { parent: { child: {} } }, { child: {} }, 'parent', { level: 1 });
      expect(contextVisit).toHaveBeenNthCalledWith(3, { child: {} }, {}, 'child', { level: 2 });
    });

    it('handles empty objects', () => {
      traverseFast({}, {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, {}, null, {});
    });

    it('handles empty arrays', () => {
      traverseFast([], {}, visitMock);

      expect(visitMock).toHaveBeenCalledTimes(1);
      expect(visitMock).toHaveBeenCalledWith(null, [], null, {});
    });

    it('handles null root', () => {
      traverseFast(null, {}, visitMock);

      expect(visitMock).not.toHaveBeenCalled();
    });

    it('handles undefined root', () => {
      traverseFast(undefined, {}, visitMock);

      expect(visitMock).not.toHaveBeenCalled();
    });

    it('handles primitive root values', () => {
      traverseFast('string', {}, visitMock);

      expect(visitMock).not.toHaveBeenCalled();

      visitMock.mockClear();

      traverseFast(42, {}, visitMock);
      expect(visitMock).not.toHaveBeenCalled();

      visitMock.mockClear();

      traverseFast(true, {}, visitMock);
      expect(visitMock).not.toHaveBeenCalled();
    });

    it('maintains correct parent-child relationships', () => {
      const root = { parent1: { child1: {}, child2: {} }, parent2: { child3: {} } };

      traverseFast(root, {}, visitMock);

      const parent1Visits = visitedNodes.filter(v => v.parentNode === root.parent1);

      expect(parent1Visits).toHaveLength(2);
      expect(parent1Visits[0].fieldKey).toBe('child2');
      expect(parent1Visits[1].fieldKey).toBe('child1');

      const parent2Visits = visitedNodes.filter(v => v.parentNode === root.parent2);

      expect(parent2Visits).toHaveLength(1);
      expect(parent2Visits[0].fieldKey).toBe('child3');
    });

    it('visits nodes in stack order for objects', () => {
      traverseFast({ first: {}, second: {}, third: {} }, {}, visitMock);

      const keys = visitedNodes.map(v => v.fieldKey).filter(k => k !== null);
      expect(keys).toEqual(['third', 'second', 'first']);
    });

    it('visits array elements in correct order', () => {
      traverseFast([{ index: 0 }, { index: 1 }, { index: 2 }], {}, visitMock);

      const indices = visitedNodes.filter(v => typeof v.fieldKey === 'number').map(v => v.fieldKey);
      expect(indices).toEqual([0, 1, 2]);
    });
  });

  describe("buildFieldKey", () => {
    it("uses field.stringifyArgs with raw variables mapped to field argument names", () => {
      const plan = createTestPlan(TEST_QUERIES.POSTS_WITH_CONNECTION);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildFieldKey(posts, { postsCategory: "tech", postsFirst: 2, postsAfter: null, });
      expect(postsKey).toBe(`posts({"after":null,"category":"tech","first":2})`);
    });
  });

  describe("buildConnectionKey", () => {
    it("builds concrete page key for root parent", () => {
      const plan = createTestPlan(TEST_QUERIES.POSTS_SIMPLE);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionKey(posts, ROOT_ID, { first: 2, after: null });
      expect(postsKey).toBe(`@.posts({"after":null,"first":2})`);
    });

    it("builds concrete page key for nested parent", () => {
      const plan = createTestPlan(TEST_QUERIES.USER_POSTS_NESTED);
      const user = plan.rootSelectionMap!.get("user")!;
      const posts = user.selectionMap!.get("posts")!;

      const userPostsKey = buildConnectionKey(posts, "User:u1", { id: "u1", first: 1, after: "p2" });
      expect(userPostsKey).toBe(`@.User:u1.posts({"after":"p2","first":1})`);
    });
  });

  describe("buildConnectionCanonicalKey", () => {
    it("respects filters and uses directive key under @connection", () => {
      const plan = createTestPlan(TEST_QUERIES.POSTS_WITH_KEY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { cat: "tech", first: 2, after: null });
      expect(postsKey).toBe(`@connection.PostsList({"category":"tech"})`);

      const userPostsKey = buildConnectionCanonicalKey(posts, "User:u1", { cat: "tech", first: 2, after: "p2" });
      expect(userPostsKey).toBe(`@connection.User:u1.PostsList({"category":"tech"})`);
    });

    it("defaults filters to all non-pagination args when filters omitted", () => {
      const plan = createTestPlan(TEST_QUERIES.POSTS_WITH_FILTERS);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { category: "tech", first: 2, sort: "hot", after: null });
      expect(postsKey).toBe(`@connection.posts({"category":"tech","sort":"hot"})`);
    });

    it("produces stable stringify identity regardless of variable order", () => {
      const plan = createTestPlan(TEST_QUERIES.POSTS_WITH_FILTERS);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const keyA = buildConnectionCanonicalKey(posts, ROOT_ID, {
        sort: "hot",
        category: "tech",
        first: 2,
        after: null,
      });
      const keyB = buildConnectionCanonicalKey(posts, ROOT_ID, {
        category: "tech",
        after: null,
        sort: "hot",
        first: 2,
      });

      expect(keyA).toBe(keyB);
      expect(keyA).toBe(`@connection.posts({"category":"tech","sort":"hot"})`);
    });
  });
});
