import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache, useFragment, useFragments, useCache } from '@/src';
import { tick } from '@/test/helpers';

function makeCache() {
  return createCache({
    addTypename: true,
    keys: () => ({
      Color: (o: any) => (o?.id != null ? String(o.id) : null),
      T: (o: any) => (o?.id != null ? String(o.id) : null),
    }),
  });
}

const liText = (w: any) => w.findAll('li').map((li: any) => li.text());

async function waitUntil(pred: () => boolean, timeoutMs = 250) {
  const end = Date.now() + timeoutMs;
  for (; ;) {
    if (pred()) return;
    if (Date.now() > end) throw new Error('timeout in waitUntil');
    await tick();
  }
}

describe('Integration • useFragment / useFragments / useCache', () => {
  it('useFragment (ref source) updates when entity changes; static + asObject returns stable non-ref snapshot', async () => {
    const cache = makeCache();
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' }).commit?.();

    // dynamic (ref) consumer (vm unwraps refs)
    const Dyn = defineComponent({
      setup() {
        const source = ref('Color:1');
        const color = useFragment(source);
        return { color };
      },
      render() { return h('div'); },
    });

    const dyn = mount(Dyn, { global: { plugins: [cache as any] } });
    await waitUntil(() => dyn.vm.color?.name === 'Black');

    // update
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' }).commit?.();
    await waitUntil(() => dyn.vm.color?.name === 'Jet Black');

    // static + asObject: stable non-reactive snapshot (materialized:false)
    const Static = defineComponent({
      setup() {
        const color = useFragment('Color:1', { asObject: true, materialized: false });
        const isRefLike = !!(color && typeof color === 'object' && 'value' in (color as any));
        return { color, isRefLike };
      },
      render() { return h('div'); },
    });

    const stat = mount(Static, { global: { plugins: [cache as any] } });
    await tick();
    expect(stat.vm.isRefLike).toBe(false);
    expect(stat.vm.color?.name).toBe('Jet Black');

    // mutate again; the snapshot should NOT change
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Matte Black' }).commit?.();
    await tick(); await tick();
    expect(stat.vm.color?.name).toBe('Jet Black'); // still the captured snapshot
  });

  it('useFragments (selector) reacts to add/remove; default (materialized) returns reactive nodes', async () => {
    const cache = makeCache();

    const Comp = defineComponent({
      setup() {
        const list = useFragments('Color:*'); // materialized proxies
        return { list };
      },
      render() {
        return h('ul', {}, (this.list || []).map((c: any) => h('li', {}, c?.name || '')));
      },
    });

    const w = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();
    expect(liText(w)).toEqual([]);

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Red' }).commit?.();
    (cache as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' }).commit?.();
    await waitUntil(() => liText(w).sort().join(',') === 'Blue,Red');

    // remove via optimistic
    const t = (cache as any).modifyOptimistic((c: any) => { c.del('Color:1'); });
    t.commit?.();
    await waitUntil(() => liText(w).join(',') === 'Blue');

    // proxies are reactive
    const list = (w.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    if (list.length) {
      expect(isReactive(list[0])).toBe(true);
    }
  });

  it('useFragments (selector, materialized:false) returns raw snapshots; updates appear after an add/remove (tick bump)', async () => {
    const cache = makeCache();
    (cache as any).writeFragment({ __typename: 'T', id: 1, name: 'A' }).commit?.();

    const Comp = defineComponent({
      setup() {
        const list = useFragments('T:*', { materialized: false }); // raw snapshots refresh on add/remove
        return { list };
      },
      render() { return h('div'); },
    });

    const w = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();
    expect((w.vm as any).list?.[0]?.name).toBe('A');

    // update only (no add/remove) → raw list keeps previous snapshot
    (cache as any).writeFragment({ __typename: 'T', id: 1, name: 'A2' }).commit?.();
    await tick(); await tick();
    expect((w.vm as any).list?.[0]?.name).toBe('A');

    // bump entitiesTick with a tiny add/remove cycle, then it reflects latest snapshot
    (cache as any).writeFragment({ __typename: 'T', id: 2, name: 'Z' }).commit?.();
    await tick();
    expect((w.vm as any).list?.[0]?.name).toBe('A2');

    // cleanup (optional)
    const t = (cache as any).modifyOptimistic((c: any) => { c.del('T:2'); });
    t.commit?.(); await tick();
  });

  it('useCache: exposes fragment API & listings', async () => {
    const cache = makeCache();

    const Comp = defineComponent({
      setup() {
        const api = useCache();
        const tx1 = (api as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' });
        const tx2 = (api as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' });
        tx1.commit?.(); tx2.commit?.();
        return { api };
      },
      render() { return h('div'); },
    });

    const w = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    const api = (w.vm as any).api;
    expect(api.hasFragment('Color:1')).toBe(true);
    expect(api.readFragment('Color:1')?.name).toBe('Black');

    const keys = api.listEntityKeys('Color');
    expect(keys.sort()).toEqual(['Color:1', 'Color:2']);

    const mats = api.listEntities('Color');
    expect(Array.isArray(mats)).toBe(true);
    expect(mats.length).toBe(2);

    const raws = api.listEntities('Color', false);
    expect(Array.isArray(raws)).toBe(true);
    expect(raws.length).toBe(2);
  });
});
