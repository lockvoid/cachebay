import { describe, it, expect, vi } from 'vitest';
import { buildConnectionKey, stableIdentityExcluding, parseEntityKey } from '@/src/core/utils';
import { TYPENAME_FIELD } from '@/src/core/constants';

describe('core/internals', () => {
  describe('connection key generation', () => {
    it('buildConnectionKey creates consistent keys regardless of variable order', () => {
      const parentKey = 'Query';
      const field = 'colors';
      const spec = {
        isRelay: true,
        paths: { edges: 'edges', pageInfo: 'pageInfo' },
        segs: { edges: ['edges'], pageInfo: ['pageInfo'] },
        names: { edges: 'edges', pageInfo: 'pageInfo' },
        cursors: { after: 'after', before: 'before', first: 'first', last: 'last' },
      } as any;

      // Same variables, different order
      const key1 = buildConnectionKey(parentKey, field, spec, { where: { b: 2, a: 1 } });
      const key2 = buildConnectionKey(parentKey, field, spec, { where: { a: 1, b: 2 } });

      expect(key1).toBe(key2);
    });

    it('buildConnectionKey excludes cursor pagination variables', () => {
      const parentKey = 'Query';
      const field = 'items';
      const spec = {
        isRelay: true,
        paths: { edges: 'edges', pageInfo: 'pageInfo' },
        segs: { edges: ['edges'], pageInfo: ['pageInfo'] },
        names: { edges: 'edges', pageInfo: 'pageInfo' },
        cursors: { after: 'after', before: 'before', first: 'first', last: 'last' },
      } as any;

      const key1 = buildConnectionKey(parentKey, field, spec, { first: 10, after: 'cursor1' });
      const key2 = buildConnectionKey(parentKey, field, spec, { first: 10, after: 'cursor2' });
      const key3 = buildConnectionKey(parentKey, field, spec, { first: 10 });

      // Keys should be same regardless of cursor values
      expect(key1).toBe(key2);
      expect(key1).toBe(key3);
    });
  });

  describe('stableIdentityExcluding', () => {
    it('creates stable identity hash excluding specified keys', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { a: 1, b: 2, c: 4 };
      const obj3 = { b: 2, a: 1, c: 3 }; // Different order

      const hash1 = stableIdentityExcluding(obj1, ['c']);
      const hash2 = stableIdentityExcluding(obj2, ['c']);
      const hash3 = stableIdentityExcluding(obj3, ['c']);

      // Should be same when excluding 'c'
      expect(hash1).toBe(hash2);
      // Should be same regardless of key order
      expect(hash1).toBe(hash3);
    });

    it('handles nested objects', () => {
      const obj1 = { filter: { status: 'active', type: 'user' } };
      const obj2 = { filter: { type: 'user', status: 'active' } };

      const hash1 = stableIdentityExcluding(obj1, []);
      const hash2 = stableIdentityExcluding(obj2, []);

      expect(hash1).toBe(hash2);
    });
  });

  describe('parseEntityKey', () => {
    it('parses entity key into typename and id', () => {
      const result = parseEntityKey('User:123');
      expect(result.typename).toBe('User');
      expect(result.id).toBe('123');
    });

    it('handles complex typenames', () => {
      const result = parseEntityKey('MyApp_User:456');
      expect(result.typename).toBe('MyApp_User');
      expect(result.id).toBe('456');
    });

    it('handles keys with colons in id', () => {
      const result = parseEntityKey('Entity:id:with:colons');
      expect(result.typename).toBe('Entity');
      expect(result.id).toBe('id:with:colons');
    });
  });

  describe('typename field constant', () => {
    it('uses consistent typename field', () => {
      expect(TYPENAME_FIELD).toBe('__typename');
      
      // Verify it's used consistently
      const obj = {};
      (obj as any)[TYPENAME_FIELD] = 'User';
      expect(obj).toHaveProperty('__typename', 'User');
    });
  });
});
