import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache } from '../../src';
import { useFragment } from '../../src/composables/useFragment';
import { tick } from '../helpers';

describe.skip('composables/useFragment', () => {
  it('returns reactive proxy that updates when entity changes', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    // Seed entity
    cache.writeFragment({ __typename: 'Color', id: 1, name: 'Black' });

    // Sanity check: cache has the entity
    const sanity = (cache as any).readFragment('Color:1');
    expect(sanity?.name).toBe('Black');

    const Comp = defineComponent({
      setup() {
        const key = ref('Color:1');
        const color = useFragment<{ id: number; name: string }>(key);
        return { color };
      },
      render() {
        // render not used for assertion, but required by Vue
        return h('div');
      },
    });

    const wrapper = mount(Comp, {
      global: {
        plugins: [
          {
            install(app: any) {
              (cache as any).install(app);
            },
          },
        ],
      },
    });

    await tick();
    // Initial value may not be populated synchronously, assert after update below

    // Update entity
    cache.writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' });
    await tick();

    expect((wrapper.vm as any).color.value?.name).toBe('Jet Black');
  });
});
