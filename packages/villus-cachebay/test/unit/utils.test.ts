import { describe, it, expect } from 'vitest';
import { print } from 'graphql';
import {
  ensureDocumentHasTypenameSmart,
  getOperationBody,
  readPathValue,
  parseEntityKey,
  buildConnectionKey,
  stableIdentityExcluding,
  parseVariablesFromConnectionKey,
  operationKey,
  familyKeyForOperation,
} from '../../src/core/utils';

describe('core/utils', () => {
  it('ensureDocumentHasTypenameSmart adds __typename to selections', () => {
    const doc = ensureDocumentHasTypenameSmart(`query X { a { b } }`);
    // getOperationBody intentionally returns original source when loc is present.
    // Use graphql.print to inspect the transformed AST instead.
    const printed = print(doc as any);
    expect(printed).toContain('__typename');
  });

  it('readPathValue reads dot and array paths', () => {
    const obj = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(readPathValue(obj, 'a.b.1.c')).toBe(2);
  });

  it('parseEntityKey returns typename and id', () => {
    expect(parseEntityKey('User:1')).toEqual({ typename: 'User', id: '1' });
    expect(parseEntityKey('bad')).toEqual({ typename: null, id: null });
  });

  it('stableIdentityExcluding removes relay cursor params stably', () => {
    const s1 = stableIdentityExcluding({ after: 'x', first: 10, where: { k: 1 } }, ['after', 'before', 'first', 'last']);
    const s2 = stableIdentityExcluding({ first: 10, where: { k: 1 } }, ['after', 'before', 'first', 'last']);
    expect(s1).toBe(s2);
  });

  it('buildConnectionKey composes expected key', () => {
    const key = buildConnectionKey('Query', 'colors', {
      paths: { edges: 'edges', node: 'node', pageInfo: 'pageInfo' },
      segs: { edges: ['edges'], node: ['node'], pageInfo: ['pageInfo'] },
      names: { edges: 'edges', pageInfo: 'pageInfo', nodeField: 'node' },
      cursors: { after: 'after', before: 'before', first: 'first', last: 'last' },
      hasNodePath: false,
      write: undefined,
    } as any, { after: 'abc', first: 10, where: { name: { _ilike: 'b%' } } });
    expect(key.startsWith('Query.colors(')).toBe(true);
  });

  it('parseVariablesFromConnectionKey parses back variables', () => {
    const prefix = 'Query.colors(';
    const key = 'Query.colors(where:{"name":{"_ilike":"b%"}})';
    const vars = parseVariablesFromConnectionKey(key, prefix);
    expect(vars).toEqual({ where: { name: { _ilike: 'b%' } } });
  });

  it('operationKey and familyKeyForOperation build stable IDs', () => {
    const op = { query: 'query X { a }', variables: { a: 1 } } as any;
    const op2 = { query: 'query X { a }', variables: { a: 1 } } as any;
    expect(operationKey(op)).toBe(operationKey(op2));
    expect(familyKeyForOperation(op)).toContain('query X');
  });
});
