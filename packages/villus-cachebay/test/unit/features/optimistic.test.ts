import { describe, it, expect } from 'vitest';
import { createCache } from '../../src';
import { tick } from '../helpers';

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
      // not needed for this unit test
    },
  };

  plugin(ctx);
  ctx.useResult({ data: resultData });
  return published;
}

describe('modifyOptimistic', () => {
  it('add and revert node in a Relay connection', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { legoColors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    // Seed initial data
    const published = runQuery(cache, {
      __typename: 'Query',
      legoColors: {
        __typename: 'LegoColorConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
          { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } },
        ],
        pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true },
      },
    });
    const view = published.data.legoColors;
    expect(Array.isArray(view.edges)).toBe(true);
    expect(view.edges.length).toBe(2);

    // Apply optimistic add
    const handle = (cache as any).modifyOptimistic((c: any) => {
      const conns = c.connections({ parent: 'Query', field: 'legoColors' });
      expect(conns.length).toBeGreaterThan(0);
      conns[0].addNode({ __typename: 'Color', id: 3, name: 'Green' }, { cursor: 'c3', position: 'end' });
    });

    // Flush microtask batched connection sync
    await tick();
    // Windowed limit may keep current view length, but entity store should contain the new node
    expect((cache as any).listEntityKeys('Color')).toContain('Color:3');

    // Revert
    handle.revert();

    await tick();
    // Connection view remains at initial length
    expect(view.edges.length).toBe(2);
  });
});
