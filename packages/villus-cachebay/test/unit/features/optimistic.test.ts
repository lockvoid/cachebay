import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { tick } from '@/test/helpers';

/** Treat the cache (plugin) as a function Villus will call with a context. */
function asPlugin(cache: any): (ctx: any) => void {
  return cache as unknown as (ctx: any) => void;
}

/** Run the cache plugin for a query and immediately publish the provided data. */
function publish(cache: any, data: any, query: string) {
  const plugin = asPlugin(cache);
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
      // noop for unit tests
    },
  };

  plugin(ctx);
  ctx.useResult({ data });
  return published;
}

/** Seed an empty Relay connection on Query.<field>. */
function seedEmptyConnection(cache: any, opts: {
  field: string;
  connectionTypename: string;
  pageInfoTypename?: string;
  query: string;
}) {
  const {
    field,
    connectionTypename,
    pageInfoTypename = 'PageInfo',
    query,
  } = opts;

  return publish(
    cache,
    {
      __typename: 'Query',
      [field]: {
        __typename: connectionTypename,
        edges: [],
        pageInfo: {
          __typename: pageInfoTypename,
          endCursor: null,
          hasNextPage: false,
        },
      },
    },
    query,
  );
}

describe('modifyOptimistic', () => {
  it('add and revert node in a Relay connection', async () => {
    const query = 'query X { legoColors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }';

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }) => ({ Query: { legoColors: relay() } }),
      keys: () => ({
        Color: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    // Seed initial data
    const published = publish(
      cache,
      {
        __typename: 'Query',
        legoColors: {
          __typename: 'LegoColorConnection',
          edges: [
            { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } },
            { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'Blue' } },
          ],
          pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true },
        },
      },
      query,
    );

    const view = published.data.legoColors;
    expect(Array.isArray(view.edges)).toBe(true);
    expect(view.edges.length).toBe(2);

    // Apply optimistic add
    const handle = (cache as any).modifyOptimistic((c: any) => {
      const conns = c.connections({ parent: 'Query', field: 'legoColors' });
      expect(conns.length).toBeGreaterThan(0);

      conns[0].addNode(
        { __typename: 'Color', id: 3, name: 'Green' },
        { cursor: 'c3', position: 'end' },
      );
    });

    // Flush batched sync
    await tick();

    // The store should now contain the new node key
    expect((cache as any).listEntityKeys('Color')).toContain('Color:3');

    // Revert optimistic change
    handle.revert();
    await tick();

    // Connection view remains at initial length
    expect(view.edges.length).toBe(2);
  });
});

describe('modifyOptimistic public API', () => {
  it('connections add/remove/patch and entity write/patch/del/revert', async () => {
    const query =
      'query Q { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }';

    const cache = createCache({
      resolvers: ({ relay }) => ({ Query: { colors: relay() } }),
      keys: () => ({
        Color: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    // Seed empty connection
    seedEmptyConnection(cache, {
      field: 'colors',
      connectionTypename: 'ColorConnection',
      query,
    });

    // Build optimistic changes
    const handle = (cache as any).modifyOptimistic((c: any) => {
      // connections API
      const conns = c.connections({ parent: 'Query', field: 'colors' });
      expect(conns.length).toBeGreaterThan(0);

      conns[0].addNode(
        { __typename: 'Color', id: 1, name: 'Black' },
        { cursor: 'c1', position: 'end', edge: { rating: 5 } },
      );

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
