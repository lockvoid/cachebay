import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, isReactive, Suspense } from 'vue';
import { useQuery } from 'villus';
import { relay } from '@/src';
import { tick, delay, seedCache, type Route } from '@/test/helpers';
import { mountWithClient, getListItems, cacheConfigs, mockResponses, testQueries, createTestClient } from '@/test/helpers/integration';

/* ─────────────────────────────────────────────────────────────────────────────
 * Harnesses
 *   - default: renders posts.edges
 *   - anyEdges: renders posts.edges || posts.items (for custom path tests)
 *   - PostsHarness: parameterized by cachePolicy and supports a `filter` prop
 * ──────────────────────────────────────────────────────────────────────────── */
function harnessEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number },
    setup(props) {
      const vars = computed(() => ({
        first: props.first || 2,
        after: props.after,
        last: props.last,
        before: props.before,
      }));
      const { data, isFetching, error } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });

      return () =>
        h(
          'ul',
          {},
          (data?.value?.posts?.edges ?? []).map((e: any) =>
            h('li', {}, e.node?.title || ''),
          ),
        );
    },
  });
}

function harnessAnyEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number },
    setup(props) {
      const vars = computed(() => ({
        first: props.first,
        after: props.after,
        last: props.last,
        before: props.before,
      }));
      const { data } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });
      return () => {
        const c = (data?.value as any)?.posts || {};
        const edges = c.edges ?? c.items ?? [];
        return h('ul', {}, edges.map((e: any) => h('li', {}, (e.node?.title ?? e.item?.node?.title) || '')));
      };
    },
  });
}

/**
 * Parameterized posts list harness that allows switching filters (A/B) and paginating.
 * It renders titles from posts.edges.
 */
