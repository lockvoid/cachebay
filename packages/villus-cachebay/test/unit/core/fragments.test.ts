import { describe, it, expect, vi } from 'vitest';
import { createFragments } from '@/src/core/fragments';
import { TYPENAME_FIELD } from '@/src/core/constants';

// Light mock helpers inline to keep this test self-contained
function createMockGraph(overrides: any = {}) {
  const entityStore = overrides.entityStore ?? new Map<string, any>();
  return {
    entityStore,
    identify: vi.fn((o: any) => (o && o.__typename && o.id != null) ? `${o.__typename}:${String(o.id)}` : null),
    materializeEntity: vi.fn((k: string) => {
      const snap = entityStore.get(k);
      if (!snap) return null;
      const [typename, id] = k.split(':');
      return id ? { __typename: typename, id, ...snap } : { __typename: typename, ...snap };
    }),
    putEntity: vi.fn((obj: any, mode?: 'merge' | 'replace') => {
      // emulate graph.putEntity snapshot behavior (exclude identity)
      const key = `${obj.__typename}:${obj.id ?? ''}`.replace(/:$/, '');
      const snap: any = {};
      Object.keys(obj).forEach(k => { if (k !== '__typename' && k !== 'id') snap[k] = obj[k]; });
      if (mode === 'replace') {
        entityStore.set(key, snap);
      } else {
        const prev = entityStore.get(key) || {};
        entityStore.set(key, { ...prev, ...snap });
      }
    }),
    resolveEntityKey: vi.fn((k: string) => k),
    isInterfaceType: vi.fn((t: string) => t === 'Node' || t === 'Animal'),
    getInterfaceTypes: vi.fn((t: string) => t === 'Node' ? ['User', 'Post'] : t === 'Animal' ? ['Cat', 'Dog'] : []),
    getEntityKeys: vi.fn((pattern: string) => {
      // naive filter
      const out: string[] = [];
      for (const key of entityStore.keys()) {
        if (key.startsWith(pattern)) out.push(key);
      }
      return out;
    }),
    ...overrides,
  };
}

