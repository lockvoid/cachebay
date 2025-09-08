// test/flows/ssrBehavior.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, Suspense } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay } from '@/test/helpers';

const COLORS = `
  query Colors($first:Int,$after:String) {
    colors(first:$first, after:$after) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const liText = (w: any) => w.findAll('li').map((li: any) => li.text());

/** Clean nullish keys to keep opKey identical */
function cleanVars(v: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val !== undefined && val !== null) out[k] = val;
  }
  return out;
}

/** Non-suspense harness that renders current edges, with cleaned variables */
function ColorsHarness(cachePolicy: 'cache-first' | 'cache-and-network') {
  return defineComponent({
    props: { first: Number, after: String },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => cleanVars({ first: props.first, after: props.after }));
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy });
      return () =>
        h(
          'ul',
          {},
          (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e.node?.name || '')),
        );
    },
  });
}

/** Suspense harness (async setup + await useQuery with suspense:true) */
function ColorsSuspenseHarnessAsync(cachePolicy: 'cache-first' | 'cache-and-network') {
  return defineComponent({
    props: { first: Number, after: String },
    async setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => cleanVars({ first: props.first, after: props.after }));
      const { data } = await useQuery({ query: COLORS, variables: vars, cachePolicy, suspense: true });
      return () =>
        h(
          'ul',
          {},
          (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')),
        );
    },
  });
}

/** Suspense wrapper to provide a boundary for the async harness */
function SuspenseApp(policy: 'cache-first' | 'cache-and-network') {
  const Child = ColorsSuspenseHarnessAsync(policy);
  return defineComponent({
    props: { first: Number, after: String },
    setup(props) {
      return () =>
        h(
          Suspense,
          { timeout: 0 },
          {
            default: () => h(Child, { first: props.first, after: props.after }),
            fallback: () => h('div', 'loading'),
          },
        );
    },
  });
}

/** Server: run one query then dehydrate */
async function makeServerSnapshot() {
  const routes: Route[] = [
    {
      when: ({ variables }) => !variables.after && variables.first === 2,
      delay: 0,
      respond: () => ({
        data: {
          __typename: 'Query',
          colors: {
            __typename: 'ColorConnection',
            edges: [
              { cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'A1' } },
              { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'A2' } },
            ],
            pageInfo: {
              startCursor: 'c1',
              endCursor: 'c2',
              hasNextPage: true,
              hasPreviousPage: false,
            },
          },
        },
      }),
    },
  ];

  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
  });

  const fx = createFetchMock(routes);
  const serverClient = createClient({ url: '/ssr', use: [cache as any, fx.plugin] });

  await serverClient.execute({ query: COLORS, variables: { first: 2 } });
  await fx.waitAll(); fx.restore();

  return (cache as any).dehydrate();
}

describe('Integration • SSR / hydration', () => {
  const mocks: Array<{ waitAll: () => Promise<void>; restore: () => void; calls: any[] }> = [];
  afterEach(async () => {
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  it('Dehydrate→Hydrate: entities & connections restored; views bound & reactive', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });

    (cache as any).hydrate(snapshot, { materialize: true });

    const fx = createFetchMock([]);
    const client = createClient({ url: '/client', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = ColorsHarness('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    // allow hydrate flag to flip + cached emit
    await tick(2);

    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    // Fragment write updates bound proxies
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'A1*' }).commit?.();
    await tick(2);

    expect(liText(w)).toEqual(['A1*', 'A2']);
  });

  it('Hydration tickets: CF no initial refetch; CN no initial refetch but refetches after variable change', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const routes: Route[] = [
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
              pageInfo: {
                startCursor: 'c3',
                endCursor: 'c4',
                hasNextPage: false,
                hasPreviousPage: true,
              },
            },
          },
        }),
      },
    ];

    const fx = createFetchMock(routes);
    const client = createClient({ url: '/client-cn', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const AppCN = ColorsHarness('cache-and-network');
    const w = mount(AppCN, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    await w.setProps({ first: 2, after: 'c2' }); await tick(2);
    expect(fx.calls.length).toBe(1);

    await delay(12);
    expect(liText(w)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('Initial render uses hydrated cache only (no flash/empty arrays)', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 50,
        respond: () => ({
          data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [], pageInfo: {} } },
        }),
      },
    ];
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/client-noflash', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = ColorsHarness('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);
  });

  /* ───────────────────────────── Suspense (CN) ───────────────────────────── */

  it('CN + suspense after hydrate → resolves from cache (no initial refetch)', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const fx = createFetchMock([]);
    const client = createClient({ url: '/cn-suspense', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = SuspenseApp('cache-and-network');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2); // let Suspense resolve
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);
  });

  it('CN + suspense: variable change → one refetch and updated list', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const routes: Route[] = [{
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
            pageInfo: { startCursor: 'c3', endCursor: 'c4', hasNextPage: false, hasPreviousPage: true },
          },
        },
      }),
    }];
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/cn-suspense-change', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = SuspenseApp('cache-and-network');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    await w.setProps({ first: 2, after: 'c2' }); await tick(2);
    expect(fx.calls.length).toBe(1);

    await delay(12);
    expect(liText(w)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  /* ───────────────────────────── Suspense (CF) ───────────────────────────── */

  it('CF + suspense after hydrate → resolves from cache (no initial refetch)', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const fx = createFetchMock([]);
    const client = createClient({ url: '/cf-suspense', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = SuspenseApp('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2); // let Suspense resolve
    expect(liText(w)).toEqual(['A1', 'A2']); // cached result
    expect(fx.calls.length).toBe(0);        // no initial refetch
  });

  it('CF + suspense: variable change (miss) → one refetch and updated list', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot, { materialize: true });

    const routes: Route[] = [{
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
            pageInfo: { startCursor: 'c3', endCursor: 'c4', hasNextPage: false, hasPreviousPage: true },
          },
        },
      }),
    }];
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/cf-suspense-change', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = SuspenseApp('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    // Change vars to a miss → CF should refetch once
    await w.setProps({ first: 2, after: 'c2' }); await tick(2);
    expect(fx.calls.length).toBe(1);

    await delay(12);
    expect(liText(w)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});