function PostsHarness(cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') {
  return defineComponent({
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: any = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });
      return () => h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */
function liText(w: any) {
  return getListItems(w);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Flows (Spec Coverage)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('Integration • Relay flows (spec coverage) • Posts', () => {
  const restores: Array<() => void> = [];
  afterEach(() => { while (restores.length) (restores.pop()!)(); });

  /* 3) Modes — append/prepend/replace behavior & view sizing (by visible edges) */

  it.only('append mode: adds at end, bumps visible by page size', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => {
          return !variables.after && variables.first === 2;
        },
        // delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Post', id: 1, title: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Post', id: 2, title: 'A2' } },
              ],
              pageInfo: { endCursor: 'c2', hasNextPage: true },
            },
          },
        }),
      },
      {
        when: ({ variables }) => {
          console.log('variables', variables.after === 'c2' && variables.first === 2);
          return variables.after === 'c2' && variables.first === 2;
        },
        // delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Post', id: 3, title: 'A3' } },
                { cursor: 'c4', node: { __typename: 'Post', id: 4, title: 'A4' } },
              ],
              pageInfo: { endCursor: 'c4', hasNextPage: false },
            },
          },
        }),
      },
    ];

    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'append' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('network-only'), routes, cache);

    await delay(12); await tick(6);

    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await delay(7); await tick(6);

    console.log('s', cache.inspect.connection('Query', 'posts'));

    expect(liText(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4']); // bumped at end
  });

  it('prepend mode: adds at start, bumps visible by page size', async () => {
    const routes: Route[] = [
      // page 1 (baseline)
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Post', id: 1, title: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Post', id: 2, title: 'A2' } },
              ],
              pageInfo: { startCursor: 'c1', endCursor: 'c2', hasPreviousPage: true, hasNextPage: true },
            },
          },
        }),
      },
      // before=c1 (older)
      {
        when: ({ variables }) => variables.before === 'c1' && variables.last === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c0', node: { __typename: 'Post', id: 0, title: 'A0' } },
                { cursor: 'c0.5', node: { __typename: 'Post', id: 0.5 as any, title: 'A0.5' } },
              ],
              pageInfo: { startCursor: 'c0', hasPreviousPage: true },
            },
          },
        }),
      },
    ];

    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'prepend' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('network-only'), routes, cache);
    restores.push(fx.restore);

    await delay(12); await tick(6);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ last: 2, before: 'c1' });
    await delay(7); await tick(6);
    expect(liText(wrapper)).toEqual(['A0', 'A0.5', 'A1', 'A2']); // bumped in front
  });

  it('replace mode: clears list, then shows only the latest page', async () => {
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Post', id: 1, title: 'A1' } },
                { cursor: 'c2', node: { __typename: 'Post', id: 2, title: 'A2' } },
              ],
              pageInfo: { endCursor: 'c2', hasNextPage: true },
            },
          },
        }),
      },
      // page 2
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Post', id: 3, title: 'A3' } },
                { cursor: 'c4', node: { __typename: 'Post', id: 4, title: 'A4' } },
              ],
              pageInfo: { endCursor: 'c4', hasNextPage: true },
            },
          },
        }),
      },
      // page 1 updated (after refetch)
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c1', node: { __typename: 'Post', id: 1, title: 'A1-new' } },
                { cursor: 'c2', node: { __typename: 'Post', id: 2, title: 'A2' } },
              ],
              pageInfo: { endCursor: 'c2', hasNextPage: true },
            },
          },
        }),
      },
    ];
    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'replace' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('cache-and-network'), routes, cache);
    restores.push(fx.restore);

    await delay(12); await tick(6);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await delay(7); await tick(6);
    // order remains [node1, node2], node1 title updated
    expect(liText(wrapper)).toEqual(['A1-new', 'A2']);
  });

  /* Custom paths (edges=item, node=item.node, pageInfo=meta) */
  it('custom paths: edges=items, node=item.node, pageInfo=meta', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              items: [
                { cursor: 'x1', item: { node: { __typename: 'Post', id: 7, title: 'X1' } } },
              ],
              meta: { endCursor: 'x1', hasNextPage: false },
            },
          },
        }),
      },
    ];
    const cache = cacheConfigs.withRelay(relay({ edges: 'items', node: 'item.node', pageInfo: 'meta' }));
    const { wrapper, fx } = await mountWithClient(harnessAnyEdges('network-only'), routes, cache);
    restores.push(fx.restore);

    await delay(10); await tick(2);
    expect(liText(wrapper)).toEqual(['X1']);
  });

  /* Host controlled transformations (append=after, prepend=before) */
  it('host controlled: after=append, before=prepend', async () => {
    const routes: Route[] = [
      // page 1 -> endCursor p1
      {
        when: ({ variables }) => variables.page === 'p1' && !variables.after && variables.first === 2,
        delay: 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'p1', node: { __typename: 'Post', id: 1, title: 'P1-1' } },
                { cursor: 'p1', node: { __typename: 'Post', id: 2, title: 'P1-2' } },
              ],
              pageInfo: { endCursor: 'p1', hasNextPage: true },
            },
          },
        }),
      },
      // page 2 -> endCursor p2 (append)
      {
        when: ({ variables }) => variables.after === 'p1' && variables.first === 2,
        delay: 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'p2', node: { __typename: 'Post', id: 3, title: 'P2-1' } },
                { cursor: 'p2', node: { __typename: 'Post', id: 4, title: 'P2-2' } },
              ],
              pageInfo: { endCursor: 'p2', hasNextPage: true },
            },
          },
        }),
      },
      // before=p1 (prepend)
      {
        when: ({ variables }) => variables.before === 'p1' && variables.last === 2,
        delay: 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'p0', node: { __typename: 'Post', id: 0, title: 'P0-1' } },
                { cursor: 'p0', node: { __typename: 'Post', id: -1, title: 'P0-2' } },
              ],
              pageInfo: { startCursor: 'p0', hasPreviousPage: true },
            },
          },
        }),
      },
    ];
    const cache = cacheConfigs.withRelay(relay({}));
    const App = defineComponent({
      props: { after: String, before: String, first: Number, last: Number, page: String },
      setup(props) {
        const vars = computed(() => ({
          page: props.page,
          first: props.first,
          after: props.after,
          last: props.last,
          before: props.before,
        }));
        const { data } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy: 'network-only' });
        return () => h('div', [
          h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || ''))),
          h('div', { class: 'cursor' }, (data?.value?.posts?.pageInfo?.endCursor || ''))
        ]);
      },
    });

    const { wrapper, fx } = await mountWithClient(App, routes, cache);
    restores.push(fx.restore);

    // initial
    await wrapper.setProps({ page: 'p1', first: 2 }); await delay(7); await tick(6);
    expect(liText(wrapper)).toEqual(['P1-1', 'P1-2']);

    // after -> append
    await wrapper.setProps({ first: 2, after: 'p1' });
    await delay(7); await tick(6);
    expect(liText(wrapper)).toEqual(['P1-1', 'P1-2', 'P2-1', 'P2-2']);

    // before -> prepend
    await wrapper.setProps({ first: undefined, after: undefined, last: 2, before: 'p1' } as any);
    await delay(7); await tick(6);
    expect(liText(wrapper)).toEqual(['P0-1', 'P0-2', 'P1-1', 'P1-2', 'P2-1', 'P2-2']);
  });

  /* Cursor replay hint (allow older page to apply after newer) */
  it('cursor replay: older page (after present) is allowed to apply after a newer family leader', async () => {
    const routes: Route[] = [
      // newer (no after)
      {
        when: ({ variables }) => !variables.after,
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [{ cursor: 'n1', node: { __typename: 'Post', id: 1, title: 'A' } }],
              pageInfo: {},
            },
          },
        }),
      },
      // older cursor page (after='n1')
      {
        when: ({ variables }) => variables.after === 'n1',
        delay: 7,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [{ cursor: 'n2', node: { __typename: 'Post', id: 2, title: 'B' } }],
              pageInfo: {},
            },
          },
        }),
      },
    ];

    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'append' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('network-only'), routes, cache);
    restores.push(fx.restore);

    await delay(6); await tick(2);
    expect(liText(wrapper)).toEqual(['A']);

    // enqueue older page with after cursor now
    await wrapper.setProps({ first: 1, after: 'n1' });
    await delay(10); await tick(2);
    expect(liText(wrapper)).toEqual(['A', 'B']);
  });
});

