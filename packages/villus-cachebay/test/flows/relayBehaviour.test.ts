import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, Suspense } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay } from '@/test/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
 * Shared query
 * ──────────────────────────────────────────────────────────────────────────── */
const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/* ─────────────────────────────────────────────────────────────────────────────
 * Harnesses
 *   - default: renders colors.edges
 *   - anyEdges: renders colors.edges || colors.items (for custom paths)
 * Variables are computed → prop changes retrigger useQuery.
 * ──────────────────────────────────────────────────────────────────────────── */
function harnessEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => ({
        first: props.first,
        after: props.after,
        last: props.last,
        before: props.before,
      }));
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy });
      return () =>
        h(
          'ul',
          {},
          (data?.value?.colors?.edges ?? []).map((e: any) =>
            h('li', {}, e.node?.name || ''),
          ),
        );
    },
  });
}

function harnessAnyEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => ({
        first: props.first,
        after: props.after,
        last: props.last,
        before: props.before,
      }));
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy });
      return () => {
        const c = (data?.value as any)?.colors || {};
        const edges = c.edges ?? c.items ?? [];
        return h(
          'ul',
          {},
          edges.map((e: any) => h('li', {}, (e.node && e.node.name) || '')),
        );
      };
    },
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Client builders (different resolver configs)
 * ──────────────────────────────────────────────────────────────────────────── */
function makeClientMode(mode: 'append' | 'prepend' | 'replace' | 'auto', routes: Route[]) {
  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({
      Query: { colors: relay({ paginationMode: mode }) },
    }),
  });
  const fx = createFetchMock(routes);
  const client = createClient({ url: '/relay', use: [cache as any, fx.plugin] });
  return { cache, client, fetchMock: fx };
}

function makeClientCustomPaths(
  opts: { edges: string; node: string; pageInfo: string },
  routes: Route[],
) {
  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({
      Query: { colors: relay({ paginationMode: 'append', ...opts }) },
    }),
  });
  const fx = createFetchMock(routes);
  const client = createClient({ url: '/relay', use: [cache as any, fx.plugin] });
  return { cache, client, fetchMock: fx };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */
