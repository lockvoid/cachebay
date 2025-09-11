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

describe('features/optimistic — conflict & ordering semantics', () => {
  it('later optimistic write wins for same entity; revert restores previous snapshot', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    // T1 writes Color:1 name=A then T2 overwrites to name=B
    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A' }, { cursor: 'c1' });
    });

    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'B' }, { cursor: 'c1b' });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    expect((cache as any).readFragment('Color:1', false)?.name).toBe('B');

    // Revert T2 -> back to A
    t2.revert?.();
    await tick();
    expect((cache as any).readFragment('Color:1', false)?.name).toBe('A');

    // Revert T1 -> removed altogether
    t1.revert?.();
    await tick();
    expect((cache as any).hasFragment('Color:1')).toBe(false);
  });

  it('remove then re-add within the same optimistic layer respects final instruction', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: { Query: { colors: relay({}) } },
      keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A' }, { cursor: 'c1' });
      conn.removeNode({ __typename: 'Color', id: 1 });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A-final' }, { cursor: 'c1z' });
    });

    t.commit?.();
    await tick();

    expect((cache as any).hasFragment('Color:1')).toBe(true);
    expect((cache as any).readFragment('Color:1', false)?.name).toBe('A-final');
  });
});