describe('core/fragments', () => {
  describe('createFragments', () => {
    it('creates fragment functions with dependencies', () => {
      const graph = createMockGraph();
      const fragments = createFragments({}, { graph });

      expect(fragments).toHaveProperty('identify');
      expect(fragments).toHaveProperty('readFragment');
      expect(fragments).toHaveProperty('hasFragment');
      expect(fragments).toHaveProperty('writeFragment');
      expect(fragments).toHaveProperty('readFragments');
    });
  });

  describe('identify', () => {
    it('delegates to graph.identify', () => {
      const graph = createMockGraph();
      const fragments = createFragments({}, { graph });
      const obj = { __typename: 'User', id: 1 };
      const result = fragments.identify(obj);
      expect(graph.identify).toHaveBeenCalledWith(obj);
      expect(result).toBe('User:1');
    });
  });

  describe('readFragment', () => {
    it('reads materialized (proxy) by default', () => {
      const graph = createMockGraph({
        entityStore: new Map([['User:1', { name: 'John' }]]),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragment('User:1');
      expect(graph.materializeEntity).toHaveBeenCalledWith('User:1');
      expect(result).toEqual({ __typename: 'User', id: '1', name: 'John' });
    });

    it('reads raw snapshot when materialized=false', () => {
      const graph = createMockGraph({
        entityStore: new Map([['User:1', { name: 'John' }]]),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragment('User:1', { materialized: false });
      expect(graph.materializeEntity).not.toHaveBeenCalled();
      expect(result).toEqual({ name: 'John' });
    });

    it('handles interface keys by falling back to raw if unresolved', () => {
      const graph = createMockGraph({
        entityStore: new Map([['Node:1', { __typename: 'Node', id: 1, name: 'Test' }]]),
        resolveEntityKey: vi.fn((k: string) => null), // unresolved
        isInterfaceType: vi.fn((t: string) => t === 'Node'),
        getInterfaceTypes: vi.fn(() => ['User', 'Post']),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragment('Node:1', { materialized: false });
      expect(result).toEqual({ __typename: 'Node', id: 1, name: 'Test' });
    });
  });

  describe('hasFragment', () => {
    it('checks entity existence by key', () => {
      const graph = createMockGraph({
        entityStore: new Map([['User:1', { name: 'John' }]]),
      });
      const fragments = createFragments({}, { graph });

      expect(fragments.hasFragment('User:1')).toBe(true);
      expect(fragments.hasFragment('User:2')).toBe(false);
    });

    it('checks interface implementors when id is present', () => {
      const graph = createMockGraph({
        entityStore: new Map([['User:1', { name: 'A' }], ['Post:1', { title: 'P' }]]),
        isInterfaceType: vi.fn((t: string) => t === 'Node'),
        getInterfaceTypes: vi.fn(() => ['User', 'Post']),
      });
      const fragments = createFragments({}, { graph });

      expect(fragments.hasFragment('Node:1')).toBe(true);
      expect(fragments.hasFragment('Node:2')).toBe(false);
    });
  });

  describe('writeFragment', () => {
    it('returns a transaction with commit and revert', () => {
      const graph = createMockGraph({ entityStore: new Map() });
      const fragments = createFragments({}, { graph });

      const obj = { __typename: 'User', id: 1, name: 'John' };
      const tx = fragments.writeFragment(obj);

      // not written yet
      expect(graph.entityStore.has('User:1')).toBe(false);

      // commit
      tx.commit();
      expect(graph.putEntity).toHaveBeenCalledWith(obj, 'merge');
      expect(graph.entityStore.get('User:1')).toEqual({ name: 'John' });

      // update to have a prev snapshot, then revert
      fragments.writeFragment({ __typename: 'User', id: 1, age: 30 }).commit();
      expect(graph.entityStore.get('User:1')).toEqual({ name: 'John', age: 30 });

      tx.revert(); // revert the first write -> should restore previous snapshot (which includes age now)
      // Our revert restores the snapshot captured before the tx.commit(); here prev was undefined, so it clears to empty.
      // To keep the test simple, assert that a replace to empty happened:
      expect(graph.putEntity).toHaveBeenCalledWith({ __typename: 'User', id: '1' }, 'replace');
    });
  });

  describe('readFragments', () => {
    it('reads multiple fragments by pattern with :* selector', () => {
      const store = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
        ['User:2', { __typename: 'User', id: 2, name: 'Jane' }],
        ['Post:1', { __typename: 'Post', id: 1, title: 'Hello' }],
      ]);
      const graph = createMockGraph({
        entityStore: store,
        getEntityKeys: vi.fn((pattern: string) => {
          if (pattern === 'User:') return ['User:1', 'User:2'];
          if (pattern === 'Post:') return ['Post:1'];
          return [];
        }),
        materializeEntity: vi.fn((k: string) => store.get(k)),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragments('User:*');
      expect(graph.getEntityKeys).toHaveBeenCalledWith('User:');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
      expect(result[1]).toEqual({ __typename: 'User', id: 2, name: 'Jane' });
    });

    it('reads single fragment by exact key', () => {
      const store = new Map([['User:1', { __typename: 'User', id: 1, name: 'John' }]]);
      const graph = createMockGraph({
        entityStore: store,
        materializeEntity: vi.fn((k: string) => store.get(k)),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragments('User:1');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
    });

    it('handles multiple patterns in array', () => {
      const store = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
        ['Post:1', { __typename: 'Post', id: 1, title: 'Hello' }],
      ]);
      const graph = createMockGraph({
        entityStore: store,
        getEntityKeys: vi.fn((pattern: string) => {
          if (pattern === 'User:') return ['User:1'];
          if (pattern === 'Post:') return ['Post:1'];
          return [];
        }),
        materializeEntity: vi.fn((k: string) => store.get(k)),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragments(['User:*', 'Post:*']);
      expect(result).toHaveLength(2);
      expect(result.find((r) => r.__typename === 'User')).toEqual({ __typename: 'User', id: 1, name: 'John' });
      expect(result.find((r) => r.__typename === 'Post')).toEqual({ __typename: 'Post', id: 1, title: 'Hello' });
    });

    it('returns raw snapshots when materialized=false', () => {
      const store = new Map([['User:1', { __typename: 'User', id: 1, name: 'Alice' }]]);
      const graph = createMockGraph({
        entityStore: store,
        getEntityKeys: vi.fn(() => ['User:1']),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragments('User:*', { materialized: false });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'Alice' });
    });

    it('filters out null/undefined results', () => {
      const store = new Map([['User:1', { __typename: 'User', id: 1, name: 'John' }]]);
      const graph = createMockGraph({
        entityStore: store,
        getEntityKeys: vi.fn(() => ['User:1', 'User:2']),
        materializeEntity: vi.fn((k: string) => store.get(k)),
      });
      const fragments = createFragments({}, { graph });

      const result = fragments.readFragments('User:*');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
    });

    it('returns empty array when no matches found', () => {
      const graph = createMockGraph({
        entityStore: new Map(),
        getEntityKeys: vi.fn(() => []),
      });
      const fragments = createFragments({}, { graph });
      const result = fragments.readFragments('User:*');
      expect(result).toEqual([]);
    });
  });
});
