import { describe, it, expect, vi } from 'vitest';
import { createPlugin } from '@/src/core/plugin';
import { CombinedError } from 'villus';
import { parse } from 'graphql';

// tiny stable stringify (mirrors selections.ts policy)
const stableStringify = (value: any): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
};

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (selection-first pipeline)
// ─────────────────────────────────────────────────────────────────────────────
function createGraphMock() {
  const selections = new Map<string, any>();

  return {
    putSelection: vi.fn((key: string, subtree: any) => {
      selections.set(key, JSON.parse(JSON.stringify(subtree)));
    }),
    getSelection: vi.fn((key: string) => selections.get(key)),
    materializeSelection: vi.fn((key: string) => {
      const v = selections.get(key);
      return v ? JSON.parse(JSON.stringify(v)) : undefined;
    }),
    __selections: selections,
  };
}

function createSelectionsMock() {
  return {
    buildRootSelectionKey(field: string, args?: Record<string, any>) {
      const a = args ? stableStringify(args) : '{}';
      return `${field}(${a})`;
    },
    compileSelections(input: { data: any }) {
      const out: Array<{ key: string; subtree: any }> = [];
      const root = input.data;
      if (!root || typeof root !== 'object') return out;

      for (const field of Object.keys(root)) {
        if (field === '__typename') continue;
        out.push({
          key: this.buildRootSelectionKey(field, {}), // heuristic root-only
          subtree: (root as any)[field],
        });
      }
      return out;
    },
  };
}

function createResolversMock() {
  return {
    applyOnObject: vi.fn((_root: any, _vars: Record<string, any>) => {
      // no-op; we just prove the call path
    }),
  };
}

function createViewsMock(graph: ReturnType<typeof createGraphMock>) {
  return {
    createSession() {
      const mounted = new Set<string>();
      return {
        mountSelection: (selectionKey: string) => {
          mounted.add(selectionKey);
          return graph.materializeSelection(selectionKey);
        },
        destroy: () => mounted.clear(),
        _mounted: mounted,
      };
    },
  };
}

const gql = (s: TemplateStringsArray) => s.join('');
const queryDoc = (src: string) => parse(src);

