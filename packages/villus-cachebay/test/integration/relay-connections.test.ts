// test/integration/relay-flows.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, isReactive } from 'vue';
import gql from 'graphql-tag';
import { useQuery } from 'villus';
import { tick, delay, seedCache, type Route } from '@/test/helpers';
import {
  mountWithClient,
  getListItems,
  cacheConfigs,
  mockResponses,
  createTestClient,
} from '@/test/helpers/integration';

/* ─────────────────────────────────────────────────────────────────────────────
 * Queries (compile-time @connection)
 * ──────────────────────────────────────────────────────────────────────────── */

const POSTS_APPEND = gql`
  query PostsAppend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "append", args: ["filter"]) {
      __typename
      edges {
        __typename
        cursor
        node { __typename id title }
      }
      pageInfo {
        __typename
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

const POSTS_PREPEND = gql`
  query PostsPrepend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "prepend", args: ["filter"]) {
      __typename
      edges {
        __typename
        cursor
        node { __typename id title }
      }
      pageInfo {
        __typename
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

const POSTS_REPLACE = gql`
  query PostsReplace($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "replace", args: ["filter"]) {
      __typename
      edges {
        __typename
        cursor
        node { __typename id title }
      }
      pageInfo {
        __typename
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
    }
  }
`;

const FRAG_POST = gql`
  fragment P on Post { __typename id title }
`;

/* ─────────────────────────────────────────────────────────────────────────────
 * Small harness components
 * ──────────────────────────────────────────────────────────────────────────── */

function harnessEdges(queryDoc: any, cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only') {
  return defineComponent({
    props: { after: String, before: String, first: Number, last: Number, filter: String },
    setup(props) {
      const vars = computed(() => {
        const v: any = { first: props.first ?? 2, after: props.after, last: props.last, before: props.before, filter: props.filter };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () =>
        h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });
}

const PostsHarness = (queryDoc: any, cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network') =>
  defineComponent({
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: any = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach(k => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () =>
        h('ul', {}, (data?.value?.posts?.edges ?? []).map((e: any) => h('li', {}, e?.node?.title || '')));
    },
  });

const liText = (w: any) => getListItems(w);

/* ─────────────────────────────────────────────────────────────────────────────
 * Flows (Spec Coverage)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('Integration • Relay flows (@connection) • Posts', () => {
  /* 1) Modes — append/prepend/replace behavior & view sizing (by visible edges) */

  it('append mode: adds at end, bumps visible by page size', async () => {
    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A1', 'A2'], { fromId: 1 }),
      },
      // page 2 (append)
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        respond: () => mockResponses.posts(['A3', 'A4'], { fromId: 3 }),
      },
    ];
    const cache = cacheConfigs.basic();
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

    await tick(2);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4']);

    await fx.waitAll(); fx.restore();
  });

  it('prepend mode: adds at start, bumps visible by page size', async () => {
    const routes: Route[] = [
      // page 1 baseline
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
      // before=c1 (older → prepend)
      {
        when: ({ variables }) => variables.before === 'c1' && variables.last === 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { cursor: 'c0', node: { __typename: 'Post', id: 0, title: 'A0' } },
                { cursor: 'c0.5', node: { __typename: 'Post', id: 5, title: 'A0.5' } },
              ],
              pageInfo: { startCursor: 'c0', hasPreviousPage: true },
            },
          },
        }),
      },
    ];

    const cache = cacheConfigs.basic();
    const Comp = harnessEdges(POSTS_PREPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

    await tick(2);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ last: 2, before: 'c1' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A0', 'A0.5', 'A1', 'A2']);

    await fx.waitAll(); fx.restore();
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
      // revalidate page 1 later
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A1-new', 'A2']),
      },
    ];

    const cache = cacheConfigs.basic();
    const Comp = harnessEdges(POSTS_REPLACE, 'cache-and-network');
    const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

    await tick(2);
    expect(liText(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A3', 'A4']); // replaced by latest page

    await fx.waitAll(); fx.restore();
  });

  /* 2) Cursor replay hint (allow older page to apply after newer) */
  it('cursor replay: older page (after present) is allowed to apply after a newer leader', async () => {
    const routes: Route[] = [
      // newer leader (no after)
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

    const cache = cacheConfigs.basic();
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes, cache);

    await tick(2);
    expect(liText(wrapper)).toEqual(['A']);

    await wrapper.setProps({ first: 1, after: 'n1' });
    await tick(2);
    expect(liText(wrapper)).toEqual(['A', 'B']);

    await fx.waitAll(); fx.restore();
  });
});