/* -------------------------------------------------------------------------- */
/* Non-Suspense: Switch A→B→A then paginate again (to p4)                      */
/* -------------------------------------------------------------------------- */
describe('Integration • Relay pagination reset & append from cache — extended', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];
  afterEach(async () => { while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); } });

  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    const cache = cacheConfigs.withRelay();

    // Register the connection quickly (A p1), then seed more pages for A and B
    {
      const fast: Route[] = [{
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['A-1', 'A-2']),
      }];
      const AppQuick = PostsHarness('cache-and-network');
      const { wrapper, fx } = await mountWithClient(AppQuick, fast, cache);
      mocks.push(fx);
      await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);
      expect(liText(wrapper)).toEqual(['A-1', 'A-2']);
      wrapper.unmount();
    }

    // Seed cached pages for A p2, p3 and B p1
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { filter: 'A', first: 2, after: 'a2' },
      data: mockResponses.posts(['A-3', 'A-4']).data,
    });
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { filter: 'A', first: 2, after: 'a4' },
      data: mockResponses.posts(['A-5', 'A-6']).data,
    });
    await seedCache(cache, {
      query: testQueries.POSTS,
      variables: { filter: 'B', first: 2 },
      data: mockResponses.posts(['B-1', 'B-2']).data,
    });

    // Now use slow routes and same cache; verify cached immediate resets/appends
    const slowRoutes: Route[] = [
      // A p1 (slow)
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 220,
        respond: () => mockResponses.posts(['A-1', 'A-2']),
      },
      // A p2 (slow)
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'a2' && variables.first === 2,
        delay: 220,
        respond: () => mockResponses.posts(['A-3', 'A-4']),
      },
      // A p3 (slow)
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'a4' && variables.first === 2,
        delay: 220,
        respond: () => mockResponses.posts(['A-5', 'A-6']),
      },
      // A p4 (slow)
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'a6' && variables.first === 2,
        delay: 220,
        respond: () => mockResponses.posts(['A-7', 'A-8']),
      },
      // B p1 (slow)
      {
        when: ({ variables }) => variables.filter === 'B' && !variables.after && variables.first === 2,
        delay: 220,
        respond: () => mockResponses.posts(['B-1', 'B-2']),
      },
    ];

    const App = PostsHarness('cache-and-network');
    const { wrapper, fx } = await mountWithClient(App, slowRoutes, cache);
    mocks.push(fx);

    // Load A p1 (shown from cache immediately despite slow network)
    await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    // Load A p2 (cached immediate append)
    await wrapper.setProps({ filter: 'A', first: 2, after: 'a2' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    // Load A p3 (cached immediate append)
    await wrapper.setProps({ filter: 'A', first: 2, after: 'a4' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    // Go to B (p1) — should reset view and show cached B p1 immediately
    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any); await tick(2);
    expect(liText(wrapper)).toEqual(['B-1', 'B-2']);

    // Back to A, paginate to p4 via cache; slow revalidate later
    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a2' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a4' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a6' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    // Slow revalidate completes; list should include p4
    await delay(240); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);

    wrapper.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Suspense variant of the same extended flow                                  */
/* -------------------------------------------------------------------------- */
describe('Integration • Suspense • Relay pagination reset & append from cache — extended', () => {
  const mocks: Array<{ waitAll: () => Promise<void>; restore: () => void }> = [];
  afterEach(async () => { while (mocks.length) { const m = mocks.pop()!; await m.waitAll?.(); m.restore?.(); } });

  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate (Suspense)', async () => {
    const cache = cacheConfigs.withRelay();

    // Register connection and seed via same approach as non-suspense
    {
      const AppQuick = PostsHarness('cache-and-network');
      const fast: Route[] = [{
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['A-1', 'A-2']),
      }];
      const { wrapper, fx } = await mountWithClient(AppQuick, fast, cache);
      mocks.push(fx);
      await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);
      wrapper.unmount();
    }
    await seedCache(cache, { query: testQueries.POSTS, variables: { filter: 'A', first: 2, after: 'a2' }, data: mockResponses.posts(['A-3', 'A-4']).data });
    await seedCache(cache, { query: testQueries.POSTS, variables: { filter: 'A', first: 2, after: 'a4' }, data: mockResponses.posts(['A-5', 'A-6']).data });
    await seedCache(cache, { query: testQueries.POSTS, variables: { filter: 'B', first: 2 }, data: mockResponses.posts(['B-1', 'B-2']).data });

    const slowRoutes: Route[] = [
      { when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2, delay: 220, respond: () => mockResponses.posts(['A-1', 'A-2']) },
      { when: ({ variables }) => variables.filter === 'A' && variables.after === 'a2' && variables.first === 2, delay: 220, respond: () => mockResponses.posts(['A-3', 'A-4']) },
      { when: ({ variables }) => variables.filter === 'A' && variables.after === 'a4' && variables.first === 2, delay: 220, respond: () => mockResponses.posts(['A-5', 'A-6']) },
      { when: ({ variables }) => variables.filter === 'A' && variables.after === 'a6' && variables.first === 2, delay: 220, respond: () => mockResponses.posts(['A-7', 'A-8']) },
      { when: ({ variables }) => variables.filter === 'B' && !variables.after && variables.first === 2, delay: 220, respond: () => mockResponses.posts(['B-1', 'B-2']) },
    ];

    const App = defineComponent({
      props: { filter: String, first: Number, after: String },
      setup(props) {
        return () =>
          h(Suspense, {}, {
            default: () => h(PostsHarness('cache-and-network'), { filter: props.filter, first: props.first, after: props.after })
          });
      },
    });

    const { wrapper, fx } = await mountWithClient(App, slowRoutes, cache);
    mocks.push(fx);

    await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a2' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a4' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any); await tick(2);
    expect(liText(wrapper)).toEqual(['B-1', 'B-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a2' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a4' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'a6' }); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await delay(240); await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);
  });
});

