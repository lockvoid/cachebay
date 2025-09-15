// test/flows/optimistic-updates.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { useQuery } from 'villus';
import { createCache } from '@/src';
import { tick, delay, seedCache, type Route } from '@/test/helpers';
import { mountWithClient, getListItems, cacheConfigs, testQueries, mockResponses } from '@/test/helpers/integration';

/** Snapshot fragments for entity checks */
const FRAG_POST = /* GraphQL */ `
  fragment P on Post { __typename id title }
`;

describe('Integration • Optimistic updates (entities & connections)', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];

  afterEach(async () => {
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  /* ───────────────────────────── Entities ───────────────────────────── */

  it('Entity: patch+commit, then revert restores previous snapshot', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    // no entity yet
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })
    ).toBeUndefined();

    const t = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post A' }, 'merge');
    });
    t.commit?.(); await tick();

    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })?.title
    ).toBe('Post A');

    t.revert?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })
    ).toBeUndefined();
  });

  it('Entity layering (order: T1 -> T2 -> revert T1 -> revert T2)', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post A' }, 'merge');
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post B' }, 'merge');
    });

    T1.commit?.(); T2.commit?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })?.title
    ).toBe('Post B');

    T1.revert?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })?.title
    ).toBe('Post B');

    T2.revert?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })
    ).toBeUndefined();
  });

  it('Entity layering (order: T1 -> T2 -> revert T2 -> revert T1) returns baseline', async () => {
    const cache = createCache({
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
    });

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post A' }, 'merge');
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post B' }, 'merge');
    });

    T1.commit?.(); T2.commit?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })?.title
    ).toBe('Post B');

    T2.revert?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })?.title
    ).toBe('Post A');

    T1.revert?.(); await tick();
    expect(
      (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST })
    ).toBeUndefined();
  });

  /* ─────────────────────────── Connections ───────────────────────────
     NOTE: we seed baseline selections via seedCache so the component
     mounts the same selection key that optimistic updates touch.
  --------------------------------------------------------------------- */

  it('Connection: addNode at end/start, removeNode, patch', async () => {
    const cache = cacheConfigs.withRelay();

    // Seed a baseline connection with 1,2,3
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts(['Post 1', 'Post 2', 'Post 3']).data,
      materialize: true,
    });

    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: 'cache-first' });
        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((e: any) =>
            h('li', { key: e.node.id }, e.node.title)
          )),
          h('div', { class: 'pageInfo' }, JSON.stringify(data.value?.posts?.pageInfo || {}))
        ]);
      }
    });

    const { wrapper } = await mountWithClient(PostList, [] as Route[], cache);
    await tick();
    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2', 'Post 3']);

    const tx = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });

      conn.addNode({ __typename: 'Post', id: '5', title: 'Post 5' }, { cursor: 'c5', position: 'end' });
      conn.addNode({ __typename: 'Post', id: '6', title: 'Post 6' }, { cursor: 'c6', position: 'end' });
      conn.removeNode({ __typename: 'Post', id: '1' });
      conn.addNode({ __typename: 'Post', id: '4', title: 'Post 4' }, { cursor: 'c4', position: 'start' });
      conn.patch({ endCursor: 'c6', hasNextPage: false });
    });
    tx.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual(['Post 4', 'Post 2', 'Post 3', 'Post 5', 'Post 6']);
    const pi = wrapper.find('.pageInfo').text();
    expect(pi).toContain('"endCursor":"c6"');
    expect(pi).toContain('"hasNextPage":false');
  });

  it('Connection: dedup on add; re-add after remove inserts at specified position', async () => {
    const cache = cacheConfigs.withRelay();

    // Seed with empty connection
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts([]).data,
      materialize: true,
    });

    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: 'cache-first' });
        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((e: any) =>
            h('li', { key: e.node.id }, e.node.title)
          )),
          h('div', { class: 'cursors' },
            (data.value?.posts?.edges || []).map((e: any) => e.cursor).join(',')
          )
        ]);
      }
    });

    const { wrapper } = await mountWithClient(PostList, [] as Route[], cache);
    await tick();

    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ __typename: 'Post', id: '1', title: 'Post 1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Post', id: '2', title: 'Post 2' }, { cursor: 'c2' });
    });
    t1.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2']);

    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode(
        { __typename: 'Post', id: '1', title: 'Post 1 Updated' },
        { cursor: 'c1b', edge: { score: 99 }, position: 'end' },
      );
    });
    t2.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual(['Post 1 Updated', 'Post 2']);

    const t3 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.removeNode({ __typename: 'Post', id: '1' });
      conn.addNode(
        { __typename: 'Post', id: '1', title: 'Post 1 Back' },
        { cursor: 'c1c', position: 'start' },
      );
    });
    t3.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual(['Post 1 Back', 'Post 2']);
    expect(wrapper.find('.cursors').text()).toBe('c1c,c2');
  });

  it('Connection: invalid nodes (missing id/__typename) are ignored safely', async () => {
    const cache = cacheConfigs.withRelay();

    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts([]).data,
      materialize: true,
    });

    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: 'cache-first' });
        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((e: any) =>
            h('li', { key: e.node.id }, e.node.title)
          ))
        ]);
      }
    });

    const { wrapper } = await mountWithClient(PostList, [] as Route[], cache);
    await tick();

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ id: '1', title: 'NoTypename' } as any, { cursor: 'x' });        // invalid
      conn.addNode({ __typename: 'Post', title: 'NoId' } as any, { cursor: 'y' });   // invalid
    });
    t.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual([]);
  });

  it('Connection layering: T1 adds, T2 adds; revert T1 preserves T2; revert T2 returns to baseline', async () => {
    const cache = cacheConfigs.withRelay();

    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: {},
      data: mockResponses.posts([]).data,
      materialize: true,
    });

    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({ query: testQueries.POSTS, variables: {}, cachePolicy: 'cache-first' });
        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((e: any) =>
            h('li', { key: e.node.id }, e.node.title)
          )),
          h('div', { class: 'pageInfo' }, JSON.stringify(data.value?.posts?.pageInfo || {}))
        ]);
      }
    });

    const { wrapper } = await mountWithClient(PostList, [] as Route[], cache);
    await tick();

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ __typename: 'Post', id: '1', title: 'Post 1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Post', id: '2', title: 'Post 2' }, { cursor: 'c2' });
      conn.patch({ endCursor: 'c2', hasNextPage: true });
    });

    const T2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ __typename: 'Post', id: '3', title: 'Post 3' }, { cursor: 'c3' });
      conn.patch({ endCursor: 'c3', hasNextPage: false });
    });

    T1.commit?.(); T2.commit?.(); await tick();

    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2', 'Post 3']);
    const info = wrapper.find('.pageInfo').text();
    expect(info).toContain('"endCursor":"c3"');
    expect(info).toContain('"hasNextPage":false');

    T1.revert?.(); await tick();
    expect(getListItems(wrapper)).toEqual(['Post 3']);

    T2.revert?.(); await tick();
    expect(getListItems(wrapper)).toEqual([]);
    expect(wrapper.find('.pageInfo').text()).toBe('{"endCursor":null,"hasNextPage":true}');
  });
});
