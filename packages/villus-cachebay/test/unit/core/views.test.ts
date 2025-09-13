import { describe, it, expect, vi } from 'vitest';
import { reactive, isReactive } from 'vue';
import { createViews } from '@/src/core/views';

// Minimal mock of GraphAPI used by views
export function createGraphMock(overrides: any = {}) {
  const entityStore = overrides.entityStore ?? new Map<string, any>();
  const connectionStore = overrides.connectionStore ?? new Map<string, any>();
  const operationStore = overrides.operationStore ?? new Map<string, any>();

  function ensureConnection(key: string) {
    let st = connectionStore.get(key);
    if (!st) {
      st = {
        list: [] as Array<{ key: string; cursor: string | null; edge?: Record<string, any> }>,
        pageInfo: {} as Record<string, any>,
        meta: {} as Record<string, any>,
        views: new Set<any>(),
        keySet: new Set<string>(),
        initialized: false,
      };
      connectionStore.set(key, st);
    }
    return st;
  }

  function getEntityParentKey(typename: string, id?: any) {
    return typename === 'Query' ? 'Query' : (id == null ? null : `${typename}:${id}`);
  }

  // Operation cache lookup: try base key, then cleaned-vars key (strip undefined)
  function lookupOperation(op: { type: string; query: any; variables?: Record<string, any>; context?: any }) {
    const baseKey = getOperationKey(op);
    const byBase = operationStore.get(baseKey);
    if (byBase) return { key: baseKey, entry: byBase };

    const cleaned = cleanVars(op.variables);
    const sameShape =
      op.variables &&
      Object.keys(op.variables).every((k) => (op.variables as any)[k] !== undefined);
    if (!sameShape) {
      const altKey = getOperationKey({ ...op, variables: cleaned } as any);
      const byAlt = operationStore.get(altKey);
      if (byAlt) return { key: altKey, entry: byAlt };
    }
    return null;
  }

  return {
    // stores
    entityStore,
    connectionStore,
    operationStore,

    // entity helpers
    identify: vi.fn((o: any) =>
      o && o.__typename && o.id != null ? `${o.__typename}:${String(o.id)}` : null
    ),

    // materialize returns a reactive proxy with identity + snapshot fields
    materializeEntity: vi.fn((key: string) => {
      const [t, id] = key.includes(':') ? key.split(':') : [key, undefined];
      const snap = entityStore.get(key) || {};
      return reactive({ __typename: t, ...(id ? { id } : {}), ...snap });
    }),

    // getEntity returns a reactive snapshot (no identity) for UI reads
    getEntity: vi.fn((key: string) => {
      const snap = entityStore.get(key) || {};
      return reactive({ ...snap });
    }),

    // connection helpers
    ensureConnection: vi.fn(ensureConnection),
    getEntityParentKey: vi.fn(getEntityParentKey),

    // operation cache helpers
    putOperation: vi.fn((key: string, payload: any) => operationStore.set(key, payload)),
    lookupOperation: vi.fn(lookupOperation),

    // allow test-specific overrides to win
    ...overrides,
  };
}

