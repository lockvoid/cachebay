import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traverseFast, TRAVERSE_SKIP, isObject } from '../../../src/core/utils';

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
