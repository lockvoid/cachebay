import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache, useFragments } from '@/src';
import { tick } from '@/test/helpers';

describe('composables/useFragments', () => {
  it('returns a computed list matching selector patterns and updates on entity add/remove', async () => {
    const cache = createCache({ keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }) });
    (cache as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' }).commit?.();
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' }).commit?.();

    const Comp = defineComponent({
      setup() {
        const list = useFragments('Color:*');
        return { list };
      },
      render() {
        return h('div');
      },
    });

    // ✅ install cache as a plugin (provides CACHEBAY_KEY)
    const wrapper = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    let list = (wrapper.vm as any).list ?? [];
    expect(list.length).toBe(2);

    // Remove one entity
    (cache as any).modifyOptimistic((c: any) => {
      c.delete('Color:1');
    }).commit?.();
    await tick();

    list = (wrapper.vm as any).list;
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe('Blue');
  });

  it('materialized=false returns raw snapshots', async () => {
    const cache = createCache({ keys: () => ({ T: (o: any) => (o?.id != null ? String(o.id) : null) }) });
    (cache as any).writeFragment({ __typename: 'T', id: 1, name: 'A' }).commit?.();

    const Comp = defineComponent({
      setup() {
        return { list: useFragments('T:*', { materialized: false }) };
      },
      render() {
        return h('div');
      },
    });

    // ✅ install cache as a plugin
    const wrapper = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    const list = (wrapper.vm as any).list;
    expect(Array.isArray(list)).toBe(true);
    expect(list[0] && typeof list[0] === 'object').toBe(true);
  });
});