/* -------------------------------------------------------------------------- */
/* Proxy shape invariants & identity stability                                 */
/* -------------------------------------------------------------------------- */
describe('Integration • Proxy shape invariants & identity (Posts)', () => {
  it('View A (page1) and View B (page1+page2) do not fight; both stay stable & reactive', async () => {
    const cache = cacheConfigs.withRelay();

    // Routes: baseline page1 resolves first; page2 resolves a bit later
    const routes: Route[] = [
      // page 1 (baseline)
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'a1', node: { __typename: 'Post', id: 1, title: 'A-1' } },
                { cursor: 'a2', node: { __typename: 'Post', id: 2, title: 'A-2' } },
              ],
              pageInfo: { endCursor: 'a2', hasNextPage: true },
            },
          },
        }),
      },
      // page 2 (after a2)
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'a2' && variables.first === 2,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'a3', node: { __typename: 'Post', id: 3, title: 'A-3' } },
                { cursor: 'a4', node: { __typename: 'Post', id: 4, title: 'A-4' } },
              ],
              pageInfo: { endCursor: 'a4', hasNextPage: true },
            },
          },
        }),
      },
    ];

    // Execute via client (no mount) to inspect proxy shapes
    const { client, fx, cache: cacheInst } = createTestClient(routes, cache);
    const res = await client.execute({ query: testQueries.POSTS, variables: { filter: 'A', first: 2 } });
    expect(res.error).toBeFalsy();

    const conn = (res.data as any).posts;
    expect(conn && typeof conn === 'object').toBe(true);

    // edges & pageInfo containers are reactive
    expect(isReactive(conn.edges)).toBe(true);
    expect(isReactive(conn.pageInfo)).toBe(true);

    // node is a materialized entity proxy
    const node = conn.edges[0].node;
    expect(node.__typename).toBe('Post');
    expect(node.id).toBe('1'); // id gets stringified by default identify
    expect(isReactive(node)).toBe(true);

    // readFragment returns the exact same proxy object
    const same = (cacheInst as any).readFragment(`Post:${node.id}`);
    expect(node).toBe(same);

    await fx.waitAll(); fx.restore();
  });

  it('Stable identity for proxy node across multiple executions.', async () => {
    const cache = cacheConfigs.withRelay();

    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['Post 1', 'Post 2']),
      },
      // page 1 again (simulate re-exec)
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['Post 1', 'Post 2']),
      },
    ];

    const { client, fx, cache: cacheInst } = createTestClient(routes, cache);
    const r1 = await client.execute({ query: testQueries.POSTS, variables: { first: 2 } });
    const n1 = (r1.data as any).posts.edges[0].node;
    const f1 = (cacheInst as any).readFragment('Post:1');
    expect(n1).toEqual(f1);

    // second execute with same key (no after) → should still materialize the same proxy object
    const r2 = await client.execute({ query: testQueries.POSTS, variables: { first: 2 } });
    const n2 = (r2.data as any).posts.edges[0].node;
    const f2 = (cacheInst as any).readFragment('Post:1');

    // identity is stable (node proxies are shared)
    expect(n2).toBe(n1);
    expect(f2).toBe(n1);

    await fx.waitAll(); fx.restore();
  });
});
