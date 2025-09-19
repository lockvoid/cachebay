// test/integration/error-handling.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mountWithClient, delay, type Route } from '@/test/helpers';
import { operations, fixtures } from '@/test/helpers';

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

      const vars = computed(() => {
        const v: any = {};
        if (props.first != null) v.first = props.first;
        if (props.after != null) v.after = props.after;
        return v;
      });

      const { data, error } = useQuery({
        query: operations.POSTS_QUERY, // DocumentNode
        variables: vars,
        cachePolicy,
      });

      // Record meaningful payloads
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
        (e) => {
          if (e) (props.errors as any[]).push(e.message || 'error');
        },
        { immediate: true },
      );

      // Render simple rows (no outer wrapper)
      return () =>
        (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || ''),
        );
    },
  });
}

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

describe('Integration • Errors (Posts connection)', () => {
  it('GraphQL/transport error: recorded once; no empty emissions', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('Boom') }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { fx } = await mountWithClient(
      defineComponent({
        setup() {
          return () => h(App, { first: 2, renders, errors, empties, name: 'E1' });
        },
      }),
      routes,
    );

    await delay(12);
    expect(errors.length).toBe(1);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);

    await fx.restore();
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
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['NEW'], { fromId: 1 }),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'GATE' });
        },
      }),
      routes,
    );

    // Newer leader (first=3)
    await wrapper.setProps({ first: 3 });

    await delay(14);
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    // Older error arrives later → dropped
    await delay(25);
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);

    await fx.restore();
  });

  it('Cursor-page error is dropped (no replay); latest success remains', async () => {
    const routes: Route[] = [
      // Newer (no cursor) fast success
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['NEW'], { fromId: 1 }),
          },
        }),
      },
      // Older cursor op (after='c1') slow error -> DROPPED
      {
        when: ({ variables }) => variables.after === 'c1' && variables.first === 2,
        delay: 30,
        respond: () => ({ error: new Error('Cursor page failed') }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first', 'after'],
        setup(props) {
          return () => h(App, { first: props.first, after: props.after, renders, errors, empties, name: 'CR' });
        },
      }),
      routes,
    );

    // Start with older cursor op in-flight…
    await wrapper.setProps({ first: 2, after: 'c1' });
    // …then issue the newer leader (no cursor)
    await wrapper.setProps({ first: 2, after: undefined });

    // Newer success arrives
    await delay(14);
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    // Cursor error arrives later — dropped
    await delay(25);
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);
    expect(empties.length).toBe(0);

    await fx.restore();
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
            posts: fixtures.posts.connection(['O1'], { fromId: 1 }),
          },
        }),
      },
      // O2: first=3 (fast error)
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('O2 err') }),
      },
      // O3: first=4 (medium success)
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        delay: 20,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['O3'], { fromId: 1 }),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarness('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'REORD' });
        },
      }),
      routes,
    );

    // Start with O1
    await wrapper.setProps({ first: 2 });
    // enqueue O2 then O3
    await wrapper.setProps({ first: 3 });
    await wrapper.setProps({ first: 4 });

    // Fast error arrives (dropped), medium still pending
    await delay(12);
    expect(errors.length).toBe(0);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);

    // O3 arrives
    await delay(18);
    expect(renders).toEqual([['O3']]);

    // O1 comes last — ignored (older)
    await delay(40);
    expect(renders).toEqual([['O3']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    await fx.restore();
  });
});
