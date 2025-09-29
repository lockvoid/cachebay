import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, getEdges, fixtures, operations, delay } from '@/test/helpers';

describe('Edge Cases Behavior', () => {
  it('maintains entity identity across paginated updates and in-place modifications', async () => {
    const PostList = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: 'cache-and-network',
      connectionFn: (data) => data.posts
    });

    const routes = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([
              { title: 'Post 1', id: '1' },
              { title: 'Post 2', id: '2' }
            ]),
          },
        }),
        delay: 5,
      },
      {
        when: ({ variables }) => variables.first === 2 && variables.after === 'c2',
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([
              { title: 'Post 3', id: '3' },
              { title: 'Post 4', id: '4' }
            ]),
          },
        }),
        delay: 10,
      },
      {
        when: ({ variables }) => variables.after === 'c4' && variables.first === 1,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.buildConnection([
              { title: 'Post 1 Updated', id: '1', content: 'Updated content', authorId: '1' }
            ]),
          },
        }),
        delay: 10,
      },
    ];

    const { client, fx } = createTestClient({ routes });

    const wrapper = mount(PostList, {
      props: {
        first: 2,
      },

      global: {
        plugins: [client]
      }
    });

    await wrapper.setProps({ first: 2 });
    await delay(8);
    expect(getEdges(wrapper, 'title')).toEqual(['Post 1', 'Post 2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await delay(12);
    expect(getEdges(wrapper, 'title')).toEqual(['Post 1', 'Post 2', 'Post 3', 'Post 4']);

    await wrapper.setProps({ first: 1, after: 'c4' });
    await delay(12);
    expect(getEdges(wrapper, 'title')).toEqual(['Post 1 Updated', 'Post 2', 'Post 3', 'Post 4']);

    await fx.restore();
  });

  it('renders concrete fragment implementations without phantom keys', async () => {
    const { cache, client } = createTestClient();

    cache.writeFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: '1', title: 'Post 1' }),
    });

    cache.writeFragment({
      id: 'User:2',
      fragment: operations.USER_FRAGMENT,
      data: fixtures.user({ id: '2', email: 'u2@example.com' }),
    });

    const postFragment = cache.readFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
    });

    const userFragment = cache.readFragment({
      id: 'User:2',
      fragment: operations.USER_FRAGMENT,
    });

    expect(postFragment?.title).toBe('Post 1');
    expect(userFragment?.email).toBe('u2@example.com');
  });

  it('hides deleted entities from live fragment readers', async () => {
    const { cache, client } = createTestClient();

    cache.writeFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: '1', title: 'Post 1' }),
    });

    cache.writeFragment({
      id: 'Post:2',
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: '2', title: 'Post 2' }),
    });

    let post1 = cache.readFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
    });

    let post2 = cache.readFragment({
      id: 'Post:2',
      fragment: operations.POST_FRAGMENT,
    });

    expect(post1?.title).toBe('Post 1');
    expect(post2?.title).toBe('Post 2');

    const tx = cache.modifyOptimistic((o) => {
      o.delete('Post:1');
    });

    tx.commit?.();

    post1 = cache.readFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
    });

    post2 = cache.readFragment({
      id: 'Post:2',
      fragment: operations.POST_FRAGMENT,
    });

    expect(post1.title).toBeUndefined();
    expect(post2.title).toBe('Post 2');
  });
});
