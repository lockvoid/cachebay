import { describe, it, expect, vi } from 'vitest';
import { buildCachebayPlugin } from '@/src/core/plugin';
import { CombinedError } from 'villus';
import { getOperationKey } from '@/src/core/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Graph mock
// ─────────────────────────────────────────────────────────────────────────────
function createGraphMock() {
  const operationStore = new Map<string, any>();
  const connectionStore = new Map<string, any>();

  function ensureConnection(key: string) {
    let st = connectionStore.get(key);
    if (!st) {
      st = {
        list: [] as Array<{ key: string; cursor: string | null }>,
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

  function lookupOperation(op: any) {
    const baseKey = getOperationKey(op);
    const byBase = operationStore.get(baseKey);
    if (byBase) return { key: baseKey, entry: byBase };

    // cleaned-vars variant (strip undefined)
    const cleaned: Record<string, any> = {};
    const vars = op.variables || {};
    for (const k of Object.keys(vars)) if (vars[k] !== undefined) cleaned[k] = vars[k];

    const sameShape =
      op.variables &&
      Object.keys(op.variables).every((k: string) => op.variables[k] !== undefined);
    if (!sameShape) {
      const altKey = getOperationKey({ ...op, variables: cleaned });
      const byAlt = operationStore.get(altKey);
      if (byAlt) return { key: altKey, entry: byAlt };
    }
    return null;
  }

  return {
    operationStore,
    connectionStore,
    ensureConnection,
    getEntityParentKey,
    lookupOperation,
    putOperation: vi.fn((key: string, payload: any) => operationStore.set(key, payload)),
    identify: (o: any) => (o && o.id != null ? String(o.id) : null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Views mock (per-useQuery sessions + primitives)
// ─────────────────────────────────────────────────────────────────────────────
function createViewsMock(graph: ReturnType<typeof createGraphMock>) {
  function createConnectionView(state: any, opts: any = {}) {
    const view = {
      edges: [] as any[],
      pageInfo: {} as Record<string, any>,
      edgesKey: opts.edgesKey ?? 'edges',
      pageInfoKey: opts.pageInfoKey ?? 'pageInfo',
      limit: Math.max(0, opts.limit ?? 0),
      root: opts.root ?? {},
      pinned: !!opts.pinned,
    };
    state.views.add(view);
    return view;
  }
  function setViewLimit(view: any, n: number) { view.limit = Math.max(0, n | 0); }
  function synchronizeConnectionViews(state: any) {
    for (const v of state.views) {
      const len = Math.min(state.list.length, v.limit);
      while (v.edges.length < len) v.edges.push({});
      if (v.edges.length > len) v.edges.splice(len);
      for (let i = 0; i < len; i++) {
        const entry = state.list[i];
        v.edges[i].cursor = entry.cursor;
        v.edges[i].node ||= {};
      }
      Object.assign(v.pageInfo, state.pageInfo);
    }
  }

  function createViewSession() {
    const viewByConnKey = new Map<string, any>();

    function buildConnKey(parentKey: string, field: string, vars: Record<string, any>) {
      const filtered: Record<string, any> = { ...vars };
      delete filtered.after; delete filtered.before; delete filtered.first; delete filtered.last;
      const id = Object.keys(filtered).sort().map(k => `${k}:${JSON.stringify(filtered[k])}`).join('|');
      return `${parentKey}.${field}(${id})`;
    }

    function wireConnections(root: any, vars: Record<string, any>) {
      if (!root || typeof root !== "object") return;

      const stack: Array<{ node: any; parentType: string | null }> = [{ node: root, parentType: "Query" }];
      while (stack.length) {
        const { node, parentType } = stack.pop()!;
        if (!node || typeof node !== "object") continue;

        const t = (node as any).__typename ?? parentType;

        for (const field of Object.keys(node)) {
          const val = (node as any)[field];
          if (!val || typeof val !== "object") continue;

          const edges = (val as any).edges;
          const pageInfo = (val as any).pageInfo;
          if (Array.isArray(edges) && pageInfo && typeof pageInfo === "object") {
            const parentKey = graph.getEntityParentKey(t!, graph.identify?.(node)) ?? "Query";
            const connKey = buildConnKey(parentKey, field, vars);
            const state = graph.ensureConnection(connKey);

            let view = viewByConnKey.get(connKey);
            if (!view) {
              view = createConnectionView(state, {
                edgesKey: 'edges', pageInfoKey: 'pageInfo', root: val, limit: 0, pinned: true
              });
              viewByConnKey.set(connKey, view);
            }

            (val as any).edges = view.edges;
            (val as any).pageInfo = view.pageInfo;

            const hasAfter = vars.after != null;
            const hasBefore = vars.before != null;
            if (!hasAfter && !hasBefore) {
              setViewLimit(view, edges.length);               // baseline → payload edges
            } else {
              setViewLimit(view, state.list.length);          // cursor page → union
            }

            synchronizeConnectionViews(state);
          }

          if (Array.isArray(val)) {
            for (const it of val) if (it && typeof it === 'object') stack.push({ node: it, parentType: t });
          } else {
            stack.push({ node: val, parentType: t });
          }
        }
      }
    }

    function destroy() { viewByConnKey.clear(); }

    return { wireConnections, destroy };
  }

  return { createViewSession, createConnectionView, setViewLimit, synchronizeConnectionViews };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolvers mock: simulate relay merge into graph (view-agnostic)
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
            const parentKey = graph.getEntityParentKey(t!, graph.identify?.(node)) ?? 'Query';
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
// Local opKey (use real getOperationKey to match plugin/graph)
// ─────────────────────────────────────────────────────────────────────────────
function makeCtx(variables: any = {}, type: 'query' | 'mutation' | 'subscription' = 'query') {
  const DUMMY_QUERY = 'query Test { __typename }';
  const op: any = { type, variables, query: DUMMY_QUERY, key: Math.floor(Math.random() * 1e9) };
  const published: any[] = [];
  const ctx: any = {
    operation: op,
    useResult: (r: any, term?: boolean) => { published.push({ r, term }); },
    get _published() { return published; }
  };
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('cachebay plugin — cache policies + SSR + views wiring', () => {
  it('cache-only miss → CacheOnlyMiss error', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({}, 'query');
    ctx.operation.cachePolicy = 'cache-only';
    plugin(ctx); // publishes immediately

    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].r.error).toBeInstanceOf(CombinedError);
    expect(ctx._published[0].r.error.networkError.name).toBe('CacheOnlyMiss');
  });

  it('cache-only hit → resolves from op-cache and wires views', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({ first: 2 });
    const key = getOperationKey(ctx.operation);
    graph.operationStore.set(key, {
      data: {
        __typename: 'Query',
        posts: {
          edges: [
            { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
            { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
          ],
          pageInfo: { endCursor: 'c2', hasNextPage: true },
        },
      },
      variables: ctx.operation.variables,
    });

    ctx.operation.cachePolicy = 'cache-only';
    plugin(ctx);

    // published cached data with wired view
    const pub = ctx._published[0].r.data;
    expect(pub.posts.edges.length).toBe(2);

    const state = graph.connectionStore.values().next().value;
    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(2);
  });

  it('cache-first hit → terminal cached publish', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({ first: 1 });
    const key = getOperationKey(ctx.operation);
    graph.operationStore.set(key, {
      data: {
        __typename: 'Query',
        posts: {
          edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: true },
        },
      },
      variables: ctx.operation.variables,
    });

    ctx.operation.cachePolicy = 'cache-first';
    plugin(ctx);
    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(true);
  });

  it('cache-and-network hit (no SSR) → non-terminal cached, then terminal network result', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({ first: 1 });
    const key = getOperationKey(ctx.operation);
    graph.operationStore.set(key, {
      data: {
        __typename: 'Query',
        posts: {
          edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: true },
        },
      },
      variables: ctx.operation.variables,
    });

    ctx.operation.cachePolicy = 'cache-and-network';
    plugin(ctx);

    // non-terminal cached publish
    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(false);

    // simulate network
    ctx.useResult({
      data: {
        __typename: 'Query',
        posts: {
          edges: [
            { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
            { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
          ],
          pageInfo: { endCursor: 'c2', hasNextPage: true },
        },
      }
    } as any, true);

    expect(ctx._published.length).toBe(2);
    expect(ctx._published[1].term).toBe(true);

    const state = graph.connectionStore.values().next().value;
    const view = Array.from(state.views)[0];
    expect(view.edges.length).toBe(2);
  });

  it('cache-and-network hit (SSR ticket) → terminal cached publish', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const ssr = { hydrateOperationTicket: new Set<string>(), isHydrating: vi.fn(() => false) };
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers, ssr });

    const ctx = makeCtx({ first: 1 });
    const key = getOperationKey(ctx.operation);
    graph.operationStore.set(key, {
      data: {
        __typename: 'Query',
        posts: {
          edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: true },
        },
      },
      variables: ctx.operation.variables,
    });
    ssr.hydrateOperationTicket!.add(key);

    ctx.operation.cachePolicy = 'cache-and-network';
    plugin(ctx);

    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(false); // resolves suspense-like path
    expect(ssr.hydrateOperationTicket!.has(key)).toBe(false);
  });

  it('network result path stores post-resolver raw and wires views', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({ first: 2 });
    plugin(ctx);

    const payload = {
      data: {
        __typename: 'Query',
        posts: {
          edges: [
            { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
            { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
          ],
          pageInfo: { endCursor: 'c2', hasNextPage: true },
        },
      }
    };

    ctx.useResult(payload as any, true);

    const opKey = getOperationKey(ctx.operation);
    const cached = graph.operationStore.get(opKey);
    expect(cached?.data).toEqual(payload.data);

    const state = graph.connectionStore.values().next().value;
    const view = Array.from(state.views)[0];
    expect(view.limit).toBe(2);
    expect(view.edges.length).toBe(2);
  });

  it('subscriptions: applies resolvers and wires views on each frame', () => {
    const graph = createGraphMock();
    const views = createViewsMock(graph);
    const resolvers = createResolversMock(graph);
    const plugin = buildCachebayPlugin({ addTypename: false }, { graph, views, resolvers });

    const ctx = makeCtx({ first: 1 }, 'subscription');
    plugin(ctx);

    ctx.useResult({
      data: {
        __typename: 'Query',
        posts: {
          edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
          pageInfo: { endCursor: 'c1', hasNextPage: true },
        },
      }
    } as any, false);

    expect(ctx._published.length).toBe(1);
    const state = graph.connectionStore.values().next().value;
    const view = Array.from(state.views)[0];
    expect(view.edges.length).toBe(1);
  });
});