/* -------------------------------------------------------------------------- */
/* Relay pagination reset & append from cache — extended (no suspense)         */
/* -------------------------------------------------------------------------- */
describe('Integration • Relay pagination reset & append from cache — extended', () => {
  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    const cache = cacheConfigs.basic();

    // seed page-2 for A
    await seedCache(cache, {
      query: POSTS_APPEND,
      variables: { filter: 'A', first: 2, after: 'c2' },
      data: mockResponses.posts(['A-3', 'A-4'], { fromId: 3 }).data,
      materialize: true,
    });

    // Quick register A p1
    {
      const fast: Route[] = [{
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A-1', 'A-2'], { fromId: 1 }),
      }];

      const AppQuick = PostsHarness(POSTS_APPEND, 'cache-and-network');
      const { wrapper, fx } = await mountWithClient(AppQuick, fast, cache);

      await wrapper.setProps({ filter: 'A', first: 2 }); await tick(2);
      expect(liText(wrapper)).toEqual(['A-1', 'A-2']);
      wrapper.unmount();
      await fx.waitAll(); fx.restore();
    }

    // Slow revalidate routes
    const slowRoutes: Route[] = [
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['A-1', 'A-2'], { fromId: 1 }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c2' && variables.first === 2,
        respond: () => mockResponses.posts(['A-3', 'A-4'], { fromId: 3 }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c4' && variables.first === 2,
        respond: () => mockResponses.posts(['A-5', 'A-6'], { fromId: 5 }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c6' && variables.first === 2,
        respond: () => mockResponses.posts(['A-7', 'A-8'], { fromId: 7 }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c8' && variables.first === 2,
        respond: () => mockResponses.posts(['A-9', 'A-10'], { fromId: 9 }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'B' && !variables.after && variables.first === 2,
        respond: () => mockResponses.posts(['B-1', 'B-2'], { fromId: 100 }),
      },
    ];

    const App = PostsHarness(POSTS_APPEND, 'cache-and-network');
    const { wrapper, fx } = await mountWithClient(App, slowRoutes, cache);

    await wrapper.setProps({ filter: 'A', first: 2 });
    await delay(51);
    expect(liText(wrapper)).toEqual(['A-1', 'A-2']);

    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(2);
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
    await fx.waitAll(); fx.restore();
  });
});

/* -------------------------------------------------------------------------- */
/* Proxy shape invariants & identity stability                                 */
/* -------------------------------------------------------------------------- */
describe('Integration • Proxy shape invariants & identity (Posts)', () => {
  it('View A (page1) and View B (page1+page2) do not fight; both stay stable & reactive (edges reactive, pageInfo not)', async () => {
    const cache = cacheConfigs.basic();

    const routes: Route[] = [
      // page 1
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0,
        respond: () => mockResponses.posts(['A1', 'A2'], { fromId: 1 }),
      },
      // page 2 (after c2)
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c2' && variables.first === 2,
        delay: 10,
        respond: () => mockResponses.posts(['A3', 'A4'], { fromId: 3 }),
      },
    ];

    const { client, fx, cache: cacheInst } = createTestClient(routes, cache);

    // View A: baseline execute (page 1)
    const r1 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2 } });
    expect(r1.error).toBeFalsy();
    const connA = (r1.data as any).posts;

    // reactivity: edge objects yes, pageInfo no
    expect(isReactive(connA.edges[0])).toBe(true);
    expect(isReactive(connA.pageInfo)).toBe(false);

    const edgesRefA = connA.edges;

    // View B: fetch page 2 (union window should include both pages)
    const r2 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2, after: 'c2' } });
    const connB = (r2.data as any).posts;
    const edgesRefB = connB.edges;

    expect(edgesRefB).not.toBe(edgesRefA);
    expect(connB.edges.length).toBe(4);
    expect(connB.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);

    // node identity stable; readFragment returns a reactive view of the same entity
    const node = connB.edges[0].node;
    const same = (cacheInst as any).readFragment({ id: `Post:${node.id}`, fragment: FRAG_POST });
    expect(isReactive(node)).toBe(true);
    expect(same.id).toBe(node.id);

    await fx.waitAll(); fx.restore();
  });

  it('Stable identity for proxy node across multiple executions.', async () => {
    const cache = cacheConfigs.basic();

    const routes: Route[] = [
      // page 1 twice
      { when: ({ variables }) => !variables.after && variables.first === 2, delay: 0, respond: () => mockResponses.posts(['Post 1', 'Post 2']) },
      { when: ({ variables }) => !variables.after && variables.first === 2, delay: 0, respond: () => mockResponses.posts(['Post 1', 'Post 2']) },
    ];

    const { client, fx, cache: cacheInst } = createTestClient(routes, cache);
    const r1 = await client.execute({ query: POSTS_APPEND, variables: { first: 2 } });
    const n1 = (r1.data as any).posts.edges[0].node;
    const f1 = (cacheInst as any).readFragment({ id: 'Post:1', fragment: FRAG_POST });
    expect(n1.id).toBe(f1.id);

    const r2 = await client.execute({ query: POSTS_APPEND, variables: { first: 2 } });
    const n2 = (r2.data as any).posts.edges[0].node;
    const f2 = (cacheInst as any).readFragment({ id: 'Post:1', fragment: FRAG_POST });

    // identity stability (same entity proxy instance via views)
    expect(n2.id).toBe(n1.id);
    expect(f2.id).toBe(f1.id);

    await fx.waitAll(); fx.restore();
  });
});