function liText(w: ReturnType<typeof mount>) {
  return w.findAll('li').map(li => li.text());
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Flows (Spec Coverage)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('Integration • Relay flows (spec coverage)', () => {
  const restores: Array<() => void> = [];
  afterEach(() => { while (restores.length) (restores.pop()!)(); });

  /* 3) Modes — append/prepend/replace behavior & view sizing (by visible edges) */

  it('append mode: adds at end, bumps visible by page size', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
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
              pageInfo: { endCursor: 'c2', hasNextPage: true, startCursor: 'c1', hasPreviousPage: false },
            },
          },
        }),
      },
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'A3' } },
                { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'A4' } },
              ],
              pageInfo: { endCursor: 'c4', hasNextPage: false, startCursor: 'c3', hasPreviousPage: true },
            },
          },
        }),
      },
    ];
    const { client, fetchMock } = makeClientMode('append', routes);
    restores.push(fetchMock.restore);

    const w = mount(harnessEdges('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A1', 'A2']); // visible == page size

    await w.setProps({ first: 2, after: 'c2' });
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A1', 'A2', 'A3', 'A4']); // bumped by page size again
  });

  it('prepend mode: adds before and bumps visible by page size', async () => {
    const routes: Route[] = [
      // earlier page (before page 1)
      {
        when: ({ variables }) => variables.last === 2 && variables.before === 'c1',
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c-1', node: { __typename: 'Color', id: 0, name: 'A0' } },
                { cursor: 'c0', node: { __typename: 'Color', id: 0.5 as any, name: 'A0.5' } },
              ],
              pageInfo: { startCursor: 'c-1', hasPreviousPage: false },
            },
          },
        }),
      },
      // page 1
      {
        when: ({ variables }) => !variables.before && variables.first === 2,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'A2' } },
              ],
              pageInfo: { startCursor: 'c1', hasPreviousPage: true },
            },
          },
        }),
      },
    ];
    const { client, fetchMock } = makeClientMode('prepend', routes);
    restores.push(fetchMock.restore);

    const w = mount(harnessEdges('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await delay(12); await tick(6);
    expect(liText(w)).toEqual(['A1', 'A2']);

    await w.setProps({ last: 2, before: 'c1' });
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A0', 'A0.5', 'A1', 'A2']); // bumped in front
  });

  it('replace mode: clears list, then shows only the latest page', async () => {
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
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
              pageInfo: { endCursor: 'c2', hasNextPage: true },
            },
          },
        }),
      },
      // page 2
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'A3' } },
                { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'A4' } },
              ],
              pageInfo: { endCursor: 'c4', hasNextPage: false },
            },
          },
        }),
      },
    ];
    const { client, fetchMock } = makeClientMode('replace', routes);
    restores.push(fetchMock.restore);

    const w = mount(harnessEdges('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A1', 'A2']);

    await w.setProps({ first: 2, after: 'c2' });
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A3', 'A4']); // replaced (visible == page size of last page)
  });

  /* 5) Dedup & update-in-place (no duplicates, edge meta merged; order stable) */

  it('dedup: same node updates in place (name + cursor + edge meta), order stable', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c1', score: 10, node: { __typename: 'Color', id: 1, name: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'A2' } },
              ],
              pageInfo: { endCursor: 'c2', hasNextPage: true },
            },
          },
        }),
      },
      // Update node 1 (duplicate) with new cursor + edge meta; should not add a duplicate
      {
        when: ({ variables }) => variables.after === 'c2',
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'c1b', score: 99, node: { __typename: 'Color', id: 1, name: 'A1-new' } },
              ],
              pageInfo: { endCursor: 'c1b', hasNextPage: true },
            },
          },
        }),
      },
    ];
    const { client, fetchMock } = makeClientMode('append', routes);
    restores.push(fetchMock.restore);

    const w = mount(harnessEdges('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['A1', 'A2']);

    await w.setProps({ first: 2, after: 'c2' });
    await delay(7); await tick(6);
    // order remains [node1, node2], node1 name updated
    expect(liText(w)).toEqual(['A1-new', 'A2']);
  });

  /* Custom paths (edges=item, node=item.node, pageInfo=meta) */

  it('custom paths: edges=items, node=item.node, pageInfo=meta', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              items: [
                { cursor: 'x1', item: { node: { __typename: 'Color', id: 7, name: 'X1' } } },
              ],
              meta: { endCursor: 'x1', hasNextPage: false },
            },
          },
        }),
      },
    ];
    const { client, fetchMock } = makeClientCustomPaths(
      { edges: 'items', node: 'item.node', pageInfo: 'meta' },
      routes,
    );
    restores.push(fetchMock.restore);

    const w = mount(harnessAnyEdges('network-only'), { props: { first: 1 }, global: { plugins: [client as any] } });

    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['X1']); // read from items, not edges
  });

  /* Auto mode inference */

  it('auto mode: after -> append, before -> prepend, none -> replace', async () => {
    const routes: Route[] = [
      // baseline (none -> replace): show page1 only
      {
        when: ({ variables }) => !variables.after && !variables.before && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'p1', node: { __typename: 'Color', id: 1, name: 'P1-1' } },
                { cursor: 'p2', node: { __typename: 'Color', id: 2, name: 'P1-2' } },
              ],
              pageInfo: { endCursor: 'p2', hasNextPage: true, startCursor: 'p1', hasPreviousPage: false },
            },
          },
        }),
      },
      // append (after present)
      {
        when: ({ variables }) => variables.after === 'p2' && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'p3', node: { __typename: 'Color', id: 3, name: 'P2-1' } },
                { cursor: 'p4', node: { __typename: 'Color', id: 4, name: 'P2-2' } },
              ],
              pageInfo: { endCursor: 'p4', hasNextPage: false },
            },
          },
        }),
      },
      // prepend (before present)
      {
        when: ({ variables }) => variables.before === 'p1' && variables.last === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'p-1', node: { __typename: 'Color', id: 0, name: 'P0-1' } },
                { cursor: 'p0', node: { __typename: 'Color', id: 0.5 as any, name: 'P0-2' } },
              ],
              pageInfo: { startCursor: 'p-1', hasPreviousPage: false },
            },
          },
        }),
      },
    ];

    const { client, fetchMock } = makeClientMode('auto', routes);
    restores.push(fetchMock.restore);

    const w = mount(harnessEdges('network-only'), {
      props: { first: 2 },
      global: { plugins: [client as any] },
    });

    // none -> replace: only page1 visible
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['P1-1', 'P1-2']);

    // after -> append
    await w.setProps({ first: 2, after: 'p2' });
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['P1-1', 'P1-2', 'P2-1', 'P2-2']);

    // before -> prepend
    await w.setProps({ first: undefined, after: undefined, last: 2, before: 'p1' });
    await delay(7); await tick(6);
    expect(liText(w)).toEqual(['P0-1', 'P0-2', 'P1-1', 'P1-2', 'P2-1', 'P2-2']);
  });

  /* Cursor replay hint (allow older page to apply after newer) */

  it('cursor replay: older page (after present) is allowed to apply after a newer family leader', async () => {
    const routes: Route[] = [
      // newer (no after)
      {
        when: ({ variables }) => !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'n1', node: { __typename: 'Color', id: 1, name: 'NEW' } }],
              pageInfo: {},
            },
          },
        }),
      },
      // older cursor page (after='n1')
      {
        when: ({ variables }) => variables.after === 'n1',
        delay: 25,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'n2', node: { __typename: 'Color', id: 2, name: 'OLD-CURSOR-PAGE' } }],
              pageInfo: {},
            },
          },
        }),
      },
    ];

    const { client, fetchMock } = makeClientMode('append', routes);
    restores.push(fetchMock.restore);

    // Start with the cursor op to ensure it is truly "older"
    const w = mount(harnessEdges('network-only'), {
      props: { after: 'n1' },
      global: { plugins: [client as any] },
    });

    // Trigger newer leader (no-after)
    await w.setProps({ after: undefined });
    await tick();

    // Newer returns first
    await delay(7); await tick(2);
    expect(liText(w)).toEqual(['NEW']);

    // Older cursor page returns later and is allowed to replay
    await delay(25); await tick(2);
    expect(liText(w)).toEqual(['NEW', 'OLD-CURSOR-PAGE']);
  });
});

