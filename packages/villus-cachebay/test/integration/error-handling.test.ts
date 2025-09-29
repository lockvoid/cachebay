import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createTestClient, fixtures, operations, delay } from '@/test/helpers';
import { useQuery } from 'villus';

const createErrorHandlingComponent = (cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network') => {
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
      const vars = computed(() => {
        const v: any = {};
        if (props.first != null) v.first = props.first;
        if (props.after != null) v.after = props.after;
        return v;
      });

      const { data, error } = useQuery({
        query: operations.POSTS_QUERY,
        variables: vars,
        cachePolicy,
      });

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

      watch(
        () => error.value,
        (e) => {
          if (e) (props.errors as any[]).push(e.message || 'error');
        },
        { immediate: true },
      );

      return () =>
        (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || ''),
        );
    },
  });
};

describe('Error Handling', () => {
  it('GraphQL/transport error: recorded once; no empty emissions', async () => {
    const routes = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('Boom') }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = createErrorHandlingComponent('network-only');
    const { client, fx } = createTestClient({ routes });
    
    const wrapper = mount(
      defineComponent({
        setup() {
          return () => h(App, { first: 2, renders, errors, empties, name: 'E1' });
        },
      }),
      {
        global: { plugins: [client] }
      }
    );

    await delay(12);
    expect(errors.length).toBe(1);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);

    await fx.restore();
  });

  it('Latest-only gating (non-cursor): older error is dropped; newer data renders', async () => {
    const routes = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 30,
        respond: () => ({ error: new Error('Older error') }),
      },
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([{ title: 'NEW', id: '1' }]),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = createErrorHandlingComponent('network-only');
    const { client, fx } = createTestClient({ routes });
    
    const wrapper = mount(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'GATE' });
        },
      }),
      {
        props: { first: 2 },
        global: { plugins: [client] }
      }
    );

    await wrapper.setProps({ first: 3 });

    await delay(14);
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    await delay(25);
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);

    await fx.restore();
  });

  it('Cursor-page error is dropped (no replay); latest success remains', async () => {
    const routes = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([{ title: 'NEW', id: '1' }]),
          },
        }),
      },
      {
        when: ({ variables }) => variables.after === 'c1' && variables.first === 2,
        delay: 30,
        respond: () => ({ error: new Error('Cursor page failed') }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = createErrorHandlingComponent('network-only');
    const { client, fx } = createTestClient({ routes });
    
    const wrapper = mount(
      defineComponent({
        props: ['first', 'after'],
        setup(props) {
          return () => h(App, { first: props.first, after: props.after, renders, errors, empties, name: 'CR' });
        },
      }),
      {
        props: { first: 2 },
        global: { plugins: [client] }
      }
    );

    await wrapper.setProps({ first: 2, after: 'c1' });

    await wrapper.setProps({ first: 2, after: undefined });

    await delay(14);
    expect(renders).toEqual([['NEW']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    await delay(25);
    expect(errors.length).toBe(0);
    expect(renders).toEqual([['NEW']]);
    expect(empties.length).toBe(0);

    await fx.restore();
  });

  it('Transport reordering: O1 slow success, O2 fast error, O3 medium success → final is O3; errors dropped; no empties', async () => {
    const routes = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 50,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([{ title: 'O1', id: '1' }]),
          },
        }),
      },
      {
        when: ({ variables }) => variables.first === 3 && !variables.after,
        delay: 5,
        respond: () => ({ error: new Error('O2 err') }),
      },
      {
        when: ({ variables }) => variables.first === 4 && !variables.after,
        delay: 20,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([{ title: 'O3', id: '1' }]),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = createErrorHandlingComponent('network-only');
    const { client, fx } = createTestClient({ routes });
    
    const wrapper = mount(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'REORD' });
        },
      }),
      {
        props: { first: 2 },
        global: { plugins: [client] }
      }
    );

    await wrapper.setProps({ first: 2 });

    await wrapper.setProps({ first: 3 });
    await wrapper.setProps({ first: 4 });

    await delay(12);
    expect(errors.length).toBe(0);
    expect(renders.length).toBe(0);
    expect(empties.length).toBe(0);

    await delay(18);
    expect(renders).toEqual([['O3']]);

    await delay(40);
    expect(renders).toEqual([['O3']]);
    expect(errors.length).toBe(0);
    expect(empties.length).toBe(0);

    await fx.restore();
  });
});
