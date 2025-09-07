import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache } from '../../src';
import { useCache } from '../../src/composables/useCache';
import { tick } from '../helpers';

describe('composables/useCache', () => {
  it('exposes fragment API and entity listing', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const Comp = defineComponent({
      setup() {
        const api = useCache();
        // Write two entities
        api.writeFragment({ __typename: 'Color', id: 1, name: 'Black' });
        api.writeFragment({ __typename: 'Color', id: 2, name: 'Blue' });
        return { api };
      },
      render() { return h('div'); },
    });

    const wrapper = mount(Comp, { global: { plugins: [{ install(app:any){ (cache as any).install(app); } }] } });
    await tick();

    const api = (wrapper.vm as any).api as ReturnType<typeof useCache>;

    // identify + hasFragment + readFragment
    expect(api.identify({ __typename: 'Color', id: 1 })).toBe('Color:1');
    expect(api.hasFragment('Color:1')).toBe(true);
    expect(api.readFragment('Color:1')?.name).toBe('Black');

    // list keys and entities (materialized and raw)
    const keys = api.listEntityKeys('Color');
    expect(keys.sort()).toEqual(['Color:1','Color:2']);

    const mats = api.listEntities('Color');
    expect(mats.length).toBe(2);

    const raws = api.listEntities('Color', false);
    expect(raws.length).toBe(2);
  });
});
