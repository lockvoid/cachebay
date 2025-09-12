import { describe, it, expect } from 'vitest';
import { reactive, isReactive } from 'vue';
import { createViews } from '@/src/core/views';
import { createResolvers } from '@/src/core/resolvers';
import { relay } from '@/src/resolvers/relay';

/** Graph mock close to what views/resolvers expect */
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
    return typename === 'Query' ? 'Query' : null;
  }

  function identify(obj: any) {
    return obj && obj.__typename && obj.id != null ? `${obj.__typename}:${String(obj.id)}` : null;
  }

  function putEntity(node: any, policy: 'merge' | 'replace' = 'merge') {
    const key = identify(node);
    if (!key) return null;
    const dst = entityStore.get(key) || {};
    if (policy === 'replace') {
      const out: any = {};
      for (const k of Object.keys(node)) {
        if (k === '__typename' || k === 'id') continue;
        out[k] = (node as any)[k];
      }
      entityStore.set(key, out);
    } else {
      for (const k of Object.keys(node)) {
        if (k === '__typename' || k === 'id') continue;
        dst[k] = (node as any)[k];
      }
      entityStore.set(key, dst);
    }
    return key;
  }

  function materializeEntity(key: string) {
    const [t, id] = key.includes(':') ? key.split(':') : [key, undefined];
    const snap = entityStore.get(key) || {};
    return reactive({ __typename: t, ...(id ? { id } : {}), ...snap });
  }

  function getEntity(_key: string) {
    return reactive({});
  }

  return {
    entityStore,
    connectionStore,
    ensureConnection,
    getEntityParentKey,
    identify,
    putEntity,
    materializeEntity,
    getEntity,
  };
}

/** utils stub for TYPENAME + path */
const utilsStub = {
  TYPENAME_KEY: '__typename',
  readPathValue: (obj: any, path: string) => {
    if (!obj || !path) return undefined;
    let cur: any = obj;
    for (const seg of path.split('.')) {
      if (cur == null) return undefined;
      cur = cur[seg];
    }
    return cur;
  },
  // no-op field resolvers at unit level (not needed for these scenarios)
  applyFieldResolvers: undefined as any,
};

describe('relay resolver + view session (unit binding of resolvers + views)', () => {
  it('baseline then append: state merges via resolver; view-session wires containers and grows to union', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });

    // Bind resolvers with Query.posts -> relay()
    const { applyResolversOnGraph } = createResolvers(
      { resolvers: { Query: { posts: relay({ paginationMode: 'append' }) } } } as any,
      { graph, views, utils: utilsStub } as any
    );

    const session = views.createViewSession();

    // --- Baseline network frame ---
    const p1 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1', title: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2', title: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };
    applyResolversOnGraph(p1, { first: 2 }, { stale: false });
    session.wireConnections(p1, { first: 2 });

    // Containers re-bound & populated
    expect(isReactive(p1.posts.edges)).toBe(true);
    expect(p1.posts.edges.length).toBe(2);
    expect(p1.posts.edges[0].node.id).toBe('1');

    // --- Cursor network frame (append) ---
    const p2 = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c3', node: { __typename: 'Post', id: '3', title: 'A3' } },
          { cursor: 'c4', node: { __typename: 'Post', id: '4', title: 'A4' } },
        ],
        pageInfo: { endCursor: 'c4', hasNextPage: false },
      },
    };
    // Resolver merges into same ConnectionState (union)
    applyResolversOnGraph(p2, { first: 2, after: 'c2' }, { stale: false });

    const edgesRefBefore = p1.posts.edges;
    session.wireConnections(p2, { first: 2, after: 'c2' });

    // Same containers, larger window
    expect(p2.posts.edges).toBe(edgesRefBefore);
    expect(p2.posts.edges.length).toBe(4);
    expect(p2.posts.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('replace-like baseline: resolver clears canonical list; session sizes window to payload size', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });
    const { applyResolversOnGraph } = createResolvers(
      { resolvers: { Query: { posts: relay({ paginationMode: 'replace' }) } } } as any,
      { graph, views, utils: utilsStub } as any
    );
    const session = views.createViewSession();

    // pretend union existed already in canonical state (not needed; replace will clear)
    const p = {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Post', id: '1', title: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Post', id: '2', title: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    };

    applyResolversOnGraph(p, { first: 2 }, { stale: false });
    session.wireConnections(p, { first: 2 });

    expect(p.posts.edges.length).toBe(2);
    expect(p.posts.edges[0].node.title).toBe('A1');
    expect(p.posts.edges[1].node.title).toBe('A2');
  });
});
