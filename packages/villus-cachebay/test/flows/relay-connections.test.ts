import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, isReactive, Suspense } from 'vue';
import { useQuery } from 'villus';
import { relay } from '@/src';
import { tick, delay, seedCache, type Route } from '@/test/helpers';
import {
  mountWithClient,
  getListItems,
  cacheConfigs,
  mockResponses,
  testQueries,
  createTestClient
} from '@/test/helpers/integration';

/* ─────────────────────────────────────────────────────────────────────────────
 * Harnesses
 * ──────────────────────────────────────────────────────────────────────────── */
function harnessEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number, filter: String },
    setup(props) {
      const vars = computed(() => {
        const v: any = { first: props.first ?? 2, after: props.after, last: props.last, before: props.before, filter: props.filter };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });
      return () =>
        h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });
}

function harnessAnyEdges(
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
) {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number },
    setup(props) {
      const vars = computed(() => {
        const v: any = { first: props.first ?? 2, after: props.after, last: props.last, before: props.before };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });
      return () => {
        const c = (data?.value as any)?.posts || {};
        const edges = c.edges ?? c.items ?? [];
        return h('ul', {}, edges.map((e: any) => h('li', {}, (e.node?.title ?? e.item?.node?.title) || '')));
      };
    },
  });
}

const PostsHarness = (cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') => {
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

const PostsHarnessSuspense = (cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') => {
  return defineComponent({
    props: { filter: String, first: Number, after: String },

    async setup(props) {
      const vars = computed(() => {
        const v: any = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });

      const { data } = await useQuery({ query: testQueries.POSTS, variables: vars, cachePolicy });

      return () => h('ul', {}, data.value.posts.edges.map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });
}


const liText = (w: any) => getListItems(w);

/* ─────────────────────────────────────────────────────────────────────────────
 * Flows (Spec Coverage)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('Integration • Relay flows (spec coverage) • Posts', () => {
  /* 1) Modes — append/prepend/replace behavior & view sizing (by visible edges) */

  it('append mode: adds at end, bumps visible by page size', async () => {
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,

        respond: () => {
          return mockResponses.posts(['A1', 'A2'], { fromId: 1 });
        },
      },
      // page 2 (append)
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,

        respond: () => {
          return mockResponses.posts(['A3', 'A4'], { fromId: 3 });
        },
      },
    ];

    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'append' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('network-only'), routes, cache);

    await tick(4);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(6);
    expect(liText(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('prepend mode: adds at start, bumps visible by page size', async () => {
    const routes: Route[] = [
      // page 1 (baseline)
      {
        when: ({ variables }) => !variables.before && variables.first === 2,
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
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c0', node: { __typename: 'Post', id: 0, title: 'A0' } },
                { cursor: 'c0.5', node: { __typename: 'Post', id: 5 as any, title: 'A0.5' } },
              ],
              pageInfo: { startCursor: 'c0', hasPreviousPage: true },
            },
          },
        }),
      },
    ];

    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'prepend' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('network-only'), routes, cache);

    await tick(4);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ last: 2, before: 'c1' });
    await tick(6);
    expect(liText(wrapper)).toEqual(['A0', 'A0.5', 'A1', 'A2']);
  });

  it('replace mode: clears list, then shows only the latest page', async () => {
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A1', 'A2']),
      },
      // after c2
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        respond: () => mockResponses.posts(['A3', 'A4']),
      },
      // page 1 revalidate (still replace keeps only latest when asked)
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A1-new', 'A2']),
      },
    ];
    const cache = cacheConfigs.withRelay(relay({ paginationMode: 'replace' }));
    const { wrapper, fx } = await mountWithClient(harnessEdges('cache-and-network'), routes, cache);

    await tick(4);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(4);
    expect(liText(wrapper)).toEqual(['A3', 'A4']);
  });

  /* 2) Custom paths (edges=item, node=item.node, pageInfo=meta) */
  it('custom paths: edges=items, node=item.node, pageInfo=meta', async () => {
    const routes: Route[] = [{
      when: ({ variables }) => !variables.after,
      respond: () => ({
        data: {
          __typename: 'Query',
          posts: {
            __typename: 'PostConnection',
            items: [{ cursor: 'x1', item: { node: { __typename: 'Post', id: 7, title: 'X1' } } }],
            meta: { endCursor: 'x1', hasNextPage: false },
          },
        },
      }),
    }];

    const cache = cacheConfigs.withRelay(relay({ edges: 'items', node: 'item.node', pageInfo: 'meta' }));
    const { wrapper, fx } = await mountWithClient(harnessAnyEdges('network-only'), routes, cache);

    await tick(2);
    expect(liText(wrapper)).toEqual(['X1']);
  });

  /* 3) Host controlled transformations (after=append, before=prepend) */
  it('host controlled: after=append, before=prepend', async () => {
    const routes: Route[] = [
      // page 1 -> endCursor p1
      {
        when: ({ variables }) => variables.page === 'p1' && !variables.after && variables.first === 2,
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

    // initial
    await wrapper.setProps({ page: 'p1', first: 2 }); await tick(2);
    expect(liText(wrapper)).toEqual(['P1-1', 'P1-2']);

    // after -> append
    await wrapper.setProps({ first: 2, after: 'p1' }); await tick(2);
    expect(liText(wrapper)).toEqual(['P1-1', 'P1-2', 'P2-1', 'P2-2']);

    // before -> prepend
    await wrapper.setProps({ first: undefined, after: undefined, last: 2, before: 'p1' } as any); await tick(2);
    expect(liText(wrapper)).toEqual(['P0-1', 'P0-2', 'P1-1', 'P1-2', 'P2-1', 'P2-2']);
  });

  /* 4) Cursor replay hint (allow older page to apply after newer) */
  it('cursor replay: older page (after present) is allowed to apply after a newer family leader', async () => {
    const routes: Route[] = [
      // newer (no after)
      {
        when: ({ variables }) => !variables.after,
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

    await tick(2);
    expect(liText(wrapper)).toEqual(['A']);

    // enqueue older page
    await wrapper.setProps({ first: 1, after: 'n1' }); await tick(3);
    expect(liText(wrapper)).toEqual(['A', 'B']);
  });
});

/* -------------------------------------------------------------------------- */
/* Non-Suspense: Switch A→B→A then paginate again (to p4)                      */
/* -------------------------------------------------------------------------- */
describe('Integration • Relay pagination reset & append from cache — extended', () => {
  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    const cache = cacheConfigs.withRelay();


    // Seed cache

    await seedCache(cache, {
      query: testQueries.POSTS,

      variables: { filter: 'A', first: 2, after: 'c2' }, // <- was 'a2'

      data: mockResponses.posts(['A-3', 'A-4'], { fromId: 3 }).data,
    }, {
      materialize: false
    });

    //console.log(cache.__internals.graph)

    // Quick register A p1
    {
      const fast: Route[] = [{
        when: ({ variables }) => {
          return variables.filter === 'A' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-1', 'A-2'], { fromId: 1 });
        },
      }];

      const AppQuick = PostsHarness('cache-and-network');

      const { wrapper, fx } = await mountWithClient(AppQuick, fast, cache);

      await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);

      expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

      wrapper.unmount();
    }

    // Slow routes for revalidate
    const slowRoutes: Route[] = [
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-1', 'A-2'], { fromId: 1 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c2' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-3', 'A-4'], { fromId: 3 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c4' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-5', 'A-6'], { fromId: 5 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c6' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-7', 'A-8'], { fromId: 7 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c8' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-9', 'A-10'], { fromId: 9 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'B' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['B-1', 'B-2'], { fromId: 100 });
        }
      },
    ];

    const App = PostsHarness('cache-and-network');
    const { wrapper, fx } = await mountWithClient(App, slowRoutes, cache);

    await wrapper.setProps({ filter: 'A', first: 2 });
    await delay(51);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(2); // Temprorary show be seedCache
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await delay(51);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any);
    await delay(51);
    expect(liText(wrapper)).toEqual(['B-1', 'B-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any);
    await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c6' });

    await tick(2);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await delay(51);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);

    wrapper.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Suspense variant of the same extended flow                                  */
/* -------------------------------------------------------------------------- */
describe.skip('Integration • Suspense • Relay pagination reset & append from cache — extended', () => {
  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    const cache = cacheConfigs.withRelay();

    // Quick register A p1
    {
      const fast: Route[] = [{
        when: ({ variables }) => {
          return variables.filter === 'A' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-1', 'A-2'], { fromId: 1 });
        },
      }];

      const AppQuick = PostsHarness('cache-and-network');

      const { wrapper, fx } = await mountWithClient(AppQuick, fast, cache);

      await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);

      expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

      wrapper.unmount();
    }

    // Seed cache

    await seedCache(cache, {
      query: testQueries.POSTS,

      variables: { filter: 'A', first: 2, after: 'c2' }, // <- was 'a2'

      data: mockResponses.posts(['A-3', 'A-4'], { fromId: 3 }).data,
    });

    // Slow routes for revalidate
    const slowRoutes: Route[] = [
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-1', 'A-2'], { fromId: 1 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c2' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-3', 'A-4'], { fromId: 3 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c4' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-5', 'A-6'], { fromId: 5 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c6' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-7', 'A-8'], { fromId: 7 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'A' && variables.after === 'c8' && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['A-9', 'A-10'], { fromId: 9 });
        }
      },
      {
        delay: 50,

        when: ({ variables }) => {
          return variables.filter === 'B' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return mockResponses.posts(['B-1', 'B-2'], { fromId: 100 });
        }
      },
    ];

    const App = defineComponent({
      props: { filter: String, first: Number, after: String },

      setup(props) {
        return () => (
          h(Suspense, {}, {
            default: () => h(PostsHarnessSuspense('cache-and-network'), { filter: props.filter, first: props.first, after: props.after })
          })
        );
      },
    });

    const { wrapper, fx } = await mountWithClient(App, slowRoutes, cache);

    await wrapper.setProps({ filter: 'A', first: 2 });
    await delay(53);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(112); // Temprorary show be seedCache
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await delay(53);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any);
    await delay(53);
    expect(liText(wrapper)).toEqual(['B-1', 'B-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any);
    await tick(4);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(4);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await tick(4);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c6' });

    await tick(114);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    await delay(51);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);

    wrapper.unmount();
  });
});

