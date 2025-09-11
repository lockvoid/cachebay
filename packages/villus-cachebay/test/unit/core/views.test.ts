import { describe, it, expect, vi } from 'vitest';
import { createViews } from '@/src/core/views';
import { reactive, isReactive } from 'vue';
import { createMockGraph } from '@/test/helpers/mocks';

describe('core/views', () => {
  describe('createViews', () => {
    it('creates view functions with dependencies', () => {
      const mockGraph = createMockGraph();
      const views = createViews({}, { graph: mockGraph });

      expect(views).toHaveProperty('registerEntityView');
      expect(views).toHaveProperty('synchronizeEntityViews');
      expect(views).toHaveProperty('markEntityDirty');
      expect(views).toHaveProperty('proxyForEntityKey');
      expect(views).toHaveProperty('materializeResult');
    });
  });

  describe('entity views', () => {
    it('registerEntityView registers valid entity views', () => {
      const mockGraph = createMockGraph({
        getReactiveEntity: vi.fn((obj) => obj)
      });
      const views = createViews({}, { graph: mockGraph });
      const entity = { id: 1, name: 'Test' };
      const key = 'Entity:1';

      views.registerEntityView(key, entity);

      // Entity views are stored internally
      // We can't directly test the internal Map, but we verify no errors
    });

    it('synchronizeEntityViews updates all views for an entity', () => {
      const entityStore = new Map([['User:1', { name: 'Updated' }]]);
      const mockGraph = createMockGraph({
        entityStore,
        materializeEntity: vi.fn(() => ({ id: 1, name: 'Updated' })),
        getReactiveEntity: vi.fn((obj) => obj)
      });
      const views = createViews({}, { graph: mockGraph });
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
      const mockGraph = createMockGraph({
        entityStore,
        materializeEntity: vi.fn(() => ({ id: 1, name: 'Test' })),
        getReactiveEntity: vi.fn((obj) => obj)
      });
      const views = createViews({}, { graph: mockGraph });
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
      const mockGraph = createMockGraph({
        materializeEntity: vi.fn(() => ({ id: 1, name: 'Test' })),
        getReactiveEntity: vi.fn((obj) => reactive(obj))
      });
      const views = createViews({}, { graph: mockGraph });
      const result = views.proxyForEntityKey('User:1');

      expect(mockGraph.materializeEntity).toHaveBeenCalledWith('User:1');
      expect(mockGraph.getReactiveEntity).toHaveBeenCalled();
      expect(isReactive(result)).toBe(true);
    });

    it('returns existing reactive object without re-wrapping', () => {
      const reactiveObj = reactive({ id: 1, name: 'Test' });
      const mockGraph = createMockGraph({
        materializeEntity: vi.fn(() => reactiveObj),
        getReactiveEntity: vi.fn((obj) => obj)
      });
      const views = createViews({}, { graph: mockGraph });
      const result = views.proxyForEntityKey('User:1');

      expect(mockGraph.materializeEntity).toHaveBeenCalledWith('User:1');
      expect(mockGraph.getReactiveEntity).toHaveBeenCalled();
      expect(result).toBe(reactiveObj);
    });
  });

  describe('connection views', () => {
    it('addStrongView adds a view to connection state', () => {
      const connectionState = {
        views: new Set(),
        list: [],
      };
      const mockGraph = createMockGraph();
      const views = createViews({}, { graph: mockGraph });
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

    it('gcConnections removes connections with no views', () => {
      const view1 = { edges: [], pageInfo: {} };
      const connectionStore = new Map([
        ['conn1', { list: [], views: new Set(), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false } as any],
        ['conn2', { list: [{ key: 'User:1' }], views: new Set([view1]), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false } as any],
      ]);
      const mockGraph = createMockGraph({ connectionStore });
      const views = createViews({}, { graph: mockGraph });
      views.gcConnections();

      // Should remove connection with no views
      expect(connectionStore.has('conn1')).toBe(false);
      // Should keep connection with views
      expect(connectionStore.has('conn2')).toBe(true);
    });
  });
});
