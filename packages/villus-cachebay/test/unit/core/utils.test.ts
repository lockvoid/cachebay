import { describe, it, expect } from 'vitest';
import { parse, print } from 'graphql';
import {
  ensureDocumentHasTypenameSmart,
  getOperationBody,
  readPathValue,
  parseEntityKey,
  buildConnectionKey,
  stableIdentityExcluding,
  operationKey,
  familyKeyForOperation,
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
    expect(parseEntityKey('Query')).toEqual({ typename: null, id: null });
    expect(parseEntityKey('NoColon')).toEqual({ typename: null, id: null });
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

  it('operationKey and familyKeyForOperation use hashed variable identity', () => {
    const opA: any = { query: 'query X { a }', variables: { where: { b: 1, a: 2 } }, context: {} };
    const opB: any = { query: 'query X { a }', variables: { where: { a: 2, b: 1 } }, context: {} };
    expect(operationKey(opA)).toBe(operationKey(opB));

    const opScoped: any = { query: 'query X { a }', variables: { where: { a: 2, b: 1 } }, context: { concurrencyScope: 'tab' } };
    expect(familyKeyForOperation(opScoped).endsWith('::tab')).toBe(true);
  });
});