/* ------------------------------- Test routes ------------------------------ */
/**
 * We’ll use the same cache instance across seed + test client to retain op-cache.
 * For “filter A” we seed both page1 + page2. For “filter B” we seed page1 only.
 */

function ColorsHarness(cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') {
  return defineComponent({
    props: { t: String, first: Number, after: String },
    setup(props) {
      const { useQuery } = require('villus')
      const vars = computed(() => {
        const v: any = { t: props.t, first: props.first, after: props.after }
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k])
        return v
      })
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy })
      return () => h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')))
    },
  })
}

function SuspenseColorsHarness(cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') {
  const Child = defineComponent({
    props: { t: String, first: Number, after: String },
    async setup(props) {
      const { useQuery } = require('villus')
      const vars = computed(() => {
        const v: any = { t: props.t, first: props.first, after: props.after }
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k])
        return v
      })
      const { data } = await useQuery({ query: COLORS, variables: vars, cachePolicy })
      return () =>
        h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')))
    },
  })

  return defineComponent({
    props: { t: String, first: Number, after: String },
    setup(props) {
      return () =>
        h(Suspense, {}, {
          default: () => h(Child, { t: props.t, first: props.first, after: props.after }),
          fallback: () => h('div', { class: 'fallback' }, 'loading…'),
        })
    },
  })
}

function makeCache() {
  return createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
  })
}

/* Cursors for A pages:
   p1: a1,a2 -> A-1,A-2
   p2: a3,a4 -> A-3,A-4
   p3: a5,a6 -> A-5,A-6
   p4: a7,a8 -> A-7,A-8
   B page1: b1,b2 -> B-1,B-2
*/

