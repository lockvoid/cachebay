import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { parse } from 'graphql';
import { getOperationKey, getFamilyKey } from '@/src/core/utils';
import { tick, seedCache } from '@/test/helpers';

/** Pull a friendly name out of the payload (first edge node name) */
function dataName(payload: any): string | null {
  const d = payload?.data;
  if (!d) return null;
  const conn =
    d.assets ??
    d.colors ??
    d.items ??
    null;
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
const QUERY = /* GraphQL */ `
  query Assets($t: String) {
    assets(filter: $t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

const CONN_QUERY = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/* ──────────────────────────────────────────────────────────────
 * UI latency / fast switching (now verifying winner replay)
 * ────────────────────────────────────────────────────────────── */
describe('UI latency edge case — fast tab switching preserves last good view', () => {
  it('A,B,C,A,B,C switching: all pending ops settle; resolved losers receive winner payload (C2)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];

    // Baseline A
    const A1 = spyCtx('A', QUERY, { t: 'A' }, calls);
    plugin(A1);
    A1.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'a1', node: { __typename: 'Asset', id: 1, name: 'A1' } }],
          pageInfo: { endCursor: 'a1', hasNextPage: false },
        },
      },
    }, true);

    // Rapid leaders (C1 is LEADER for {t:'C'}, C2 is FOLLOWER)
    const B1 = spyCtx('B1', QUERY, { t: 'B' }, calls);
    const C1 = spyCtx('C1', QUERY, { t: 'C' }, calls); // leader
    const A2 = spyCtx('A2', QUERY, { t: 'A' }, calls);
    const B2 = spyCtx('B2', QUERY, { t: 'B' }, calls);
    const C2 = spyCtx('C2', QUERY, { t: 'C' }, calls); // follower

    plugin(B1);
    plugin(C1);
    plugin(A2);
    plugin(B2);
    plugin(C2);

    // Winner resolves on the LEADER (C1), not C2
    C1.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'c3', node: { __typename: 'Asset', id: 33, name: 'C3' } }],
          pageInfo: { endCursor: 'c3', hasNextPage: false },
        },
      },
    }, true);

    // let dedup forward to C2
    await tick(0);

    const byName = Object.fromEntries(calls.map(c => [c.name, c.value]));
    expect(byName['A']).toBe('A1');    // baseline
    expect(byName['C1']).toBe('C3');   // leader got network payload
    expect(byName['C2']).toBe('C3');   // follower received forwarded winner payload
    // losers that never resolved remain undefined (no publish)
    expect(byName['B1']).toBeUndefined();
    expect(byName['A2']).toBeUndefined();
    expect(byName['B2']).toBeUndefined();
  });

  it('A,B,C,D with B cached: immediate cached reveal (non-terminating) then winner C2', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    seedCache(cache, {
      query: QUERY,
      variables: { t: "B" },
      data: {
        __typename: "Query",
        assets: {
          __typename: "AssetConnection",
          edges: [{ cursor: "b1", node: { __typename: "Asset", id: 2, name: "B1" } }],
          pageInfo: { endCursor: "b1", hasNextPage: false },
        },
      },
    });
    await tick(0);

    const plugin = cache as unknown as (ctx: any) => void;
    const calls: Array<{ name: string; term: boolean; value: string | null }> = [];

    const A = spyCtx('A', QUERY, { t: 'A' }, calls);
    plugin(A);
    A.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'a1', node: { __typename: 'Asset', id: 1, name: 'A1' } }],
          pageInfo: { endCursor: 'a1', hasNextPage: false },
        },
      },
    }, true);

    const C1 = spyCtx('C1', QUERY, { t: 'C' }, calls); // LEADER for C
    const D1 = spyCtx('D1', QUERY, { t: 'D' }, calls);
    plugin(C1);
    plugin(D1);

    const B = spyCtx('B', QUERY, { t: 'B' }, calls);
    plugin(B); // cached reveal via plugin (non-terminating)

    const C2 = spyCtx('C2', QUERY, { t: 'C' }, calls); // FOLLOWER for C
    plugin(C2);

    // Winner payload resolves on C1 (leader)
    C1.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'c2', node: { __typename: 'Asset', id: 3, name: 'C2' } }],
          pageInfo: { endCursor: 'c2', hasNextPage: false },
        },
      },
    }, true);

    await tick(0);

    const byName = Object.fromEntries(calls.map(c => [c.name, c.value]));
    const termByName = Object.fromEntries(calls.map(c => [c.name, c.term]));

    expect(byName['A']).toBe('A1');
    expect(byName['B']).toBe('B1');        // cached reveal
    expect(termByName['B']).toBe(false);   // non-terminating
    expect(byName['C1']).toBe('C2');       // leader
    expect(byName['C2']).toBe('C2');       // follower forwarded
    expect(termByName['C1']).toBe(true);
    expect(termByName['C2']).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────────
 * core/take-latest (losers replay winner)
 * ────────────────────────────────────────────────────────────── */
describe('core/take-latest', () => {
  it('older op replays winner result when later family member exists', async () => {
    const cache = createCache({});
    const calls: Array<{ name: string; term: boolean; value: any }> = [];
    const query = 'query Q { x }';

    const older = makeCtx('older', query, {}, {}, calls); // LEADER
    const newer = makeCtx('newer', query, {}, {}, calls); // FOLLOWER

    (cache as any)(older);
    (cache as any)(newer);

    // Leader settles with final (winner) payload
    older.useResult({ data: { x: 2 } }, true);

    // Allow dedup promise to forward into follower
    await tick(0);

    expect(calls.map(c => c.name)).toEqual(['older', 'newer']);
    expect(calls[0].value).toEqual({ x: 2 });
    expect(calls[1].value).toEqual({ x: 2 });
  });

  it('concurrencyScope isolates families; both winners publish their own payloads', () => {
    const cache = createCache({});
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: Array<{ name: string; term: boolean; value: any }> = [];
    const query = 'query Q { x }';

    const a = makeCtx('tab-1', query, {}, { concurrencyScope: 'tab-1' }, calls);
    const b = makeCtx('tab-2', query, {}, { concurrencyScope: 'tab-2' }, calls);

    plugin(a);
    plugin(b);

    a.useResult({ data: { x: 1 } }, true);
    b.useResult({ data: { x: 2 } }, true);

    expect(calls).toEqual([
      { name: 'tab-1', term: true, value: { x: 1 } },
      { name: 'tab-2', term: true, value: { x: 2 } },
    ]);
  });

  it('allows replay of a stale page result when relay resolver marks allowReplayOnStale', () => {
    const cache = createCache({
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: Array<{ name: string; term: boolean; value: any }> = [];

    const older = makeCtx('older', CONN_QUERY, { after: 'c2', first: 2 }, {}, calls);
    const newer = makeCtx('newer', CONN_QUERY, {}, {}, calls);

    plugin(older);
    plugin(newer);

    // Newer first
    newer.useResult({
      data: {
        __typename: 'Query',
        colors: {
          __typename: 'ColorConnection',
          edges: [
            { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'A' } },
            { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'B' } },
          ],
          pageInfo: { startCursor: 'c1', endCursor: 'c2', hasNextPage: true, hasPreviousPage: false },
        },
      },
    }, true);

    // Older (page 2) after — allowed to publish due to cursor exception
    older.useResult({
      data: {
        __typename: 'Query',
        colors: {
          __typename: 'ColorConnection',
          edges: [
            { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'C' } },
            { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'D' } },
          ],
          pageInfo: { startCursor: 'c3', endCursor: 'c4', hasNextPage: false, hasPreviousPage: true },
        },
      },
    }, true);

    // Expect both to pass, preserving order
    expect(calls.map(c => c.name)).toEqual(['newer', 'older']);
  });
});

/* ──────────────────────────────────────────────────────────────
 * op-family & getOperationKey
 * ────────────────────────────────────────────────────────────── */
describe('core/op-family & getOperationKey', () => {
  it('familyKey is stable w.r.t. variable order', () => {
    const opA: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { a: 1, b: 2 }, context: {} };
    const opB: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { b: 2, a: 1 }, context: {} };

    const fa = getFamilyKey(opA);
    const fb = getFamilyKey(opB);
    expect(fa).toBe(fb);
  });

  it('familyKey includes concurrencyScope (isolates families)', () => {
    const op1: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-1' } };
    const op2: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-2' } };

    const f1 = getFamilyKey(op1);
    const f2 = getFamilyKey(op2);

    expect(f1).not.toBe(f2);
    expect(f1.endsWith('::tab-1')).toBe(true);
    expect(f2.endsWith('::tab-2')).toBe(true);
  });

  it('getOperationKey changes when variables change', () => {
    const A: any = { query: 'query Q { x }', variables: { n: 1 }, context: {} };
    const B: any = { query: 'query Q { x }', variables: { n: 2 }, context: {} };
    expect(getOperationKey(A)).not.toBe(getOperationKey(B));
  });

  it('getOperationKey is identical for string vs DocumentNode, all else equal', () => {
    const src = 'query Q { x }';
    const opStr: any = { query: src, variables: {}, context: {} };
    const opDoc: any = { query: parse(src), variables: {}, context: {} };
    expect(getOperationKey(opStr)).toBe(getOperationKey(opDoc));
  });
});
