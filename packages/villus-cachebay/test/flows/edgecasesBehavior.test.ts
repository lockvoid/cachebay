import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay } from '@/test/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
 * Queries & helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String) {
    colors(first:$first, after:$after) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const ASSETS = /* GraphQL */ `
  query Assets($t:String) {
    assets(filter:$t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

const liText = (w: any) => w.findAll('li').map((li: any) => li.text());
const cleanVars = (v: Record<string, any>) => {
  const o: Record<string, any> = {}; for (const k in v) if (v[k] != null) o[k] = v[k]; return o;
};

function makeColorsCache(extra?: any) {
  return createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    ...(extra || {}),
  });
}

function makeAssetsCache(extra?: any) {
  return createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
    ...(extra || {}),
  });
}

/** Harness that records renders/errors/empties and exposes array identity hooks */
function MakeColorsHarness(cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network', taps?: {
  edgeRefs?: any[], firstNodeRefs?: any[], lens?: number[]
}) {
  return defineComponent({
    props: { first: Number, after: String, renders: Array, empties: Array, errors: Array, name: String },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => cleanVars({ first: props.first, after: props.after }));
      const { data, error } = useQuery({ query: COLORS, variables: vars, cachePolicy });

      watch(() => data.value, (v) => {
        const con = v?.colors;
        if (con && Array.isArray(con.edges)) {
          if (con.edges.length > 0) {
            (props.renders as any[]).push(con.edges.map((e: any) => e?.node?.name || ''));
            // tap array identity + node identity + length changes
            if (taps?.edgeRefs) taps.edgeRefs.push(con.edges);
            if (taps?.firstNodeRefs && con.edges[0]?.node) taps.firstNodeRefs.push(con.edges[0].node);
            if (taps?.lens) taps.lens.push(con.edges.length);
          } else {
            (props.empties as any[]).push('empty'); // only real [] payloads
          }
        }
      }, { immediate: true });

      watch(() => error.value, (e) => { if (e) (props.errors as any[]).push(e.message || 'error'); }, { immediate: true });

      return () => h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

/** Harness for assets (simple list) */
function MakeAssetsHarness(cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only') {
  return defineComponent({
    props: { t: String, renders: Array, empties: Array, errors: Array },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => ({ t: props.t }));
      const { data, error } = useQuery({ query: ASSETS, variables: vars, cachePolicy });

      watch(() => data.value, (v) => {
        const con = v?.assets;
        if (con && Array.isArray(con.edges)) {
          if (con.edges.length > 0) (props.renders as any[]).push(con.edges.map((e: any) => e?.node?.name || ''));
          else (props.empties as any[]).push('empty');
        }
      }, { immediate: true });
      watch(() => error.value, (e) => { if (e) (props.errors as any[]).push(e.message || ''); }, { immediate: true });

      return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

describe('Integration • Edge-cases & performance guards', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];
  afterEach(async () => {
    while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); }
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * 1) Never emit empty payloads to consumers
   *    (no {}, undefined, or missing edges)
   * ────────────────────────────────────────────────────────────────────────── */
  it('Never emits empties across slow network, errors, and drops', async () => {
    const routes: Route[] = [
      // initial slow success
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 20,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'A1' } }],
              pageInfo: {},
            },
          },
        }),
      },
      // older error (should be dropped by take-latest)
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('drop me') }),
      },
      // final success
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'A2' } }],
              pageInfo: {},
            },
          },
        }),
      },
    ];
    const cache = makeColorsCache();
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/no-empties', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeColorsHarness('network-only');
    const w = mount(App, { props: { first: 2, renders, errors, empties, name: 'A' }, global: { plugins: [client as any] } });

    // queue older error then final success
    await w.setProps({ first: 3 }); await tick();
    await w.setProps({ first: 4 }); await tick();

    await delay(8); await tick();
    expect(renders.length).toBe(0);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    await delay(15); await tick();
    // Now success landed
    expect(renders).toEqual([['A2']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * 2) Single render per logical result
   *    - CN + cached hit + identical network → only 1 render
   *    - CN + cached hit + different network → 2 renders
   * ────────────────────────────────────────────────────────────────────────── */
  it('cache-and-network: identical network as cache → single render; different network → two renders', async () => {
    const cache = makeAssetsCache();
    // Seed op cache (pretend SSR or earlier visit)
    {
      const seedRoutes: Route[] = [{
        when: ({ variables }) => variables.t === 'HIT',
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', assets: {
              __typename: 'AssetConnection',
              edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {}
            }
          },
        }),
      }];
      const sfx = createFetchMock(seedRoutes);
      const sclient = createClient({ url: '/seed', use: [cache as any, sfx.plugin] });
      await sclient.execute({ query: ASSETS, variables: { t: 'HIT' }, context: { concurrencyScope: 'seed' } });
      await sfx.waitAll(); sfx.restore();
    }

    // Case 1: Identical network payload
    {
      const routes: Route[] = [{
        when: ({ variables }) => variables.t === 'HIT',
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query', assets: {
              __typename: 'AssetConnection',
              edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {}
            }
          },
        }),
      }];
      const fx = createFetchMock(routes);
      const client = createClient({ url: '/cn-ident', use: [cache as any, fx.plugin] });
      mocks.push(fx);

      const renders: string[][] = [];
      const empties: string[] = [];
      const errors: string[] = [];
      const App = MakeAssetsHarness('cache-and-network');
      mount(App, { props: { t: 'HIT', renders, empties, errors }, global: { plugins: [client as any] } });

      await tick(); // cached render
      expect(renders).toEqual([['X0']]);

      await delay(15); await tick(); // network identical
      expect(renders).toEqual([['X0']]); // still 1 render
    }

    // Case 2: Different network payload
    {
      const routes: Route[] = [{
        when: ({ variables }) => variables.t === 'HIT',
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query', assets: {
              __typename: 'AssetConnection',
              edges: [{ cursor: 'h2', node: { __typename: 'Asset', id: 2, name: 'X1' } }], pageInfo: {}
            }
          },
        }),
      }];
      const fx = createFetchMock(routes);
      const client = createClient({ url: '/cn-diff', use: [cache as any, fx.plugin] });
      mocks.push(fx);

      const renders: string[][] = [];
      const empties: string[] = [];
      const errors: string[] = [];
      const App = MakeAssetsHarness('cache-and-network');
      mount(App, { props: { t: 'HIT', renders, empties, errors }, global: { plugins: [client as any] } });

      await tick();
      expect(renders).toEqual([['X0']]); // cached

      await delay(15); await tick();
      expect(renders).toEqual([['X0'], ['X1']]); // network refresh different
    }
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * 3) No array churn in relay views: stable edges array & in-place updates
   * ────────────────────────────────────────────────────────────────────────── */
  it('Relay edges array: pointer stable; grows/shrinks as expected; entries update in place', async () => {
    const cache = makeColorsCache();
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'A2' } },
              ],
              pageInfo: { endCursor: 'c2', hasNextPage: true, startCursor: 'c1', hasPreviousPage: false }
            }
          },
        }),
      },
      // page 2 append
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'A3' } },
                { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'A4' } },
              ],
              pageInfo: { endCursor: 'c4', hasNextPage: false, startCursor: 'c3', hasPreviousPage: true }
            }
          },
        }),
      },
      // dedup update for Color:1 (should *not* add an entry, just update name)
      {
        when: ({ variables }) => variables.after === 'c4' && variables.first === 1,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'c1b', node: { __typename: 'Color', id: 1, name: 'A1-upd' } }],
              pageInfo: { endCursor: 'c1b' }
            }
          },
        }),
      },
    ];

    const fx = createFetchMock(routes);
    const client = createClient({ url: '/churn', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const empties: string[] = [];
    const errors: string[] = [];
    const edgeRefs: any[] = [];
    const firstNodeRefs: any[] = [];
    const lens: number[] = [];

    const App = MakeColorsHarness('network-only', { edgeRefs, firstNodeRefs, lens });
    const w = mount(App, { props: { first: 2, renders, empties, errors, name: 'CHURN' }, global: { plugins: [client as any] } });

    await delay(8); await tick();
    expect(renders).toEqual([['A1', 'A2']]);
    expect(lens[0]).toBe(2);

    await w.setProps({ first: 2, after: 'c2' }); await tick();
    await delay(12); await tick();
    expect(renders).toEqual([['A1', 'A2'], ['A1', 'A2', 'A3', 'A4']]);
    expect(lens[1]).toBe(4);

    await w.setProps({ first: 1, after: 'c4' }); await tick();
    await delay(12); await tick();
    // still 4 entries; A1 name updated
    expect(renders.at(-1)).toEqual(['A1-upd', 'A2', 'A3', 'A4']);
    expect(lens.at(-1)).toBe(4);

    // edges array pointer stable across all renders
    expect(edgeRefs.length).toBeGreaterThanOrEqual(3);
    const firstRef = edgeRefs[0];
    for (const r of edgeRefs) expect(r).toBe(firstRef);

    // first node proxy identity stable across update
    expect(firstNodeRefs.length).toBeGreaterThanOrEqual(3);
    const firstNodeRef = firstNodeRefs[0];
    for (const n of firstNodeRefs) expect(n).toBe(firstNodeRef);
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * 4) Cache eviction (LRU op cache)
   * ────────────────────────────────────────────────────────────────────────── */
  it('LRU op cache: eviction prevents CF immediate render; non-evicted still hits', async () => {
    const cache = makeAssetsCache({ lruOperationCacheSize: 2 });
    // Seed 3 different ops → oldest (A) evicted
    {
      const routes: Route[] = [
        { when: ({ variables }) => variables.t === 'A', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'a', node: { __typename: 'Asset', id: 11, name: 'A' } }], pageInfo: {} } } }) },
        { when: ({ variables }) => variables.t === 'B', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'b', node: { __typename: 'Asset', id: 12, name: 'B' } }], pageInfo: {} } } }) },
        { when: ({ variables }) => variables.t === 'C', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'c', node: { __typename: 'Asset', id: 13, name: 'C' } }], pageInfo: {} } } }) },
      ];
      const fx = createFetchMock(routes);
      const client = createClient({ url: '/seed-lru', use: [cache as any, fx.plugin] });

      await client.execute({ query: ASSETS, variables: { t: 'A' }, context: { concurrencyScope: 'seed' } });
      await client.execute({ query: ASSETS, variables: { t: 'B' }, context: { concurrencyScope: 'seed' } });
      await client.execute({ query: ASSETS, variables: { t: 'C' }, context: { concurrencyScope: 'seed' } });

      await fx.waitAll(); fx.restore();
    }

    // CF hit for non-evicted (B) — should render immediately
    {
      const fx = createFetchMock([]);
      const client = createClient({ url: '/cf-B', use: [cache as any, fx.plugin] });
      mocks.push(fx);

      const renders: string[][] = []; const empties: string[] = []; const errors: string[] = [];
      const App = MakeAssetsHarness('cache-first');
      mount(App, { props: { t: 'B', renders, empties, errors }, global: { plugins: [client as any] } });

      await tick();
      expect(renders).toEqual([['B']]);
      expect(fx.calls.length).toBe(0);
    }

    // CF miss for evicted (A) — should NOT render immediately
    {
      const fx = createFetchMock([]); // no network responses
      const client = createClient({ url: '/cf-A', use: [cache as any, fx.plugin] });
      mocks.push(fx);

      const renders: string[][] = []; const empties: string[] = []; const errors: string[] = [];
      const App = MakeAssetsHarness('cache-first');
      mount(App, { props: { t: 'A', renders, empties, errors }, global: { plugins: [client as any] } });

      await tick();
      expect(renders.length).toBe(0); // no immediate render (evicted)
      expect(fx.calls.length).toBe(0); // CF: no network fetch
    }
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * 5) Interface reads: Node:* returns concrete implementors (keys & materialized)
   * ────────────────────────────────────────────────────────────────────────── */
  it('Interface reads: Node:* lists concrete implementors for keys & materialized proxies', async () => {
    const cache = createCache({
      addTypename: true,
      interfaces: () => ({ Node: ['Color', 'T'] }),
      keys: () => ({
        Color: (o: any) => (o?.id != null ? String(o.id) : null),
        T: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    // Seed concrete implementors
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'C1' }).commit?.();
    (cache as any).writeFragment({ __typename: 'T', id: 2, name: 'T2' }).commit?.();
    await tick();

    // Keys for Node:* (via cache.inspect.listEntityKeys if exposed on instance)
    const keys = (cache as any).listEntityKeys('Node');
    expect(keys.sort()).toEqual(['Color:1', 'T:2']);

    // Materialized fragments via useFragments('Node:*')
    const Comp = defineComponent({
      setup() {
        const { useFragments } = require('@/src'); // from public API
        return { list: useFragments('Node:*') };
      },
      render() { return h('div'); },
    });

    const w = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    const list = (w.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
    const names = list.map((x: any) => x?.name).sort();
    expect(names).toEqual(['C1', 'T2']);
  });
});
