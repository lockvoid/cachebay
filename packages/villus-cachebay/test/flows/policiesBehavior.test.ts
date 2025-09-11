// test/flows/policiesBehavior.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay, seedCache } from '@/test/helpers';

/* ─────────────────────────────────────────────────────────────────────────────
 * Queries
 * ──────────────────────────────────────────────────────────────────────────── */
const ASSETS = /* GraphQL */ `
  query Assets($t:String) {
    assets(filter:$t) {
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

const liText = (w: any) => w.findAll('li').map((li: any) => li.text());

describe('Integration • Policies behavior (cachebay only)', () => {
  /* cache-only: hit vs miss */
  it('cache-only: hit emits cached and terminates; miss yields CacheOnlyMiss', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } },
    });

    // Seed cached HIT (warm client cache; helper uses rabbit:false)
    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }],
          pageInfo: {},
        },
      },
      materialize: true,
    });

    // HIT
    {
      const fx = createFetchMock([]);
      const client = createClient({ url: '/co-hit', use: [cache as any, fx.plugin] });

      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: 'HIT' }, cachePolicy: 'cache-only' });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });
      await tick(2);
      expect(liText(w)).toEqual(['X0']);
      expect(fx.calls.length).toBe(0);
    }

    // MISS
    {
      const fx = createFetchMock([]);
      const client = createClient({ url: '/co-miss', use: [cache as any, fx.plugin] });

      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data, error } = useQuery({ query: ASSETS, variables: { t: 'MISS' }, cachePolicy: 'cache-only' });
          return () => h('div', {}, error?.value?.networkError?.name || (data?.value?.assets?.edges?.length ?? 0));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });
      await tick(2);
      expect(w.text()).toContain('CacheOnlyMiss');
      expect(fx.calls.length).toBe(0);
    }
  });

  /* cache-first: hit vs miss */
  it('cache-first: hit emits cached and terminates; miss emits nothing here', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } },
    });

    await seedCache(cache, {
      query: ASSETS,
      variables: { t: 'HIT' },
      data: {
        __typename: 'Query',
        assets: {
          __typename: 'AssetConnection',
          edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }],
          pageInfo: {},
        },
      },
      materialize: true,
    });

    // HIT
    {
      const fx = createFetchMock([]);
      const client = createClient({ url: '/cf-hit', use: [cache as any, fx.plugin] });

      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: 'HIT' }, cachePolicy: 'cache-first' });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });
      await tick(2);
      expect(liText(w)).toEqual(['X0']);
      expect(fx.calls.length).toBe(0);
    }

    // MISS (no cached emit here; network plugin would run, but we provide no routes)
    {
      const fx = createFetchMock([]);
      const client = createClient({ url: '/cf-miss', use: [cache as any, fx.plugin] });

      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: 'MISS' }, cachePolicy: 'cache-first' });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });
      await tick(2);
      expect(liText(w)).toEqual([]);
      expect(fx.calls.length).toBe(0);
    }
  });

  /* cache-and-network cases */
  it('cache-and-network: identical network as cache → single render; different network → two renders; miss → one render', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { assets: relay() } },
    });

    // Seed cached X0
    const cachedEnvelope = {
      __typename: 'Query',
      assets: {
        __typename: 'AssetConnection',
        edges: [{ cursor: 'h', node: { __typename: 'Asset', id: 1, name: 'X0' } }],
        pageInfo: {},
      },
    };
    await seedCache(cache, { query: ASSETS, variables: { t: 'HIT' }, data: cachedEnvelope, materialize: true });

    // Case 1: Identical network as cache — single render (cached only)
    {
      const fx = createFetchMock([{
        when: ({ variables }) => variables.t === 'HIT',
        delay: 10,
        respond: () => ({ data: cachedEnvelope },
      }]);
      const client = createClient({ url: '/cn-ident', use: [cache as any, fx.plugin] });

      // Let hydrate flag (set by seed) clear so CN cached emit isn't suppressed
      await tick(2);

      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: 'HIT' }, cachePolicy: 'cache-and-network' });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });

      await tick(2);                    // cached emit (non-terminating)
      expect(liText(w)).toEqual(['X0']);

      await delay(15); await tick(2);   // winner identical → suppressed
      expect(liText(w)).toEqual(['X0']);
      expect(fx.calls.length).toBe(1);
    }

    // Case 2: Different network — two renders (cached then winner)
    {
      const fx = createFetchMock([{
        when: ({ variables }) => variables.t === 'HIT',
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            assets: {
              __typename: 'AssetConnection',
              edges: [{ cursor: 'h2', node: { __typename: 'Asset', id: 2, name: 'X1' } }],
              pageInfo: {},
            },
          },
        },
      }]);
      const client = createClient({ url: '/cn-diff', use: [cache as any, fx.plugin] });

      await tick(2); // ensure no residual hydrating state

      // capture renders to assert "two renders", while DOM shows latest only
      const renders: string[][] = [];
      const App = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: 'HIT' }, cachePolicy: 'cache-and-network' });
          watch(() => data.value, (v) => {
            const names = (v?.assets?.edges ?? []).map((e: any) => e?.node?.name || '');
            if (names.length) renders.push(names);
          }, { immediate: true });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { global: { plugins: [client as any] } });

      await tick(2);                    // cached
      expect(liText(w)).toEqual(['X0']);

      await delay(15); await tick(2);   // winner
      expect(renders).toEqual([['X0'], ['X1']]); // two renders observed
      expect(liText(w)).toEqual(['X1']);         // DOM shows the latest only
      expect(fx.calls.length).toBe(1);
    }

    // Case 3: MISS → one render on winner
    {
      const fx = createFetchMock([{
        when: ({ variables }) => variables.t === 'MISS',
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            assets: {
              __typename: 'AssetConnection',
              edges: [{ cursor: 'n1', node: { __typename: 'Asset', id: 9, name: 'NEW' } }],
              pageInfo: {},
            },
          },
        },
      }]);
      const client = createClient({ url: '/cn-miss', use: [cache as any, fx.plugin] });

      const App = defineComponent({
        props: { t: String },
        setup(props) {
          const { useQuery } = require('villus');
          const { data } = useQuery({ query: ASSETS, variables: { t: props.t }, cachePolicy: 'cache-and-network' });
          return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
        }
      });
      const w = mount(App, { props: { t: 'MISS' }, global: { plugins: [client as any] } });

      await tick(2);
      expect(liText(w)).toEqual([]);  // no cached

      await delay(8); await tick(2);  // winner arrives
      expect(liText(w)).toEqual(['NEW']);
      expect(fx.calls.length).toBe(1);
    }
  });

  /* cursor replay (cache merge) */
  it('cursor replay publishes terminally (append/prepend/replace via relay resolver)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } },
    });

    const fx = createFetchMock([{
      when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
      delay: 10,
      respond: () => ({
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
      },
    }]);
    const client = createClient({ url: '/cursor', use: [cache as any, fx.plugin] });

    const App = defineComponent({
      setup() {
        const { useQuery } = require('villus');
        const { data } = useQuery({ query: COLORS, variables: { first: 2, after: 'c2' }, cachePolicy: 'network-only' });
        return () => h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
      }
    });

    const w = mount(App, { global: { plugins: [client as any] } });

    await delay(12); await tick(2); // allow the mocked 10ms response to arrive
    expect(liText(w)).toEqual(['C3', 'C4']);
  });
});
