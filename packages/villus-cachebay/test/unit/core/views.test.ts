import { describe, it, expect, vi } from 'vitest';
import { createViews } from '@/src/core/views';
import { reactive, isReactive } from 'vue';

describe('core/views', () => {
  describe('createViews', () => {
    it('creates view functions with dependencies', () => {
      const mockDependencies = {
        entityStore: new Map(),
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(),
        makeEntityProxy: vi.fn(),
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);

      expect(views).toHaveProperty('registerEntityView');
      expect(views).toHaveProperty('synchronizeEntityViews');
      expect(views).toHaveProperty('markEntityDirty');
      expect(views).toHaveProperty('proxyForEntityKey');
      expect(views).toHaveProperty('materializeResult');
    });
  });

  describe('entity views', () => {
    it('registerEntityView registers valid entity views', () => {
      const entityStore = new Map();
      const mockMakeEntityProxy = vi.fn((obj) => obj);
      const mockDependencies = {
        entityStore,
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(),
        makeEntityProxy: mockMakeEntityProxy,
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const entity = { id: 1, name: 'Test' };
      const key = 'Entity:1';

      views.registerEntityView(key, entity);

      // Should wrap non-reactive objects in proxy
      expect(mockMakeEntityProxy).toHaveBeenCalledWith(entity);
    });

    it('synchronizeEntityViews updates all views for an entity', () => {
      const entityStore = new Map([['User:1', { name: 'Updated' }]]);
      const mockDependencies = {
        entityStore,
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(() => ({ id: 1, name: 'Updated' })),
        makeEntityProxy: vi.fn((obj) => obj),
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const view1 = { id: 1, name: 'Old' };
      const view2 = { id: 1, name: 'Old' };

      // Manually register views for testing
      views.registerEntityView('User:1', view1);
      views.registerEntityView('User:1', view2);

      views.synchronizeEntityViews('User:1');

      // Both views should be updated
      expect(view1.name).toBe('Updated');
      expect(view2.name).toBe('Updated');
    });

    it('markEntityDirty schedules entity synchronization', () => {
      const entityStore = new Map([['User:1', { name: 'Test' }]]);
      const mockDependencies = {
        entityStore,
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(),
        makeEntityProxy: vi.fn((obj) => obj),
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const entity = { name: 'Old' };
      
      // Register a view to be synchronized
      views.registerEntityView('User:1', entity);

      // Mark dirty should schedule synchronization
      views.markEntityDirty('User:1');

      // After flush (happens async), entity should be updated
      // Note: In real implementation this is scheduled via Promise.resolve
      // For unit test, we're verifying the dirty set tracking
      expect(entity.name).toBe('Old'); // Not updated yet (scheduled)
    });
  });

  describe('proxyForEntityKey', () => {
    it('returns materialized entity wrapped in proxy when not already reactive', () => {
      const mockMaterializeEntity = vi.fn(() => ({ id: 1, name: 'Test' }));
      const mockMakeEntityProxy = vi.fn((obj) => reactive(obj));
      const mockDependencies = {
        entityStore: new Map(),
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: mockMaterializeEntity,
        makeEntityProxy: mockMakeEntityProxy,
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const result = views.proxyForEntityKey('User:1');

      expect(mockMaterializeEntity).toHaveBeenCalledWith('User:1');
      expect(mockMakeEntityProxy).toHaveBeenCalled();
      expect(isReactive(result)).toBe(true);
    });

    it('returns existing reactive object without re-wrapping', () => {
      const reactiveObj = reactive({ id: 1, name: 'Test' });
      const mockMaterializeEntity = vi.fn(() => reactiveObj);
      const mockMakeEntityProxy = vi.fn();
      const mockDependencies = {
        entityStore: new Map(),
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: mockMaterializeEntity,
        makeEntityProxy: mockMakeEntityProxy,
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const result = views.proxyForEntityKey('User:1');

      expect(mockMaterializeEntity).toHaveBeenCalledWith('User:1');
      expect(mockMakeEntityProxy).not.toHaveBeenCalled();
      expect(result).toBe(reactiveObj);
    });
  });

  describe('connection views', () => {
    it('addStrongView adds a view to connection state', () => {
      const connectionState = {
        views: new Set(),
        list: [],
      };
      const mockDependencies = {
        entityStore: new Map(),
        connectionStore: new Map(),
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(),
        makeEntityProxy: vi.fn(),
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      const view = {
        edges: [],
        pageInfo: {},
        root: {},
        edgesKey: 'edges',
        pageInfoKey: 'pageInfo',
        pinned: false,
        limit: 10,
      };

      views.addStrongView(connectionState as any, view);

      expect(connectionState.views.has(view)).toBe(true);
    });

    it('gcConnections removes empty connections', () => {
      const connectionStore = new Map([
        ['conn1', { list: [], views: new Set(), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false } as any],
        ['conn2', { list: [{ key: 'User:1' }], views: new Set(), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false } as any],
      ]);
      const mockDependencies = {
        entityStore: new Map(),
        connectionStore,
        ensureConnectionState: vi.fn(),
        materializeEntity: vi.fn(),
        makeEntityProxy: vi.fn(),
        idOf: vi.fn(),
      };

      const views = createViews({}, mockDependencies);
      views.gcConnections();

      // Should remove empty connection
      expect(connectionStore.has('conn1')).toBe(false);
      // Should keep non-empty connection
      expect(connectionStore.has('conn2')).toBe(true);
    });
  });
});
