import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountWithClient, type Route, MakeHarnessErrorHandling } from '@/test/helpers/integration';
import { operations, fixtures, delay } from '@/test/helpers';

describe('Error Handling', () => {
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

    const App = MakeHarnessErrorHandling('network-only');
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
            posts: fixtures.posts.connection(['NEW'], { fromId: 1 }),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarnessErrorHandling('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'GATE' });
        },
      }),
      routes,
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
    const routes: Route[] = [

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

      {
        when: ({ variables }) => variables.after === 'c1' && variables.first === 2,
        delay: 30,
        respond: () => ({ error: new Error('Cursor page failed') }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarnessErrorHandling('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first', 'after'],
        setup(props) {
          return () => h(App, { first: props.first, after: props.after, renders, errors, empties, name: 'CR' });
        },
      }),
      routes,
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
    const routes: Route[] = [

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
            posts: fixtures.posts.connection(['O3'], { fromId: 1 }),
          },
        }),
      },
    ];

    const renders: string[][] = [];
    const errors: string[] = [];
    const empties: string[] = [];

    const App = MakeHarnessErrorHandling('network-only');
    const { wrapper, fx } = await mountWithClient(
      defineComponent({
        props: ['first'],
        setup(props) {
          return () => h(App, { first: props.first, renders, errors, empties, name: 'REORD' });
        },
      }),
      routes,
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
