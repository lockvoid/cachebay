import { relay } from '@/src/resolvers/relay';

// Minimal deps test double that satisfies what the resolver touches.
function createDepsMock() {
  const TYPENAME_KEY = '__typename';
  const entityStore = new Map<string, any>();
  const connectionStore = new Map<string, any>();
  const relayResolverIndexByType = new Map<string, Map<string, any>>();

  function setRelayOptionsByType(parentTypename: string, field: string, opts: any) {
    let fm = relayResolverIndexByType.get(parentTypename);
    if (!fm) relayResolverIndexByType.set(parentTypename, fm = new Map());
    fm.set(field, opts);
  }

  function getEntityParentKey(typename: string, id?: any) {
    return typename === 'Query' ? 'Query' : (id == null ? null : `${typename}:${id}`);
  }

  function buildConnectionKey(parent: string, field: string, _opts: any, vars: Record<string, any>) {
    // filter out cursor params (aligns with production)
    const filtered = { ...vars };
    delete (filtered as any).after; delete (filtered as any).before;
    delete (filtered as any).first; delete (filtered as any).last;
    const id = Object.keys(filtered).sort().map(k => `${k}:${JSON.stringify((filtered as any)[k])}`).join('|');
    return `${parent}.${field}(${id})`;
  }

  function ensureConnectionState(key: string) {
    let st = connectionStore.get(key);
    if (!st) {
      st = {
        list: [] as Array<{ key: string; cursor: string | null; edge?: Record<string, any> }>,
        pageInfo: {},
        meta: {},
        views: new Set<any>(),
        keySet: new Set<string>(),
        initialized: false,
      };
      connectionStore.set(key, st);
    }
    return st;
  }

  function readPathValue(obj: any, path: string) {
    if (!obj) return undefined;
    const segs = path.split('.');
    let cur = obj;
    for (const s of segs) {
      if (cur == null) return undefined;
      cur = cur[s];
    }
    return cur;
  }

  function putEntity(node: any, writePolicy?: 'merge' | 'replace') {
    const t = node?.[TYPENAME_KEY];
    const id = node?.id ?? node?._id;
    if (!t || id == null) return null;
    const key = `${t}:${id}`;
    if (writePolicy === 'replace') {
      const dst: any = {};
      for (const k of Object.keys(node)) {
        if (k === TYPENAME_KEY || k === 'id' || k === '_id') continue;
        dst[k] = node[k];
      }
      entityStore.set(key, dst);
    } else {
      const dst = entityStore.get(key) || {};
      for (const k of Object.keys(node)) {
        if (k === TYPENAME_KEY || k === 'id' || k === '_id') continue;
        dst[k] = node[k];
      }
      entityStore.set(key, dst);
    }
    return key;
  }

  function addStrongView(state: any, view: any) { state.views.add(view); }
  function linkEntityToConnection(_k: string, _s: any) { }
  function unlinkEntityFromConnection(_k: string, _s: any) { }
  function markConnectionDirty(_s: any) { }

  function synchronizeConnectionViews(state: any) {
    // Minimal emulation: size each view's edges to min(list.length, limit),
    // copy cursors/pageInfo so tests that look at sizing/merging pass.
    state.views.forEach((view: any) => {
      const cap = view.limit != null ? view.limit : state.list.length;
      const len = Math.min(state.list.length, cap);

      const arr = view.edges;
      // grow/shrink edges array to desired length
      while (arr.length < len) arr.push({});
      if (arr.length > len) arr.splice(len);

      // update cursors (no node proxying needed for unit tests)
      for (let i = 0; i < len; i++) {
        const entry = state.list[i];
        const edge = arr[i];
        edge.cursor = entry.cursor;
        edge.node ||= {}; // stub ok for these tests
      }

      Object.assign(view.pageInfo, state.pageInfo);
    });
  }

  // Return grouped dependencies matching the new structure
  return {
    graph: {
      entityStore,
      connectionStore,
      getEntityParentKey,
      ensureReactiveConnection: ensureConnectionState,
      putEntity,
      identify: (obj: any) => obj?.id,
    },
    views: {
      addStrongView,
      linkEntityToConnection,
      unlinkEntityFromConnection,
      markConnectionDirty,
      synchronizeConnectionViews,
    },
    utils: {
      TYPENAME_KEY,
      setRelayOptionsByType,
      buildConnectionKey,
      readPathValue,
      applyFieldResolvers: undefined,
    },
  };
}

function makeCtx({
  parentTypename = 'Query',
  field = 'assets',
  connectionValue,
  variables = {},
}: {
  parentTypename?: string;
  field?: string;
  connectionValue: any;
  variables?: Record<string, any>;
}) {
  const hint: any = { stale: false };
  const holder = { v: connectionValue };
  return {
    parentTypename,
    field,
    parent: { __typename: parentTypename },
    value: holder.v,
    variables,
    set: (nv: any) => { holder.v = nv; },
    hint,
  };
}

