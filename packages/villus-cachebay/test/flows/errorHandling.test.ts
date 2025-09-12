import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mountWithClient, testQueries, mockResponses, cacheConfigs, cleanVars } from '@/test/helpers/integration';
import { type Route, tick, delay } from '@/test/helpers';

/* -----------------------------------------------------------------------------
 * Harness: records non-empty renders and error events
 * -------------------------------------------------------------------------- */

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
      const { data, error } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });

      // Record meaningful payloads: edges with items, or explicit empty edges array
      watch(
        () => data.value,
        (v) => {
          const edges = v?.posts?.edges;
          if (Array.isArray(edges) && edges.length > 0) {
            (props.renders as any[]).push(edges.map((e: any) => e?.node?.title || ''));
          } else if (v && v.posts && Array.isArray(v.posts.edges) && v.posts.edges.length === 0) {
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
        h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });
}

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

describe('Integration • Errors (Posts connection)', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];

  afterEach(async () => {
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
        respond: () => ({ error: new Error('Boom') }),
      },
    ];

    const cache = cacheConfigs.withRelay();

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        setup() {
          return () => h(App, { first: 2, renders, errors, empties, name: 'E1' });
        }
      }),
      routes,
      cache
    );
    mocks.push(fx);

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
        respond: () => ({ error: new Error('Older error') }),
      },
      // Newer op (first=3) – fast data
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => mockResponses.posts(['NEW']),
      },
    ];
    const cache = cacheConfigs.withRelay();

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'GATE' });
        }
      }),
      routes,
      cache
    );
    mocks.push(fx);

    // Newer leader (first=3)
    await wrapper.setProps({ first: 3 }); await tick();

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
    const routes: Route[] = [
      // Newer (no cursor) fast success
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => mockResponses.posts(['NEW']),
      },
      // Older cursor op (after='p1') slow error -> DROPPED
      {
        when: ({ variables }) => variables.after === 'p1' && variables.first === 2,
        delay: 30,
        respond: () => ({ error: new Error('Cursor page failed') }),
      },
    ];

    const cache = cacheConfigs.withRelay();

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first', 'after'],
        setup(props) {
          return () => h(App, { first: props.first, after: props.after, renders, errors, empties, name: 'CR' });
        }
      }),
      routes,
      cache
    );
    mocks.push(fx);

    // Start with older cursor op in-flight…
    await wrapper.setProps({ first: 2, after: 'p1' });
    // …then issue the newer leader (no cursor)
    await wrapper.setProps({ first: 2, after: undefined }); await tick();

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
        respond: () => mockResponses.posts(['O1']),
      },
      // O2: first=3 (fast error)
      { when: ({ variables }) => variables.first === 3 && !variables.after, delay: 5, respond: () => ({ error: new Error('O2 err') }) },
      // O3: first=4 (medium success)
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        delay: 20,
        respond: () => mockResponses.posts(['O3']),
      },
    ];

    const cache = cacheConfigs.withRelay();

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'REORD' });
        }
      }),
      routes,
      cache
    );
    mocks.push(fx);

    // Start with O1
    await wrapper.setProps({ first: 2 });
    // enqueue O2 then O3
    await wrapper.setProps({ first: 3 }); await tick();
    await wrapper.setProps({ first: 4 }); await tick();

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
