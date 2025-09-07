import { describe, it, expect } from 'vitest';
import { createCache } from '../../src';
import { tick } from '../helpers';

function seed(cache: any) {
  const plugin = cache as unknown as (ctx: any) => void;
  const ctx: any = {
    operation: { type: 'query', query: 'query Q { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }', variables: {}, cachePolicy: 'cache-and-network', context: {} },
    useResult: (_: any) => {},
    afterQuery: (_cb: any) => {},
  };
  plugin(ctx);
  ctx.useResult({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [], pageInfo: { __typename: 'PageInfo', endCursor: null, hasNextPage: false } } } });
}

describe('modifyOptimistic public API', () => {
  it('connections add/remove/patch and entity write/patch/del/revert', async () => {
    const cache = createCache({
      resolvers: ({ relay }) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o:any) => (o?.id != null ? String(o.id) : null) })
    });
    seed(cache);

    // Build optimistic changes
    const handle = (cache as any).modifyOptimistic((c: any) => {
      // connections API
      const conns = c.connections({ parent: 'Query', field: 'colors' });
      expect(conns.length).toBeGreaterThan(0);
      conns[0].addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1', position: 'end', edge: { rating: 5 } });
      conns[0].addNodeByKey('Color:2', { cursor: 'c2', position: 'end' });
      conns[0].patch('hasNextPage', () => true);
      conns[0].removeNodeByKey('Color:2');

      // entity api
      c.write({ __typename: 'Color', id: 3, name: 'Green' });
      c.patch('Color:3', { name: 'Lime' });
      c.del('Color:3');
    });

    await tick();

    // After optimistic changes
    const keysAfter = (cache as any).listEntityKeys('Color');
    expect(keysAfter).toContain('Color:1');
    expect(keysAfter).not.toContain('Color:2');
    expect(keysAfter).not.toContain('Color:3');

    // Revert optimistic changes
    handle.revert();
    await tick();

    const keysFinal = (cache as any).listEntityKeys('Color');
    expect(Array.isArray(keysFinal)).toBe(true);
  });
});
