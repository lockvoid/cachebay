import { describe, it, expect, vi } from 'vitest';
import { buildCachebayPlugin } from '@/src/core/plugin';
import { createViews } from '@/src/core/views';
import { createResolvers } from '@/src/core/resolvers';
import { relay } from '@/src/resolvers/relay';
import { reactive } from 'vue';

// ---------- Minimal graph mock for plugin path ----------
function makeGraphMock() {
  const entityStore = new Map<string, any>();
  const connectionStore = new Map<string, any>();
  const operationStore = new Map<string, any>();

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

  // ✅ FIX: overlay the snapshot fields into the node proxy
  function materializeEntity(key: string) {
    const [t, id] = key.includes(':') ? key.split(':') : [key, undefined];
    const snap = entityStore.get(key) || {};
    // include both identity and snapshot fields
    return reactive({ __typename: t, ...(id ? { id } : {}), ...snap });
  }

  function getEntity(_key: string) {
    // not used by this test; keep simple
    return reactive({});
  }

  function putOperation(key: string, payload: any) {
    operationStore.set(key, payload);
  }

  function lookupOperation(op: any) {
    const key = `${op.type}:${op.query}:${JSON.stringify(op.variables || {})}`;
    const entry = operationStore.get(key);
    return entry ? { key, entry } : null;
  }

  return {
    entityStore,
    connectionStore,
    operationStore,
    ensureConnection,
    getEntityParentKey,
    identify,
    putEntity,
    materializeEntity,  // <-- now overlays snapshot
    getEntity,
    putOperation,
    lookupOperation,
  };
}

// ---------- Helpers ----------
function shallowClone(root: any) {
  if (!root || typeof root !== 'object') return root;
  return Array.isArray(root) ? root.slice() : { ...root };
}

const POSTS_QUERY =
  'query Posts { posts { edges { cursor node { __typename id title } } pageInfo { endCursor hasNextPage } } }';

// Build a fake Villus ctx
function makeCtx(query = POSTS_QUERY, vars: any = {}, policy: any = 'network-only') {
  const op = {
    type: 'query',
    key: Math.floor(Math.random() * 1e9),
    variables: vars,
    query,
    cachePolicy: policy,
  } as any;

  const published: Array<{ r: any; term: boolean | undefined }> = [];
  const ctx: any = {
    operation: op,
    useResult: (r: any, term?: boolean) => { published.push({ r, term }); },
    get _published() { return published; },
  };

  return ctx;
}

// ---------- Tests ----------
describe('plugin + relay + view-session (unit, no mount)', () => {
  it('network-only: baseline → publishes with edges and containers wired', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });

    // Build resolvers (Query.posts -> relay append; we just need merge to state)
    const { applyResolversOnGraph } = createResolvers(
      { resolvers: { Query: { posts: relay({ paginationMode: 'append' }) } } } as any,
      { graph, views, utils: { TYPENAME_KEY: '__typename' } } as any
    );

    // Build plugin with view session + resolvers
    const plugin = buildCachebayPlugin(
      { addTypename: false },
      { graph, views, resolvers: { applyResolversOnGraph } }
    );

    // 1) create ctx & install plugin (simulates useQuery setup)
    const ctx = makeCtx(POSTS_QUERY, {}, 'network-only');
    plugin(ctx);

    // 2) simulate network frame (baseline)
    const payload = {
      data: {
        __typename: 'Query',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { cursor: 'c1', node: { __typename: 'Post', id: '1', title: 'A1' } },
            { cursor: 'c2', node: { __typename: 'Post', id: '2', title: 'A2' } },
          ],
          pageInfo: { endCursor: 'c2', hasNextPage: true },
        },
      }
    } as any;

    // plugin overrides ctx.useResult inside, so call the overridden one:
    ctx.useResult(payload, true);

    // assert published, with wired containers
    expect(ctx._published.length).toBe(1);
    const r = ctx._published[0].r;
    const edges = r?.data?.posts?.edges;
    expect(Array.isArray(edges)).toBe(true);
    expect(edges.length).toBe(2);
    expect(edges[0].node.title).toBe('A1');
  });

  it('network-only: append after baseline → union window (4) & same edges container', () => {
    const graph = makeGraphMock();
    const views = createViews({}, { graph });
    const { applyResolversOnGraph } = createResolvers(
      { resolvers: { Query: { posts: relay({ paginationMode: 'append' }) } } } as any,
      { graph, views, utils: { TYPENAME_KEY: '__typename' } } as any
    );
    const plugin = buildCachebayPlugin(
      { addTypename: false },
      { graph, views, resolvers: { applyResolversOnGraph } }
    );

    const ctx = makeCtx(POSTS_QUERY, {}, 'network-only');
    plugin(ctx);

    // baseline
    const p1 = {
      data: {
        __typename: 'Query',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { cursor: 'c1', node: { __typename: 'Post', id: '1', title: 'A1' } },
            { cursor: 'c2', node: { __typename: 'Post', id: '2', title: 'A2' } },
          ],
          pageInfo: { endCursor: 'c2', hasNextPage: true },
        },
      }
    } as any;

    ctx.useResult(p1, true);
    const edgesRef = ctx._published[0].r.data.posts.edges;

    // append (after c2)
    ctx.operation.variables = { first: 2, after: 'c2' };
    const p2 = {
      data: {
        __typename: 'Query',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { cursor: 'c3', node: { __typename: 'Post', id: '3', title: 'A3' } },
            { cursor: 'c4', node: { __typename: 'Post', id: '4', title: 'A4' } },
          ],
          pageInfo: { endCursor: 'c4', hasNextPage: false },
        },
      }
    } as any;

    ctx.useResult(p2, true);

    // Published again once
    expect(ctx._published.length).toBe(2);
    const r2 = ctx._published[1].r;
    expect(r2.data.posts.edges).toBe(edgesRef);
    expect(r2.data.posts.edges.length).toBe(4);
    expect(r2.data.posts.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});