/* -------------------------------------------------------------------------- */
/* Proxy shape invariants & identity stability                                 */
/* -------------------------------------------------------------------------- */
describe('Integration • Proxy shape invariants & identity (Posts)', () => {
  it('View A (page1) and View B (page1+page2) do not fight; both stay stable & reactive', async () => {
    const cache = cacheConfigs.withRelay();

    const routes: Route[] = [
      // page 1 (baseline)
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['A1', 'A2'], { fromId: 1 }),
      },
      // page 2 (after c2)  <-- must be c2, not a2
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c2' && variables.first === 2,
        delay: 10,
        respond: () => mockResponses.posts(['A3', 'A4'], { fromId: 3 }),
      },
    ];

    const { client, fx, cache: cacheInst } = createTestClient(routes, cache);

    // View A: baseline execute (page 1)
    const r1 = await client.execute({
      query: testQueries.POSTS,
      variables: { filter: 'A', first: 2 }
    });
    expect(r1.error).toBeFalsy();

    const connA = (r1.data as any).posts;
    expect(connA && typeof connA === 'object').toBe(true);

    // containers are reactive
    expect(isReactive(connA.edges)).toBe(true);
    expect(isReactive(connA.pageInfo)).toBe(true);
    expect(connA.edges.length).toBe(2);
    const edgesRefA = connA.edges; // keep ref to prove container reuse

    // View B: explicitly fetch page 2 (after c2)
    const r2 = await client.execute({
      query: testQueries.POSTS,
      variables: { filter: 'A', first: 2, after: 'c2' } // <-- second fetch triggers page-2 route
    });
    expect(r2.error).toBeFalsy();

    const connB = (r2.data as any).posts;

    const edgesRefB = connB.edges;

    expect(edgesRefB).not.toBe(edgesRefA); // Important
    expect(connB.edges.length).toBe(4);        // union window (4)
    expect(connB.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);

    // node is a materialized entity proxy (stable identity)
    const node = connB.edges[0].node;
    expect(node.__typename).toBe('Post');
    expect(node.id).toBe('1');
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
    // same content and identity
    expect(n1).toBe(f1);

    const r2 = await client.execute({ query: testQueries.POSTS, variables: { first: 2 } });
    const n2 = (r2.data as any).posts.edges[0].node;
    const f2 = (cacheInst as any).readFragment('Post:1');

    // identity is stable (node proxies are shared)
    expect(n2).toBe(n1);
    expect(f2).toBe(f1);

    await fx.waitAll(); fx.restore();
  });
});
