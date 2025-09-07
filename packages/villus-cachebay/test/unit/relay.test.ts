import { describe, it, expect } from 'vitest';
import { createCache } from '../../src';

function runQuery(cache: any, resultData: any, query = 'query X { legoColors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }') {
  const plugin = cache as unknown as (ctx: any) => void;

  let published: any = null;

  const ctx: any = {
    operation: {
      type: 'query',
      query,
      variables: {},
      cachePolicy: 'cache-and-network',
      context: {},
    },
    useResult: (payload: any) => {
      published = payload;
    },
    afterQuery: (_cb: any) => {
      // not needed for this test
    },
  };

  plugin(ctx);

  // Simulate Villus delivering the result to the plugin
  ctx.useResult({ data: resultData });

  return published;
}

describe('relay resolver', () => {
  it('indexes nodes into entity store and creates reactive view', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({
        Query: {
          legoColors: relay(),
        },
      }),
      keys: () => ({
        Color: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    const data = {
      __typename: 'Query',
      legoColors: {
        __typename: 'LegoColorConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
          { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } },
        ],
        pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true },
      },
    };

    const published = runQuery(cache, data);
    expect(published?.data).toBeTruthy();

    // Entities should have been stored
    const keys = (cache as any).listEntityKeys('Color');
    expect(keys).toContain('Color:1');
    expect(keys).toContain('Color:2');
  });
});
