import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { publish } from '@/test/helpers';

function runQuery(cache: any, data: any, query: string) {
  return publish(cache, data, query);
}

describe('SSR dehydrate/hydrate', () => {
  it('restores entities, connections and op cache', () => {
    const query = /* GraphQL */ `
      query Q { colors { edges { cursor node { __typename id name } } pageInfo { endCursor hasNextPage } } }
    `;

    const cacheA = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    runQuery(
      cacheA,
      {
        __typename: 'Query',
        colors: {
          __typename: 'ColorConnection',
          edges: [{ cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'Black' } }],
          pageInfo: { __typename: 'PageInfo', endCursor: 'c1', hasNextPage: false },
        },
      },
      query,
    );

    const snap = (cacheA as any).dehydrate();
    expect(Array.isArray(snap.ent)).toBe(true);

    const cacheB = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    (cacheB as any).hydrate(snap);

    const keys = (cacheB as any).listEntityKeys('Color');
    expect(keys).toContain('Color:1');
  });

  it('hydrate accepts a function and is idempotent', () => {
    const cache = createCache({ keys: () => ({ T: (o: any) => (o?.id != null ? String(o.id) : null) }) });
    (cache as any).writeFragment({ __typename: 'T', id: 1, v: 1 }).commit?.();

    const snap = (cache as any).dehydrate();

    (cache as any).hydrate((hydrate: any) => hydrate(snap));
    const keys = (cache as any).listEntityKeys('T');
    expect(keys).toEqual(['T:1']);

    // hydrate again should not duplicate
    (cache as any).hydrate(snap);
    const keys2 = (cache as any).listEntityKeys('T');
    expect(keys2).toEqual(['T:1']);
  });
});
