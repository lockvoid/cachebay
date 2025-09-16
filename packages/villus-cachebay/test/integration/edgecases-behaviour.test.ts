import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { useQuery } from 'villus';
import { createCache, useFragment } from '@/src';
import { tick, delay, type Route } from '@/test/helpers';
import { mountWithClient, cacheConfigs, testQueries, mockResponses } from '@/test/helpers/integration';

const FRAG_POST = /* GraphQL */ `
  fragment P on Post { __typename id title }
`;
const FRAG_USER = /* GraphQL */ `
  fragment U on User { __typename id name }
`;

describe('Integration • Edgecases behaviour', () => {
  it('Relay edges: grow across cursor pages; update in place; entity identity stable across updates', async () => {
    const cache = cacheConfigs.withRelay();
    const renders: string[][] = [];
    const firstNodeIds: string[] = [];

    // Component that tracks post updates
    const PostList = defineComponent({
      props: { first: Number, after: String },
      setup(props) {
        const vars = computed(() => {
          const v: any = {};
          if (props.first != null) v.first = props.first;
          if (props.after != null) v.after = props.after;
          return v;
        });

        const { data } = useQuery({
          query: testQueries.POSTS,
          variables: vars,
          cachePolicy: 'network-only'
        });

        watch(
          () => data.value,
          (v) => {
            const con = v?.posts;
            if (con && Array.isArray(con.edges)) {
              const titles = con.edges.map((e: any) => e?.node?.title || '');
              if (titles.length > 0) {
                renders.push(titles);
                if (con.edges[0]?.node) {
                  firstNodeIds.push(String(con.edges[0].node.id));
                }
              }
            }
          },
          { immediate: true }
        );

        return () => h(
          'ul',
          (data.value?.posts?.edges || []).map((e: any) =>
            h('li', { key: e.node.id }, e?.node?.title || '')
          )
        );
      },
    });

    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => mockResponses.posts(['Post 1', 'Post 2']),
      },
      // page 2 (append)
      {
        when: ({ variables }) => variables.first === 2 && variables.after === 'c2',
        delay: 10,
        respond: () => mockResponses.posts(['Post 3', 'Post 4']),
      },
      // update Post 1 (cursor page with first=1) — under union window policy, union remains visible
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
                  cursor: 'c1b',
                  node: { __typename: 'Post', id: '1', title: 'Post 1 Updated', content: 'Updated content', authorId: '1' },
                },
              ],
              pageInfo: { endCursor: 'c1b', hasNextPage: false },
            },
          },
        }),
      },
    ];

    const { wrapper } = await mountWithClient(PostList, routes, cache);
    await wrapper.setProps({ first: 2 });

    await delay(8);
    expect(renders).toEqual([['Post 1', 'Post 2']]);
    expect(renders[0].length).toBe(2);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await delay(12);
    expect(renders).toEqual([['Post 1', 'Post 2'], ['Post 3', 'Post 4']]);
    expect(renders[1].length).toBe(2);

    await wrapper.setProps({ first: 1, after: 'c4' });
    await delay(12);

    // Under union-window policy, entity id=1 must reflect the updated title.
    const last = renders.at(-1)!;
    expect(last).toContain('Post 1 Updated');
    expect(last.length === 1 || last.length === 2).toBe(true);

    // Identity stability
    expect(firstNodeIds[0]).toBe('1');
    expect(firstNodeIds.at(-1)).toBe(firstNodeIds[0]);
  });

  it('Interface reads (no wildcard): two live fragments show concrete implementors (materialized), no phantom keys', async () => {
    const cache = createCache({
      addTypename: true,
      interfaces: { Node: ['Post', 'User'] },
      keys: {
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
        User: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    });

    // Write two interface implementors
    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Post 1' }
    });
    (cache as any).writeFragment({
      id: 'User:2',
      fragment: FRAG_USER,
      data: { __typename: 'User', id: '2', name: 'User 2' }
    });
    await tick(2);

    const Comp = defineComponent({
      name: 'InterfaceTwo',
      setup() {
        // live reads for two distinct implementors
        const postRef = useFragment({ id: 'Post:1', fragment: FRAG_POST });
        const userRef = useFragment({ id: 'User:2', fragment: FRAG_USER });

        // Use computed strings to avoid any ref auto-unwrapping edge cases in render
        const postTitle = computed(() => postRef.value?.title || '');
        const userName = computed(() => userRef.value?.name || '');
        return { postTitle, userName };
      },
      render() {
        return h('ul', [h('li', {}, this.postTitle), h('li', {}, this.userName)]);
      },
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick(2);

    const items = wrapper.findAll('li').map(li => li.text()).sort();
    expect(items).toEqual(['Post 1', 'User 2']); // concrete fields, no phantom keys
  });

  it('Deletion hides removed entity in live readers (no wildcard)', async () => {
    const cache = cacheConfigs.basic();

    // seed
    (cache as any).writeFragment({
      id: 'Post:1', fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'T1' }
    });
    (cache as any).writeFragment({
      id: 'Post:2', fragment: FRAG_POST,
      data: { __typename: 'Post', id: '2', title: 'T2' }
    });
    await tick();

    const A = defineComponent({
      name: 'A',
      setup() {
        const pRef = useFragment({ id: 'Post:1', fragment: FRAG_POST });
        const title = computed(() => pRef.value?.title || '');
        return { title };
      },
      render() { return h('div', { class: 'a' }, this.title); }
    });
    const B = defineComponent({
      name: 'B',
      setup() {
        const pRef = useFragment({ id: 'Post:2', fragment: FRAG_POST });
        const title = computed(() => pRef.value?.title || '');
        return { title };
      },
      render() { return h('div', { class: 'b' }, this.title); }
    });
    const Wrapper = defineComponent({
      name: 'W',
      render() { return h('div', {}, [h(A), h(B)]); }
    });

    const { wrapper } = await mountWithClient(Wrapper, [], cache);
    await tick();
    expect(wrapper.find('.a').text()).toBe('T1');
    expect(wrapper.find('.b').text()).toBe('T2');

    // delete Post:1 optimistically via modifyOptimistic (graph-level delete)
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('Post:1'); });
    t.commit?.();
    await tick();

    // A disappears (empty); B remains
    expect(wrapper.find('.a').text()).toBe('');
    expect(wrapper.find('.b').text()).toBe('T2');
  });
});
