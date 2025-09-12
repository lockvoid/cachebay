import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';                    // <-- YOUR factory used in integration
import { relay } from '@/src/resolvers/relay';

// Same Posts query integration uses
const POSTS_QUERY =
  'query Posts { posts { edges { cursor node { __typename id title } } pageInfo { endCursor hasNextPage } } }';

// Fake Villus ctx harness
function makeCtx(query = POSTS_QUERY, vars: any = {}, policy: any = 'network-only') {
  const op: any = {
    type: 'query',
    key: Math.floor(Math.random() * 1e9),
    variables: vars,
    query,
    cachePolicy: policy,
  };
  const published: Array<{ r: any; term: boolean | undefined }> = [];
  const ctx: any = {
    operation: op,
    useResult: (r: any, term?: boolean) => { published.push({ r, term }); },
    get _published() { return published; }
  };
  return ctx;
}

describe('createCache() produces a plugin that wires relay with view session', () => {
  it('network-only baseline: publishes data with wired edges (2)', () => {
    // Build cache with relay bound on Query.posts
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { posts: relay({ paginationMode: 'append' }) } },
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    }) as any;                   // <-- createCache returns a Villus plugin

    const ctx = makeCtx(POSTS_QUERY, {}, 'network-only');
    // Install plugin
    (cache as Function)(ctx);

    // Simulate network baseline frame
    ctx.useResult({
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
    }, true);

    expect(ctx._published.length).toBe(1);
    const edges = ctx._published[0].r?.data?.posts?.edges;
    expect(Array.isArray(edges)).toBe(true);
    expect(edges.length).toBe(2);
    expect(edges[0].node.title).toBe('A1');
    expect(edges[1].node.title).toBe('A2');
  });

  it('network-only append: second publish grows window to union (4) & keeps same edges array', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { posts: relay({ paginationMode: 'append' }) } },
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    }) as any;

    const ctx = makeCtx(POSTS_QUERY, {}, 'network-only');
    (cache as Function)(ctx);

    // baseline
    ctx.useResult({
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
    }, true);

    const edgesRef = ctx._published[0].r.data.posts.edges;

    // append page
    ctx.operation.variables = { first: 2, after: 'c2' };
    ctx.useResult({
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
    }, true);

    expect(ctx._published.length).toBe(2);
    const r2 = ctx._published[1].r;
    expect(r2.data.posts.edges).toBe(edgesRef);
    expect(r2.data.posts.edges.length).toBe(4);
    expect(r2.data.posts.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});
