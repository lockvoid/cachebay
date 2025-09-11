import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { useQuery } from 'villus';
import { createCache } from '@/src';
import { tick, delay, seedCache, type Route } from '@/test/helpers';
import { mountWithClient, getListItems, cacheConfigs, testQueries, mockResponses, createTestClient } from '@/test/helpers/integration';

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

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

    expect((cache as any).hasFragment('Post:1')).toBe(false);

    const t = (cache as any).modifyOptimistic((c: any) => {
      c.patch({ __typename: 'Post', id: '1', title: 'Post A' }, 'merge');
    });
    t.commit?.(); await tick();

    expect((cache as any).hasFragment('Post:1')).toBe(true);
    expect((cache as any).readFragment('Post:1')?.title).toBe('Post A');

    t.revert?.(); await tick();
    expect((cache as any).hasFragment('Post:1')).toBe(false);
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
    expect((cache as any).readFragment('Post:1')?.title).toBe('Post B');

    T1.revert?.(); await tick();
    expect((cache as any).readFragment('Post:1')?.title).toBe('Post B');

    T2.revert?.(); await tick();
    expect((cache as any).hasFragment('Post:1')).toBe(false);
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
    expect((cache as any).readFragment('Post:1')?.title).toBe('Post B');

    T2.revert?.(); await tick();
    expect((cache as any).readFragment('Post:1')?.title).toBe('Post A');

    T1.revert?.(); await tick();
    expect((cache as any).hasFragment('Post:1')).toBe(false);
  });

  /* ─────────────────────────── Connections ─────────────────────────── */

  it('Connection: addNode at end/start, removeNode, patch', async () => {
    const cache = cacheConfigs.withRelay();

    // Component that renders posts from the cache
    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({
          query: testQueries.POSTS,
          variables: {}
        });

        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((edge: any) =>
            h('li', { key: edge.node.id }, edge.node.title)
          )),
          h('div', { class: 'pageInfo' }, JSON.stringify(data.value?.posts?.pageInfo || {}))
        ]);
      }
    });

    // Initial response will trigger relay resolver to register the connection
    const routes: Route[] = [{
      when: ({ body }) => body.includes('query Posts'),
      delay: 0,
      respond: () => mockResponses.posts(['Post 1', 'Post 2', 'Post 3']),
    }];

    const { wrapper } = await mountWithClient(PostList, routes, cache);
    await delay(20);

    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2', 'Post 3']);

    const tx = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });

      // Add Post 5 at end
      conn.addNode({ __typename: 'Post', id: '5', title: 'Post 5', content: 'Content for Post 5', authorId: '1' }, { cursor: 'c5', position: 'end' });

      // Add Post 6 after Post 5
      conn.addNode({ __typename: 'Post', id: '6', title: 'Post 6', content: 'Content for Post 6', authorId: '1' }, { cursor: 'c6', position: 'end' });

      // Remove Post 1
      conn.removeNode({ __typename: 'Post', id: '1' });

      // Add Post 4 as first
      conn.addNode({ __typename: 'Post', id: '4', title: 'Post 4', content: 'Content for Post 4', authorId: '1' }, { cursor: 'c4', position: 'start' });

      // Update pageInfo
      conn.patch({ endCursor: 'c6', hasNextPage: false });
    });
    tx.commit?.();

    await tick(2);

    // Check the rendered output
    const items = getListItems(wrapper);
    expect(items).toEqual(['Post 4', 'Post 2', 'Post 3', 'Post 5', 'Post 6']);

    // Check pageInfo was updated
    expect(wrapper.find('.pageInfo').text()).toContain('"endCursor":"c6"');
    expect(wrapper.find('.pageInfo').text()).toContain('"hasNextPage":false');
  });

  it.skip('Connection: dedup on add; re-add after remove inserts at specified position', async () => {
    const cache = cacheConfigs.withRelay();

    // Component that renders posts from the cache
    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({
          query: testQueries.POSTS,
          variables: {}
        });

        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((edge: any) =>
            h('li', { key: edge.node.id }, edge.node.title)
          )),
          h('div', { class: 'cursors' },
            (data.value?.posts?.edges || []).map((edge: any) => edge.cursor).join(',')
          )
        ]);
      }
    });

    // Set up mock response for initial query
    const routes: Route[] = [{
      when: ({ body }) => body.includes('query Posts'),
      delay: 0,
      respond: () => mockResponses.posts([]),
    }];

    const { wrapper } = await mountWithClient(PostList, routes, cache);
    await delay(20);

    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ __typename: 'Post', id: '1', title: 'Post 1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Post', id: '2', title: 'Post 2' }, { cursor: 'c2' });
    });
    t1.commit?.();
    await delay(10);

    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2']);

    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode(
        { __typename: 'Post', id: '1', title: 'Post 1 Updated' },
        { cursor: 'c1b', edge: { score: 99 }, position: 'end' },
      );
    });
    t2.commit?.();
    await delay(10);

    // Post 1 should be deduplicated and remain in same position with updated title
    expect(getListItems(wrapper)).toEqual(['Post 1 Updated', 'Post 2']);

    const t3 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.removeNode({ __typename: 'Post', id: '1' });
      conn.addNode(
        { __typename: 'Post', id: '1', title: 'Post 1 Back' },
        { cursor: 'c1c', position: 'start' },
      );
    });
    t3.commit?.();
    await delay(10);

    // Post 1 should be at start now
    expect(getListItems(wrapper)).toEqual(['Post 1 Back', 'Post 2']);
    expect(wrapper.find('.cursors').text()).toBe('c1c,c2');
  });

  it('Connection: invalid nodes (missing id/__typename) are ignored safely', async () => {
    const cache = cacheConfigs.withRelay();

    // Component that renders posts from the cache
    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({
          query: testQueries.POSTS,
          variables: {}
        });

        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((edge: any) =>
            h('li', { key: edge.node.id }, edge.node.title)
          ))
        ]);
      }
    });

    // Set up mock response for initial query
    const routes: Route[] = [{
      when: ({ body }) => body.includes('query Posts'),
      delay: 0,
      respond: () => mockResponses.posts([]),
    }];

    const { wrapper } = await mountWithClient(PostList, routes, cache);
    await delay(20);

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ id: '1', title: 'NoTypename' } as any, { cursor: 'x' });        // invalid
      conn.addNode({ __typename: 'Post', title: 'NoId' } as any, { cursor: 'y' }); // invalid
    });
    t.commit?.();
    await delay(10);

    // Invalid nodes should be ignored
    expect(getListItems(wrapper)).toEqual([]);
  });

  it.skip('Connection layering: T1 adds, T2 adds; revert T1 preserves T2; revert T2 returns to baseline', async () => {
    const cache = cacheConfigs.withRelay();

    // Component that renders posts from the cache
    const PostList = defineComponent({
      setup() {
        const { data } = useQuery({
          query: testQueries.POSTS,
          variables: {}
        });

        return () => h('div', [
          h('ul', (data.value?.posts?.edges || []).map((edge: any) =>
            h('li', { key: edge.node.id }, edge.node.title)
          )),
          h('div', { class: 'pageInfo' }, JSON.stringify(data.value?.posts?.pageInfo || {}))
        ]);
      }
    });

    // Set up mock response for initial query
    const routes: Route[] = [{
      when: ({ body }) => body.includes('query Posts'),
      delay: 0,
      respond: () => mockResponses.posts([]),
    }];

    const { wrapper } = await mountWithClient(PostList, routes, cache);
    await delay(20);

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

    T1.commit?.(); T2.commit?.();
    await delay(10);

    expect(getListItems(wrapper)).toEqual(['Post 1', 'Post 2', 'Post 3']);
    expect(wrapper.find('.pageInfo').text()).toContain('"endCursor":"c3"');
    expect(wrapper.find('.pageInfo').text()).toContain('"hasNextPage":false');

    // Revert T1 -> only Post 3 remains
    T1.revert?.();
    await delay(10);
    expect(getListItems(wrapper)).toEqual(['Post 3']);

    // Revert T2 -> baseline
    T2.revert?.();
    await delay(10);
    expect(getListItems(wrapper)).toEqual([]);
    expect(wrapper.find('.pageInfo').text()).toBe('{}');
  });
});
