import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createCache, useFragment } from '@/src';
import { tick } from '@/test/helpers';

describe('composables/useFragment', () => {
  it('dynamic mode (auto) returns a Ref that updates when entity changes', async () => {
    const cache = createCache({ keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }) });
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' }).commit?.();

    const Comp = defineComponent({
      setup() {
        const source = ref('Color:1');
        const color = useFragment(source);
        return { color };
      },
      render() {
        return h('div');
      },
    });

    // ✅ install cache plugin so provideCachebay() runs
    const wrapper = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' }).commit?.();
    await tick(); // propagate entity change
    await tick(); // flush view sync

    expect((wrapper.vm as any).color!.name).toBe('Jet Black');
  });

  it('static + asObject returns plain object (non-Ref)', async () => {
    const cache = createCache({ keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }) });
    (cache as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' }).commit?.();

    const Comp = defineComponent({
      setup() {
        const color = useFragment('Color:2', { asObject: true });
        return { color };
      },
      render() {
        return h('div');
      },
    });

    // ✅ install cache plugin so provideCachebay() runs
    const wrapper = mount(Comp, { global: { plugins: [cache as any] } });
    await tick();

    expect((wrapper.vm as any).color!.name).toBe('Blue');
  });
});