describe('core/views', () => {
  describe('createViews', () => {
    it('exposes view helpers', () => {
      const graph = createGraphMock();
      const views = createViews({}, { graph });
      expect(views).toHaveProperty('proxyForEntityKey');
      expect(views).toHaveProperty('materializeResult');
      expect(views).toHaveProperty('createConnectionView');
      expect(views).toHaveProperty('setViewLimit');
      expect(views).toHaveProperty('synchronizeConnectionViews');
      expect(views).toHaveProperty('gcConnections');
    });
  });

  describe('proxyForEntityKey', () => {
    it('returns a reactive object for an entity key', () => {
      const store = new Map([['User:1', { name: 'Test' }]]);
      const graph = createGraphMock({ entityStore: store });
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
      const graph = createGraphMock({ entityStore: store });
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
    it('createConnectionView attaches a view and synchronizeConnectionViews populates edges/nodes', () => {
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
      } as any;

      const store = new Map([
        ['User:1', { name: 'A' }],
        ['User:2', { name: 'B' }],
      ]);

      const graph = createGraphMock({ entityStore: store });
      const views = createViews({}, { graph });

      // Create a view limited to 1 item
      const view = views.createConnectionView(connectionState, { limit: 1 });

      // Sync connection to view
      views.synchronizeConnectionViews(connectionState);

      expect(Array.isArray(view.edges)).toBe(true);
      expect(view.edges.length).toBe(1);
      expect(view.edges[0].cursor).toBe('c1');
      expect(view.edges[0].node.__typename).toBe('User');
      expect(view.edges[0].node.id).toBe('1');
      expect(view.edges[0].node.name).toBe('A');

      // Increase limit and sync again
      views.setViewLimit(view, 2);
      views.synchronizeConnectionViews(connectionState);
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
      const graph = createGraphMock({ connectionStore });
      const views = createViews({}, { graph });

      views.gcConnections();

      expect(connectionStore.has('conn1')).toBe(false);
      expect(connectionStore.has('conn2')).toBe(true);
    });
  });
});

describe('createViewSession', () => {
  it('creates a per-session view for a baseline payload and sizes it to payload edges length', () => {
    const graph = createGraphMock();
    const views = createViews({}, { graph: graph as any });

    // Pre-populate connection state like a relay resolver would do
    const connKey = 'Query.posts()';
    const state = graph.ensureConnection(connKey);
    state.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
    ];
    state.pageInfo = { endCursor: 'c2', hasNextPage: true };

    // Baseline (no cursor) payload
    const data = {
      __typename: 'Query',
      posts: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };

    const session = views.createViewSession();
    session.wireConnections(data, { first: 2 });

    expect(state.views.size).toBe(1);
    const view = Array.from(state.views)[0];
    // baseline → sized to payload edges length
    expect(view.limit).toBe(2);
    // containers attached to payload
    expect(data.posts.edges).toBe(view.edges);
    expect(data.posts.pageInfo).toBe(view.pageInfo);
    // edges synchronized
    expect(view.edges.length).toBe(2);
    expect(view.edges[0].cursor).toBe('c1');
    expect(view.edges[1].cursor).toBe('c2');
  });

  it('reuses the same view for cursor pages and grows the window to the union size', () => {
    const graph = createGraphMock();
    const views = createViews({}, { graph: graph as any });

    // Pre-populate state with page 1
    const connKey = 'Query.posts()';
    const state = graph.ensureConnection(connKey);
    state.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
    ];
    state.pageInfo = { endCursor: 'c2', hasNextPage: true };

    const session = views.createViewSession();

    // baseline wire
    const data1 = {
      __typename: 'Query',
      posts: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };
    session.wireConnections(data1, { first: 2 });
    const view1 = Array.from(state.views)[0];

    // simulate resolver merged page 2
    state.list.push({ key: 'Post:3', cursor: 'c3' }, { key: 'Post:4', cursor: 'c4' });
    state.pageInfo = { endCursor: 'c4', hasNextPage: true };

    // cursor page wire (after)
    const data2 = {
      __typename: 'Query',
      posts: {
        edges: [
          { cursor: 'c3', node: { __typename: 'Post', id: '3' } },
          { cursor: 'c4', node: { __typename: 'Post', id: '4' } },
        ],
        pageInfo: { endCursor: 'c4', hasNextPage: true },
      },
    };
    session.wireConnections(data2, { after: 'c2', first: 2 });

    const view2 = Array.from(state.views)[0];
    // same view reused
    expect(view2).toBe(view1);
    // cursor page → window grows to union size (4)
    expect(view2.limit).toBe(4);
    expect(view2.edges.length).toBe(4);
    expect(view2.edges[3].cursor).toBe('c4');
  });

  it('two sessions produce two independent views over the same connection state', () => {
    const graph = createGraphMock();
    const views = createViews({}, { graph: graph as any });

    const connKey = 'Query.posts()';
    const state = graph.ensureConnection(connKey);
    state.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
    ];
    state.pageInfo = { endCursor: 'c2', hasNextPage: true };

    const data = {
      __typename: 'Query',
      posts: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };

    const s1 = views.createViewSession();
    const s2 = views.createViewSession();

    s1.wireConnections(data, { first: 2 });
    s2.wireConnections(data, { first: 2 });

    expect(state.views.size).toBe(2);
    const [v1, v2] = Array.from(state.views);
    expect(v1).not.toBe(v2);
    expect(v1.edges.length).toBe(2);
    expect(v2.edges.length).toBe(2);
  });

  it('destroy clears the session map so a new wire creates a new view object', () => {
    const graph = createGraphMock();
    const views = createViews({}, { graph: graph as any });

    const connKey = 'Query.posts()';
    const state = graph.ensureConnection(connKey);
    state.list = [{ key: 'Post:1', cursor: 'c1' }];
    state.pageInfo = { endCursor: 'c1', hasNextPage: true };

    const data = {
      __typename: 'Query',
      posts: {
        edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
        pageInfo: { endCursor: 'c1', hasNextPage: true },
      },
    };

    const s = views.createViewSession();
    s.wireConnections(data, { first: 1 });
    const firstView = Array.from(state.views)[0];

    s.destroy(); // clear session’s viewByConnKey

    // Wire again; session should create a new view (old view remains in state)
    s.wireConnections(data, { first: 1 });
    const viewsArr = Array.from(state.views);
    expect(viewsArr.length).toBe(2);
    const secondView = viewsArr[1];
    expect(secondView).not.toBe(firstView);
  });
});
