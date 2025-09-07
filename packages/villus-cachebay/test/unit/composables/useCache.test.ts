import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache, useCache } from '@/src';
import { tick } from '@/test/helpers';

describe('composables/useCache', () => {
  it('exposes fragment API and entity listing', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const Comp = defineComponent({
      setup() {
        const api = useCache();
        // Write two entities
        const tx1 = (api as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' });
        const tx2 = (api as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' });
        tx1.commit?.();
        tx2.commit?.();
        return { api };
      },
      render() {
        return h('div');
      },
    });

    // ✅ Install the cache plugin so it provides CACHEBAY_KEY via provideCachebay()
    const wrapper = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    const api = (wrapper.vm as any).api;

    // has/read
    expect(api.hasFragment('Color:1')).toBe(true);
    expect(api.readFragment('Color:1')?.name).toBe('Black');

    // list keys and entities (materialized and raw)
    const keys = api.listEntityKeys('Color');
    expect(keys.sort()).toEqual(['Color:1', 'Color:2']);

    const mats = api.listEntities('Color');
    expect(mats.length).toBe(2);

    const raws = api.listEntities('Color', false);
    expect(raws.length).toBe(2);
  });
});
