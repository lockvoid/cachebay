import { describe, it, expect, vi } from 'vitest';
import { createSSR } from '@/src/features/ssr';

// ─────────────────────────────────────────────────────────────────────────────
// Graph mock
// ─────────────────────────────────────────────────────────────────────────────
function createGraphMock() {
  const entityStore = new Map<string, any>();
  const connectionStore = new Map<string, any>();
  const operationStore = new Map<string, { data: any; variables: Record<string, any> }>();

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

  return {
    entityStore,
    connectionStore,
    operationStore,
    ensureConnection,
    getEntityParentKey,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolvers mock — view-agnostic relay merge
// ─────────────────────────────────────────────────────────────────────────────
function createResolversMock(graph: ReturnType<typeof createGraphMock>) {
  return {
    applyResolversOnGraph: vi.fn((root: any, vars: Record<string, any>) => {
      const stack = [{ node: root, parent: 'Query' as string | null }];
      while (stack.length) {
        const { node, parent } = stack.pop()!;
        const t = node?.__typename ?? parent;
        for (const f of Object.keys(node || {})) {
          const val = (node as any)[f];
          if (!val || typeof val !== 'object') continue;

          if (Array.isArray(val.edges) && val.pageInfo && typeof val.pageInfo === 'object') {
            // merge into state
            const parentKey = graph.getEntityParentKey(t!, (node as any).id);
            const filtered = { ...vars }; delete (filtered as any).after; delete (filtered as any).before; delete (filtered as any).first; delete (filtered as any).last;
            const id = Object.keys(filtered).sort().map(k => `${k}:${JSON.stringify((filtered as any)[k])}`).join('|');
            const connKey = `${parentKey}.${f}(${id})`;

            const state = graph.ensureConnection(connKey);

            // baseline replaces; cursor pages append/prepend
            if (!(vars.after != null || vars.before != null)) {
              state.list.length = 0; state.keySet.clear();
            }

            for (const e of val.edges) {
              const k = `${e.node.__typename}:${e.node.id}`;
              if (!state.keySet.has(k)) {
                state.list.push({ key: k, cursor: e.cursor });
                state.keySet.add(k);
              }
            }
            Object.assign(state.pageInfo, val.pageInfo);
            state.initialized = true;
            continue;
          }

          if (Array.isArray(val)) {
            for (const it of val) if (it && typeof it === 'object') stack.push({ node: it, parent: t });
          } else {
            stack.push({ node: val, parent: t });
          }
        }
      }
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('SSR dehydrate/hydrate (new system)', () => {
  it('dehydrate returns entities, connections and operations-cache snapshots', () => {
    const graph = createGraphMock();

    // seed entity
    graph.entityStore.set('Color:1', { name: 'Black' });

    // seed connection
    const st = graph.ensureConnection('Query.colors()');
    st.list.push({ key: 'Color:1', cursor: 'c1' });
    st.pageInfo = { endCursor: 'c1', hasNextPage: false };
    st.meta = { foo: 'bar' };
    st.keySet.add('Color:1');
    st.initialized = true;

    // seed operation cache
    graph.operationStore.set('opKey', {
      data: {
        __typename: 'Query',
        colors: {
          edges: [{ cursor: 'c1', node: { __typename: 'Color', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: false },
        },
      },
      variables: { first: 1 },
    });

    const ssr = createSSR({ graph });
    const snap = ssr.dehydrate();

    expect(Array.isArray(snap.entities)).toBe(true);
    expect(Array.isArray(snap.connections)).toBe(true);
    expect(Array.isArray(snap.operations)).toBe(true);
    expect(snap.connections[0][0]).toBe('Query.colors()');
  });

  it('hydrate restores entities, connections and operations-cache', () => {
    const graphA = createGraphMock();

    // prior cache state
    graphA.entityStore.set('Color:1', { name: 'Black' });
    const stA = graphA.ensureConnection('Query.colors()');
    stA.list.push({ key: 'Color:1', cursor: 'c1' });
    stA.pageInfo = { endCursor: 'c1', hasNextPage: false };
    stA.meta = { foo: 'bar' };
    stA.keySet.add('Color:1');
    stA.initialized = true;
    graphA.operationStore.set('opKey', {
      data: {
        __typename: 'Query',
        colors: {
          edges: [{ cursor: 'c1', node: { __typename: 'Color', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: false },
        },
      },
      variables: { first: 1 },
    });

    const ssrA = createSSR({ graph: graphA });
    const snap = ssrA.dehydrate();

    // hydrate into a fresh graph
    const graphB = createGraphMock();
    const ssrB = createSSR({ graph: graphB });
    ssrB.hydrate(snap);

    expect(graphB.entityStore.get('Color:1')).toEqual({ name: 'Black' });

    const stB = graphB.connectionStore.get('Query.colors()');
    expect(stB).toBeTruthy();
    expect(stB.list[0].key).toBe('Color:1');
    expect(stB.pageInfo).toEqual({ endCursor: 'c1', hasNextPage: false });
    expect(stB.meta).toEqual({ foo: 'bar' });
    expect(graphB.operationStore.get('opKey')?.variables).toEqual({ first: 1 });
  });

  it('hydrate({ materialize:true }) applies resolvers to rebuild connection state from operations-cache', async () => {
    const graph = createGraphMock();
    const resolvers = createResolversMock(graph);
    const ssr = createSSR({ graph, resolvers });

    // snapshot with only operations-cache (no prebuilt connections)
    const snap = {
      entities: [] as any[],
      connections: [] as any[],
      operations: [
        [
          'opKey',
          {
            data: {
              __typename: 'Query',
              colors: {
                edges: [
                  { cursor: 'c1', node: { __typename: 'Color', id: '1' } },
                  { cursor: 'c2', node: { __typename: 'Color', id: '2' } },
                ],
                pageInfo: { endCursor: 'c2', hasNextPage: true },
              },
            },
            variables: { first: 2 },
          },
        ],
      ],
    };

    ssr.hydrate(snap, { materialize: true });

    // connection state should be built by applyResolversOnGraph
    const st = graph.connectionStore.values().next().value;
    expect(st.list.map((e: any) => e.key)).toEqual(['Color:1', 'Color:2']);
    expect(st.pageInfo).toEqual({ endCursor: 'c2', hasNextPage: true });
  });

  it('hydrate drops tickets by default and respects rabbit:false', () => {
    const graph = createGraphMock();
    const ssr = createSSR({ graph });

    const snap = {
      entities: [],
      connections: [],
      operations: [
        ['k1', { data: { d: 1 }, variables: {} }],
        ['k2', { data: { d: 2 }, variables: {} }],
      ],
    };

    ssr.hydrate(snap); // default rabbit=true
    expect(ssr.hydrateOperationTicket.has('k1')).toBe(true);
    expect(ssr.hydrateOperationTicket.has('k2')).toBe(true);

    const graph2 = createGraphMock();
    const ssr2 = createSSR({ graph: graph2 });
    ssr2.hydrate(snap, { rabbit: false });
    expect(ssr2.hydrateOperationTicket.size).toBe(0);
  });

  it('isHydrating flips to false on the next microtask', async () => {
    const graph = createGraphMock();
    const ssr = createSSR({ graph });

    const snap = { entities: [], connections: [], operations: [] };
    ssr.hydrate(snap);
    expect(ssr.isHydrating()).toBe(true);

    // allow the queued microtask to run
    await Promise.resolve();
    expect(ssr.isHydrating()).toBe(false);
  });

  it('hydrate accepts a function and is idempotent', () => {
    const graph = createGraphMock();
    const ssr = createSSR({ graph });

    // seed a snapshot with one entity
    const snap = {
      entities: [['T:1', { v: 1 }]],
      connections: [],
      operations: [],
    };

    ssr.hydrate((hydrate: any) => hydrate(snap));
    expect(graph.entityStore.get('T:1')).toEqual({ v: 1 });

    // hydrate again should not duplicate entries or fail
    ssr.hydrate(snap);
    expect(graph.entityStore.get('T:1')).toEqual({ v: 1 });
  });
});
