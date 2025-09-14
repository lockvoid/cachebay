// test/flows/use-composables.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive } from 'vue';
import { createCache, useFragment, useCache } from '@/src';
import { tick, delay, type Route } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';

const FRAG_POST = /* GraphQL */ `
  fragment P on Post { __typename id title content }
`;

describe('Integration • useFragment / useCache', () => {
  it('useFragment (ref id) is live: initial render and automatic updates', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Initial Post', content: 'Content' }
    });

    const Dyn = defineComponent({
      setup() {
        const key = ref('Post:1');
        const post = useFragment({ id: key, fragment: FRAG_POST });
        return { post };
      },
      render() { return h('div'); },
    });

    const { wrapper: dyn } = await mountWithClient(Dyn, routes, cache);
    await delay(10);
    expect((dyn.vm as any).post?.title).toBe('Initial Post');
    expect(isReactive((dyn.vm as any).post)).toBe(true);

    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Updated Post', content: 'New' }
    });
    await delay(10);
    expect((dyn.vm as any).post?.title).toBe('Updated Post');
  });

  it('useFragment (static id) defaults to live proxy and reflects updates', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: 'Post:2',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '2', title: 'Static Reactive', content: '' }
    });

    const Comp = defineComponent({
      setup() {
        const post = useFragment({ id: 'Post:2', fragment: FRAG_POST });
        return { post };
      },
      render() { return h('div'); }
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();
    expect((wrapper.vm as any).post?.title).toBe('Static Reactive');

    (cache as any).writeFragment({
      id: 'Post:2',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '2', title: 'Static++', content: '' }
    });
    await tick();
    expect((wrapper.vm as any).post?.title).toBe('Static++');
  });

  it('two components reading same fragment update together (live)', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'Post:3',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '3', title: 'Shared', content: '' }
    });

    const A = defineComponent({
      setup() { const p = useFragment({ id: 'Post:3', fragment: FRAG_POST }); return { p }; },
      render() { return h('div', { class: 'a' }, this.p?.title || ''); },
    });
    const B = defineComponent({
      setup() { const p = useFragment({ id: 'Post:3', fragment: FRAG_POST }); return { p }; },
      render() { return h('div', { class: 'b' }, this.p?.title || ''); },
    });
    const Wrapper = defineComponent({
      render() { return h('div', {}, [h(A), h(B)]); }
    });

    const { wrapper } = await mountWithClient(Wrapper, [], cache);
    await tick();
    expect(wrapper.find('.a').text()).toBe('Shared');
    expect(wrapper.find('.b').text()).toBe('Shared');

    (cache as any).writeFragment({
      id: 'Post:3',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '3', title: 'Shared++', content: '' }
    });
    await tick();
    expect(wrapper.find('.a').text()).toBe('Shared++');
    expect(wrapper.find('.b').text()).toBe('Shared++');
  });

  it('useCache exposes fragment API and identify()', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const Comp = defineComponent({
      setup() {
        const api = useCache();
        api.writeFragment({
          id: 'Post:2',
          fragment: FRAG_POST,
          data: { __typename: 'Post', id: '2', title: 'Second Post', content: '' }
        });
        api.writeFragment({
          id: 'Post:1',
          fragment: FRAG_POST,
          data: { __typename: 'Post', id: '1', title: 'First Post', content: '' }
        });
        return { api };
      },
      render() { return h('div'); },
    });

    const { wrapper } = await mountWithClient(Comp, [], createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    }));
    await tick();

    const api = (wrapper.vm as any).api;
    expect(api.identify({ __typename: 'Post', id: '1' })).toBe('Post:1');
    const a = api.readFragment({ id: 'Post:1', fragment: FRAG_POST });
    const b = api.readFragment({ id: 'Post:2', fragment: FRAG_POST });
    expect(a?.title).toBe('First Post');
    expect(b?.title).toBe('Second Post');
  });

  it('materialized snapshot stays stable; live result updates independently', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'Post:9',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '9', title: 'Before', content: '' }
    });

    const Comp = defineComponent({
      setup() {
        const api = useCache();
        const staticSnap = api.readFragment({ id: 'Post:9', fragment: FRAG_POST }); // snapshot
        const live = useFragment({ id: 'Post:9', fragment: FRAG_POST });            // live proxy
        return { staticSnap, live, reread: () => {/* snapshot can be re-queried by caller if desired */ } };
      },
      render() { return h('div'); },
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();

    const vm = wrapper.vm as any;
    expect(isReactive(vm.staticSnap)).toBe(false);
    expect(vm.staticSnap?.title).toBe('Before');
    expect(vm.live?.title).toBe('Before');

    (cache as any).writeFragment({
      id: 'Post:9',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '9', title: 'After', content: '' }
    });
    await tick();
    // snapshot unchanged
    expect(vm.staticSnap?.title).toBe('Before');
    // live proxy moved
    expect(vm.live?.title).toBe('After');
  });
});
