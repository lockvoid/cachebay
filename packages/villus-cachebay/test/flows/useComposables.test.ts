import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive } from 'vue';
import { createCache, useFragment, useFragments, useCache } from '@/src';
import { tick, type Route, delay } from '@/test/helpers';
import { mountWithClient, getListItems } from '@/test/helpers/integration';

describe('Integration • useFragment / useFragments / useCache', () => {
  it('useFragment (ref source) updates when entity changes; static + asObject returns stable non-ref snapshot', async () => {
    const routes: Route[] = [];

    const cache = createCache({
      keys: {
        Post: (o: any) => o?.id != null ? String(o.id) : null,
      },
    });

    // Initialize cache with a Post
    const tx = (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Initial Post', content: 'Content' });
    tx.commit();
    await tick();

    // dynamic (ref) consumer (vm unwraps refs)
    const Dyn = defineComponent({
      name: 'DynPost',
      setup() {
        const source = ref('Post:1');
        const post = useFragment(source); // dynamic via ref source
        return { post };
      },
      render() { return h('div'); },
    });

    const { wrapper: dyn } = await mountWithClient(Dyn, routes, cache);
    await delay(10);
    expect((dyn.vm as any).post?.title).toBe('Initial Post');

    // update
    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Updated Post', content: 'New Content' }).commit?.();
    await delay(10);
    expect((dyn.vm as any).post?.title).toBe('Updated Post');

    // static: stable non-reactive snapshot (materialized:false)
    const Static = defineComponent({
      name: 'StaticPost',
      setup() {
        const post = useFragment('Post:1', { materialized: false });
        const isRefLike = !!(post && typeof post === 'object' && 'value' in (post as any));
        return { post, isRefLike };
      },
      render() { return h('div'); },
    });

    const { wrapper: stat } = await mountWithClient(Static, routes, cache);
    await tick();
    expect((stat.vm as any).isRefLike).toBe(false);
    expect((stat.vm as any).post?.title).toBe('Updated Post');

    // mutate again; the snapshot should NOT change
    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Final Post', content: 'Final Content' }).commit?.();
    await tick(); await tick();
    expect((stat.vm as any).post?.title).toBe('Updated Post'); // still the captured snapshot
  });

  it('useFragments (selector) reacts to add/remove; default (materialized) returns reactive nodes', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      addTypename: true,
      keys: {
        Post: (o: any) => o?.id != null ? String(o.id) : null,
      },
    });

    const Comp = defineComponent({
      name: 'PostList',
      setup() {
        const list = useFragments('Post:*'); // materialized proxies, wildcard pattern
        return { list };
      },
      render() {
        return h('ul', {}, (this.list || []).map((p: any) => h('li', {}, p?.title || '')));
      },
    });

    const { wrapper } = await mountWithClient(Comp, routes, cache);
    await tick();
    expect(getListItems(wrapper)).toEqual([]);

    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'First Post' }).commit?.();
    (cache as any).writeFragment({ __typename: 'Post', id: '2', title: 'Second Post' }).commit?.();
    await delay(10);
    expect(getListItems(wrapper).sort()).toEqual(['First Post', 'Second Post']);

    // remove via optimistic
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('Post:1'); });
    t.commit?.();
    await delay(10);
    expect(getListItems(wrapper)).toEqual(['Second Post']);

    // proxies are reactive
    const list = (wrapper.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    if (list.length) {
      expect(isReactive(list[0])).toBe(true);
    }
  });

  it('useFragments (selector, materialized:false) returns raw snapshots; updates appear after an add/remove (membership change)', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      addTypename: true,
      keys: {
        Post: (o: any) => o?.id != null ? String(o.id) : null,
      },
    });

    const tx = (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Initial' });
    tx.commit();
    await tick();

    const Comp = defineComponent({
      name: 'SnapshotPostList',
      setup() {
        const list = useFragments('Post:*', { materialized: false }); // raw snapshots refresh on add/remove
        return { list };
      },
      render() { return h('div'); },
    });

    const { wrapper } = await mountWithClient(Comp, routes, cache);
    await tick();
    expect((wrapper.vm as any).list?.[0]?.title).toBe('Initial');

    // update only (no add/remove) → raw list keeps previous snapshot
    (cache as any).writeFragment({ __typename: 'Post', id: '1', title: 'Updated' }).commit?.();
    await tick(); await tick();
    expect((wrapper.vm as any).list?.[0]?.title).toBe('Initial');

    // membership change → snapshots rebuilt and reflect latest
    (cache as any).writeFragment({ __typename: 'Post', id: '2', title: 'New Post' }).commit?.();
    await tick();
    expect((wrapper.vm as any).list?.[0]?.title).toBe('Updated');

    // cleanup
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('Post:2'); });
    t.commit?.();
    await tick();
  });

  it('useCache: exposes fragment API & listings', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      addTypename: true,
      keys: {
        Post: (o: any) => o?.id != null ? String(o.id) : null,
      },
    });

    const Comp = defineComponent({
      name: 'CacheApiSmoke',
      setup() {
        const cacheApi = useCache();
        const tx1 = (cacheApi as any).writeFragment({ __typename: 'Post', id: '2', title: 'Second Post' });
        const tx2 = (cacheApi as any).writeFragment({ __typename: 'Post', id: '1', title: 'First Post' });
        tx1.commit?.(); tx2.commit?.();
        return { api: cacheApi };
      },
      render() { return h('div'); },
    });

    const { wrapper } = await mountWithClient(Comp, routes, cache);
    await tick();

    const cacheApi = (wrapper.vm as any).api;
    expect(cacheApi.hasFragment('Post:1')).toBe(true);
    expect(cacheApi.readFragment('Post:1')?.title).toBe('First Post');

    // Check inspect API - should have 2 Post entities
    const entities = (cache as any).inspect?.entities('Post');
    expect(entities).toBeDefined();
    expect(entities?.length).toBe(2);
  });
});
