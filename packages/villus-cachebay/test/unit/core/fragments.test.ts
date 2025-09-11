import { describe, it, expect, vi } from 'vitest';
import { createFragments } from '@/src/core/fragments';
import { TYPENAME_FIELD } from '@/src/core/constants';

describe('core/fragments', () => {
  describe('createFragments', () => {
    it('creates fragment functions with dependencies', () => {
      const mockGraph = {
        entityStore: new Map(),
        identify: vi.fn(),
        resolveEntityKey: vi.fn(),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });

      expect(fragments).toHaveProperty('identify');
      expect(fragments).toHaveProperty('readFragment');
      expect(fragments).toHaveProperty('hasFragment');
      expect(fragments).toHaveProperty('writeFragment');
    });
  });

  describe('identify', () => {
    it('delegates to graph.identify', () => {
      const mockIdentify = vi.fn((obj) => `${obj.__typename}:${obj.id}`);
      const mockGraph = {
        entityStore: new Map(),
        identify: mockIdentify,
        resolveEntityKey: vi.fn(),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const obj = { __typename: 'User', id: 1 };
      const result = fragments.identify(obj);

      expect(mockIdentify).toHaveBeenCalledWith(obj);
      expect(result).toBe('User:1');
    });
  });

  describe('readFragment', () => {
    it('reads fragment with materialized=true by default', () => {
      const mockProxyForEntityKey = vi.fn(() => ({ name: 'Proxied' }));
      const mockGraph = {
        entityStore: new Map(),
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: mockProxyForEntityKey,
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragment('User:1');

      expect(mockProxyForEntityKey).toHaveBeenCalledWith('User:1');
      expect(result).toEqual({ name: 'Proxied' });
    });

    it('reads raw entity when materialized=false', () => {
      const entityStore = new Map([['User:1', { name: 'John' }]]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const result = fragments.readFragment('User:1', false);

      // When materialized=false, it returns directly from entityStore
      expect(result).toEqual({ name: 'John' });
      expect(mockGraph.resolveEntityKey).toHaveBeenCalledWith('User:1');
    });

    it('handles interface types', () => {
      const entityStore = new Map([['User:1', { name: 'Test' }]]);
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key === 'Node:1' ? null : key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn((t) => t === 'Node'),
        getInterfaceTypes: vi.fn((t) => ['User', 'Post']),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

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
      const mockGraph = {
        entityStore,
        identify: vi.fn(),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: vi.fn(),
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      
      expect(fragments.hasFragment('User:1')).toBe(true);
      expect(fragments.hasFragment('User:2')).toBe(false);
    });
  });

  describe('writeFragment', () => {
    it('creates a transaction with commit and revert', () => {
      const entityStore = new Map();
      const mockMaterializeEntity = vi.fn(() => ({ __typename: 'User', id: 1 }));
      const mockGraph = {
        entityStore,
        identify: vi.fn((obj) => `${obj.__typename}:${obj.id}`),
        resolveEntityKey: vi.fn((key) => key),
        materializeEntity: mockMaterializeEntity,
        bumpEntitiesTick: vi.fn(),
        isInterfaceType: vi.fn(),
        getInterfaceTypes: vi.fn(),
      };
      const mockViews = {
        proxyForEntityKey: vi.fn(),
        markEntityDirty: vi.fn(),
        touchConnectionsForEntityKey: vi.fn(),
      };

      const fragments = createFragments({}, { graph: mockGraph, views: mockViews });
      const obj = { __typename: 'User', id: 1, name: 'Test' };
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
});
