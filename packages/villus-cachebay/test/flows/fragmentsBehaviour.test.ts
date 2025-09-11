import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, ref, computed, watchEffect, watch } from 'vue';
import { isReactive } from 'vue';
import { createCache } from '@/src';
import { tick, delay } from '@/test/helpers';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { provide } from 'vue';
import { useCache, useFragment, useFragments } from '@/src';
import { CACHEBAY_KEY } from '@/src/core/plugin';

describe('Integration • Fragments Behavior', () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length) (restores.pop()!)();
  });

  describe('Fragment API Basics', () => {
    it('identify returns normalized key', () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const key = (cache as any).identify({ __typename: 'User', id: 1, name: 'A' });
      expect(key).toBe('User:1');
    });

    it('writeFragment -> commit and revert work; hasFragment checks presence', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const tx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Ann' });
      tx.commit();
      await tick();

      expect((cache as any).hasFragment('User:1')).toBe(true);
      expect((cache as any).readFragment('User:1')?.name).toBe('Ann');

      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Ann B.' });
      tx2.commit();
      await tick();
      expect((cache as any).readFragment('User:1')?.name).toBe('Ann B.');

      // revert the last change (this should restore the previous value)
      tx2.revert();
      await tick();
      const result = (cache as any).readFragment('User:1');
      expect(result?.name).toBe('Ann');
    });

    it('readFragment can return raw snapshot when materialized=false', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const tx = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
      tx.commit();
      await tick();

      const raw = (cache as any).readFragment('User:2', { materialized: false });
      expect(raw).toBeTruthy();
      expect(raw!.name).toBe('Bob');
      expect(isReactive(raw)).toBe(false); // Raw should not be reactive
    });

    it('readFragment returns reactive proxy by default (materialized=true)', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const tx = (cache as any).writeFragment({ __typename: 'User', id: 3, name: 'Charlie' });
      tx.commit?.();
      await tick();

      const proxy = (cache as any).readFragment('User:3'); // materialized=true by default
      expect(proxy).toBeTruthy();
      expect(proxy.name).toBe('Charlie');
      expect(isReactive(proxy)).toBe(true); // Should be reactive proxy
    });
  });

  describe('readFragments (Multiple Fragments)', () => {
    it('reading multiple fragments manually', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Write multiple fragments
      const tx1 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
      const tx3 = (cache as any).writeFragment({ __typename: 'User', id: 3, name: 'Charlie' });

      tx1.commit();
      tx2.commit();
      tx3.commit();
      await tick();

      // Read multiple fragments manually
      const fragments = [
        (cache as any).readFragment('User:1'),
        (cache as any).readFragment('User:2'),
        (cache as any).readFragment('User:3')
      ];

      expect(fragments).toHaveLength(3);
      expect(fragments[0]?.name).toBe('Alice');
      expect(fragments[1]?.name).toBe('Bob');
      expect(fragments[2]?.name).toBe('Charlie');

      // All should be reactive by default
      fragments.forEach(fragment => {
        if (fragment) {
          expect(isReactive(fragment)).toBe(true);
        }
      });
    });

    it('readFragments API returns multiple fragments', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Write fragments
      const tx1 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
      const tx3 = (cache as any).writeFragment({ __typename: 'User', id: 3, name: 'Charlie' });

      tx1.commit();
      tx2.commit();
      tx3.commit();
      await tick();

      // Use readFragments API
      const fragments = (cache as any).readFragments(['User:1', 'User:2', 'User:3']);

      expect(fragments).toHaveLength(3);
      expect(fragments[0]?.name).toBe('Alice');
      expect(fragments[1]?.name).toBe('Bob');
      expect(fragments[2]?.name).toBe('Charlie');
    });

    it('handles missing fragments gracefully', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Write only one fragment
      const tx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      tx.commit();
      await tick();

      // Try to read multiple, some missing
      const fragments = (cache as any).readFragments(['User:1', 'User:999', 'User:2']);

      expect(fragments).toHaveLength(1); // Only one exists
      expect(fragments[0]?.name).toBe('Alice');
    });

    it('readFragments with materialized=false returns raw data', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const tx1 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
      tx1.commit();
      tx2.commit();
      await tick();

      const fragments = (cache as any).readFragments(['User:1', 'User:2'], { materialized: false });

      expect(fragments).toHaveLength(2);
      expect(fragments[0]?.name).toBe('Alice');
      expect(fragments[1]?.name).toBe('Bob');

      // Should not be reactive when materialized=false
      fragments.forEach(fragment => {
        if (fragment) {
          expect(isReactive(fragment)).toBe(false);
        }
      });
    });
  });

  describe('Fragment Reactivity in Components', () => {
    it('components update when fragments change', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Seed initial data
      const tx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Initial Name' });
      tx.commit();
      await tick();

      const renders: string[] = [];

      const Component = defineComponent({
        setup() {
          const user = useFragment('User:1');

          watch(() => user.value?.name, (name) => {
            if (name) renders.push(name);
          }, { immediate: true });

          return () => h('div', {}, user.value?.name || 'Loading...');
        }
      });

      const api = {
        readFragment: (cache as any).readFragment,
        readFragments: (cache as any).readFragments,
        writeFragment: (cache as any).writeFragment,
        identify: (cache as any).identify,
        modifyOptimistic: (cache as any).modifyOptimistic,
        hasFragment: (cache as any).hasFragment,
        listEntityKeys: (cache as any).listEntityKeys,
        listEntities: (cache as any).listEntities,
        inspect: (cache as any).inspect,
        entitiesTick: (cache as any).__entitiesTick,
      };

      const wrapper = mount(Component, {
        global: {
          provide: {
            [CACHEBAY_KEY as symbol]: api
          }
        }
      });

      await tick(2);
      expect(renders).toEqual(['Initial Name']);
      expect(wrapper.text()).toBe('Initial Name');

      // Update the fragment
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Updated Name' });
      tx2.commit();
      await tick(2);

      expect(renders).toEqual(['Initial Name', 'Updated Name']);
      expect(wrapper.text()).toBe('Updated Name');
    });

    it('multiple components react to same fragment changes', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const tx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Shared User' });
      tx.commit();
      await tick();

      const renders1: string[] = [];
      const renders2: string[] = [];

      const Component1 = defineComponent({
        setup() {
          const user = useFragment('User:1');

          watch(() => user.value?.name, (name) => {
            if (name) renders1.push(`C1:${name}`);
          }, { immediate: true });

          return () => h('div', { class: 'comp1' }, user.value?.name || 'Loading...');
        }
      });

      const Component2 = defineComponent({
        setup() {
          const user = useFragment('User:1');

          watch(() => user.value?.name, (name) => {
            if (name) renders2.push(`C2:${name}`);
          }, { immediate: true });

          return () => h('div', { class: 'comp2' }, `Hello ${user.value?.name || 'Unknown'}`);
        }
      });

      const WrapperComponent = defineComponent({
        setup() {
          const api = {
            readFragment: (cache as any).readFragment,
            readFragments: (cache as any).readFragments,
            writeFragment: (cache as any).writeFragment,
            identify: (cache as any).identify,
            modifyOptimistic: (cache as any).modifyOptimistic,
            hasFragment: (cache as any).hasFragment,
            listEntityKeys: (cache as any).listEntityKeys,
            listEntities: (cache as any).listEntities,
            inspect: (cache as any).inspect,
            entitiesTick: (cache as any).__entitiesTick,
          };
          provide(CACHEBAY_KEY as symbol, api);
          return () => h('div', {}, [h(Component1), h(Component2)]);
        }
      });

      const wrapper = mount(WrapperComponent);

      await tick(2);
      expect(renders1).toEqual(['C1:Shared User']);
      expect(renders2).toEqual(['C2:Shared User']);
      expect(wrapper.find('.comp1').text()).toBe('Shared User');
      expect(wrapper.find('.comp2').text()).toBe('Hello Shared User');

      // Update fragment - both components should react
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Updated User' });
      tx2.commit();
      await tick(2);

      expect(renders1).toEqual(['C1:Shared User', 'C1:Updated User']);
      expect(renders2).toEqual(['C2:Shared User', 'C2:Updated User']);
      expect(wrapper.find('.comp1').text()).toBe('Updated User');
      expect(wrapper.find('.comp2').text()).toBe('Hello Updated User');
    });

    it('useFragments composable works with multiple fragments', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Seed multiple users
      const tx1 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
      tx1.commit();
      tx2.commit();
      await tick();

      const renders: string[][] = [];

      const Component = defineComponent({
        setup() {
          const users = useFragments(['User:1', 'User:2']);

          watch(() => users.value, (userList) => {
            const names = userList.map((u: any) => u?.name || 'null').filter(Boolean);
            if (names.length > 0) renders.push(names);
          }, { immediate: true, deep: true });

          return () => h('ul', {},
            users.value.map((user: any, i: number) =>
              h('li', { key: i }, user?.name || 'Missing')
            )
          );
        }
      });

      const api = {
        readFragment: (cache as any).readFragment,
        readFragments: (cache as any).readFragments,
        writeFragment: (cache as any).writeFragment,
        identify: (cache as any).identify,
        modifyOptimistic: (cache as any).modifyOptimistic,
        hasFragment: (cache as any).hasFragment,
        listEntityKeys: (cache as any).listEntityKeys,
        listEntities: (cache as any).listEntities,
        inspect: (cache as any).inspect,
        entitiesTick: (cache as any).__entitiesTick,
      };

      const wrapper = mount(Component, {
        global: {
          provide: {
            [CACHEBAY_KEY as symbol]: api
          }
        }
      });

      await tick(2);
      expect(renders).toEqual([['Alice', 'Bob']]);
      expect(wrapper.findAll('li').map(li => li.text())).toEqual(['Alice', 'Bob']);

      // Update one fragment
      const tx3 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice Updated' });
      tx3.commit();
      await tick(2);

      expect(renders).toEqual([['Alice', 'Bob'], ['Alice Updated', 'Bob']]);
      expect(wrapper.findAll('li').map(li => li.text())).toEqual(['Alice Updated', 'Bob']);
    });

    it('components do not update for unrelated fragment changes', async () => {
      const cache = createCache({
        keys: {
          User: (o: any) => (o?.id != null ? String(o.id) : null),
          Post: (o: any) => (o?.id != null ? String(o.id) : null)
        },
      });

      // Seed data
      const userTx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice' });
      const postTx = (cache as any).writeFragment({ __typename: 'Post', id: 1, title: 'Post Title' });
      userTx.commit();
      postTx.commit();
      await tick();

      const userRenders: string[] = [];
      const postRenders: string[] = [];

      const UserComponent = defineComponent({
        setup() {
          const user = useFragment('User:1');

          watch(() => user.value?.name, (name) => {
            if (name) userRenders.push(name);
          }, { immediate: true });

          return () => h('div', { class: 'user' }, user.value?.name || 'No user');
        }
      });

      const PostComponent = defineComponent({
        setup() {
          const post = useFragment('Post:1');

          watch(() => post.value?.title, (title) => {
            if (title) postRenders.push(title);
          }, { immediate: true });

          return () => h('div', { class: 'post' }, post.value?.title || 'No post');
        }
      });

      const WrapperComponent = defineComponent({
        setup() {
          const api = {
            readFragment: (cache as any).readFragment,
            readFragments: (cache as any).readFragments,
            writeFragment: (cache as any).writeFragment,
            identify: (cache as any).identify,
            modifyOptimistic: (cache as any).modifyOptimistic,
            hasFragment: (cache as any).hasFragment,
            listEntityKeys: (cache as any).listEntityKeys,
            listEntities: (cache as any).listEntities,
            inspect: (cache as any).inspect,
            entitiesTick: (cache as any).__entitiesTick,
          };
          provide(CACHEBAY_KEY as symbol, api);
          return () => h('div', {}, [h(UserComponent), h(PostComponent)]);
        }
      });

      const wrapper = mount(WrapperComponent);

      await tick(2);
      expect(userRenders).toEqual(['Alice']);
      expect(postRenders).toEqual(['Post Title']);

      // Update user fragment - only UserComponent should react
      const userTx2 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Alice Updated' });
      userTx2.commit();
      await tick(2);

      expect(userRenders).toEqual(['Alice', 'Alice Updated']);
      expect(postRenders).toEqual(['Post Title']); // Should not change

      // Update post fragment - only PostComponent should react
      const postTx2 = (cache as any).writeFragment({ __typename: 'Post', id: 1, title: 'Updated Title' });
      postTx2.commit();
      await tick(2);

      expect(userRenders).toEqual(['Alice', 'Alice Updated']); // Should not change
      expect(postRenders).toEqual(['Post Title', 'Updated Title']);
    });
  });
});
