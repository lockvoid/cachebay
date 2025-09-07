import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { seedRelay, tick } from '@/test/helpers';

const QUERY = /* GraphQL */ `
  query Colors($where: ColorsBoolExp) {
    colors(where: $where) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage startCursor hasPreviousPage }
    }
  }
`;

describe('internals — connection key uses object-hash (order-independent)', () => {
  it('two connections with same non-cursor vars but different order map to the same state', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    seedRelay(cache, { field: 'colors', connectionTypename: 'ColorConnection', query: QUERY });

    const t1 = (cache as any).modifyOptimistic((c: any) => {
      // where keys: (b,a)
      const [conn] = c.connections({
        parent: 'Query',
        field: 'colors',
        variables: { where: { b: 2, a: 1 } },
      });
      conn.addNode({ __typename: 'Color', id: 1, name: 'Black' }, { cursor: 'c1' });
    });

    const t2 = (cache as any).modifyOptimistic((c: any) => {
      // same where, different order: (a,b)
      const [conn] = c.connections({
        parent: 'Query',
        field: 'colors',
        variables: { where: { a: 1, b: 2 } },
      });
      conn.addNode({ __typename: 'Color', id: 2, name: 'Blue' }, { cursor: 'c2' });
    });

    t1.commit?.();
    t2.commit?.();
    await tick();

    // If both ops targeted the same connection bucket, both entities exist together.
    const keys = (cache as any).listEntityKeys('Color').sort();
    expect(keys).toEqual(['Color:1', 'Color:2']);
  });
});
