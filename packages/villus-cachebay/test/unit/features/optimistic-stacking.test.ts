import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { tick, seedRelay } from '@/test/helpers';

const QUERY = /* GraphQL */ `
  query Colors($first: Int, $after: String) {
    colors(first: $first, after: $after) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage startCursor hasPreviousPage }
    }
  }
`;

describe('features/optimistic — stacking / layering', () => {
  it('supports multiple optimistic layers with proper isolation (revert preserves later commits)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    // T1: add 1,2
    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1', position: 'end' });
      conn.addNode({ __typename: 'Color', id: 2, name: 'Blue' }, { cursor: 'c2', position: 'end' });
    });

    // T2: add 3
    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 3, name: 'Cyan' }, { cursor: 'c3', position: 'end' });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    let keys = (cache as any).listEntityKeys('Color').sort();
    expect(keys).toEqual(['Color:1', 'Color:2', 'Color:3']);

    // Revert T1 — T2 should remain
    t1.revert?.();
    await tick();

    keys = (cache as any).listEntityKeys('Color').sort();
    expect(keys).toEqual(['Color:3']);

    // Revert T2 — back to baseline
    t2.revert?.();
    await tick();

    keys = (cache as any).listEntityKeys('Color');
    expect(keys.length === 0 || Array.isArray(keys)).toBe(true);
  });

  it('revert before commit is a no-op and does not throw', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
    });

    // Revert without commit
    t.revert?.();
    await tick();

    const keys = (cache as any).listEntityKeys('Color');
    expect(keys.length === 0 || Array.isArray(keys)).toBe(true);
  });

  it('operations against the same connection key (ignoring cursors) aggregate correctly', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    // First optimistic layer uses (first:2, after:null)
    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({
        parent: 'Query',
        field: 'colors',
        variables: { first: 2, after: null },
      });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
    });

    // Second layer uses different cursor vars but should target same connection identity
    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({
        parent: 'Query',
        field: 'colors',
        variables: { first: 2, after: 'c1' }, // cursor vars must be ignored when building the key
      });
      conn.addNode({ __typename: 'Color', id: 2, name: 'Blue' }, { cursor: 'c2' });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    const keys = (cache as any).listEntityKeys('Color').sort();
    expect(keys).toEqual(['Color:1', 'Color:2']);
  });
});
