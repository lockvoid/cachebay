import { describe, it, expect, vi } from 'vitest';
import { createFragments } from '@/src/core/fragments';
import { TYPENAME_FIELD } from '@/src/core/constants';
import { createMockGraph, createMockViews, createEntity } from '@/test/helpers/mocks';

describe('core/fragments', () => {
  describe('createFragments', () => {
    it('creates fragment functions with dependencies', () => {
      const mockGraph = createMockGraph();
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });

      expect(fragments).toHaveProperty('identify');
      expect(fragments).toHaveProperty('readFragment');
      expect(fragments).toHaveProperty('hasFragment');
      expect(fragments).toHaveProperty('writeFragment');
      expect(fragments).toHaveProperty('readFragments');
    });
  });

  describe('identify', () => {
    it('delegates to graph.identify', () => {
      const mockGraph = createMockGraph();
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const obj = createEntity('User', 1);
      const result = fragments.identify(obj);

      expect(mockGraph.identify).toHaveBeenCalledWith(obj);
      expect(result).toBe('User:1');
    });
  });

  describe('readFragment', () => {
    it('reads fragment with materialized=true by default', () => {
      const mockGraph = createMockGraph();
      const mockViews = createMockViews({
        proxyForEntityKey: vi.fn(() => ({ name: 'Proxied' }))
      });

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragment('User:1');

      expect(mockViews.proxyForEntityKey).toHaveBeenCalledWith('User:1');
      expect(result).toEqual({ name: 'Proxied' });
    });

    it('reads raw entity when materialized=false', () => {
      const entityStore = new Map([['User:1', { name: 'John' }]]);
      const mockGraph = createMockGraph({ entityStore });
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragment('User:1', false);

      // When materialized=false, it returns directly from entityStore
      expect(result).toEqual({ name: 'John' });
      expect(mockGraph.resolveEntityKey).toHaveBeenCalledWith('User:1');
    });

    it('handles interface types', () => {
      const entityStore = new Map([['User:1', { name: 'Test' }]]);
      const mockGraph = createMockGraph({
        entityStore,
        resolveEntityKey: vi.fn((key) => key === 'Node:1' ? null : key),
        isInterfaceType: vi.fn((t) => t === 'Node'),
        getInterfaceTypes: vi.fn(() => ['User', 'Post'])
      });
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragment('Node:1', false);

      expect(mockGraph.isInterfaceType).toHaveBeenCalledWith('Node');
      expect(mockGraph.getInterfaceTypes).toHaveBeenCalledWith('Node');
      // When interface type is not resolved, it tries each implementation
      expect(result).toEqual({ name: 'Test' });
    });
  });

  describe('hasFragment', () => {
    it('checks for entity in store', () => {
      const entityStore = new Map([['User:1', { name: 'John' }]]);
      const mockGraph = createMockGraph({ entityStore });
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      
      expect(fragments.hasFragment('User:1')).toBe(true);
      expect(fragments.hasFragment('User:2')).toBe(false);
    });
  });

  describe('writeFragment', () => {
    it('creates a transaction with commit and revert', () => {
      const entityStore = new Map();
      const mockGraph = createMockGraph({
        entityStore,
        materializeEntity: vi.fn(() => createEntity('User', 1))
      });
      const mockViews = createMockViews();

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const obj = createEntity('User', 1, { name: 'Test' });
      const tx = fragments.writeFragment(obj);

      expect(tx).toHaveProperty('commit');
      expect(tx).toHaveProperty('revert');

      // writeFragment immediately executes (stores entity and calls hooks)
      expect(entityStore.has('User:1')).toBe(true);
      expect(entityStore.get('User:1')).toEqual({ __typename: 'User', id: 1, name: 'Test' });
      expect(mockGraph.bumpEntitiesTick).toHaveBeenCalled();
      expect(mockViews.markEntityDirty).toHaveBeenCalledWith('User:1');
      expect(mockViews.touchConnectionsForEntityKey).toHaveBeenCalledWith('User:1');
    });
  });

  describe('readFragments', () => {
    it('reads multiple fragments by pattern with :* selector', () => {
      const entityStore = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
        ['User:2', { __typename: 'User', id: 2, name: 'Jane' }],
        ['Post:1', { __typename: 'Post', id: 1, title: 'Hello' }],
      ]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn((pattern) => {
          if (pattern === 'User:') return ['User:1', 'User:2'];
          if (pattern === 'Post:') return ['Post:1'];
          return [];
        }),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn((key) => entityStore.get(key)),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments('User:*');

      expect(mockGraph.getEntityKeys).toHaveBeenCalledWith('User:');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
      expect(result[1]).toEqual({ __typename: 'User', id: 2, name: 'Jane' });
    });

    it('reads single fragment by exact key', () => {
      const entityStore = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
      ]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn((key) => entityStore.get(key)),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments('User:1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
    });

    it('handles multiple patterns in array', () => {
      const entityStore = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
        ['Post:1', { __typename: 'Post', id: 1, title: 'Hello' }],
      ]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn((pattern) => {
          if (pattern === 'User:') return ['User:1'];
          if (pattern === 'Post:') return ['Post:1'];
          return [];
        }),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn((key) => entityStore.get(key)),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments(['User:*', 'Post:*']);

      expect(result).toHaveLength(2);
      expect(result.find(r => r.__typename === 'User')).toEqual({ __typename: 'User', id: 1, name: 'John' });
      expect(result.find(r => r.__typename === 'Post')).toEqual({ __typename: 'Post', id: 1, title: 'Hello' });
    });

    it('returns raw entities when materialized=false', () => {
      const entityStore = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
      ]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn(() => ['User:1']),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments('User:*', { materialized: false });

      expect(mockViews.proxyForEntityKey).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
    });

    it('filters out null/undefined results', () => {
      const entityStore = new Map([
        ['User:1', { __typename: 'User', id: 1, name: 'John' }],
      ]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn(() => ['User:1', 'User:2']), // User:2 doesn't exist
      };
      const mockViews = {
        proxyForEntityKey: vi.fn((key) => entityStore.get(key)), // returns undefined for User:2
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments('User:*');

      expect(result).toHaveLength(1); // Only User:1 should be returned
      expect(result[0]).toEqual({ __typename: 'User', id: 1, name: 'John' });
    });

    it('returns empty array when no matches found', () => {
      const mockGraph = {
        entityStore: new Map(),
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
        getEntityKeys: vi.fn(() => []),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragments('User:*');

      expect(result).toEqual([]);
    });
  });
});
