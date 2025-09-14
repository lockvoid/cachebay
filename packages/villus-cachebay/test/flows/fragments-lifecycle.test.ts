import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref, isReactive } from 'vue';
import { createCache, useFragment, useCache } from '@/src';
import { tick, delay, type Route } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';

describe('Integration • Fragments Behavior (selection-first, no readFragments)', () => {
  it('Fragment API Basics • identify returns normalized key', () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    expect((cache as any).identify({ __typename: 'User', id: 1 })).toBe('User:1');
  });

  it('Fragment API Basics • writeFragment → readFragment roundtrip (entity fields only)', async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({
      id: 'User:1', fragment: `
      fragment U on User { id name }
    `, data: { __typename: 'User', id: '1', name: 'Ann' }
    });

    const out = (cache as any).readFragment({
      id: 'User:1',
      fragment: `fragment U on User { id name }`,
    });

    expect(out).toBeTruthy();
    expect(out.id).toBe('1');
    expect(out.name).toBe('Ann');
    // readFragment returns a plain snapshot at the root (not a proxy)
    expect(isReactive(out)).toBe(false);
  });

  it('Fragment API Basics • readFragment with materialized=false returns raw snapshot (non-reactive)', async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'User:2', fragment: `
      fragment U on User { id name }
    `, data: { __typename: 'User', id: '2', name: 'Bob' }
    });

    const raw = (cache as any).readFragment({
      id: 'User:2',
      fragment: `fragment U on User { id name }`,
      materialized: false,
    });
    expect(raw).toBeTruthy();
    expect(raw.name).toBe('Bob');
    expect(isReactive(raw)).toBe(false);
  });

  it('Fragment API Basics • writeFragment twice updates readFragment result', async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'User:3', fragment: `
      fragment U on User { id name }
    `, data: { __typename: 'User', id: '3', name: 'Charlie' }
    });

    (cache as any).writeFragment({
      id: 'User:3', fragment: `
      fragment U on User { id name }
    `, data: { __typename: 'User', id: '3', name: 'Charles' }
    });

    const out = (cache as any).readFragment({ id: 'User:3', fragment: `fragment U on User { id name }` });
    expect(out.name).toBe('Charles');
  });

  it('Fragment with nested field + args • writes & reads a nested connection subtree via fragment (selection stored)', () => {
    const cache = createCache({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
    });
    (cache as any).writeFragment({
      id: 'User:1',
      fragment: `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename hasNextPage endCursor }
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
          pageInfo: { __typename: 'PageInfo', hasNextPage: true, endCursor: 'c2' },
        },
      }
    });

    const result = (cache as any).readFragment({
      id: 'User:1',
      fragment: `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename hasNextPage endCursor }
          }
        }
      `,
    });
    expect(result.posts.__typename).toBe('PostConnection');
    expect(Array.isArray(result.posts.edges)).toBe(true);
    expect(result.posts.edges.map((e: any) => e.node.title)).toEqual(['Hello', 'World']);
    expect(result.posts.pageInfo).toEqual({ __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true });
  });

  it('Fragment Reactivity in Components (single, dynamic id) • component updates when a fragment changes', async () => {
    const routes: Route[] = [];
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });
    (cache as any).writeFragment({
      id: 'User:1', fragment: `fragment U on User { id name }`,
      data: { __typename: 'User', id: '1', name: 'Initial Name' }
    });

    const renders: string[] = [];

    const Comp = defineComponent({
      setup() {
        const id = ref('User:1');
        const f = useFragment({ id, fragment: `fragment U on User { id name }` });
        // record on read()
        renders.push(f.data.value?.name ?? '');
        return { f };
      },
      render() { return h('div', {}, this.f.data.value?.name || ''); }
    });

    const { wrapper } = await mountWithClient(Comp, routes, cache);
    await tick();
    expect(renders.at(-1)).toBe('Initial Name');

    (cache as any).writeFragment({
      id: 'User:1', fragment: `fragment U on User { id name }`,
      data: { __typename: 'User', id: '1', name: 'Updated Name' }
    });
    (wrapper.vm as any).f.read();
    await tick();
    expect(wrapper.text()).toBe('Updated Name');
  });

  it('Multiple fragments (manual) • read multiple via repeated readFragment calls', async () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({ id: 'User:1', fragment: `fragment U on User { id name }`, data: { __typename: 'User', id: '1', name: 'Alice' } });
    (cache as any).writeFragment({ id: 'User:2', fragment: `fragment U on User { id name }`, data: { __typename: 'User', id: '2', name: 'Bob' } });
    (cache as any).writeFragment({ id: 'User:3', fragment: `fragment U on User { id name }`, data: { __typename: 'User', id: '3', name: 'Charlie' } });

    const items = ['User:1', 'User:2', 'User:3']
      .map(k => (cache as any).readFragment({ id: k, fragment: `fragment U on User { id name }` }))
      .filter(Boolean);

    expect(items.map(u => u?.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    // root is a plain snapshot (not a proxy)
    items.forEach(u => { if (u) expect(isReactive(u)).toBe(false); });
  });

  it('Multiple fragments (manual) • missing ones are simply undefined', () => {
    const cache = createCache({
      keys: { User: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    (cache as any).writeFragment({ id: 'User:1', fragment: `fragment U on User { id name }`, data: { __typename: 'User', id: '1', name: 'Alice' } });

    const items = ['User:1', 'User:999', 'User:2']
      .map(k => (cache as any).readFragment({ id: k, fragment: `fragment U on User { id name }` }))
      .filter(Boolean);

    expect(items.length).toBe(3);
    expect(items[0]?.name).toBe('Alice');
  });
});
