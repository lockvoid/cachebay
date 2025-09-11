import { describe, it, expect, beforeEach } from 'vitest';
import { isReactive, isRef } from 'vue';
import { createGraph } from '@/src/core/graph';
import { createCache } from '@/src';
import { tick } from '@/test/helpers';

// ============================================================================
// ISOLATED UNIT TESTS FOR createGraph
// ============================================================================

describe('createGraph - Unit Tests', () => {
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

  // Configuration properties are no longer exposed - they're internal

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

    it('should return null for objects without typename', () => {
      expect(graph.identify({ id: '123' })).toBe(null);
      expect(graph.identify(null)).toBe(null);
      expect(graph.identify(undefined)).toBe(null);
    });

    it('should return null for objects without id', () => {
      expect(graph.identify({ __typename: 'Product' })).toBe(null);
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

  describe('putEntity', () => {
    it('should store entity snapshot with replace policy', () => {
      const obj = { __typename: 'User', id: '1', name: 'Alice', age: 30 };
      const key = graph.putEntity(obj);
      
      expect(key).toBe('User:1');
      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Alice', age: 30 });
      // __typename, id, _id should be excluded
      expect(stored.__typename).toBeUndefined();
      expect(stored.id).toBeUndefined();
    });

    it('should merge entity fields with merge policy', () => {
      // First write
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      
      // Merge write
      graph.putEntity(
        { __typename: 'User', id: '1', age: 30 },
        'merge'
      );
      
      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Alice', age: 30 });
    });

    it('should replace entity fields with replace policy', () => {
      // First write
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice', age: 25 });
      
      // Replace write
      graph.putEntity(
        { __typename: 'User', id: '1', name: 'Bob' },
        'replace'
      );
      
      const stored = graph.entityStore.get('User:1');
      expect(stored).toEqual({ name: 'Bob' });
      expect(stored.age).toBeUndefined();
    });

    it('should return null for objects without valid key', () => {
      expect(graph.putEntity({ name: 'No typename' })).toBe(null);
      expect(graph.putEntity({ __typename: 'User' })).toBe(null);
    });

    it('should bump entities tick on first entity creation', () => {
      const initialTick = graph.entitiesTick.value;
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      expect(graph.entitiesTick.value).toBe(initialTick + 1);
      
      // Update should not bump tick
      graph.putEntity({ __typename: 'User', id: '1', name: 'Bob' });
      expect(graph.entitiesTick.value).toBe(initialTick + 1);
    });
  });

  describe('ensureReactiveConnection', () => {
    it('should create new connection state if not exists', () => {
      const state = graph.ensureReactiveConnection('Query.users');
      
      expect(state).toBeDefined();
      expect(state.list).toEqual([]);
      expect(state.pageInfo).toBeDefined();
      expect(state.meta).toBeDefined();
      expect(state.views).toBeInstanceOf(Set);
      expect(state.keySet).toBeInstanceOf(Set);
      expect(state.initialized).toBe(false);
      expect((state as any).window).toBe(0);
      expect(state.__key).toBe('Query.users');
      
      // Check reactivity
      expect(isReactive(state.pageInfo)).toBe(true);
      expect(isReactive(state.meta)).toBe(true);
    });

    it('should return existing connection state', () => {
      const state1 = graph.ensureReactiveConnection('Query.posts');
      state1.initialized = true;
      
      const state2 = graph.ensureReactiveConnection('Query.posts');
      expect(state2).toBe(state1);
      expect(state2.initialized).toBe(true);
      
      // Check reactivity is preserved
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
        // Store a User entity
        graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
        
        // Node:1 should resolve to User:1
        expect(graph.resolveEntityKey('Node:1')).toBe('User:1');
      });

      it('should return null if no concrete implementation exists', () => {
        expect(graph.resolveEntityKey('Node:999')).toBe(null);
      });

      it('should return first matching implementation', () => {
        // Store both User and Post with same id
        graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
        graph.putEntity({ __typename: 'Post', id: '1', title: 'Hello' });
        
        // Should return first in implementation list
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
      if (typeof (globalThis as any).WeakRef === 'undefined') {
        // Skip test in environments without WeakRef
        return;
      }
      
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      
      const mat1 = graph.materializeEntity('User:1');
      const mat2 = graph.materializeEntity('User:1');
      
      // Should return same object reference
      expect(mat1).toBe(mat2);
    });

    it('should update cached materialized entity', () => {
      if (typeof (globalThis as any).WeakRef === 'undefined') {
        return;
      }
      
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      const mat1 = graph.materializeEntity('User:1');
      
      // Update entity
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice', age: 31 });
      const mat2 = graph.materializeEntity('User:1');
      
      // Should be same reference but updated
      expect(mat1).toBe(mat2);
      expect(mat2.age).toBe(31);
    });
  });

  describe('getReactiveEntity', () => {
    it('should return reactive entity data', () => {
      const entityData = { __typename: 'User', id: '1', name: 'Alice', age: 30 };
      graph.putEntity(entityData);
      
      const reactiveEntity = graph.getReactiveEntity('User:1');
      
      // getReactiveEntity returns stored fields (excluding __typename and id)
      expect(reactiveEntity).toEqual({ name: 'Alice', age: 30 });
      expect(isReactive(reactiveEntity)).toBe(true);
    });

    it('should return undefined for non-existent entities', () => {
      const result = graph.getReactiveEntity('User:999');
      expect(result).toBeUndefined();
    });

    it('should return reactive nested objects in deep mode', () => {
      const entityData = {
        __typename: 'User',
        id: '1',
        profile: { name: 'Alice', settings: { theme: 'dark' } }
      };
      graph.putEntity(entityData);
      
      const reactiveEntity = graph.getReactiveEntity('User:1');
      
      // Should return stored fields only
      expect(reactiveEntity).toEqual({ profile: { name: 'Alice', settings: { theme: 'dark' } } });
      expect(isReactive(reactiveEntity)).toBe(true);
      expect(isReactive(reactiveEntity.profile)).toBe(true);
      expect(isReactive(reactiveEntity.profile.settings)).toBe(true);
    });

    it('should use shallow reactivity when configured', () => {
      // Create graph with shallow reactivity
      const shallowGraph = createGraph({
        writePolicy: 'replace',
        interfaces: {},
        reactiveMode: 'shallow',
        keys: {}
      });
      
      const entityData = {
        __typename: 'User',
        id: '1',
        profile: { name: 'Alice', settings: { theme: 'dark' } }
      };
      shallowGraph.putEntity(entityData);
      
      const reactiveEntity = shallowGraph.getReactiveEntity('User:1');
      
      // Should return stored fields only
      expect(reactiveEntity).toEqual({ profile: { name: 'Alice', settings: { theme: 'dark' } } });
      expect(isReactive(reactiveEntity)).toBe(true);
      expect(isReactive(reactiveEntity.profile)).toBe(false); // Should be shallow
    });
  });


  describe('putOperation', () => {
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
      // Fill cache to limit (200)
      for (let i = 0; i < 200; i++) {
        graph.putOperation(`query${i}`, { 
          data: { id: i }, 
          variables: {} 
        });
      }
      
      expect(graph.operationStore.size).toBe(200);
      expect(graph.operationStore.has('query0')).toBe(true);
      
      // Add one more - should evict oldest
      graph.putOperation('query200', { 
        data: { id: 200 }, 
        variables: {} 
      });
      
      expect(graph.operationStore.size).toBe(200);
      expect(graph.operationStore.has('query0')).toBe(false);
      expect(graph.operationStore.has('query200')).toBe(true);
    });
  });

  describe('bumpEntitiesTick', () => {
    it('should increment entities tick', () => {
      const initial = graph.entitiesTick.value;
      
      graph.bumpEntitiesTick();
      expect(graph.entitiesTick.value).toBe(initial + 1);
      
      graph.bumpEntitiesTick();
      expect(graph.entitiesTick.value).toBe(initial + 2);
    });
    
    it('should have reactive entitiesTick', () => {
      expect(isRef(graph.entitiesTick)).toBe(true);
    });
  });

  describe('Store Management', () => {
    it('should expose entity store', () => {
      expect(graph.entityStore).toBeInstanceOf(Map);
      
      graph.putEntity({ __typename: 'User', id: '1', name: 'Alice' });
      expect(graph.entityStore.size).toBe(1);
      expect(graph.entityStore.has('User:1')).toBe(true);
    });

    it('should expose connection store', () => {
      expect(graph.connectionStore).toBeInstanceOf(Map);
      
      graph.ensureReactiveConnection('Query.users');
      expect(graph.connectionStore.size).toBe(1);
      expect(graph.connectionStore.has('Query.users')).toBe(true);
    });

    it('should expose operation cache', () => {
      expect(graph.operationStore).toBeInstanceOf(Map);
      
      graph.putOperation('test', { data: {}, variables: {} });
      expect(graph.operationStore.size).toBe(1);
    });
  });
});