/* -------------------------------------------------------------------------- */
/* Non-Suspense: Switch A→B→A then paginate again (to p4)                      */
/* -------------------------------------------------------------------------- */
describe('Integration • Relay pagination reset & append from cache — extended', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = []
  afterEach(async () => { while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); } })

  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    const cache = makeCache()
    const App = ColorsHarness('cache-and-network')

    // ---------- Phase 1: FAST routes to populate cache ----------
    const fastRoutes: Route[] = [
      // A p1
      {
        when: ({ variables }) => variables.t === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a1', node: { __typename: 'Color', id: 1, name: 'A-1' } },
                { cursor: 'a2', node: { __typename: 'Color', id: 2, name: 'A-2' } },
              ],
              pageInfo: { endCursor: 'a2', hasNextPage: true },
            }
          }
        }),
      },
      // A p2
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a2' && variables.first === 2,
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a3', node: { __typename: 'Color', id: 3, name: 'A-3' } },
                { cursor: 'a4', node: { __typename: 'Color', id: 4, name: 'A-4' } },
              ],
              pageInfo: { endCursor: 'a4', hasNextPage: true },
            }
          }
        }),
      },
      // A p3
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a4' && variables.first === 2,
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a5', node: { __typename: 'Color', id: 5, name: 'A-5' } },
                { cursor: 'a6', node: { __typename: 'Color', id: 6, name: 'A-6' } },
              ],
              pageInfo: { endCursor: 'a6', hasNextPage: true },
            }
          }
        }),
      },
      // B p1
      {
        when: ({ variables }) => variables.t === 'B' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'b1', node: { __typename: 'Color', id: 10, name: 'B-1' } },
                { cursor: 'b2', node: { __typename: 'Color', id: 11, name: 'B-2' } },
              ],
              pageInfo: { endCursor: 'b2', hasNextPage: false },
            }
          }
        }),
      },
    ]
    const fxFast = createFetchMock(fastRoutes)
    mocks.push(fxFast)
    const clientFast = createClient({ url: '/fast', use: [cache as any, fxFast.plugin] })

    // Mount and build cache: A p1
    let w = mount(App, { props: { t: 'A', first: 2 }, global: { plugins: [clientFast as any] } })
    await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2'])

    // Load A p2
    await w.setProps({ t: 'A', first: 2, after: 'a2' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4'])

    // Load A p3
    await w.setProps({ t: 'A', first: 2, after: 'a4' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'])

    // Go to B (p1)
    await w.setProps({ t: 'B', first: 2, after: undefined }); await tick(2)
    expect(liText(w)).toEqual(['B-1', 'B-2'])

    // Unmount before phase 2
    w.unmount()

    // ---------- Phase 2: SLOW routes, same cache; verify cached immediate resets/appends ----------
    const slowRoutes: Route[] = [
      // A p1 (slow)
      {
        when: ({ variables }) => variables.t === 'A' && !variables.after && variables.first === 2,
        delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a1', node: { __typename: 'Color', id: 1, name: 'A-1' } },
                { cursor: 'a2', node: { __typename: 'Color', id: 2, name: 'A-2' } },
              ],
              pageInfo: { endCursor: 'a2', hasNextPage: true },
            }
          }
        }),
      },
      // A p2 (slow)
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a2' && variables.first === 2,
        delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a3', node: { __typename: 'Color', id: 3, name: 'A-3' } },
                { cursor: 'a4', node: { __typename: 'Color', id: 4, name: 'A-4' } },
              ],
              pageInfo: { endCursor: 'a4', hasNextPage: true },
            }
          }
        }),
      },
      // A p3 (slow)
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a4' && variables.first === 2,
        delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a5', node: { __typename: 'Color', id: 5, name: 'A-5' } },
                { cursor: 'a6', node: { __typename: 'Color', id: 6, name: 'A-6' } },
              ],
              pageInfo: { endCursor: 'a6', hasNextPage: true },
            }
          }
        }),
      },
      // A p4 (slow) — new page to verify post-return pagination
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a6' && variables.first === 2,
        delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'a7', node: { __typename: 'Color', id: 7, name: 'A-7' } },
                { cursor: 'a8', node: { __typename: 'Color', id: 8, name: 'A-8' } },
              ],
              pageInfo: { endCursor: 'a8', hasNextPage: false },
            }
          }
        }),
      },
      // B p1 (slow)
      {
        when: ({ variables }) => variables.t === 'B' && !variables.after && variables.first === 2,
        delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [
                { cursor: 'b1', node: { __typename: 'Color', id: 10, name: 'B-1' } },
                { cursor: 'b2', node: { __typename: 'Color', id: 11, name: 'B-2' } },
              ],
              pageInfo: { endCursor: 'b2', hasNextPage: false },
            }
          }
        }),
      },
    ]
    const fxSlow = createFetchMock(slowRoutes)
    mocks.push(fxSlow)
    const clientSlow = createClient({ url: '/slow', use: [cache as any, fxSlow.plugin] })

    // Remount on A baseline → cached immediate must reset to p1 only
    w = mount(App, { props: { t: 'A', first: 2 }, global: { plugins: [clientSlow as any] } })
    await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2'])

    // Load A p2 (cached immediate append)
    await w.setProps({ t: 'A', first: 2, after: 'a2' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4'])

    // Load A p3 (cached immediate append)
    await w.setProps({ t: 'A', first: 2, after: 'a4' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'])

    // Load A p4 (cached immediate append)
    await w.setProps({ t: 'A', first: 2, after: 'a6' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'])

    // Slow revalidate completes; list should remain the same
    await delay(240); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'])

    w.unmount()
  })
})

/* -------------------------------------------------------------------------- */
/* Suspense variant of the same extended flow                                  */
/* -------------------------------------------------------------------------- */
describe('Integration • Suspense • Relay pagination reset & append from cache — extended', () => {
  const mocks: Array<{ waitAll: () => Promise<void>; restore: () => void }> = []
  afterEach(async () => { while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); } })

  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 under Suspense with cached append, then revalidate', async () => {
    const cache = makeCache()
    const App = SuspenseColorsHarness('cache-and-network')

    // Fast seeding (same as above)
    const fastRoutes: Route[] = [
      // A p1
      {
        when: ({ variables }) => variables.t === 'A' && !variables.after && variables.first === 2, delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a1', node: { __typename: 'Color', id: 1, name: 'A-1' } },
              { cursor: 'a2', node: { __typename: 'Color', id: 2, name: 'A-2' } }],
              pageInfo: { endCursor: 'a2', hasNextPage: true }
            }
          }
        })
      },
      // A p2
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a2' && variables.first === 2, delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a3', node: { __typename: 'Color', id: 3, name: 'A-3' } },
              { cursor: 'a4', node: { __typename: 'Color', id: 4, name: 'A-4' } }],
              pageInfo: { endCursor: 'a4', hasNextPage: true }
            }
          }
        })
      },
      // A p3
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a4' && variables.first === 2, delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a5', node: { __typename: 'Color', id: 5, name: 'A-5' } },
              { cursor: 'a6', node: { __typename: 'Color', id: 6, name: 'A-6' } }],
              pageInfo: { endCursor: 'a6', hasNextPage: true }
            }
          }
        })
      },
      // B p1
      {
        when: ({ variables }) => variables.t === 'B' && !variables.after && variables.first === 2, delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'b1', node: { __typename: 'Color', id: 10, name: 'B-1' } },
              { cursor: 'b2', node: { __typename: 'Color', id: 11, name: 'B-2' } }],
              pageInfo: { endCursor: 'b2', hasNextPage: false }
            }
          }
        })
      },
    ]
    const fxFast = createFetchMock(fastRoutes)
    mocks.push(fxFast)
    const clientFast = createClient({ url: '/fast', use: [cache as any, fxFast.plugin] })

    let w = mount(App, { props: { t: 'A', first: 2 }, global: { plugins: [clientFast as any] } })
    await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2'])

    await w.setProps({ t: 'A', first: 2, after: 'a2' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4'])

    await w.setProps({ t: 'A', first: 2, after: 'a4' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'])

    await w.setProps({ t: 'B', first: 2, after: undefined }); await tick(2)
    expect(liText(w)).toEqual(['B-1', 'B-2'])

    w.unmount()

    const slowRoutes: Route[] = [
      // A p1
      {
        when: ({ variables }) => variables.t === 'A' && !variables.after && variables.first === 2, delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a1', node: { __typename: 'Color', id: 1, name: 'A-1' } },
              { cursor: 'a2', node: { __typename: 'Color', id: 2, name: 'A-2' } }],
              pageInfo: { endCursor: 'a2', hasNextPage: true }
            }
          }
        })
      },
      // A p2
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a2' && variables.first === 2, delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a3', node: { __typename: 'Color', id: 3, name: 'A-3' } },
              { cursor: 'a4', node: { __typename: 'Color', id: 4, name: 'A-4' } }],
              pageInfo: { endCursor: 'a4', hasNextPage: true }
            }
          }
        })
      },
      // A p3
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a4' && variables.first === 2, delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a5', node: { __typename: 'Color', id: 5, name: 'A-5' } },
              { cursor: 'a6', node: { __typename: 'Color', id: 6, name: 'A-6' } }],
              pageInfo: { endCursor: 'a6', hasNextPage: true }
            }
          }
        })
      },
      // A p4
      {
        when: ({ variables }) => variables.t === 'A' && variables.after === 'a6' && variables.first === 2, delay: 220,
        respond: () => ({
          data: {
            __typename: 'Query', colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'a7', node: { __typename: 'Color', id: 7, name: 'A-7' } },
              { cursor: 'a8', node: { __typename: 'Color', id: 8, name: 'A-8' } }],
              pageInfo: { endCursor: 'a8', hasNextPage: false }
            }
          }
        })
      },
    ]
    const fxSlow = createFetchMock(slowRoutes)
    mocks.push(fxSlow)
    const clientSlow = createClient({ url: '/slow', use: [cache as any, fxSlow.plugin] })

    w = mount(App, { props: { t: 'A', first: 2 }, global: { plugins: [clientSlow as any] } })
    await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2'])

    await w.setProps({ t: 'A', first: 2, after: 'a2' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4'])

    await w.setProps({ t: 'A', first: 2, after: 'a4' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'])

    await w.setProps({ t: 'A', first: 2, after: 'a6' }); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'])

    await delay(240); await tick(2)
    expect(liText(w)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'])

    w.unmount()
  })
})
