import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache, useFragment, useFragments, useCache } from '@/src';
import { CACHEBAY_KEY } from '@/src/core/plugin';
import { tick } from '@/test/helpers';

function makeCache() {
  return createCache({
    addTypename: true,
    keys: {
      Color: (o: any) => (o?.id != null ? String(o.id) : null),
      T: (o: any) => (o?.id != null ? String(o.id) : null),
    },
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
    const tx = (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' });
    tx.commit();
    await tick();

    const api = {
      readFragment: (cache as any).readFragment,
      readFragments: (cache as any).readFragments,
      writeFragment: (cache as any).writeFragment,
      identify: (cache as any).identify,
      modifyOptimistic: (cache as any).modifyOptimistic,
      hasFragment: (cache as any).hasFragment,
      inspect: (cache as any).inspect,
      entitiesTick: (cache as any).__entitiesTick,
    };

    // dynamic (ref) consumer (vm unwraps refs)
    const Dyn = defineComponent({
      setup() {
        const source = ref('Color:1');
        const color = useFragment(source);
        return { color };
      },
      render() { return h('div'); },
    });

    const dyn = mount(Dyn, { 
      global: { 
        provide: {
          [CACHEBAY_KEY as symbol]: api
        }
      }
    });
    await waitUntil(() => dyn.vm.color?.name === 'Black');

    // update
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' }).commit?.();
    await waitUntil(() => dyn.vm.color?.name === 'Jet Black');

    // static: stable non-reactive snapshot (materialized:false)
    const Static = defineComponent({
      setup() {
        const color = useFragment('Color:1', { materialized: false });
        const isRefLike = !!(color && typeof color === 'object' && 'value' in (color as any));
        return { color, isRefLike };
      },
      render() { return h('div'); },
    });

    const stat = mount(Static, { 
      global: { 
        provide: {
          [CACHEBAY_KEY as symbol]: api
        }
      }
    });
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

    const api = {
      readFragment: (cache as any).readFragment,
      readFragments: (cache as any).readFragments,
      writeFragment: (cache as any).writeFragment,
      identify: (cache as any).identify,
      modifyOptimistic: (cache as any).modifyOptimistic,
      hasFragment: (cache as any).hasFragment,
      inspect: (cache as any).inspect,
      entitiesTick: (cache as any).__entitiesTick,
    };

    const Comp = defineComponent({
      setup() {
        const list = useFragments('Color:*'); // materialized proxies
        return { list };
      },
      render() {
        return h('ul', {}, (this.list || []).map((c: any) => h('li', {}, c?.name || '')));
      },
    });

    const w = mount(Comp, { 
      global: { 
        provide: {
          [CACHEBAY_KEY as symbol]: api
        }
      }
    });
    await tick();
    expect(liText(w)).toEqual([]);

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Red' }).commit?.();
    (cache as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' }).commit?.();
    await waitUntil(() => liText(w).sort().join(',') === 'Blue,Red');

    // remove via optimistic
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('Color:1'); });
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
    const tx = (cache as any).writeFragment({ __typename: 'T', id: 1, name: 'A' });
    tx.commit();
    await tick();

    const api = {
      readFragment: (cache as any).readFragment,
      readFragments: (cache as any).readFragments,
      writeFragment: (cache as any).writeFragment,
      identify: (cache as any).identify,
      modifyOptimistic: (cache as any).modifyOptimistic,
      hasFragment: (cache as any).hasFragment,
      inspect: (cache as any).inspect,
      entitiesTick: (cache as any).__entitiesTick,
    };

    const Comp = defineComponent({
      setup() {
        const list = useFragments('T:*', { materialized: false }); // raw snapshots refresh on add/remove
        return { list };
      },
      render() { return h('div'); },
    });

    const w = mount(Comp, { 
      global: { 
        provide: {
          [CACHEBAY_KEY as symbol]: api
        }
      }
    });
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
    const t = (cache as any).modifyOptimistic((c: any) => { c.delete('T:2'); });
    t.commit?.(); await tick();
  });

  it('useCache: exposes fragment API & listings', async () => {
    const cache = makeCache();

    const api = {
      readFragment: (cache as any).readFragment,
      readFragments: (cache as any).readFragments,
      writeFragment: (cache as any).writeFragment,
      identify: (cache as any).identify,
      modifyOptimistic: (cache as any).modifyOptimistic,
      hasFragment: (cache as any).hasFragment,
      inspect: (cache as any).inspect,
      entitiesTick: (cache as any).__entitiesTick,
    };

    const Comp = defineComponent({
      setup() {
        const cacheApi = useCache();
        const tx1 = (cacheApi as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' });
        const tx2 = (cacheApi as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' });
        tx1.commit?.(); tx2.commit?.();
        return { api: cacheApi };
      },
      render() { return h('div'); },
    });

    const w = mount(Comp, { 
      global: { 
        provide: {
          [CACHEBAY_KEY as symbol]: api
        }
      }
    });
    await tick();

    const cacheApi = (w.vm as any).api;
    expect(cacheApi.hasFragment('Color:1')).toBe(true);
    expect(cacheApi.readFragment('Color:1')?.name).toBe('Black');

    // Check inspect API - should have 2 Color entities
    const entities = (cache as any).inspect?.entities('Color');
    expect(entities).toBeDefined();
    expect(entities?.length).toBe(2);
  });
});
