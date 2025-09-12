import { describe, it, expect, vi } from 'vitest';
import { reactive, isReactive } from 'vue';
import { createViews } from '@/src/core/views';

// Minimal mock of GraphAPI used by views
function createMockGraph(overrides: any = {}) {
  const store = overrides.entityStore ?? new Map<string, any>();
  return {
    entityStore: store,
    connectionStore: overrides.connectionStore ?? new Map<string, any>(),
    // identify: typename + id (stringify id)
    identify: vi.fn((o: any) =>
      o && o.__typename && o.id != null ? `${o.__typename}:${String(o.id)}` : null
    ),
    // materialize returns a proxy with identity + snapshot
    materializeEntity: vi.fn((key: string) => {
      const [t, id] = key.includes(':') ? key.split(':') : [key, undefined];
      const snap = store.get(key) || {};
      return reactive({ __typename: t, ...(id ? { id } : {}), ...snap });
    }),
    // getEntity returns a reactive snapshot (no identity) for UI reads
    getEntity: vi.fn((key: string) => {
      const snap = store.get(key) || {};
      return reactive({ ...snap });
    }),
    ensureConnection: vi.fn((key: string) => {
      const existing = (overrides.connectionStore ?? new Map()).get(key);
      return existing || null;
    }),
    ...overrides,
  };
}

describe('core/views', () => {
  describe('createViews', () => {
    it('exposes view helpers', () => {
      const graph = createMockGraph();
      const views = createViews({}, { graph });
      expect(views).toHaveProperty('proxyForEntityKey');
      expect(views).toHaveProperty('materializeResult');
      expect(views).toHaveProperty('createConnectionView');
      expect(views).toHaveProperty('setViewLimit');
      expect(views).toHaveProperty('syncConnection');
      expect(views).toHaveProperty('gcConnections');
    });
  });

  describe('proxyForEntityKey', () => {
    it('returns a reactive object for an entity key', () => {
      const store = new Map([['User:1', { name: 'Test' }]]);
      const graph = createMockGraph({ entityStore: store });
      const views = createViews({}, { graph });

      const res = views.proxyForEntityKey('User:1');
      expect(graph.materializeEntity).toHaveBeenCalledWith('User:1');
      expect(graph.getEntity).toHaveBeenCalledWith('User:1');
      expect(isReactive(res)).toBe(true);
      expect(res).toEqual({ name: 'Test' });
    });
  });

  describe('materializeResult', () => {
    it('replaces node objects with materialized proxies', () => {
      const store = new Map([['User:1', { name: 'A' }]]);
      const graph = createMockGraph({ entityStore: store });
      const views = createViews({}, { graph });

      const root = {
        edges: [{ node: { __typename: 'User', id: 1 } }],
      };
      views.materializeResult(root);
      expect(root.edges[0].node.__typename).toBe('User');
      expect(root.edges[0].node.id).toBe('1');
      expect(root.edges[0].node.name).toBe('A');
    });
  });

  describe('connection views', () => {
    it('createConnectionView attaches a view and syncConnection populates edges/nodes', () => {
      // Prepare a connection state and entity snapshots
      const connectionState = {
        list: [
          { cursor: 'c1', key: 'User:1' },
          { cursor: 'c2', key: 'User:2' },
        ],
        pageInfo: reactive({ endCursor: 'c2', hasNextPage: true }),
        meta: reactive({}),
        views: new Set(),
        keySet: new Set(),
        initialized: true,
        window: 0,
      } as any;

      const store = new Map([
        ['User:1', { name: 'A' }],
        ['User:2', { name: 'B' }],
      ]);

      const graph = createMockGraph({ entityStore: store });
      const views = createViews({}, { graph });

      // Create a view limited to 1 item
      const view = views.createConnectionView(connectionState, { limit: 1 });

      // Sync connection to view
      views.syncConnection(connectionState);

      expect(Array.isArray(view.edges)).toBe(true);
      expect(view.edges.length).toBe(1);
      expect(view.edges[0].cursor).toBe('c1');
      expect(view.edges[0].node.__typename).toBe('User');
      expect(view.edges[0].node.id).toBe('1');
      expect(view.edges[0].node.name).toBe('A');

      // Increase limit and sync again
      views.setViewLimit(view, 2);
      views.syncConnection(connectionState);
      expect(view.edges.length).toBe(2);
      expect(view.edges[1].cursor).toBe('c2');
      expect(view.edges[1].node.name).toBe('B');

      // pageInfo copied
      expect(view.pageInfo.endCursor).toBe('c2');
      expect(view.pageInfo.hasNextPage).toBe(true);
    });

    it('gcConnections removes entries with no views', () => {
      const connectionStore = new Map<string, any>([
        ['conn1', { list: [], views: new Set(), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false }],
        ['conn2', { list: [], views: new Set([{}]), pageInfo: {}, meta: {}, keySet: new Set(), initialized: false }],
      ]);
      const graph = createMockGraph({ connectionStore });
      const views = createViews({}, { graph });

      views.gcConnections();

      expect(connectionStore.has('conn1')).toBe(false);
      expect(connectionStore.has('conn2')).toBe(true);
    });
  });
});