import { describe, it, expect } from 'vitest';
import { parse, print } from 'graphql';
import {
  ensureDocumentHasTypenameSmart,
  getOperationBody,
  readPathValue,
  parseEntityKey,
  buildConnectionKey,
  stableIdentityExcluding,
  getOperationKey,
  getFamilyKey,
  normalizeParentKeyInput,
} from '@/src/core/utils';

describe('core/utils (object-hash signatures)', () => {
  it('ensureDocumentHasTypenameSmart adds __typename where missing', () => {
    const src = parse(`
      query Q {
        colors { id name }
        me { id username }
      }
    `);
    const withTypename = ensureDocumentHasTypenameSmart(src);
    const body = print(withTypename);
    expect(body).toMatch(/__typename/);
    const again = ensureDocumentHasTypenameSmart(withTypename);
    expect(again).toBe(withTypename);
  });

  it('getOperationBody normalizes string and DocumentNode equally', () => {
    const s = 'query Q { a }';
    const d = parse(s);
    expect(getOperationBody(s)).toBe(getOperationBody(d));
  });

  it('readPathValue safely reads deep paths (dot / nested)', () => {
    const obj = { a: { b: { c: 1 } }, arr: [{ x: { y: 2 } }] };
    expect(readPathValue(obj, 'a.b.c')).toBe(1);
    expect(readPathValue(obj, 'arr.0.x.y')).toBe(2);
    expect(readPathValue(obj, 'missing.path')).toBeUndefined();
  });

  it('parseEntityKey returns nulls when no colon is present (including "Query")', () => {
    expect(parseEntityKey('User:1')).toEqual({ typename: 'User', id: '1' });
    expect(parseEntityKey('Query')).toEqual({ typename: 'Query', id: null });
  });

  it('buildConnectionKey filters cursor variables and is stable across nested order (hashed)', () => {
    const parent = 'Query';
    const field = 'colors';
    const opts: any = { cursors: { after: 'after', before: 'before', first: 'first', last: 'last' } };

    // Same shape; different key order at multiple depths
    const k1 = buildConnectionKey(parent, field, opts, {
      after: 'c1',
      first: 10,
      where: {
        name: { _ilike: 'b%' },
        z: 3,
        a: 1,
      },
    });

    const k2 = buildConnectionKey(parent, field, opts, {
      after: 'c2',
      first: 10,
      where: {
        a: 1,
        name: { _ilike: 'b%' },
        z: 3,
      },
    });

    expect(k1).toBe(k2);
    expect(k1.startsWith('Query.colors(')).toBe(true);
  });

  it('stableIdentityExcluding ignores listed keys and is order-independent deep', () => {
    const a = { after: 'x', where: { b: 1, a: 2, nested: { z: 0, y: 1 } }, first: 20 };
    const b = { where: { a: 2, nested: { y: 1, z: 0 }, b: 1 }, first: 20, after: 'y' };
    const ia = stableIdentityExcluding(a, ['after']);
    const ib = stableIdentityExcluding(b, ['after']);
    expect(ia).toBe(ib);
  });

  it('normalizeParentKeyInput handles Query and entity refs', () => {
    expect(normalizeParentKeyInput('Query', 'colors')).toBe('Query');
    expect(normalizeParentKeyInput({ __typename: 'User', id: 1 } as any, 'posts')).toBe('User:1');
  });

  it('getOperationKey and getFamilyKey use hashed variable identity', () => {
    const opA: any = { query: 'query X { a }', variables: { where: { b: 1, a: 2 } }, context: {} };
    const opB: any = { query: 'query X { a }', variables: { where: { a: 2, b: 1 } }, context: {} };
    expect(getOperationKey(opA)).toBe(getOperationKey(opB));

    const opScoped: any = { query: 'query X { a }', variables: { where: { a: 2, b: 1 } }, context: { concurrencyScope: 'tab' } };
    expect(getFamilyKey(opScoped).endsWith('::tab')).toBe(true);
  });

  it('familyKey is stable w.r.t. variable order', () => {
    const opA: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { a: 1, b: 2 }, context: {} };
    const opB: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { b: 2, a: 1 }, context: {} };

    const fa = getFamilyKey(opA);
    const fb = getFamilyKey(opB);
    expect(fa).toBe(fb);
  });

  it('familyKey includes concurrencyScope (isolates families)', () => {
    const op1: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-1' } };
    const op2: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-2' } };

    const f1 = getFamilyKey(op1);
    const f2 = getFamilyKey(op2);

    expect(f1).not.toBe(f2);
    expect(f1.endsWith('::tab-1')).toBe(true);
    expect(f2.endsWith('::tab-2')).toBe(true);
  });

  it('getOperationKey changes when variables change', () => {
    const A: any = { query: 'query Q { x }', variables: { n: 1 }, context: {} };
    const B: any = { query: 'query Q { x }', variables: { n: 2 }, context: {} };
    expect(getOperationKey(A)).not.toBe(getOperationKey(B));
  });

  it('getOperationKey is identical for string vs DocumentNode, all else equal', () => {
    const src = 'query Q { x }';
    const opStr: any = { query: src, variables: {}, context: {} };
    const opDoc: any = { query: parse(src), variables: {}, context: {} };
    expect(getOperationKey(opStr)).toBe(getOperationKey(opDoc));
  });
});
