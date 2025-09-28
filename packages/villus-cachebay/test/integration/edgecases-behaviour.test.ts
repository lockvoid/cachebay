
import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { mountWithClient, delay, tick, type Route, PostListTracker } from '@/test/helpers';
import { operations, fixtures } from '@/test/helpers';
import { createCache } from '@/src/core/internals';
import { useFragment } from '@/src';

describe('Edgecases behaviour', () => {
  it('grows across cursor pages; update in place; entity identity stable across updates', async () => {
    const cache = createCache();
    const renders: string[][] = [];
    const firstNodeIds: string[] = [];

    const PostList = PostListTracker(renders, firstNodeIds);

    const routes: Route[] = [

      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['Post 1', 'Post 2'], { fromId: 1 }),
          },
        }),
      },

      {
        when: ({ variables }) => variables.first === 2 && variables.after === 'c2',
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['Post 3', 'Post 4'], { fromId: 3 }),
          },
        }),
      },

      {
        when: ({ variables }) => variables.after === 'c4' && variables.first === 1,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                {
                  __typename: 'PostEdge',
                  cursor: 'c1b',
                  node: {
                    __typename: 'Post',
                    id: '1',
                    title: 'Post 1 Updated',
                    content: 'Updated content',
                    authorId: '1',
                  },
                },
              ],
              pageInfo: { __typename: 'PageInfo', endCursor: 'c1b', hasNextPage: false },
            },
          },
        }),
      },
    ];

    const { wrapper, fx } = await mountWithClient(PostList, routes, cache);

    await wrapper.setProps({ first: 2 });
    await delay(8);
    expect(renders).toEqual([['Post 1', 'Post 2']]);
    expect(renders[0].length).toBe(2);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await delay(12);
    expect(renders).toEqual([
      ['Post 1', 'Post 2'],
      ['Post 1', 'Post 2', 'Post 3', 'Post 4'],
    ]);
    expect(renders[1].length).toBe(4);

    await wrapper.setProps({ first: 1, after: 'c4' });
    await delay(12);

    const last = renders.at(-1)!;
    expect(last).toContain('Post 1 Updated');

    expect([1, 2, 3, 4]).toContain(last.length);

    expect(firstNodeIds[0]).toBe('1');
    expect(firstNodeIds.at(-1)).toBe(firstNodeIds[0]);

    await fx.restore();
  });

  it('two live fragments show concrete implementors (materialized), no phantom keys', async () => {
    const cache = createCache();

    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
      data: { __typename: 'Post', id: '1', title: 'Post 1', tags: [] },
    });
    (cache as any).writeFragment({
      id: 'User:2',
      fragment: operations.USER_FRAGMENT,
      data: { __typename: 'User', id: '2', email: 'user2@example.com' },
    });
    await tick();

    const Comp = defineComponent({
      name: 'InterfaceTwo',
      setup() {
        const postRef = useFragment({ id: 'Post:1', fragment: operations.POST_FRAGMENT });
        const userRef = useFragment({ id: 'User:2', fragment: operations.USER_FRAGMENT });
        const postTitle = computed(() => postRef.value?.title || '');
        const userEmail = computed(() => userRef.value?.email || '');
        return { postTitle, userEmail };
      },
      render() {
        return [h('div', {}, this.postTitle), h('div', {}, this.userEmail)];
      },
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();

    const items = wrapper.findAll('div').map((d) => d.text()).sort();
    expect(items).toEqual(['Post 1', 'user2@example.com']);
  });

  it('hides removed entity in live readers (no wildcard)', async () => {
    const cache = createCache();

    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: operations.POST_FRAGMENT,
      data: { __typename: 'Post', id: '1', title: 'T1', tags: [] },
    });
    (cache as any).writeFragment({
      id: 'Post:2',
      fragment: operations.POST_FRAGMENT,
      data: { __typename: 'Post', id: '2', title: 'T2', tags: [] },
    });
    await tick();

    const A = defineComponent({
      name: 'A',
      setup() {
        const refA = useFragment({ id: 'Post:1', fragment: operations.POST_FRAGMENT });
        const title = computed(() => refA.value?.title || '');
        return { title };
      },
      render() {
        return h('div', { class: 'a' }, this.title);
      },
    });
    const B = defineComponent({
      name: 'B',
      setup() {
        const refB = useFragment({ id: 'Post:2', fragment: operations.POST_FRAGMENT });
        const title = computed(() => refB.value?.title || '');
        return { title };
      },
      render() {
        return h('div', { class: 'b' }, this.title);
      },
    });
    const Wrapper = defineComponent({
      name: 'W',
      render() {
        return [h(A), h(B)];
      },
    });

    const { wrapper } = await mountWithClient(Wrapper, [], cache);
    await tick();
    expect(wrapper.find('.a').text()).toBe('T1');
    expect(wrapper.find('.b').text()).toBe('T2');

    const t = (cache as any).modifyOptimistic((tx: any) => {
      tx.delete('Post:1');
    });
    t.commit?.();
    await tick();

    expect(wrapper.find('.a').text()).toBe('');
    expect(wrapper.find('.b').text()).toBe('T2');
  });
});
