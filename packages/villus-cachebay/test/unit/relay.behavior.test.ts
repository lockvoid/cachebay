import { describe, it, expect } from 'vitest';
import { createCache } from '../../src';

function makeCtx(opts: { query: string; variables?: any; policy?: 'cache-first' | 'cache-and-network' | 'network-only' }) {
  const listeners: any[] = [];
  let published: any = null;
  const ctx: any = {
    operation: {
      type: 'query',
      query: opts.query,
      variables: opts.variables || {},
      cachePolicy: opts.policy || 'cache-first',
      context: {},
    },
    useResult: (payload: any) => {
      published = payload;
    },
    afterQuery: (cb: any) => {
      listeners.push(cb);
    },
  };
  return { ctx, listeners, get published() { return published; } };
}

function seed(cache: any, data: any, variables: any = {}, policy: any = 'cache-and-network') {
  const plugin = cache as unknown as (ctx: any) => void;
  const { ctx } = makeCtx({ query: 'query Q($after: String, $before: String) { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables, policy });
  plugin(ctx);
  ctx.useResult({ data });
}

describe('relay resolver behavior', () => {
  it('auto mode chooses append for after and prepend for before', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { colors: relay({ mode: 'auto' }) } }),
      keys: () => ({ Color: (o:any) => (o?.id != null ? String(o.id) : null) }),
    });

    // seed page 1
    seed(cache, {
      __typename: 'Query',
      colors: { __typename: 'ColorConnection', edges: [
        { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
      ], pageInfo: { __typename: 'PageInfo', endCursor: 'c1', hasNextPage: true } }
    }, {});

    // publish page 2 with after -> append
    seed(cache, {
      __typename: 'Query',
      colors: { __typename: 'ColorConnection', edges: [
        { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } },
      ], pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true } }
    }, { after: 'c1' });

    // cached request for after should immediately present p1+p2
    const plugin = cache as unknown as (ctx: any) => void;
    const { ctx, published } = makeCtx({ query: 'query Q($after: String, $before: String) { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: { after: 'c1' }, policy: 'cache-first' });
    plugin(ctx);
    expect(published?.data?.colors?.edges?.length).toBe(2);
  });

  it('mode: replace shows only the latest page and resets view limit', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { colors: relay({ mode: 'replace' }) } }),
      keys: () => ({ Color: (o:any) => (o?.id != null ? String(o.id) : null) }),
    });

    // seed page 1 and page 2
    seed(cache, { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [
      { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
    ], pageInfo: { __typename: 'PageInfo', endCursor: 'c1', hasNextPage: true } } }, {});

    seed(cache, { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [
      { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } },
    ], pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true } } }, { after: 'c1' });

    // cached request for page 2 returns only page 2
    const plugin = cache as unknown as (ctx: any) => void;
    const { ctx, published } = makeCtx({ query: 'query Q($after: String) { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: { after: 'c1' }, policy: 'cache-first' });
    plugin(ctx);
    expect(published?.data?.colors?.edges?.length).toBe(1);
    expect(published?.data?.colors?.edges?.[0]?.node?.name).toBe('Blue');
  });

  it('cache-and-network append merges out-of-order pages with dedup and stable growth', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { colors: relay({ mode: 'append' }) } }),
      keys: () => ({ Color: (o:any) => (o?.id != null ? String(o.id) : null) }),
    });

    // seed page 1
    seed(cache, { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [
      { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
    ], pageInfo: { __typename: 'PageInfo', endCursor: 'c1', hasNextPage: true } } }, {});

    const plugin = cache as unknown as (ctx: any) => void;
    const ctx1 = makeCtx({ query: 'query Q($after: String) { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: { after: 'c1' }, policy: 'cache-and-network' });
    const ctx2 = makeCtx({ query: 'query Q($after: String) { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: { after: 'c2' }, policy: 'cache-and-network' });

    plugin(ctx1.ctx);
    plugin(ctx2.ctx);

    // network returns p3 then p2
    ctx1.listeners.forEach((cb:any) => cb({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [ { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'Green' } } ], pageInfo: { __typename: 'PageInfo', endCursor: 'c3', hasNextPage: true } } } }));
    ctx2.listeners.forEach((cb:any) => cb({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [ { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } } ], pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true } } } }));

    // latest published should have 3 items (p1 + p3 + p2 with dedup)
    const final = ctx2.published || ctx1.published; // one of them will be last
    expect(final?.data?.colors?.edges?.length).toBe(3);
    const names = final.data.colors.edges.map((e:any)=>e.node.name).sort();
    expect(names).toEqual(['Black','Blue','Green']);
  });
});
