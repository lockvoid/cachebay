import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick, delay } from '@/test/helpers';

/* -----------------------------------------------------------------------------
 * Shared Relay query & cache factory
 * -------------------------------------------------------------------------- */

const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String) {
    colors(first:$first, after:$after) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

function makeCache() {
  return createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { colors: relay() } },
    keys: { Color: (o: any) => (o?.id != null ? String(o.id) : null) },
  });
}

/* -----------------------------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------------------------- */

const liText = (w: any) => w.findAll('li').map((li: any) => li.text());

/** Clean nullish keys for stable op keys */
function cleanVars(v: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val !== undefined && val !== null) out[k] = val;
  }
  return out;
}

/** Harness that records non-empty renders and error events; never records "empty" for undefined payloads */
function MakeHarness(cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network') {
  return defineComponent({
    props: {
      first: Number,
      after: String,
      renders: Array,
      errors: Array,
      empties: Array,
      name: String,
    },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => cleanVars({ first: props.first, after: props.after }));
      const { data, error } = useQuery({ query: COLORS, variables: vars, cachePolicy });

      // Record only meaningful payloads: edges with items, or explicit empty edges array.
      watch(
        () => data.value,
        (v) => {
          const edges = v?.colors?.edges;
          if (Array.isArray(edges) && edges.length > 0) {
            (props.renders as any[]).push(edges.map((e: any) => e?.node?.name || ''));
          } else if (v && v.colors && Array.isArray(v.colors.edges) && v.colors.edges.length === 0) {
            (props.empties as any[]).push('empty');
          }
        },
        { immediate: true },
      );

      // Record GraphQL/transport errors once
      watch(
        () => error.value,
        (e) => { if (e) (props.errors as any[]).push(e.message || 'error'); },
        { immediate: true },
      );

      return () =>
        h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

describe('Integration • Errors', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];

  afterEach(async () => {
    // Drain timers for all mocks, then restore fetch to avoid “result was not set” noise.
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  it('GraphQL/transport error: recorded once; no empty emissions', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('Boom') },
      },
    ];
    const cache = makeCache();
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/err', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    mount(App, {
      props: { first: 2, renders, errors, empties, name: 'E1' },
      global: { plugins: [client as any] },
    });

    await delay(10); await tick();
    expect(errors.length).toBe(1);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);
  });

  it('Latest-only gating (non-cursor): older error is dropped; newer data renders', async () => {
    const routes: Route[] = [
      // Older op (first=2) – slow error
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 30,
        respond: () => ({ error: new Error('Older error') },
      },
      // Newer op (first=3) – fast data
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'n', node: { __typename: 'Color', id: 9, name: 'NEW' } }],
              pageInfo: {},
            },
          },
        },
      },
    ];
    const cache = makeCache();
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/gating', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const w = mount(App, {
      props: { first: 2, renders, errors, empties, name: 'GATE' },
      global: { plugins: [client as any] },
    });

    // Newer leader
    await w.setProps({ first: 3 }); await tick();

    await delay(10); await tick();
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    // Older error arrives later → dropped
    await delay(25); await tick();
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);
  });

  it('Cursor-page error is dropped (no replay); latest success remains', async () => {
    // Core drops older cursor-page errors.
    const routes: Route[] = [
      // Newer (no cursor) fast success
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'p1', node: { __typename: 'Color', id: 1, name: 'NEW' } }],
              pageInfo: {},
            },
          },
        },
      },
      // Older cursor op (after='p1') slow error -> DROPPED
      {
        when: ({ variables }) => variables.after === 'p1' && variables.first === 2,
        delay: 30,
        respond: () => ({ error: new Error('Cursor page failed') },
      },
    ];

    const cache = makeCache();
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/cursor-drop', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const w = mount(App, {
      // Start with older cursor op in-flight…
      props: { first: 2, after: 'p1', renders, errors, empties, name: 'CR' },
      global: { plugins: [client as any] },
    });

    // …then issue the newer leader (no cursor)
    await w.setProps({ first: 2, after: undefined }); await tick();

    // Newer success arrives
    await delay(10); await tick();
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    // Cursor error arrives later — dropped
    await delay(25); await tick();
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);
    expect(empties.length).toBe(0);
  });

  it('Transport reordering: O1 slow success, O2 fast error, O3 medium success → final is O3; errors dropped; no empties', async () => {
    const routes: Route[] = [
      // O1: first=2 (slow success)
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 50,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'o1', node: { __typename: 'Color', id: 1, name: 'O1' } }],
              pageInfo: {},
            },
          },
        },
      },
      // O2: first=3 (fast error)
      { when: ({ variables }) => variables.first === 3 && !variables.after, delay: 5, respond: () => ({ error: new Error('O2 err') }) },
      // O3: first=4 (medium success)
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        delay: 20,
        respond: () => ({
          data: {
            __typename: 'Query',
            colors: {
              __typename: 'ColorConnection',
              edges: [{ cursor: 'o3', node: { __typename: 'Color', id: 3, name: 'O3' } }],
              pageInfo: {},
            },
          },
        },
      },
    ];

    const cache = makeCache();
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/reorder', use: [cache as any, fx.plugin] });
    mocks.push(fx);

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const w = mount(App, {
      props: { first: 2, renders, errors, empties, name: 'REORD' },
      global: { plugins: [client as any] },
    });

    // enqueue O2 then O3
    await w.setProps({ first: 3 }); await tick();
    await w.setProps({ first: 4 }); await tick();

    // Fast error arrives (dropped), medium still pending
    await delay(10); await tick();
    expect(errors.length).toBe(0);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);

    // O3 arrives
    await delay(15); await tick();
    expect(renders).toEqual([['O3']]);

    // O1 comes last — ignored (older)
    await delay(40); await tick();
    expect(renders).toEqual([['O3']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);
  });
});
