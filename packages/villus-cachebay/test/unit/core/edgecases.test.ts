import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { parse } from 'graphql';
import {
  operationKey,
  familyKeyForOperation,
} from '@/src/core/utils';

function makeCtx(
  name: string,
  query: string,
  variables: Record<string, any> = {},
  context: Record<string, any> = {},
  sink: string[],
) {
  const ctx: any = {
    operation: { type: 'query', query, variables, context },
    useResult: (payload: any) => { sink.push(name); },
    afterQuery: () => { },
  };
  return ctx;
}

const CONN_QUERY = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;


function makeCtx2(
  name: string,
  query: string,
  variables: Record<string, any>,
  renders: string[],
  empties: string[],
) {
  return {
    operation: { type: 'query', query, variables, context: {} },

    useResult: (payload: any) => {
      if (Object.keys(payload).length === 0) {
        return;
      }

      renders.push(name);
    },

    afterQuery: () => {
      // Noop
    },
  } as any;
}

const QUERY = /* GraphQL */ `
  query Assets($t: String) {
    assets(filter: $t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

describe('UI latency edge case — fast tab switching preserves last good view', () => {
  it('A,B,C,A,B,C switching: keeps showing A until C result lands (no undefined edges)', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const renders: string[] = [];
    const empties: string[] = [];

    // Start on A, deliver its data immediately (baseline UI).
    const A1 = makeCtx2('A', QUERY, { t: 'A' }, renders, empties);
    plugin(A1);
    A1.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [
            { cursor: 'a1', node: { __typename: 'Asset', id: 1, name: 'A1' } },
          ],
          pageInfo: { endCursor: 'a1', hasNextPage: false },
        },
      },
    });

    // Now user quickly switches: B, C, A, B, C — none of these have network results yet.
    const B1 = makeCtx2('B1', QUERY, { t: 'B' }, renders, empties);
    const C1 = makeCtx2('C1', QUERY, { t: 'C' }, renders, empties);
    const A2 = makeCtx2('A2', QUERY, { t: 'A' }, renders, empties);
    const B2 = makeCtx2('B2', QUERY, { t: 'B' }, renders, empties);
    const C2 = makeCtx2('C2', QUERY, { t: 'C' }, renders, empties);

    plugin(B1);
    plugin(C1);
    plugin(A2);
    plugin(B2);
    plugin(C2);

    // While all are still pending, UI should STILL be showing A (no blank intermediate payloads).
    expect(renders).toEqual(['A']);
    expect(empties).toEqual([]);

    // Finally C resolves (that's where the user stopped).
    C2.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [
            { cursor: 'c3', node: { __typename: 'Asset', id: 3, name: 'C3' } },
          ],
          pageInfo: { endCursor: 'c3', hasNextPage: false },
        },
      },
    });

    // We should only have rendered A, then C — and never received an "empty" payload.
    expect(renders).toEqual(['A', 'C2']);
    expect(empties).toEqual([]);
  });

  it('A,B,C,D with B cached: switching to B renders immediately; switching to C keeps showing B until C resolves', () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const renders: string[] = [];
    const empties: string[] = [];

    // Small local helper to build ctxs that record renders/empties
    function ctx(name: string, vars: Record<string, any>) {
      return {
        operation: { type: 'query', query: QUERY, variables: vars, context: {} },
        useResult: (payload: any) => {
          if (!payload || typeof payload !== 'object' || !('data' in payload) || payload.data == null) {
            empties.push(name);
          } else {
            renders.push(name);
          }
        },
        afterQuery: () => { },
      } as any;
    }

    // 1) Pre-seed B in the op cache (user viewed B earlier in the session).
    //    We seed via the plugin so op-cache & lastPublished are set correctly,
    //    but we use a no-op useResult so it doesn't count as a render now.
    const Bseed: any = {
      operation: { type: 'query', query: QUERY, variables: { t: 'B' }, context: {} },
      useResult: (_: any) => { },
      afterQuery: () => { },
    };
    plugin(Bseed);
    Bseed.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'b1', node: { __typename: 'Asset', id: 2, name: 'B1' } }],
          pageInfo: { endCursor: 'b1', hasNextPage: false },
        },
      },
    });

    // 2) User is on A now (baseline visible UI is A).
    const A1 = ctx('A', { t: 'A' });
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
    });

    // 3) Fast switch to C and D: start both requests but no network results yet.
    const C1 = ctx('C1', { t: 'C' });
    const D1 = ctx('D1', { t: 'D' });
    plugin(C1);
    plugin(D1);

    // 4) Switch to B — should show immediately from cache (no undefined edges), and still send network.
    const B_live = ctx('B', { t: 'B' });
    plugin(B_live);
    // (no network response yet; cache-first should have rendered immediately)

    // 5) Switch to C again — still pending; UI must continue showing B until C resolves.
    const C2 = ctx('C2', { t: 'C' });
    plugin(C2);

    // At this moment only A (initial) and B (cache-first) should have rendered. No empties.
    expect(renders).toEqual(['A', 'B']);
    expect(empties).toEqual([]);

    // 6) Now C resolves — UI updates to C.
    C2.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'c2', node: { __typename: 'Asset', id: 3, name: 'C2' } }],
          pageInfo: { endCursor: 'c2', hasNextPage: false },
        },
      },
    });

    // Final: A → B (immediate cache) → C2 (when ready). Still no empties.
    expect(renders).toEqual(['A', 'B', 'C2']);
    expect(empties).toEqual([]);
  });

  it('fast switching: older in-flight results (B1, C1) do not render; only latest C2 renders', () => {
    const cache = createCache({
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    });

    const renders: string[] = [];

    function ctx(name: string, vars: Record<string, any>) {
      return {
        operation: { type: 'query', query: QUERY, variables: vars, context: {} },

        useResult: (payload: any) => {
          if (Object.keys(payload).length === 0) {
            return;
          }

          renders.push(name);
        },

        afterQuery: () => {
          // Noop
        },
      } as any;
    }

    // 1) Initial A render (baseline visible UI).
    const A1 = ctx('A', { t: 'A' });

    cache(A1);

    A1.useResult({
      data: {
        __typename: 'Query',

        assets: {
          __typename: 'AssetConnection',

          pageInfo: { endCursor: 'a1', hasNextPage: false },

          edges: [{ node: { __typename: 'Asset', id: 1, name: 'A1' } }],
        },
      },
    });

    // 2) Start multiple in-flight leaders by rapid switching; last is C2 (current tab).
    const B1 = ctx('B1', { t: 'B' });
    const C1 = ctx('C1', { t: 'C' });
    const A2 = ctx('A2', { t: 'A' });
    const B2 = ctx('B2', { t: 'B' });
    const C2 = ctx('C2', { t: 'C' });

    cache(B1);
    cache(C1);
    cache(A2);
    cache(B2);
    cache(C2); // latest leader for family "assets"

    // 3) Older in-flight results arrive out of order — MUST NOT render:
    //    - B1 resolves (not latest leader) → drop silently
    B1.useResult({
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'b1', node: { __typename: 'Asset', id: 20, name: 'B1' } }],
          pageInfo: { endCursor: 'b1', hasNextPage: false },
        },
      },
    });

    // - C1 (older C) resolves before C2 → also drop silently
    C1.useResult({
      data: {
        __typename: 'Query',

        assets: {
          __typename: 'AssetConnection',

          pageInfo: { endCursor: 'c1', hasNextPage: true },

          edges: [{ node: { __typename: 'Asset', id: 30, name: 'C1' } }],
        },
      },
    });

    // Still only A rendered, no empties.x
    expect(renders).toEqual(['A']);

    // 4) Finally the latest leader (C2) resolves — now it should render.
    C2.useResult({
      data: {
        __typename: 'Query',

        assets: {
          __typename: 'AssetConnection',

          pageInfo: { endCursor: 'c2', hasNextPage: false },

          edges: [{ cursor: 'c2', node: { __typename: 'Asset', id: 31, name: 'C2' } }],
        },
      },
    });

    expect(renders).toEqual(['A', 'C2']);
  });
});

describe('core/take-latest', () => {
  it('drops stale results from older operation when a later family member exists', () => {
    const cache = createCache({});

    const events: string[] = [];
    const query = 'query Q { x }';

    const older = makeCtx('older', query, {}, {}, events);
    const newer = makeCtx('newer', query, {}, {}, events);

    // register both in order: newer is the latest family member
    cache(older);
    cache(newer);

    // out-of-order network: older finishes first -> should be dropped
    older.useResult({ data: { x: 1 } });
    newer.useResult({ data: { x: 2 } });

    expect(events).toEqual(['newer']);
  });

  it('concurrencyScope isolates families; both results pass', () => {
    const cache = createCache({});
    const plugin = cache as unknown as (ctx: any) => void;

    const events: string[] = [];
    const query = 'query Q { x }';

    const a = makeCtx('tab-1', query, {}, { concurrencyScope: 'tab-1' }, events);
    const b = makeCtx('tab-2', query, {}, { concurrencyScope: 'tab-2' }, events);

    plugin(a);
    plugin(b);

    a.useResult({ data: { x: 1 } });
    b.useResult({ data: { x: 2 } });

    // Different scopes: no dropping
    expect(events).toEqual(['tab-1', 'tab-2']);
  });

  it('allows replay of a stale page result when relay resolver marks allowReplayOnStale', () => {
    const cache = createCache({
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }), // relay sets allowReplayOnStale for after/before
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const events: string[] = [];

    // Older request = page 2 (after present) — will finish last
    const older = makeCtx(
      'older',
      CONN_QUERY,
      { after: 'c2', first: 2 },
      {},
      events,
    );

    // Newer request = page 1 (no cursors)
    const newer = makeCtx(
      'newer',
      CONN_QUERY,
      {},
      {},
      events,
    );

    plugin(older);
    plugin(newer);

    // Newer finishes first
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
    });

    // Older (page 2) finishes after — relay resolver should set hint.allowReplayOnStale=true
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
    });

    // Expect both to pass: newer first, then older replay allowed
    expect(events).toEqual(['newer', 'older']);
  });
});

describe('core/op-family & operationKey', () => {
  it('familyKey is stable w.r.t. variable order', () => {
    const opA: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { a: 1, b: 2 }, context: {} };
    const opB: any = { query: 'query Q($a:Int,$b:Int){x}', variables: { b: 2, a: 1 }, context: {} };

    const fa = familyKeyForOperation(opA);
    const fb = familyKeyForOperation(opB);
    expect(fa).toBe(fb);
  });

  it('familyKey includes concurrencyScope (isolates families)', () => {
    const op1: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-1' } };
    const op2: any = { query: 'query Q { x }', variables: {}, context: { concurrencyScope: 'tab-2' } };

    const f1 = familyKeyForOperation(op1);
    const f2 = familyKeyForOperation(op2);

    expect(f1).not.toBe(f2);
    expect(f1.endsWith('::tab-1')).toBe(true);
    expect(f2.endsWith('::tab-2')).toBe(true);
  });

  it('operationKey changes when variables change', () => {
    const A: any = { query: 'query Q { x }', variables: { n: 1 }, context: {} };
    const B: any = { query: 'query Q { x }', variables: { n: 2 }, context: {} };
    expect(operationKey(A)).not.toBe(operationKey(B));
  });

  it('operationKey is identical for string vs DocumentNode, all else equal', () => {
    const src = 'query Q { x }';
    const opStr: any = { query: src, variables: {}, context: {} };
    const opDoc: any = { query: parse(src), variables: {}, context: {} };
    expect(operationKey(opStr)).toBe(operationKey(opDoc));
  });
});
