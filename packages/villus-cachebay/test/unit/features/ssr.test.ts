import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';

function runQuery(cache: any, data: any) {
  const plugin = cache as unknown as (ctx: any) => void;
  const ctx: any = {
    operation: { type: 'query', query: 'query X { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: {}, cachePolicy: 'cache-and-network', context: {} },
    useResult: (_: any) => { },
    afterQuery: (_cb: any) => { },
  };
  plugin(ctx);
  ctx.useResult({ data });
}

describe('SSR dehydrate/hydrate', () => {
  it('restores entities, connections and op cache', () => {
    const cacheA = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    runQuery(cacheA, {
      __typename: 'Query',
      colors: {
        __typename: 'ColorConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
        ],
        pageInfo: { __typename: 'PageInfo', endCursor: 'c1', hasNextPage: false },
      },
    });

    const snap = (cacheA as any).dehydrate();
    expect(Array.isArray(snap.ent)).toBe(true);

    const cacheB = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });
    (cacheB as any).hydrate(snap);

    const keys = (cacheB as any).listEntityKeys('Color');
    expect(keys).toContain('Color:1');
  });
});
