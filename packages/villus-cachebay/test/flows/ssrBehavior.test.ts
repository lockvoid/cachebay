import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay } from '@/test/helpers';

/* Shared query */
const COLORS = /* GraphQL */ `
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

/** Harness that renders current edges, with cleaned variables */
function ColorsHarness(cachePolicy: 'cache-first' | 'cache-and-network') {
  return defineComponent({
    props: { first: Number, after: String },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => cleanVars({ first: props.first, after: props.after }));
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy });
      return () => h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e.node?.name || '')));
    },
  });
}

/** Build a minimal Query payload from the hydrated connection state (no fetch). */
function buildRootFromHydrated(cache: any, field: string, parent = 'Query') {
  const conns = (cache as any).inspect.connection(parent, field);
  // Your inspect returns an array of connections; use the first (single bucket by vars in these tests)
  const c = Array.isArray(conns) ? conns[0] : null;
  if (!c) return null;

  const edges = (c.edges || []).map((e: any) => ({
    cursor: e.cursor ?? null,
    node: {
      __typename: (e.node && e.node.__typename) || (e.key ? e.key.split(':')[0] : 'Node'),
      id: e.node?.id ?? (e.key ? e.key.split(':')[1] : undefined),
      // copy known fields (your proxies will fill the rest)
      ...(e.node?.name ? { name: e.node.name } : {}),
    },
  }));

  const pageInfo = { ...(c.pageInfo || {}) };
  return {
    __typename: 'Query',
    [field]: {
      __typename: 'ColorConnection',
      edges,
      pageInfo,
    },
  };
}

/** Locally publish one cached result through the cache plugin (no network). */
function seedClientFromHydratedState(cache: any, query: any, variables: Record<string, any>) {
  const root = buildRootFromHydrated(cache, 'colors', 'Query');
  if (!root) return;
  const pluginFn = cache as unknown as (ctx: any) => void;
  const ctx: any = {
    operation: { type: 'query', query, variables: cleanVars(variables), context: {} },
    useResult: (_payload: any) => { },  // plugin will call this; we don’t need to intercept
    afterQuery: () => { },
  };
  // Install plugin hooks for this synthetic operation
  pluginFn(ctx);
  // Push the hydrated root once into the plugin pipeline
  ctx.useResult({ data: root }, true);
}

/** Simulate SSR: run query on "server", then dehydrate snapshot */
async function makeServerSnapshot() {
  const routes: Route[] = [{
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
          pageInfo: { startCursor: 'c1', endCursor: 'c2', hasNextPage: true, hasPreviousPage: false },
        },
      },
    }),
  }];

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
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];
  afterEach(async () => {
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  it('Dehydrate→Hydrate: entities & connections restored; views bound & reactive', async () => {
    const snapshot = await makeServerSnapshot();

    // Client hydrate
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot);

    // Seed the client cache from hydrated state (no network)
    seedClientFromHydratedState(cache, COLORS, { first: 2 });

    const fx = createFetchMock([]); // ensure no initial refetch counts
    const client = createClient({ url: '/client', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = ColorsHarness('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick();
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    // Views reactive after hydration
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'A1*' }).commit?.();
    await tick(); await tick();
    expect(liText(w)).toEqual(['A1*', 'A2']);
  });

  it('Hydration tickets: CF no initial refetch; CN no initial refetch but refetches after variable change', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot);

    // Seed CN op from hydrated state
    seedClientFromHydratedState(cache, COLORS, { first: 2 });

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
    const client = createClient({ url: '/client-cn', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const AppCN = ColorsHarness('cache-and-network');
    const w = mount(AppCN, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick();
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);

    // Change variables → CN should refetch
    await w.setProps({ first: 2, after: 'c2' }); await tick();
    expect(fx.calls.length).toBe(1);

    await delay(12); await tick();
    expect(liText(w)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('Initial render uses hydrated cache only (no flash/empty arrays)', async () => {
    const snapshot = await makeServerSnapshot();

    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
    });
    (cache as any).hydrate(snapshot);
    seedClientFromHydratedState(cache, COLORS, { first: 2 });

    const routes: Route[] = [{
      when: ({ variables }) => !variables.after && variables.first === 2,
      delay: 50,
      respond: () => ({
        data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [], pageInfo: {} } },
      }),
    }];
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/client-noflash', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const App = ColorsHarness('cache-first');
    const w = mount(App, { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick();
    expect(liText(w)).toEqual(['A1', 'A2']);
    expect(fx.calls.length).toBe(0);
  });
});
