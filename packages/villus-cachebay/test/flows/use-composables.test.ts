// test/flows/use-composables.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive } from 'vue';
import { createCache, useFragment, useCache } from '@/src';
import { tick, type Route, delay } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';

const FRAG_POST = /* GraphQL */ `
  fragment PostBits on Post {
    __typename
    id
    title
    content
  }
`;

describe('Integration • useFragment / useCache', () => {
  it('useFragment (ref id) reads & re-reads; materialized:false snapshot stays stable', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    // seed
    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Initial Post', content: 'Content' }
    });

    // dynamic (ref id)
    const Dyn = defineComponent({
      name: 'Dyn',
      setup() {
        const key = ref('Post:1');
        const frag = useFragment({ id: key, fragment: FRAG_POST });
        // return the Ref itself so read() can refresh it; Vue unwraps on wrapper.vm
        return { post: frag.data, reread: frag.read };
      },
      render() { return h('div'); },
    });

    const { wrapper: dyn } = await mountWithClient(Dyn, routes, cache);
    await delay(10);
    // ref on wrapper.vm is auto-unwrapped → no ".value" here
    expect((dyn.vm as any).post?.title).toBe('Initial Post');

    // update & re-read
    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Updated Post', content: 'New' }
    });
    (dyn.vm as any).reread();
    await delay(10);
    expect((dyn.vm as any).post?.title).toBe('Updated Post');

    // static snapshot (materialized:false)
    const Static = defineComponent({
      name: 'Static',
      setup() {
        const s = useFragment({ id: 'Post:1', fragment: FRAG_POST, materialized: false });
        return { snap: s.data, reread: s.read };
      },
      render() { return h('div'); },
    });

    const { wrapper: stat } = await mountWithClient(Static, routes, cache);
    await tick();
    const snap = (stat.vm as any).snap; // unwrapped on vm
    expect(isReactive(snap)).toBe(false);
    expect(snap?.title).toBe('Updated Post');

    // write again; static snapshot stays the same until read()
    (cache as any).writeFragment({
      id: 'Post:1',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '1', title: 'Final', content: 'X' }
    });
    await tick();
    expect((stat.vm as any).snap?.title).toBe('Updated Post');
    (stat.vm as any).reread();
    expect((stat.vm as any).snap?.title).toBe('Final');
  });

  it('useFragment (static id) defaults to materialized; re-reads reflect updates', async () => {
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
        const frag = useFragment({ id: 'Post:2', fragment: FRAG_POST });
        return { post: frag.data, reread: frag.read };
      },
      render() { return h('div'); }
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();

    // auto-unwrapped on vm
    const proxy = (wrapper.vm as any).post;
    expect(proxy?.title).toBe('Static Reactive');

    (cache as any).writeFragment({
      id: 'Post:2',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '2', title: 'Static++', content: '' }
    });
    (wrapper.vm as any).reread();
    await tick();
    expect((wrapper.vm as any).post?.title).toBe('Static++');
  });

  it('two components reading same fragment can re-read independently', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'Post:3',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '3', title: 'Shared', content: '' }
    });

    const A = defineComponent({
      setup() {
        const f = useFragment({ id: 'Post:3', fragment: FRAG_POST });
        return { f };
      },
      render() {
        return h('div', { class: 'a' }, this.f.data.value?.title || '');
      },
    });

    const B = defineComponent({
      setup() {
        const f = useFragment({ id: 'Post:3', fragment: FRAG_POST });
        return { f };
      },
      render() {
        return h('div', { class: 'b' }, this.f.data.value?.title || '');
      },
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

    // call the controllers to re-read
    (wrapper.findComponent(A).vm as any).f.read();
    (wrapper.findComponent(B).vm as any).f.read();
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

  it('materialized=false snapshots are stable; controller read() updates live independently', async () => {
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
        const staticCtl = useFragment({ id: 'Post:9', fragment: FRAG_POST, materialized: false });
        const liveCtl = useFragment({ id: 'Post:9', fragment: FRAG_POST });
        // return refs directly; wrapper.vm auto-unwraps them
        return { staticSnap: staticCtl.data, live: liveCtl.data, reread: liveCtl.read };
      },
      render() { return h('div'); },
    });

    const { wrapper } = await mountWithClient(Comp, [], cache);
    await tick();

    const vm = wrapper.vm as any;
    expect(isReactive(vm.staticSnap)).toBe(false); // snapshot is plain
    expect(isReactive(vm.live)).toBe(true); // snapshot is plain
    expect(vm.staticSnap?.title).toBe('Before');
    expect(vm.live?.title).toBe('Before');

    (cache as any).writeFragment({
      id: 'Post:9',
      fragment: FRAG_POST,
      data: { __typename: 'Post', id: '9', title: 'After', content: '' }
    });
    vm.reread();
    await tick();
    expect(vm.staticSnap?.title).toBe('Before');
    expect(vm.live?.title).toBe('After');
  });
});
