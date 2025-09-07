import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache } from '../../src';
import { useFragments } from '../../src/composables/useFragments';
import { tick } from '../helpers';

describe('composables/useFragments', () => {
  it('returns a computed list matching selector patterns and updates on entity add/remove', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    // Seed before mount
    cache.writeFragment({ __typename: 'Color', id: 2, name: 'Blue' });
    cache.writeFragment({ __typename: 'Color', id: 1, name: 'Black' });

    const Comp = defineComponent({
      setup() {
        const list = useFragments<any>('Color');
        return { list };
      },
      render() { return h('div'); },
    });

    const wrapper = mount(Comp, { global: { plugins: [{ install(app:any){ (cache as any).install(app); } }] } });

    await nextTick();
    // Bump entities tick by adding a temp entity
    cache.writeFragment({ __typename: 'Color', id: 3, name: 'Green' });
    await nextTick();
    let list = (wrapper.vm as any).list.value ?? [];
    expect(list.length).toBe(3);
    const namesAfterAdd = list.map((c: any) => c?.name).sort();
    expect(namesAfterAdd).toEqual(['Black','Blue','Green']);

    // Remove temp entity and expect update
    (cache as any).modifyOptimistic((c:any) => { c.del('Color:3'); }).commit?.();
    await nextTick();
    list = (wrapper.vm as any).list.value ?? [];
    expect(list.length).toBe(2);

    // Remove one entity and expect update
    (cache as any).modifyOptimistic((c:any) => {
      c.del('Color:1');
    }).commit?.();

    await tick();
    const next = (wrapper.vm as any).list.value;
    expect(next.length).toBe(1);
    expect(next[0]?.name).toBe('Blue');
  });
});
