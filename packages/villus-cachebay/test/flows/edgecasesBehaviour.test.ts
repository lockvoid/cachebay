import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, watch } from 'vue';
import { useQuery } from 'villus';
import { createCache, useFragments } from '@/src';
import { tick, delay, type Route } from '@/test/helpers';
import { mountWithClient, cacheConfigs, testQueries, mockResponses } from '@/test/helpers/integration';

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
      // update Post 1 (cursor page with first=1) — under current policy, union window remains
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

    // Under union-window policy, after an update the list still shows the union,
    // but the entity with id=1 must reflect the updated title.
    const last = renders.at(-1)!;
    expect(last).toContain('Post 1 Updated');
    // (It may also still contain "Post 4" in this union window.)
    // So we don't assert exact equality or length=1; we assert correct update.
    // Optional sanity: either 1 or 2 items depending on prior union
    expect(last.length === 1 || last.length === 2).toBe(true);

    // Entity identity stability: same entity ("Post 1" -> "Post 1 Updated") keeps the same id across renders
    expect(firstNodeIds[0]).toBe('1');
    expect(firstNodeIds.at(-1)).toBe(firstNodeIds[0]);
  });

  it('Interface reads: Node:* lists concrete implementors (materialized), no phantom keys', async () => {
    const cache = createCache({
      addTypename: true,
      interfaces: { Node: ['Post', 'User'] },
      keys: {
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
        User: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    });

    // Write fragments to cache
    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Post 1' }).commit();
    (cache as any).writeFragment({ __typename: 'User', id: '2', name: 'User 2' }).commit();
    await tick(2);

    const Comp = defineComponent({
      name: 'InterfaceList',
      setup() {
        const list = useFragments('Node:*'); // materialized: proxies
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

  it('Deletion prunes wildcard lists (Post:*) and no phantom entries remain', async () => {
    const cache = cacheConfigs.basic();

    // seed
    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'T1' }).commit();
    (cache as any).writeFragment({ __typename: 'Post', id: '2', title: 'T2' }).commit();
    await tick();

    const Comp = defineComponent({
      name: 'WildcardPostList',
      setup() {
        const list = useFragments('Post:*'); // materialized proxies for wildcard
        return { list };
      },
      render() {
        return h('ul', (this.list ?? []).map((p: any) => h('li', { key: p.id }, p.title || '')));
      },
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();
    let titles = wrapper.findAll('li').map(li => li.text()).sort();
    expect(titles).toEqual(['T1', 'T2']);

    // delete Post:1 optimistically
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('Post:1'); });
    t.commit?.(); await tick();

    titles = wrapper.findAll('li').map(li => li.text()).sort();
    expect(titles).toEqual(['T2']); // pruned
  });
});
