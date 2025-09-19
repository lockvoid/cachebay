import { traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, TRAVERSE_SKIP, isObject } from '@/src/core/utils';
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler/compile";
import { ROOT_ID } from "@/src/core/constants";

describe('traverseFast', () => {
  let visitMock: ReturnType<typeof vi.fn>;
  let visitedNodes: Array<{ parentNode: any; valueNode: any; fieldKey: string | number | null; frameContext: any }>;

  beforeEach(() => {
    visitMock = vi.fn((parentNode, valueNode, fieldKey, frameContext) => {
      visitedNodes.push({ parentNode, valueNode, fieldKey, frameContext });
    });

    visitedNodes = [];
  });

  it('should traverse a simple object', () => {
    traverseFast({ a: { value: 1 }, b: { value: 2 } }, { initial: true }, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(3);
    expect(visitMock).toHaveBeenCalledWith(null, { a: { value: 1 }, b: { value: 2 } }, null, { initial: true });
    expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 1 }, 'a', { initial: true });
    expect(visitMock).toHaveBeenCalledWith({ a: { value: 1 }, b: { value: 2 } }, { value: 2 }, 'b', { initial: true });
  });

  it('should traverse nested objects', () => {
    traverseFast({ level1: { level2: { level3: { value: 'deep' } } } }, {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(4);
    expect(visitedNodes[0]).toEqual({ parentNode: null, valueNode: { level1: { level2: { level3: { value: 'deep' } } } }, fieldKey: null, frameContext: {} });
    expect(visitedNodes[1].fieldKey).toBe('level1');
    expect(visitedNodes[2].fieldKey).toBe('level2');
    expect(visitedNodes[3].fieldKey).toBe('level3');
  });

  it('should traverse arrays', () => {
    traverseFast([{ id: 1 }, { id: 2 }, { id: 3 }], {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(4);
    expect(visitMock).toHaveBeenCalledWith(null, [{ id: 1 }, { id: 2 }, { id: 3 }], null, {});
    expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 1 }, 0, {});
    expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 2 }, 1, {});
    expect(visitMock).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }], { id: 3 }, 2, {});
  });

  it('should traverse mixed objects and arrays', () => {
    traverseFast({ items: [{ name: 'Item1', details: { color: 'black' } }, { name: 'Item2', details: { color: 'white' } }] }, {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(6);

    const arrayNode = visitedNodes.find(v => Array.isArray(v.valueNode));
    expect(arrayNode).toBeDefined();
    expect(arrayNode?.fieldKey).toBe('items');
  });

  it('should skip non-object primitives in objects', () => {
    traverseFast({ string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(2);
    expect(visitMock).toHaveBeenCalledWith(null, { string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, null, {});
    expect(visitMock).toHaveBeenCalledWith({ string: 'string', number: 42, boolean: true, null: null, object: { nested: true } }, { nested: true }, 'object', {});
  });

  it('should skip non-object primitives in arrays', () => {
    traverseFast(['string', 42, true, null, { id: 1 }], {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(2);
    expect(visitMock).toHaveBeenCalledWith(null, ['string', 42, true, null, { id: 1 }], null, {});
    expect(visitMock).toHaveBeenCalledWith(['string', 42, true, null, { id: 1 }], { id: 1 }, 4, {});
  });

  it('should handle TRAVERSE_SKIP for objects', () => {
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

  it('should handle TRAVERSE_SKIP for arrays', () => {
    const skipVisit = vi.fn((parentNode, valueNode) => {
      if (Array.isArray(valueNode)) {
        return TRAVERSE_SKIP;
      }
    });

    traverseFast([{ id: 1, children: [{ nested: true }] }, { id: 2 }], {}, skipVisit);

    expect(skipVisit).toHaveBeenCalledTimes(1);
    expect(skipVisit).toHaveBeenCalledWith(null, [{ id: 1, children: [{ nested: true }] }, { id: 2 }], null, {});
  });

  it('should update context when visitor returns new context', () => {
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

  it('should pass updated context to nested objects', () => {
    const contextVisit = vi.fn((parentNode, valueNode, fieldKey, frameContext) => {
      return { level: frameContext.level + 1 };
    });

    traverseFast({ parent: { child: {} } }, { level: 0 }, contextVisit);

    expect(contextVisit).toHaveBeenCalledTimes(3);
    expect(contextVisit).toHaveBeenNthCalledWith(1, null, { parent: { child: {} } }, null, { level: 0 });
    expect(contextVisit).toHaveBeenNthCalledWith(2, { parent: { child: {} } }, { child: {} }, 'parent', { level: 1 });
    expect(contextVisit).toHaveBeenNthCalledWith(3, { child: {} }, {}, 'child', { level: 2 });
  });

  it('should handle empty objects', () => {
    traverseFast({}, {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(1);
    expect(visitMock).toHaveBeenCalledWith(null, {}, null, {});
  });

  it('should handle empty arrays', () => {
    traverseFast([], {}, visitMock);

    expect(visitMock).toHaveBeenCalledTimes(1);
    expect(visitMock).toHaveBeenCalledWith(null, [], null, {});
  });

  it('should handle null root', () => {
    traverseFast(null, {}, visitMock);

    expect(visitMock).not.toHaveBeenCalled();
  });

  it('should handle undefined root', () => {
    traverseFast(undefined, {}, visitMock);

    expect(visitMock).not.toHaveBeenCalled();
  });

  it('should handle primitive root values', () => {
    traverseFast('string', {}, visitMock);

    expect(visitMock).not.toHaveBeenCalled();

    visitMock.mockClear();

    traverseFast(42, {}, visitMock);
    expect(visitMock).not.toHaveBeenCalled();

    visitMock.mockClear();

    traverseFast(true, {}, visitMock);
    expect(visitMock).not.toHaveBeenCalled();
  });

  it('should maintain correct parent-child relationships', () => {
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

  it('should visit nodes in stack order for objects', () => {
    traverseFast({ first: {}, second: {}, third: {} }, {}, visitMock);

    const keys = visitedNodes.map(v => v.fieldKey).filter(k => k !== null);
    expect(keys).toEqual(['third', 'second', 'first']);
  });

  it('should visit array elements in correct order', () => {
    traverseFast([{ index: 0 }, { index: 1 }, { index: 2 }], {}, visitMock);

    const indices = visitedNodes.filter(v => typeof v.fieldKey === 'number').map(v => v.fieldKey);

    expect(indices).toEqual([0, 1, 2]);
  });
});



describe("buildFieldKey", () => {
  it("uses field.stringifyArgs(vars) with RAW vars (mapped to field-arg names)", () => {
    const DOC = gql`
      query Q($postsCategory: String, $postsFirst: Int, $postsAfter: String) {
        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
          @connection(filters: ["category"]) {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;

    const k = buildFieldKey(posts, {
      postsCategory: "tech",
      postsFirst: 2,
      postsAfter: null,
    });

    expect(k).toBe(`posts({"after":null,"category":"tech","first":2})`);
  });
});

describe("buildConnectionKey", () => {
  it("builds a concrete page key for root parent", () => {
    const DOC = gql`
      query Q($first: Int, $after: String) {
        posts(first: $first, after: $after) @connection {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;

    const pageRoot = buildConnectionKey(posts, ROOT_ID, { first: 2, after: null });
    expect(pageRoot).toBe(`@.posts({"after":null,"first":2})`);
  });

  it("builds a concrete page key for nested parent", () => {
    const DOC = gql`
      query Q($id: ID!, $first: Int, $after: String) {
        user(id: $id) {
          __typename id
          posts(first: $first, after: $after) @connection {
            edges { cursor node { id __typename } __typename }
            pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
          }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const user = plan.rootSelectionMap!.get("user")!;
    const posts = user.selectionMap!.get("posts")!;

    const pageNested = buildConnectionKey(posts, "User:u1", { id: "u1", first: 1, after: "p2" });
    expect(pageNested).toBe(`@.User:u1.posts({"after":"p2","first":1})`);
  });
});

describe("buildConnectionCanonicalKey", () => {
  it("respects filters & uses directive key  under @connection.", () => {
    const DOC = gql`
      query Q($cat: String, $first: Int, $after: String) {
        posts(category: $cat, first: $first, after: $after)
          @connection(key: "PostsList", filters: ["category"]) {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;

    // root
    const idRoot = buildConnectionCanonicalKey(posts, ROOT_ID, { cat: "tech", first: 2, after: null });
    // Only category in identity; pagination removed. Uses key if provided, but our key-part
    // in canonical name uses `connectionKey || fieldName` — for namespace we only need field name segment.
    // (We keep the segment as field name to avoid exploding namespace; key still picked up by metadata)
    expect(idRoot).toBe(`@connection.PostsList({"category":"tech"})`);

    // nested
    const idNested = buildConnectionCanonicalKey(posts, "User:u1", { cat: "tech", first: 2, after: "p2" });
    expect(idNested).toBe(`@connection.User:u1.PostsList({"category":"tech"})`);
  });

  it("defaults filters to all non-pagination args when filters omitted", () => {
    const DOC = gql`
      query Q($category: String, $sort: String, $first: Int, $after: String) {
        posts(category: $category, sort: $sort, first: $first, after: $after)
          @connection {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;

    const id = buildConnectionCanonicalKey(posts, ROOT_ID, {
      category: "tech",
      first: 2,
      sort: "hot",
      after: null,
    });

    expect(id).toBe(`@connection.posts({"category":"tech","sort":"hot"})`);
  });

  it("stable stringify → identity identical regardless of variable order", () => {
    const DOC = gql`
      query Q($category: String, $sort: String, $first: Int, $after: String) {
        posts(category: $category, sort: $sort, first: $first, after: $after)
          @connection {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;

    const a = buildConnectionCanonicalKey(posts, ROOT_ID, {
      sort: "hot",
      category: "tech",
      first: 2,
      after: null,
    });
    const b = buildConnectionCanonicalKey(posts, ROOT_ID, {
      category: "tech",
      after: null,
      sort: "hot",
      first: 2,
    });

    expect(a).toBe(b);
    expect(a).toBe(`@connection.posts({"category":"tech","sort":"hot"})`);
  });
});
