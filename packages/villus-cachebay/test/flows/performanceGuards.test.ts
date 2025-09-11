// test/flows/performanceGuards.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { useQuery } from 'villus';
import { createCache, useFragments } from '@/src';
import { tick, delay, type Route } from '@/test/helpers';
import { mountWithClient, cacheConfigs, testQueries, mockResponses, getListItems } from '@/test/helpers/integration';

describe('Integration • Performance guards', () => {
  it('Relay edges array: grows/shrinks, entries update in place, logical identity stable', async () => {
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

        watch(() => data.value, (v) => {
          const con = v?.posts;
          if (con && Array.isArray(con.edges) && con.edges.length > 0) {
            renders.push(con.edges.map((e: any) => e?.node?.title || ''));
            if (con.edges[0]?.node) {
              firstNodeIds.push(String(con.edges[0].node.id));
            }
          }
        }, { immediate: true });

        return () => h('ul', 
          (data.value?.posts?.edges || []).map((e: any) => 
            h('li', { key: e.node.id }, e?.node?.title || '')
          )
        );
      },
    });
    
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.first === 2 && !variables.after,
        delay: 5,
        respond: () => mockResponses.posts(['Post 1', 'Post 2']),
      },
      {
        when: ({ variables }) => variables.first === 2 && variables.after === 'c2',
        delay: 10,
        respond: () => mockResponses.posts(['Post 3', 'Post 4']),
      },
      {
        when: ({ variables }) => variables.after === 'c4' && variables.first === 1,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [{ cursor: 'c1b', node: { __typename: 'Post', id: '1', title: 'Post 1 Updated', content: 'Updated content', authorId: '1' } }],
              pageInfo: { endCursor: 'c1b', hasNextPage: false }
            }
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
    expect(renders.at(-1)).toEqual(['Post 1 Updated']);
    expect(renders.at(-1)?.length).toBe(1);

    // assert logical identity of the first node across updates (ids are the same entity)
    expect(new Set(firstNodeIds).size).toBe(1);
  });

  it('Interface reads: Node:* lists concrete implementors and materialized proxies', async () => {
    const cache = createCache({
      addTypename: true,
      interfaces: { Node: ['Post', 'User'] },
      keys: {
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
        User: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    });

    // Write fragments to cache
    const t1 = (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Post 1' });
    t1.commit();
    const t2 = (cache as any).writeFragment({ __typename: 'User', id: '2', name: 'User 2' });
    t2.commit();
    await tick(2);

    const Comp = defineComponent({
      setup() {
        const list = useFragments('Node:*');
        return { list };
      },
      render() { 
        return h('div', [
          h('ul', this.list?.map((item: any) => 
            h('li', { key: item.id }, item.title || item.name || '')
          ) || [])
        ]); 
      },
    });
    
    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick(2);

    const list = (wrapper.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
    const items = list.map((x: any) => x?.title || x?.name).sort();
    expect(items).toEqual(['Post 1', 'User 2']);
  });
});
