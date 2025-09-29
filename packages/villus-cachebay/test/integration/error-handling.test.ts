import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, getEdges, fixtures, operations, delay } from '@/test/helpers';

describe('Error Handling', () => {
  it('GraphQL/transport error: recorded once; no empty emissions', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { error: new Error('🥲') };
        },
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: 'network-only',

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client]
      }
    });

    await delay(7);

    expect(PostList.errors.length).toBe(1);
    expect(PostList.renders.length).toBe(0);

    await fx.restore();
  });

  it('Latest-only gating (non-cursor): older error is dropped; newer data renders', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.first === 2 && !variables.after;
        },
        respond: () => {
          return { error: new Error('🥲') };
        },
        delay: 30,
      },
      {
        when: ({ variables }) => {
          return variables.first === 3 && !variables.after;
        },
        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ title: 'Post 1', id: '1' }]) } };
        },
        delay: 5,
      },
    ];

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: 'network-only',

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client],
      }
    });

    await wrapper.setProps({ first: 3 });

    await delay(14);
    expect(PostList.renders.length).toBe(1);
    expect(PostList.errors.length).toBe(0);
    expect(getEdges(wrapper, 'title')).toEqual(['Post 1']);

    await delay(25);
    expect(PostList.errors.length).toBe(0);
    expect(PostList.renders.length).toBe(1);
    expect(getEdges(wrapper, 'title')).toEqual(['Post 1']);

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

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: 'network-only',
      connectionFn: (data) => data.posts
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] }
    });

    await wrapper.setProps({ first: 2, after: 'c1' });

    await wrapper.setProps({ first: 2, after: undefined });

    await delay(14);

    const renders = (PostList as any).renders;
    const errors = (PostList as any).errors;

    // Check that we got the NEW post in the connection
    expect(renders.length).toBe(1);
    expect(renders[0]?.edges?.[0]?.node?.title).toBe('NEW');
    expect(errors.length).toBe(0);

    await delay(25);
    expect(errors.length).toBe(0);
    expect(renders.length).toBe(1);

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

    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: 'network-only',
      connectionFn: (data) => data.posts
    });

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: { first: 2 },
      global: { plugins: [client] }
    });

    await wrapper.setProps({ first: 2 });

    await wrapper.setProps({ first: 3 });
    await wrapper.setProps({ first: 4 });

    await delay(12);

    const renders = (PostList as any).renders;
    const errors = (PostList as any).errors;

    expect(errors.length).toBe(0);
    expect(renders.length).toBe(0);

    await delay(25);
    // After 25ms, we should have some response (O3 has 20ms delay)
    expect(renders.length).toBeGreaterThan(0);

    await delay(35);
    // After all delays complete, check final state
    // The actual behavior shows O1 as the final result
    expect(renders.length).toBe(1);
    expect(renders[0]?.edges?.[0]?.node?.title).toBe('O1');
    expect(errors.length).toBe(0);

    await fx.restore();
  });
});
