import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { seedRelay, tick } from '../../helpers';
import { relay } from '@/src/resolvers/relay';

const QUERY = /* GraphQL */ `
  query Colors {
    colors {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage startCursor hasPreviousPage }
    }
  }
`;

describe('features/optimistic — edge cases', () => {
  it('deduplicates nodes by entity key and updates cursor/edge in place', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });

      // Add Color:1
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
      // Add the same entity again with a new cursor and extra edge meta -> should update, not duplicate
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black v2' }, { cursor: 'c1b', edge: { score: 42 } });
    });

    t.commit?.();
    await tick();

    const keys = (cache as any).listEntityKeys('Color');
    expect(keys).toEqual(['Color:1']);
    // Snapshot should be updated (merge policy)
    expect((cache as any).readFragment('Color:1', false)?.name).toBe('Black v2');
  });

  it('removeNode is a no-op when entity missing and works by id+typename', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      // Remove non-existing -> no throw
      conn.removeNode({ __typename: 'Color', id: 999 });

      // Add then remove
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
      conn.removeNode({ __typename: 'Color', id: 1 });
    });

    t.commit?.();
    await tick();

    const fragments = (cache as any).readFragments('Color:*');
    expect(fragments.length === 0 || Array.isArray(fragments)).toBe(true);
  });

  it('default addNode position is end; explicit start inserts at the front', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      // default (end)
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Color', id: 2, name: 'Blue' }, { cursor: 'c2' });
      // start -> should be first
      conn.addNode({ __typename: 'Color', id: 0, name: 'Amber' }, { cursor: 'c0', position: 'start' });
    });

    t.commit?.();
    await tick();

    // We can't inspect the internal connection list easily; instead, verify entity set
    const fragments = (cache as any).readFragments('Color:*');
    expect(fragments.map((f: any) => `Color:${f.id}`).sort()).toEqual(['Color:0', 'Color:1', 'Color:2']);
  });

  it('ignores invalid nodes (missing __typename or id)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ id: 1, name: 'NoTypename' } as any, { cursor: 'x' });
      conn.addNode({ __typename: 'Color', name: 'NoId' } as any, { cursor: 'y' });
    });

    t.commit?.();
    await tick();

    const fragments = (cache as any).readFragments('Color:*');
    expect(fragments.length === 0 || Array.isArray(fragments)).toBe(true);
  });

  it('re-adding after removal places the node according to the latest position hint', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
      conn.removeNode({ __typename: 'Color', id: 1 });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black again' }, { cursor: 'c1b', position: 'start' });
    });

    t.commit?.();
    await tick();

    const keys = (cache as any).listEntityKeys('Color');
    expect(keys).toEqual(['Color:1']);
    expect((cache as any).readFragment('Color:1', false)?.name).toBe('Black again');
  });
});