function makeCtx(doc: any, variables: any = {}, type: 'query' | 'mutation' | 'subscription' = 'query') {
  const op: any = { type, variables, query: doc, key: Math.floor(Math.random() * 1e9) };
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
describe('cachebay plugin — cache policies (selection/graph based)', () => {
  it('cache-only miss → CacheOnlyMiss error', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    const doc = queryDoc(gql`
      query Q($first:Int){
        posts(first:$first){
          edges{cursor node{__typename id}}
          pageInfo{endCursor hasNextPage}
        }
      }`);
    const ctx = makeCtx(doc, { first: 2 }, 'query');

    ctx.operation.cachePolicy = 'cache-only';
    plugin(ctx);

    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].r.error).toBeInstanceOf(CombinedError);
    expect(ctx._published[0].r.error.networkError.name).toBe('CacheOnlyMiss');
  });

  it('cache-only hit → returns materialized selection from graph (no network)', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    const selKey = selections.buildRootSelectionKey('posts', { first: 2 });
    graph.putSelection(selKey, {
      edges: [
        { cursor: 'c1', node: { __typename: 'Post', id: '1' } },
        { cursor: 'c2', node: { __typename: 'Post', id: '2' } },
      ],
      pageInfo: { endCursor: 'c2', hasNextPage: true },
    });

    const doc = queryDoc(gql`
      query Q($first:Int){
        posts(first:$first){
          edges{cursor node{__typename id}}
          pageInfo{endCursor hasNextPage}
        }
      }`);
    const ctx = makeCtx(doc, { first: 2 });

    ctx.operation.cachePolicy = 'cache-only';
    plugin(ctx);

    expect(ctx._published.length).toBe(1);
    const result = ctx._published[0].r.data;
    expect(result.__typename).toBe('Query');
    expect(result.posts.edges.length).toBe(2);
    expect(result.posts.pageInfo.endCursor).toBe('c2');
  });

  it('cache-first hit → terminal cached publish', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    const selKey = selections.buildRootSelectionKey('posts', { first: 1 });
    graph.putSelection(selKey, {
      edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
      pageInfo: { endCursor: 'c1', hasNextPage: true },
    });

    const doc = queryDoc(gql`
      query Q($first:Int){
        posts(first:$first){
          edges{cursor node{__typename id}}
          pageInfo{endCursor hasNextPage}
        }
      }`);
    const ctx = makeCtx(doc, { first: 1 });

    ctx.operation.cachePolicy = 'cache-first';
    plugin(ctx);
    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(true);
  });

  it('cache-and-network hit → non-terminal cached; then network writes selections & publishes terminal', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    // seed cached page (1 edge)
    const cachedKey = selections.buildRootSelectionKey('posts', { first: 1 });
    graph.putSelection(cachedKey, {
      edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
      pageInfo: { endCursor: 'c1', hasNextPage: true },
    });

    const doc = queryDoc(gql`
      query Q($first:Int){
        posts(first:$first){
          edges{cursor node{__typename id}}
          pageInfo{endCursor hasNextPage}
        }
      }`);
    const ctx = makeCtx(doc, { first: 1 });

    ctx.operation.cachePolicy = 'cache-and-network';
    plugin(ctx);

    // cached non-terminal
    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(false);

    // network frame (2 edges)
    const networkPayload = {
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
    };

    ctx.useResult(networkPayload as any, true);

    // terminal publish
    expect(ctx._published.length).toBe(2);
    expect(ctx._published[1].term).toBe(true);

    // ensure selections got updated by plugin
    expect(graph.putSelection).toHaveBeenCalled();
    const call = (graph.putSelection as any).mock.calls.find((c: any[]) => {
      const [, subtree] = c;
      return subtree && subtree.edges && Array.isArray(subtree.edges) && subtree.edges.length === 2;
    });
    expect(call).toBeTruthy();

    // materialize the same selection key the plugin should use (root heuristic)
    const postsKey = selections.buildRootSelectionKey('posts', {});
    const mat = graph.materializeSelection(postsKey);
    expect(mat && Array.isArray(mat.edges) ? mat.edges.length : 0).toBe(2);
  });

  it('subscriptions: each frame updates selections and publishes a frame', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    const doc = queryDoc(gql`
      subscription S {
        posts {
          edges { cursor node { __typename id } }
          pageInfo { endCursor }
        }
      }`);
    const ctx = makeCtx(doc, {}, 'subscription');
    plugin(ctx);

    ctx.useResult({
      data: {
        __typename: 'Query',
        posts: { edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }], pageInfo: { endCursor: 'c1' } }
      }
    } as any, false);

    expect(ctx._published.length).toBe(1);
    // Verify selection storage was touched
    expect(graph.putSelection).toHaveBeenCalled();
    const postsKey = selections.buildRootSelectionKey('posts', {});
    const mat = graph.materializeSelection(postsKey);
    expect(mat && Array.isArray(mat.edges) ? mat.edges.length : 0).toBe(1);
  });

  it('cache-and-network hit → non-terminal cached; then network writes selections & publishes terminal', () => {
    const graph = createGraphMock();
    const selections = createSelectionsMock();
    const resolvers = createResolversMock();
    const views = createViewsMock(graph);
    const plugin = createPlugin({ addTypename: false }, { graph, selections, resolvers, views });

    // seed cached page (1 edge) under arg-key
    const cachedKey = selections.buildRootSelectionKey('posts', { first: 1 });
    graph.putSelection(cachedKey, {
      edges: [{ cursor: 'c1', node: { __typename: 'Post', id: '1' } }],
      pageInfo: { endCursor: 'c1', hasNextPage: true },
    });

    const doc = queryDoc(gql`
      query Q($first:Int){
        posts(first:$first){
          edges{cursor node{__typename id}}
          pageInfo{endCursor hasNextPage}
        }
      }`);
    const ctx = makeCtx(doc, { first: 1 });

    ctx.operation.cachePolicy = 'cache-and-network';
    plugin(ctx);

    // cached non-terminal
    expect(ctx._published.length).toBe(1);
    expect(ctx._published[0].term).toBe(false);

    // network frame (2 edges)
    const networkPayload = {
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
    };
    ctx.useResult(networkPayload as any, true);

    // terminal publish
    expect(ctx._published.length).toBe(2);
    expect(ctx._published[1].term).toBe(true);

    // ensure selections got updated by plugin
    expect(graph.putSelection).toHaveBeenCalled();

    // 1) Root (heuristic) key
    const rootKey = selections.buildRootSelectionKey('posts', {});
    const matRoot = graph.materializeSelection(rootKey);
    expect(matRoot && Array.isArray(matRoot.edges) ? matRoot.edges.length : 0).toBe(2);

    // 2) Arg-shaped key used by this operation
    const argKey = selections.buildRootSelectionKey('posts', { first: 1 });
    const matArg = graph.materializeSelection(argKey);
    expect(matArg && Array.isArray(matArg.edges) ? matArg.edges.length : 0).toBe(2);
  });
});