describe('relay resolver (paginationMode + writePolicy)', () => {
  it('replace: initializes list with page 1, sets limit = pageSize', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'replace' });
    const fn = spec.bind(deps);

    const page1 = {
      __typename: 'AssetConnection',
      edges: [
        { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
        { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
      ],
      pageInfo: { endCursor: 'c2', hasNextPage: true },
    };

    const ctx = makeCtx({ connectionValue: page1 });
    fn(ctx);

    // state shape
    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1', 'Asset:2']);

    // view sizing: replace → limit = pageSize
    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(2);
  });

  it('append: adds page 2 after page 1, limit grows by pageSize', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'append' });
    const fn = spec.bind(deps);

    // Page 1 (no after)
    const page1 = {
      edges: [
        { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
        { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
      ],
      pageInfo: { endCursor: 'c2', hasNextPage: true },
    };
    fn(makeCtx({ connectionValue: page1 }));

    // Page 2 (after)
    const page2 = {
      edges: [
        { cursor: 'c3', node: { __typename: 'Asset', id: '3', name: 'A3' } },
        { cursor: 'c4', node: { __typename: 'Asset', id: '4', name: 'A4' } },
      ],
      pageInfo: { endCursor: 'c4', hasNextPage: true },
    };
    fn(makeCtx({ connectionValue: page2, variables: { after: 'c2', first: 2 } }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1', 'Asset:2', 'Asset:3', 'Asset:4']);

    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(4); // 2 + 2
  });

  it('prepend: inserts page 0 before page 1, limit grows by pageSize', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'prepend' });
    const fn = spec.bind(deps);

    // Page 1 baseline
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { startCursor: 'c1', hasPreviousPage: true },
      },
    }));

    // Page 0 (before)
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c0a', node: { __typename: 'Asset', id: '0a', name: 'A0a' } },
          { cursor: 'c0b', node: { __typename: 'Asset', id: '0b', name: 'A0b' } },
        ],
        pageInfo: { startCursor: 'c0a', hasPreviousPage: false },
      },
      variables: { before: 'c1', last: 2 },
    }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:0a', 'Asset:0b', 'Asset:1', 'Asset:2']);

    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(4);
  });

  it('replace is destructive: clears previous list before writing', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'replace' });
    const fn = spec.bind(deps);

    // Page 1
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2' },
      },
    }));

    // Page 2 with replace – prior list must be cleared, leaving only page 2
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c3', node: { __typename: 'Asset', id: '3', name: 'A3' } },
          { cursor: 'c4', node: { __typename: 'Asset', id: '4', name: 'A4' } },
        ],
        pageInfo: { endCursor: 'c4' },
      },
      variables: { after: 'c2', first: 2 },
    }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:3', 'Asset:4']);
    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(2);
  });

  it('dedups nodes by key and updates edge meta in place', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'append' });
    const fn = spec.bind(deps);

    // page with Asset:1 and Asset:2
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' }, score: 10 },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2' },
      },
    }));

    // incoming page updates Asset:1 (same node), not adding a duplicate
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1b', node: { __typename: 'Asset', id: '1', name: 'A1-new' }, score: 99 },
        ],
        pageInfo: { endCursor: 'c1b' },
      },
      variables: { after: 'c2', first: 1 },
    }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.length).toBe(2);
    // Edge meta updated:
    const entry = state.list.find((e: any) => e.key === 'Asset:1');
    expect(entry.cursor).toBe('c1b');
    expect(entry.edge?.score).toBe(99);
    // Entity snapshot updated (writePolicy default "merge"):
    expect(deps.graph.entityStore.get('Asset:1').name).toBe('A1-new');
  });

  it('writePolicy=replace overwrites entity snapshot, merge keeps unknown fields', () => {
    const deps = createDepsMock();
    // First call merges initial entity with extra field
    const specMerge = relay({ paginationMode: 'replace', writePolicy: 'merge' });
    const fnMerge = specMerge.bind(deps);

    fnMerge(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', foo: 1, bar: 2 } },
        ],
        pageInfo: {},
      },
    }));
    expect(deps.graph.entityStore.get('Asset:1')).toEqual({ foo: 1, bar: 2 });

    // Now call with writePolicy: replace and a partial node
    const specReplace = relay({ paginationMode: 'replace', writePolicy: 'replace' });
    const fnReplace = specReplace.bind(deps);

    fnReplace(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1b', node: { __typename: 'Asset', id: '1', foo: 10 } }, // no 'bar'
        ],
        pageInfo: {},
      },
    }));
    // Snapshot should be overwritten to only { foo: 10 }
    expect(deps.graph.entityStore.get('Asset:1')).toEqual({ foo: 10 });
  });

  it('merges pageInfo properties', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'append' });
    const fn = spec.bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [],
        pageInfo: { endCursor: 'x', hasNextPage: true },
      },
    }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.pageInfo).toEqual({ endCursor: 'x', hasNextPage: true });

    // Update pageInfo (flip hasNextPage)
    fn(makeCtx({
      connectionValue: {
        edges: [],
        pageInfo: { endCursor: 'x', hasNextPage: false },
      },
      variables: { after: 'x', first: 0 },
    }));
    expect(state.pageInfo).toEqual({ endCursor: 'x', hasNextPage: false });
  });

  it('sets allowReplayOnStale when after/before is present', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'append' });
    const fn = spec.bind(deps);

    const ctx = makeCtx({
      connectionValue: { edges: [], pageInfo: {} },
      variables: { after: 'c2' },
    });
    fn(ctx);
    expect(ctx.hint.allowReplayOnStale).toBe(true);
  });

  it('supports nested node path (e.g., "item.node")', () => {
    const deps = createDepsMock();
    const spec = relay({ paginationMode: 'replace', node: 'item.node' } as any);
    const fn = spec.bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', item: { node: { __typename: 'Asset', id: '1', name: 'A1' } } },
        ],
        pageInfo: {},
      },
    }));

    const state = deps.graph.connectionStore.values().next().value;
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1']);
  });
});
