// test/flows/fragments-behaviour.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, ref, watch } from 'vue';
import { isReactive } from 'vue';
import { createCache } from '@/src';
import { mountWithClient } from '@/test/helpers/integration';
import { tick } from '@/test/helpers';

const gql = (s: TemplateStringsArray) => s.join('');

describe('Integration • Fragments Behavior (selection-first, no readFragments)', () => {
  const restores: Array<() => void> = [];
  afterEach(() => { while (restores.length) (restores.pop()!)(); });

  describe('Fragment API Basics', () => {
    it('identify returns normalized key', () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      const key = (cache as any).identify({ __typename: 'User', id: 1, name: 'A' });
      expect(key).toBe('User:1');
    });

    it('writeFragment → readFragment roundtrip (entity fields only)', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // write
      (cache as any).writeFragment({
        id: 'User:1',
        fragment: gql`
          fragment UserName on User { id name }
        `,
        data: { __typename: 'User', id: '1', name: 'Ann' },
      });

      await tick();

      // read (materialized by default)
      const out = (cache as any).readFragment({
        id: 'User:1',
        fragment: gql`fragment UserName on User { id name }`,
      });
      expect(out).toBeTruthy();
      expect(out.__typename).toBe('User');
      expect(out.id).toBe('1');
      expect(out.name).toBe('Ann');
      expect(isReactive(out)).toBe(true);
    });

    it('readFragment with materialized=false returns raw snapshot (non-reactive)', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      (cache as any).writeFragment({
        id: 'User:2',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '2', name: 'Bob' },
      });
      await tick();

      const raw = (cache as any).readFragment({
        id: 'User:2',
        fragment: gql`fragment UserName on User { id name }`,
        variables: undefined,
        materialized: false, // supported by your fragments.readFragment options
      });
      expect(raw).toBeTruthy();
      expect(raw.name).toBe('Bob');
      expect(isReactive(raw)).toBe(false);
    });

    it('writeFragment twice updates readFragment result', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      (cache as any).writeFragment({
        id: 'User:3',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '3', name: 'Charlie' },
      });
      await tick();

      // update
      (cache as any).writeFragment({
        id: 'User:3',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '3', name: 'Charlie Updated' },
      });
      await tick();

      const out = (cache as any).readFragment({
        id: 'User:3', fragment: gql`fragment UserName on User { id name }`
      });
      expect(out.name).toBe('Charlie Updated');
    });
  });

  describe('Fragment with nested field + args (connection skeleton)', () => {
    it('writes & reads a nested connection subtree via fragment (selection stored)', async () => {
      const cache = createCache({
        keys: {
          User: (o: any) => o?.id ?? null,
          Post: (o: any) => o?.id ?? null,
        },
      });

      // Parent must exist (identify works regardless)
      (cache as any).writeFragment({
        id: 'User:1',
        fragment: gql`fragment Seed on User { id }`,
        data: { __typename: 'User', id: '1' },
      });

      // Write connection page on User via fragment
      (cache as any).writeFragment({
        id: 'User:1',
        fragment: gql`
          fragment UserPostsPage on User {
            posts(first: 2) {
              __typename
              edges { __typename cursor node { __typename id title } }
              pageInfo { __typename endCursor hasNextPage }
            }
          }
        `,
        data: {
          __typename: 'User',
          id: '1',
          posts: {
            __typename: 'PostConnection',
            edges: [
              { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'Post', id: '101', title: 'Hello' } },
              { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'Post', id: '102', title: 'World' } },
            ],
            pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true },
          },
        },
      });

      await tick();

      // Read nested page back
      const result = (cache as any).readFragment({
        id: 'User:1',
        fragment: gql`
          fragment UserPostsPage on User {
            posts(first: 2) {
              edges { cursor node { id title } }
              pageInfo { endCursor hasNextPage }
            }
          }
        `,
      });

      expect(Array.isArray(result.posts.edges)).toBe(true);
      expect(result.posts.edges.map((e: any) => e.node.title)).toEqual(['Hello', 'World']);
      expect(result.posts.pageInfo).toMatchObject({
        __typename: 'PageInfo',
        endCursor: 'c2',
        hasNextPage: true,
      });
    });
  });

  describe('Fragment Reactivity in Components (single, dynamic id)', () => {
    it('component updates when a fragment changes', async () => {
      const routes: any[] = [];
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      // Seed
      (cache as any).writeFragment({
        id: 'User:10',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '10', name: 'Initial Name' },
      });
      await tick();

      const renders: string[] = [];

      const Component = defineComponent({
        setup() {
          const id = ref('User:10');

          // a tiny composable-like inline reader using the cache instance
          // (you have your own useFragment, but this keeps the test focused)
          const read = () =>
            (cache as any).readFragment({ id: id.value, fragment: gql`fragment F on User { id name }` });

          const current = ref<any>(read());
          // watch changes to the materialized proxy
          watch(() => current.value?.name, (name) => {
            if (name) renders.push(name);
          }, { immediate: true });

          // trick to keep current fresh when id doesn't change:
          // in real app your useFragment would re-read on writes automatically via reactivity
          const rerender = () => { current.value = read(); };

          // expose a rerender hook on window for test (not required in your suite,
          // we just call rerender after writes to simulate a read)
          (globalThis as any).__forceReRead = rerender;

          return () => h('div', {}, current.value?.name || 'Loading...');
        }
      });

      const { wrapper } = await mountWithClient(Component, routes, cache);

      await tick(2);
      expect(renders).toEqual(['Initial Name']);
      expect(wrapper.text()).toBe('Initial Name');

      // Update the fragment → simulate re-read (your real useFragment would stay bound)
      (cache as any).writeFragment({
        id: 'User:10',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '10', name: 'Updated Name' },
      });
      (globalThis as any).__forceReRead?.();
      await tick(2);

      expect(renders).toEqual(['Initial Name', 'Updated Name']);
      expect(wrapper.text()).toBe('Updated Name');
    });
  });

  describe('Multiple fragments (manual loop; no readFragments/useFragments API)', () => {
    it('read multiple via repeated readFragment calls', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      (cache as any).writeFragment({
        id: 'User:1',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '1', name: 'Alice' },
      });
      (cache as any).writeFragment({
        id: 'User:2',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '2', name: 'Bob' },
      });
      (cache as any).writeFragment({
        id: 'User:3',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '3', name: 'Charlie' },
      });

      await tick();

      const keys = ['User:1', 'User:2', 'User:3'];
      const items = keys.map(k =>
        (cache as any).readFragment({ id: k, fragment: gql`fragment UserName on User { id name }` })
      );

      expect(items.map(u => u?.name)).toEqual(['Alice', 'Bob', 'Charlie']);
      items.forEach(u => { if (u) expect(isReactive(u)).toBe(true); });
    });

    it('missing ones are simply undefined', async () => {
      const cache = createCache({
        keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
      });

      (cache as any).writeFragment({
        id: 'User:1',
        fragment: gql`fragment UserName on User { id name }`,
        data: { __typename: 'User', id: '1', name: 'Alice' },
      });

      await tick();

      const keys = ['User:1', 'User:999', 'User:2'];
      const items = keys
        .map(k => (cache as any).readFragment({ id: k, fragment: gql`fragment UserName on User { id name }` }))
        .filter(Boolean);

      expect(items.length).toBe(1);
      expect(items[0]?.name).toBe('Alice');
    });
  });
});
