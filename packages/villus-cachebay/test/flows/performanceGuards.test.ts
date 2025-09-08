// test/flows/performanceGuards.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache, useFragments } from '@/src';
import { createFetchMock, type Route, tick, delay, seedCache } from '@/test/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
 * Queries
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Cache builders
 * ──────────────────────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Harnesses
 * ──────────────────────────────────────────────────────────────────────────── */
function MakeColorsHarness(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network',
  taps?: { firstNodeIds?: string[]; lens?: number[] }
) {
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
            if (taps?.firstNodeIds && con.edges[0]?.node) {
              taps.firstNodeIds.push(String(con.edges[0].node.id ?? con.edges[0].node._id));
            }
            if (taps?.lens) taps.lens.push(con.edges.length);
          } else {
            (props.empties as any[]).push('empty');
          }
        }
      }, { immediate: true });

      watch(() => error.value, (e) => { if (e) (props.errors as any[]).push(e.message || 'error'); }, { immediate: true });

      return () => h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

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

/* ─────────────────────────────────────────────────────────────────────────────
 * Suites
 * ──────────────────────────────────────────────────────────────────────────── */
describe('Integration • Performance guards (cachebay only)', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];
  afterEach(async () => {
    while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); }
  });

  /* 1) Relay: grows/shrinks, entries update in place, logical identity stable */
  it('Relay edges array: grows/shrinks, entries update in place, logical identity stable', async () => {
    const cache = makeColorsCache();
    const routes: Route[] = [
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
    const firstNodeIds: string[] = [];
    const lens: number[] = [];

    const App = MakeColorsHarness('network-only', { firstNodeIds, lens });
    const w = mount(App, { props: { first: 2, renders, empties, errors, name: 'CHURN' }, global: { plugins: [client as any] } });

    await delay(8); await tick(6);
    expect(renders).toEqual([['A1', 'A2']]);
    expect(lens[0]).toBe(2);

    await w.setProps({ first: 2, after: 'c2' }); await tick(6);
    await delay(12); await tick(6);
    expect(renders).toEqual([['A1', 'A2'], ['A1', 'A2', 'A3', 'A4']]);
    expect(lens[1]).toBe(4);

    await w.setProps({ first: 1, after: 'c4' }); await tick(6);
    await delay(12); await tick(6);
    expect(renders.at(-1)).toEqual(['A1-upd', 'A2', 'A3', 'A4']);
    expect(lens.at(-1)).toBe(4);

    // assert logical identity of the first node across updates (ids are the same entity)
    expect(new Set(firstNodeIds).size).toBe(1);
  });

  /* 3) Interface reads: Node:* materialized proxies */
  it('Interface reads: Node:* lists concrete implementors and materialized proxies', async () => {
    const cache = createCache({
      addTypename: true,
      interfaces: () => ({ Node: ['Color', 'T'] }),
      keys: () => ({
        Color: (o: any) => (o?.id != null ? String(o.id) : null),
        T: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'C1' }).commit?.();
    (cache as any).writeFragment({ __typename: 'T', id: 2, name: 'T2' }).commit?.();
    await tick(2);

    const keys = (cache as any).listEntityKeys('Node');
    expect(keys.sort()).toEqual(['Color:1', 'T:2']);

    const Comp = defineComponent({
      setup() {
        return { list: useFragments('Node:*') };
      },
      render() { return h('div'); },
    });
    const w = mount(Comp, { global: { plugins: [cache as any] } });
    await tick(2);

    const list = (w.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
    const names = list.map((x: any) => x?.name).sort();
    expect(names).toEqual(['C1', 'T2']);
  });
});
