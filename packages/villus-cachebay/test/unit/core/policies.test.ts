import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { parse } from 'graphql';
import { getOperationKey, getFamilyKey } from '@/src/core/utils';
import { tick, seedCache } from '@/test/helpers';

/** Pull a friendly name out of the payload (first edge node name) */
function dataName(payload: any): string | null {
  const d = payload?.data;
  if (!d) return null;
  const conn = d.assets ?? d.colors ?? d.items ?? null;
  const node = conn?.edges?.[0]?.node ?? null;
  return node?.name ?? null;
}

function spyCtx(
  name: string,
  query: string,
  variables: Record<string, any>,
  calls: Array<{ name: string; term: boolean; value: string | null }>
) {
  return {
    operation: { type: 'query', query, variables, context: {} },
    useResult: (payload: any, terminate?: boolean) => {
      calls.push({ name, term: !!terminate, value: dataName(payload) });
    },
    afterQuery: () => { },
  } as any;
}

function makeCtx(
  name: string,
  query: string,
  variables: Record<string, any>,
  context: Record<string, any>,
  calls: Array<{ name: string; term: boolean; value: any }>
) {
  return {
    operation: { type: 'query', query, variables, context },
    useResult: (payload: any, terminate?: boolean) => {
      calls.push({ name, term: !!terminate, value: (payload?.data ?? payload?.error) });
    },
    afterQuery: () => { },
  } as any;
}

/** Test queries */
const ASSETS = /* GraphQL */ `
  query Assets($t: String) {
    assets(filter: $t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/* ──────────────────────────────────────────────────────────────
 * Cache policies (cache-only / cache-first / cache-and-network)
 * ────────────────────────────────────────────────────────────── */
describe('cache policies (cachebay only)', () => {
  it('cache-only: hit emits data and terminates; miss emits CacheOnlyMiss', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    // Seed op-cache for t=HIT (materialize: true, rabbit: false by default helper)
    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: {
        __typename: 'Query',
        assets: { __typename: 'AssetConnection', edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {} },
      },
      materialize: true,
    });

    // HIT
    {
      const calls: Array<{ name: string; term: boolean; value: string | null }> = [];
      const ctx = spyCtx('co-hit', ASSETS, { t: 'HIT' }, calls);
      ctx.operation.cachePolicy = 'cache-only';
      (cache as any)(ctx);
      expect(calls).toEqual([{ name: 'co-hit', term: true, value: 'X0' }]);
    }

    // MISS
    {
      const calls2: Array<{ name: string; term: boolean; value: any }> = [];
      const ctx2 = makeCtx('co-miss', ASSETS, { t: 'MISS' }, {}, calls2);
      ctx2.operation.cachePolicy = 'cache-only';
      (cache as any)(ctx2);
      expect(calls2.length).toBe(1);
      const v = calls2[0].value;
      expect(v?.networkError?.name).toBe('CacheOnlyMiss');
      expect(calls2[0].term).toBe(true);
    }
  });

  it('cache-first: hit emits cached and terminates; miss does nothing here (fetch would run later)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: {
        __typename: 'Query',
        assets: { __typename: 'AssetConnection', edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {} },
      },
      materialize: true,
    });

    // HIT
    {
      const calls: Array<{ name: string; term: boolean; value: string | null }> = [];
      const ctx = spyCtx('cf-hit', ASSETS, { t: 'HIT' }, calls);
      ctx.operation.cachePolicy = 'cache-first';
      (cache as any)(ctx);
      expect(calls).toEqual([{ name: 'cf-hit', term: true, value: 'X0' }]);
    }

    // MISS
    {
      const calls2: Array<{ name: string; term: boolean; value: string | null }> = [];
      const ctx2 = spyCtx('cf-miss', ASSETS, { t: 'MISS' }, calls2);
      ctx2.operation.cachePolicy = 'cache-first';
      (cache as any)(ctx2);
      // no cached emit in cache-first miss (fetch plugin would handle network)
      expect(calls2.length).toBe(0);
    }
  });

  it('cache-and-network: cached hit emits non-terminating; identical network is suppressed', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    const cachedEnvelope = {
      __typename: 'Query',
      assets: { __typename: 'AssetConnection', edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {} },
    };

    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: cachedEnvelope,
      materialize: true,
    });

    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];
    const ctx = spyCtx('cn', ASSETS, { t: 'HIT' }, calls);
    ctx.operation.cachePolicy = 'cache-and-network';

    // cached emit (non-terminating)
    (cache as any)(ctx);
    expect(calls).toEqual([{ name: 'cn', term: false, value: 'X0' }]);

    // winner network arrives with IDENTICAL content -> suppression (no extra call)
    ctx.useResult({ data: cachedEnvelope }, true);
    expect(calls).toEqual([{ name: 'cn', term: false, value: 'X0' }]);
  });

  it('cache-and-network: cached hit emits non-terminating; different network winner publishes once', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: {
        __typename: 'Query',
        assets: { __typename: 'AssetConnection', edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {} },
      },
      materialize: true,
    });

    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];
    const ctx = spyCtx('cn', ASSETS, { t: 'HIT' }, calls);
    ctx.operation.cachePolicy = 'cache-and-network';

    // cached emit (non-terminating)
    (cache as any)(ctx);
    expect(calls).toEqual([{ name: 'cn', term: false, value: 'X0' }]);

    // winner network DIFFERENT content → one more publish (terminating)
    ctx.useResult({
      data: {
        __typename: 'Query',
        assets: { __typename: 'AssetConnection', edges: [{ cursor: 'h2', node: { __typename: 'Asset', id: 2, name: 'X1' } }], pageInfo: {} },
      },
    }, true);

    expect(calls).toEqual([
      { name: 'cn', term: false, value: 'X0' },
      { name: 'cn', term: true, value: 'X1' },
    ]);
  });

  it('cache-and-network: miss → winner network publishes once', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];
    const ctx = spyCtx('cn', ASSETS, { t: 'MISS' }, calls);
    ctx.operation.cachePolicy = 'cache-and-network';

    // no cached emit
    (cache as any)(ctx);
    expect(calls.length).toBe(0);

    // network winner arrives
    ctx.useResult({
      data: {
        __typename: 'Query',
        assets: { __typename: 'AssetConnection', edges: [{ cursor: 'n', node: { __typename: 'Asset', id: 9, name: 'NEW' } }], pageInfo: {} },
      },
    }, true);

    expect(calls).toEqual([{ name: 'cn', term: true, value: 'NEW' }]);
  });
});

/* ──────────────────────────────────────────────────────────────
 * Cursor replay (cache merge, not concurrency)
 * ────────────────────────────────────────────────────────────── */
describe('cursor replay (cache merge)', () => {
  it('publishes cursor pages (after/before present) with terminate=true', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];

    const ctx = spyCtx('cursor', COLORS, { after: 'c2', first: 2 }, calls);
    (cache as any)(ctx);

    // cursor page result arrives
    ctx.useResult({
      data: {
        __typename: 'Query',
        colors: {
          __typename: 'ColorConnection',
          edges: [
            { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'C3' } },
            { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'C4' } },
          ],
          pageInfo: { startCursor: 'c3', endCursor: 'c4', hasNextPage: false, hasPreviousPage: true },
        },
      },
    }, true);

    expect(calls).toEqual([{ name: 'cursor', term: true, value: 'C3' }]);
  });
});
