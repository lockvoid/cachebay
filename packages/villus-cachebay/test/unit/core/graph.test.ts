import { describe, it, expect, beforeEach } from 'vitest';
import { isReactive } from 'vue';
import { createGraph } from '@/src/core/graph';
import { tick } from '@/test/helpers';
import { getOperationKey } from '@/src/core/utils';

describe('createGraph - Unit Tests (refactor)', () => {
  let graph: ReturnType<typeof createGraph>;

  beforeEach(() => {
    graph = createGraph({
      writePolicy: 'replace',
      interfaces: { Node: ['User', 'Post'], Animal: ['Cat', 'Dog'] },
      reactiveMode: 'deep',
      keys: {
        User: (o: any) => o?.userId ?? o?.id,
        Post: (o: any) => o?.postId ?? o?.id,
      },
    });
  });

  describe('identify', () => {
    it('should generate entity key using typename and id', () => {
      const obj = { __typename: 'Product', id: '123' };
      expect(graph.identify(obj)).toBe('Product:123');
    });

    it('should return null if only _id is present (no longer supported)', () => {
      const obj = { __typename: 'Product', _id: '456' };
      expect(graph.identify(obj)).toBe(null);
    });

    it('should use custom key factory for specific types', () => {
      const user = { __typename: 'User', userId: 'u1', id: 'ignored' };
      expect(graph.identify(user)).toBe('User:u1');

      const post = { __typename: 'Post', postId: 'p1', id: 'fallback' };
      expect(graph.identify(post)).toBe('Post:p1');
    });

    it('should fallback to id when custom factory returns null', () => {
      const user = { __typename: 'User', id: 'u2' };
      expect(graph.identify(user)).toBe('User:u2');
    });

    it('should return null for objects without typename or id', () => {
      expect(graph.identify({ id: '123' })).toBe(null);
      expect(graph.identify({ __typename: 'Product' })).toBe(null);
      expect(graph.identify(null)).toBe(null);
      expect(graph.identify(undefined)).toBe(null);
    });
  });

  describe('getEntityParentKey', () => {
    it('should return "Query" for Query typename', () => {
      expect(graph.getEntityParentKey('Query')).toBe('Query');
      expect(graph.getEntityParentKey('Query', 'anyId')).toBe('Query');
    });

    it('should generate entity key for non-Query types with id', () => {
      expect(graph.getEntityParentKey('User', '123')).toBe('User:123');
      expect(graph.getEntityParentKey('Post', 456)).toBe('Post:456');
    });

    it('should return null for non-Query types without id', () => {
      expect(graph.getEntityParentKey('User')).toBe(null);
      expect(graph.getEntityParentKey('User', null)).toBe(null);
      expect(graph.getEntityParentKey('User', undefined)).toBe(null);
    });
  });

  describe('putEntity (snapshot without identity)', () => {
    it('should store entity snapshot with replace policy', async () => {
      const obj = { __typename: 'User', id: '1', name: 'Alice', age: 30 };
      const key = graph.putEntity(obj);
      expect(key).toBe('User:1');

      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Alice', age: 30 });
      expect(stored.__typename).toBeUndefined();
      expect(stored.id).toBeUndefined();
    });

    it('should merge entity fields with merge policy', async () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      graph.putEntity({ __typename: 'User', id: '1', age: 30 }, 'merge');
      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Alice', age: 30 });
    });

    it('should replace entity fields with replace policy', async () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice', age: 25 });
      graph.putEntity({ __typename: 'User', id: '1', name: 'Bob' }, 'replace');
      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Bob' });
      expect(stored.age).toBeUndefined();
    });
  });

  describe('ensureConnection', () => {
    it('should create new connection state if not exists', () => {
      const state = graph.ensureConnection('Query.users');
      expect(state).toBeDefined();
      expect(state.list).toEqual([]);
      expect(state.pageInfo).toBeDefined();
      expect(state.meta).toBeDefined();
      expect(state.views).toBeInstanceOf(Set);
      expect(state.keySet).toBeInstanceOf(Set);
      expect(state.initialized).toBe(false);
      expect((state as any).__key).toBe('Query.users');

      // Reactivity checks
      expect(isReactive(state.list)).toBe(true);
      expect(isReactive(state.pageInfo)).toBe(true);
      expect(isReactive(state.meta)).toBe(true);
    });

    it('should return existing connection state', () => {
      const state1 = graph.ensureConnection('Query.posts');
      state1.initialized = true;
      const state2 = graph.ensureConnection('Query.posts');
      expect(state2).toBe(state1);
      expect(state2.initialized).toBe(true);
      expect(isReactive(state2.list)).toBe(true);
      expect(isReactive(state2.pageInfo)).toBe(true);
      expect(isReactive(state2.meta)).toBe(true);
    });
  });

  describe('Interface Helpers', () => {
    describe('isInterfaceType', () => {
      it('should identify interface types', () => {
        expect(graph.isInterfaceType('Node')).toBe(true);
        expect(graph.isInterfaceType('Animal')).toBe(true);
        expect(graph.isInterfaceType('User')).toBe(false);
        expect(graph.isInterfaceType('Product')).toBe(false);
        expect(graph.isInterfaceType(null)).toBe(false);
      });
    });

    describe('getInterfaceTypes', () => {
      it('should return concrete types for interface', () => {
        expect(graph.getInterfaceTypes('Node')).toEqual(['User', 'Post']);
        expect(graph.getInterfaceTypes('Animal')).toEqual(['Cat', 'Dog']);
        expect(graph.getInterfaceTypes('Unknown')).toEqual([]);
      });
    });

    describe('resolveEntityKey', () => {
      it('should return same key for non-interface types', () => {
        expect(graph.resolveEntityKey('User:1')).toBe('User:1');
        expect(graph.resolveEntityKey('Product:1')).toBe('Product:1');
      });

      it('should resolve interface key to concrete implementation', () => {
        graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
        expect(graph.resolveEntityKey('Node:1')).toBe('User:1');
      });

      it('should return null if no concrete implementation exists', () => {
        expect(graph.resolveEntityKey('Node:999')).toBe(null);
      });

      it('should return first matching implementation', () => {
        graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
        graph.putEntity({ __typename: 'Post', id: '1', title: 'Hello' });
        expect(graph.resolveEntityKey('Node:1')).toBe('User:1');
      });
    });

    describe('areEntityKeysEqual', () => {
      it('should match identical keys', () => {
        expect(graph.areEntityKeysEqual('User:1', 'User:1')).toBe(true);
        expect(graph.areEntityKeysEqual('Post:2', 'Post:2')).toBe(true);
      });

      it('should not match different ids', () => {
        expect(graph.areEntityKeysEqual('User:1', 'User:2')).toBe(false);
      });

      it('should not match different types with same id', () => {
        expect(graph.areEntityKeysEqual('User:1', 'Post:1')).toBe(false);
      });

      it('should match interface key with implementation', () => {
        expect(graph.areEntityKeysEqual('Node:1', 'User:1')).toBe(true);
        expect(graph.areEntityKeysEqual('Node:1', 'Post:1')).toBe(true);
        expect(graph.areEntityKeysEqual('Animal:1', 'Cat:1')).toBe(true);
      });

      it('should not match interface with non-implementation', () => {
        expect(graph.areEntityKeysEqual('Node:1', 'Cat:1')).toBe(false);
        expect(graph.areEntityKeysEqual('Animal:1', 'User:1')).toBe(false);
      });

      it('should handle invalid keys', () => {
        expect(graph.areEntityKeysEqual('Invalid', 'User:1')).toBe(false);
        expect(graph.areEntityKeysEqual('User:1', 'Invalid')).toBe(false);
      });
    });
  });

  describe('materializeEntity', () => {
    it('should create materialized object with typename and id', () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice', age: 30 });
      const materialized = graph.materializeEntity('User:1');
      expect(materialized).toEqual({
        __typename: 'User',
        id: '1',
        name: 'Alice',
        age: 30,
      });
    });

    it('should materialize entity without stored data', () => {
      const materialized = graph.materializeEntity('User:999');
      expect(materialized).toEqual({
        __typename: 'User',
        id: '999',
      });
    });

    it('should handle keys without id', () => {
      const materialized = graph.materializeEntity('Query');
      expect(materialized).toEqual({
        __typename: 'Query',
      });
    });

    it('should cache materialized entities with WeakRef if available', () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      const mat1 = graph.materializeEntity('User:1');
      const mat2 = graph.materializeEntity('User:1');
      expect(mat1).toBe(mat2);
    });

    it('should reflect updated snapshot on subsequent materialize', async () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'A' });
      const mat1 = graph.materializeEntity('User:1');
      graph.putEntity({ __typename: 'User', id: '1', name: 'B' }, 'merge');
      const mat2 = graph.materializeEntity('User:1');
      expect(mat1).toBe(mat2);
      expect(mat2.name).toBe('B');
    });
  });

  describe('getEntity', () => {
    it('should return reactive entity data (stored fields only)', () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice', age: 30 });
      const reactiveEntity = graph.getEntity('User:1');
      expect(reactiveEntity).toEqual({ name: 'Alice', age: 30 });
      expect(isReactive(reactiveEntity)).toBe(true);
    });

    it('should return undefined for non-existent entities', () => {
      const result = graph.getEntity('User:999');
      expect(result).toBeUndefined();
    });

    it('should return reactive nested objects in deep mode', () => {
      graph.putEntity({
        __typename: 'User',
        id: '1',
        profile: { name: 'Alice', settings: { theme: 'dark' } }
      });
      const reactiveEntity = graph.getEntity('User:1');
      expect(reactiveEntity).toEqual({ profile: { name: 'Alice', settings: { theme: 'dark' } } });
      expect(isReactive(reactiveEntity)).toBe(true);
      expect(isReactive(reactiveEntity.profile)).toBe(true);
      expect(isReactive(reactiveEntity.profile.settings)).toBe(true);
    });

    it('should use shallow reactivity when configured', () => {
      const shallowGraph = createGraph({
        writePolicy: 'replace',
        interfaces: {},
        reactiveMode: 'shallow',
        keys: {}
      });
      shallowGraph.putEntity({
        __typename: 'User',
        id: '1',
        profile: { name: 'Alice', settings: { theme: 'dark' } }
      });
      const reactiveEntity = shallowGraph.getEntity('User:1');
      expect(reactiveEntity).toEqual({ profile: { name: 'Alice', settings: { theme: 'dark' } } });
      expect(isReactive(reactiveEntity)).toBe(true);
      expect(isReactive(reactiveEntity.profile)).toBe(false); // shallow
    });
  });

  describe('Fast queries: getEntityKeys/getEntities', () => {
    it('should list keys and snapshots by typename prefix', () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'A' });
      graph.putEntity({ __typename: 'User', id: '2', name: 'B' });
      graph.putEntity({ __typename: 'Post', id: '1', title: 'P1' });

      const userKeys = graph.getEntityKeys('User:');
      expect(new Set(userKeys)).toEqual(new Set(['User:1', 'User:2']));

      const users = graph.getEntities('User');
      expect(users).toHaveLength(2);
      const names = users.map(u => u.name).sort();
      expect(names).toEqual(['A', 'B']);
    });

    it('should support multiple selectors', () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'A' });
      graph.putEntity({ __typename: 'Post', id: '1', title: 'P1' });
      graph.putEntity({ __typename: 'Post', id: '2', title: 'P2' });

      const keys = graph.getEntityKeys(['User', 'Post:2']);
      expect(new Set(keys)).toEqual(new Set(['User:1', 'Post:2']));
    });
  });

  describe('putOperation (LRU)', () => {
    it('should write operation to cache', () => {
      const data = { users: [{ id: 1, name: 'Alice' }] };
      const variables = { first: 10 };
      graph.putOperation('query1', { data, variables });
      const cached = graph.operationStore.get('query1');
      expect(cached).toBeDefined();
      expect(cached?.data).toEqual(data);
      expect(cached?.variables).toEqual(variables);
    });

    it('should enforce LRU limit', () => {
      for (let i = 0; i < 200; i++) {
        graph.putOperation(`query${i}`, { data: { id: i }, variables: {} });
      }
      expect(graph.operationStore.size).toBe(200);
      expect(graph.operationStore.has('query0')).toBe(true);

      graph.putOperation('query200', { data: { id: 200 }, variables: {} });
      expect(graph.operationStore.size).toBe(200);
      expect(graph.operationStore.has('query0')).toBe(false);
      expect(graph.operationStore.has('query200')).toBe(true);
    });
  });

  describe('Watchers (granular tick)', () => {
    it('should notify only watchers of changed entities (microtask flush)', async () => {
      graph.putEntity({ __typename: 'User', id: '1', name: 'A' });
      graph.putEntity({ __typename: 'User', id: '2', name: 'B' });

      let calls1 = 0;
      let calls2 = 0;

      const w1 = graph.registerEntityWatcher(() => { calls1++; });
      const w2 = graph.registerEntityWatcher(() => { calls2++; });

      graph.trackEntity(w1, 'User:1');
      graph.trackEntity(w2, 'User:2');

      graph.putEntity({ __typename: 'User', id: '1', name: 'A1' }, 'merge');

      await tick();

      expect(calls1).toBe(1);
      expect(calls2).toBe(0);

      graph.unregisterEntityWatcher(w1);
      graph.unregisterEntityWatcher(w2);
    });
  });

  describe('lookupOperation', () => {
    const DUMMY_QUERY = 'query Test { __typename }';

    function makeGraph() {
      return createGraph({
        writePolicy: 'replace',
        reactiveMode: 'deep',
        interfaces: {},
        keys: {},
      });
    }

    it('returns a base-key hit for an exact operation signature', () => {
      const graph = makeGraph();

      const op = { type: 'query', query: DUMMY_QUERY, variables: { a: 1, b: 2 } };
      const key = getOperationKey(op);

      graph.putOperation(key, { data: { ok: true }, variables: op.variables });

      const hit = (graph as any).lookupOperation(op);
      expect(hit).toBeTruthy();
      expect(hit!.key).toBe(key);
      expect(hit!.entry.data).toEqual({ ok: true });
      expect(hit!.entry.variables).toEqual({ a: 1, b: 2 });
    });

    it('ignores undefined values in variables when computing the lookup key', () => {
      const graph = makeGraph();

      // Seed using cleaned variables { a: 1 }
      const seeded = { type: 'query', query: DUMMY_QUERY, variables: { a: 1 } };
      const seededKey = getOperationKey(seeded);
      graph.putOperation(seededKey, { data: { hit: true }, variables: seeded.variables });

      // Lookup with { a: 1, b: undefined } should still hit the same entry
      const lookupOp = { type: 'query', query: DUMMY_QUERY, variables: { a: 1, b: undefined as any } };
      const hit = (graph as any).lookupOperation(lookupOp);

      expect(hit).toBeTruthy();
      expect(hit!.key).toBe(seededKey);
      expect(hit!.entry.data).toEqual({ hit: true });
      expect(hit!.entry.variables).toEqual({ a: 1 });
    });

    it('returns null when there is no matching cache entry', () => {
      const graph = makeGraph();

      const missOp = { type: 'query', query: DUMMY_QUERY, variables: { z: 9 } };
      const hit = (graph as any).lookupOperation(missOp);

      expect(hit).toBeNull();
    });

    it('does not mutate the operationStore size during lookup', () => {
      const graph = makeGraph();

      const op = { type: 'query', query: DUMMY_QUERY, variables: { a: 1 } };
      const key = getOperationKey(op);
      graph.putOperation(key, { data: { ok: true }, variables: op.variables });

      const sizeBefore = graph.operationStore.size;
      const hit = (graph as any).lookupOperation(op);
      const sizeAfter = graph.operationStore.size;

      expect(hit).toBeTruthy();
      expect(sizeAfter).toBe(sizeBefore);
    });

    it('handles empty/undefined variables consistently', () => {
      const graph = makeGraph();

      // Seed with no variables
      const seeded = { type: 'query', query: DUMMY_QUERY, variables: {} as Record<string, any> };
      const seededKey = getOperationKey(seeded);
      graph.putOperation(seededKey, { data: { ok: 'empty' }, variables: {} });

      // Lookup with undefined variables
      const lookupOp = { type: 'query', query: DUMMY_QUERY, variables: undefined as any };
      const hit = (graph as any).lookupOperation(lookupOp);

      expect(hit).toBeTruthy();
      expect(hit!.key).toBe(seededKey);
      expect(hit!.entry.data).toEqual({ ok: 'empty' });
    });

    // ─────────────────────────────────────────────────────────────────────
    // Cursor-aware tests (guard against fallback to baseline for pages)
    // ─────────────────────────────────────────────────────────────────────
    it('does NOT fall back to baseline for {after}', () => {
      const graph = makeGraph();

      const CURSOR_QUERY = `
        query Posts($filter: String, $first:Int, $after:String){
          posts(filter:$filter, first:$first, after:$after){
            edges { cursor node { __typename id title } }
            pageInfo { endCursor }
          }
        }
      `;

      // store only baseline (no cursor)
      const baseOp = { type: 'query', query: CURSOR_QUERY, variables: { filter: 'A', first: 2 } };
      const baseKey = getOperationKey(baseOp as any);
      graph.putOperation(baseKey, {
        data: { __typename: 'Query', posts: { __typename: 'PostConnection', edges: [], pageInfo: {} } },
        variables: baseOp.variables,
      });

      // lookup with after -> must **not** return the baseline
      const cursorOp = { type: 'query', query: CURSOR_QUERY, variables: { filter: 'A', first: 2, after: 'c2' } };
      const hit = (graph as any).lookupOperation(cursorOp);
      expect(hit).toBeNull();
    });

    it('still returns the exact hit when the exact cursor page is cached', () => {
      const graph = makeGraph();

      const CURSOR_QUERY = `
        query Posts($filter: String, $first:Int, $after:String){
          posts(filter:$filter, first:$first, after:$after){
            edges { cursor node { __typename id title } }
            pageInfo { endCursor }
          }
        }
      `;

      const cursorOp = { type: 'query', query: CURSOR_QUERY, variables: { filter: 'A', first: 2, after: 'c2' } };
      const cursorKey = getOperationKey(cursorOp as any);

      graph.putOperation(cursorKey, {
        data: { __typename: 'Query', posts: { __typename: 'PostConnection', edges: [], pageInfo: { endCursor: 'c2' } } },
        variables: cursorOp.variables,
      });

      const hit = (graph as any).lookupOperation(cursorOp);
      expect(hit).not.toBeNull();
      expect(hit!.key).toBe(cursorKey);
    });
  });
});
