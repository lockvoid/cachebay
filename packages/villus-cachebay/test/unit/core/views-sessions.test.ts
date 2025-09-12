import { describe, it, expect } from 'vitest';
import { reactive, isReactive } from 'vue';
import { createViews } from '@/src/core/views';

/**
 * Minimal graph mock that matches what views.createViewSession expects.
 * We do NOT test the relay resolver here — we simulate the canonical ConnectionState
 * as if the resolver had already merged pages into state.list/pageInfo.
 */
function makeGraphMock() {
  const entityStore = new Map<string, any>();
  const connectionStore = new Map<string, any>();

  function ensureConnection(key: string) {
    let st = connectionStore.get(key);
    if (!st) {
      st = {
        list: [] as Array<{ key: string; cursor: string | null; edge?: Record<string, any> }>,
        pageInfo: {},
        meta: {},
        views: new Set<any>(),
        keySet: new Set<string>(),
        initialized: false,
        _version: 0,
      };
      connectionStore.set(key, st);
    }
    return st;
  }

  function getEntityParentKey(typename: string, _id?: any) {
    // session passes parentTypename + graph.identify(node) for object parents,
    // but for Query we just return 'Query'
    return typename === 'Query' ? 'Query' : null;
  }

  function identify(obj: any) {
    return obj && obj.__typename && obj.id != null ? `${obj.__typename}:${String(obj.id)}` : null;
  }

  function materializeEntity(key: string) {
    // very light proxy: keep identity fields; simulate reactive node proxies
    const [t, id] = key.includes(':') ? key.split(':') : [key, undefined];
    const existing = entityStore.get(key) || {};
    const node = reactive({ __typename: t, ...(id ? { id } : {}), ...existing });
    return node;
  }

  function getEntity(_key: string) {
    // not needed here (views uses materializeEntity for node proxies)
    return reactive({});
  }

  return {
    entityStore,
    connectionStore,
    ensureConnection,
    getEntityParentKey,
    identify,
    materializeEntity,
    getEntity,
  };
}

describe('views.createViewSession (relay wiring, view-agnostic resolver)', () => {
  it('baseline page wires containers and shows page; cursor page grows window to union', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });

    // Prepare canonical state as if relay resolver had merged page 1
    const connKey = 'Query.posts()'; // no vars
    const st = graph.ensureConnection(connKey);
    st.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
    ];
    st.keySet = new Set(['Post:1', 'Post:2']);
    st.pageInfo = { endCursor: 'c2', hasNextPage: true };
    st._version++;

    const session = views.createViewSession();

    // Baseline payload (server page 1): containers present with two edges
    const payload1 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };

    session.wireConnections(payload1, { /* no cursors */ });
    const view1 = payload1.posts;
    expect(Array.isArray(view1.edges)).toBe(true);
    expect(isReactive(view1.edges)).toBe(true);
    expect(view1.edges.length).toBe(2);
    expect(view1.edges[0].node.__typename).toBe('Post');
    expect(view1.edges[0].node.id).toBe('1');

    // Now simulate resolver having appended page 2 into the canonical state
    st.list.push(
      { key: 'Post:3', cursor: 'c3' },
      { key: 'Post:4', cursor: 'c4' },
    );
    st.keySet.add('Post:3'); st.keySet.add('Post:4');
    st.pageInfo = { endCursor: 'c4', hasNextPage: false };
    st._version++;

    // Cursor page payload (server returns only page 2 edges); vars have after → union sizing
    const payload2 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c3', node: { __typename: 'Post', id: '3' } },
          { cursor: 'c4', node: { __typename: 'Post', id: '4' } },
        ],
        pageInfo: { endCursor: 'c4', hasNextPage: false },
      },
    };

    const prevEdgesRef = view1.edges; // keep ref to ensure we reuse the same view containers
    session.wireConnections(payload2, { after: 'c2', first: 2 });
    const view2 = payload2.posts;

    // Same per-session view (same edges array ref) is reused
    expect(view2.edges).toBe(prevEdgesRef);
    // Window grows to union (4) and is synchronized
    expect(view2.edges.length).toBe(4);
    expect(view2.edges[0].node.id).toBe('1');
    expect(view2.edges[3].node.id).toBe('4');
  });

  it('replace-like baseline resets window back to baseline page size', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });
    const session = views.createViewSession();

    // Canonical state has 4 items (e.g., after union)
    const st = graph.ensureConnection('Query.posts()');
    st.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
      { key: 'Post:3', cursor: 'c3' },
      { key: 'Post:4', cursor: 'c4' },
    ];
    st.keySet = new Set(['Post:1', 'Post:2', 'Post:3', 'Post:4']);
    st.pageInfo = { endCursor: 'c4', hasNextPage: false };
    st._version++;

    // Baseline server payload (page 1 only); no cursor → baseline sizing = payload size (2)
    const payload = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };
    session.wireConnections(payload, { /* baseline */ });

    expect(payload.posts.edges.length).toBe(2); // window reset to page size
    expect(payload.posts.edges[0].node.id).toBe('1');
    expect(payload.posts.edges[1].node.id).toBe('2');
  });

  it('reuses the same containers across wires for the same connection key (ignore cursor vars)', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });
    const session = views.createViewSession();

    // Canonical state set to 2
    const st = graph.ensureConnection('Query.posts()');
    st.list = [
      { key: 'Post:1', cursor: 'c1' },
      { key: 'Post:2', cursor: 'c2' },
    ];
    st.keySet = new Set(['Post:1', 'Post:2']);
    st.pageInfo = { endCursor: 'c2' };
    st._version++;

    const p1 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
        pageInfo: {},
      },
    };
    session.wireConnections(p1, { first: 1 });
    const edgesRef1 = p1.posts.edges;

    // same connection with cursor vars (ignored for key) → same view should be reused
    const p2 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [{ cursor: 'c2', node: { __typename: 'Post', id: '2' } }],
        pageInfo: {},
      },
    };
    session.wireConnections(p2, { first: 1, after: 'c1' });
    const edgesRef2 = p2.posts.edges;

    expect(edgesRef2).toBe(edgesRef1);
  });
});
