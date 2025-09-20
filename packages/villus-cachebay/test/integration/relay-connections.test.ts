import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed, isReactive } from 'vue';
import gql from 'graphql-tag';
import { useQuery } from 'villus';

import { delay, tick, seedCache, type Route } from '@/test/helpers';
import { mountWithClient, createTestClient } from '@/test/helpers/integration';
import { fixtures } from '@/test/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Queries (@connection)
// ─────────────────────────────────────────────────────────────────────────────

const POSTS_APPEND = gql`
  query PostsAppend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "append", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const POSTS_PREPEND = gql`
  query PostsPrepend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "prepend", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/**
 * IMPORTANT: page-mode is the only “replace” semantics in the runtime.
 * So we use mode:"page" here (not "replace").
 */
const POSTS_REPLACE = gql`
  query PostsReplace($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "page", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const FRAG_POST = gql`fragment P on Post { __typename id title }`;

// ─────────────────────────────────────────────────────────────────────────────
// Small harness (rows are <div>, no <ul>/<li>)
// ─────────────────────────────────────────────────────────────────────────────

function harnessEdges(
  queryDoc: any,
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only'
) {
  return defineComponent({
    name: 'EdgesHarness',
    props: { after: String, before: String, first: Number, last: Number, filter: String },
    setup(props) {
      const vars = computed(() => {
        const v: Record<string, any> = {
          first: props.first ?? 2,
          after: props.after,
          last: props.last,
          before: props.before,
          filter: props.filter,
        };
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () => (data?.value?.posts?.edges ?? []).map((e: any) => h('div', {}, e?.node?.title || ''));
    },
  });
}

const PostsHarness = (
  queryDoc: any,
  cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network'
) =>
  defineComponent({
    name: 'PostsHarness',
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: Record<string, any> = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () => (data?.value?.posts?.edges ?? []).map((e: any) => h('div', {}, e?.node?.title || ''));
    },
  });

const rows = (w: any) => w.findAll('div').map((d: any) => d.text());

// ─────────────────────────────────────────────────────────────────────────────
// Flows
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration • Relay flows (@connection) • Posts', () => {
  it('append mode: adds at end, bumps visible by page size', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2'], { fromId: 1 }) } })
      },
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
    ];
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4']);

    await fx.restore?.();
  });

  it('prepend mode: adds at start, bumps visible by page size', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.before && variables.first === 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'Post', id: 1, title: 'A1' } },
                { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'Post', id: 2, title: 'A2' } },
              ],
              pageInfo: { __typename: 'PageInfo', startCursor: 'c1', endCursor: 'c2', hasPreviousPage: true, hasNextPage: true },
            }
          }
        })
      },
      {
        when: ({ variables }) => variables.before === 'c1' && variables.last === 2,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [
                { __typename: 'PostEdge', cursor: 'c0', node: { __typename: 'Post', id: 0, title: 'A0' } },
                { __typename: 'PostEdge', cursor: 'c0.5', node: { __typename: 'Post', id: 5, title: 'A0.5' } },
              ],
              pageInfo: { __typename: 'PageInfo', startCursor: 'c0', hasPreviousPage: true, hasNextPage: true },
            }
          }
        })
      },
    ];
    const Comp = harnessEdges(POSTS_PREPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ last: 2, before: 'c1' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A0', 'A0.5', 'A1', 'A2']);

    await fx.restore?.();
  });

  it('replace (page-mode): clears list, then shows only the latest page', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2']) } })
      },
      {
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
      // revalidate leader later (still page-mode → last fetched replaces)
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1-new', 'A2'], { fromId: 1 }) } })
      },
    ];

    const Comp = harnessEdges(POSTS_REPLACE, 'cache-and-network');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);

    await wrapper.setProps({ first: 2, after: 'c2' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A3', 'A4']); // page-mode replaces with last page

    await fx.restore?.();
  });

  it('cursor replay: older page (after present) is allowed to apply after a newer leader', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [{ __typename: 'PostEdge', cursor: 'n1', node: { __typename: 'Post', id: 1, title: 'A' } }],
              pageInfo: { __typename: 'PageInfo' },
            }
          }
        })
      },
      {
        when: ({ variables }) => variables.after === 'n1',
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: {
              __typename: 'PostConnection',
              edges: [{ __typename: 'PostEdge', cursor: 'n2', node: { __typename: 'Post', id: 2, title: 'B' } }],
              pageInfo: { __typename: 'PageInfo' },
            }
          }
        })
      },
    ];
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A']);

    await wrapper.setProps({ first: 1, after: 'n1' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A', 'B']);

    await fx.restore?.();
  });
});

describe('Integration • Relay pagination reset & append from cache — extended', () => {
  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 with cached append, then slow revalidate', async () => {
    // Quick register A p1 in its own mount (cache-and-network)
    {
      const fast: Route[] = [{
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-1', 'A-2'], { fromId: 1 }) } }),
      }];

      const AppQuick = PostsHarness(POSTS_APPEND, 'cache-and-network');
      const { wrapper, fx, cache } = await mountWithClient(AppQuick, fast);

      // seed page-2 for A into THIS cache
      await seedCache(cache, {
        query: POSTS_APPEND,
        variables: { filter: 'A', first: 2, after: 'c2' },
        data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) },
      });

      await wrapper.setProps({ filter: 'A', first: 2 });
      await tick(2);

      expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);

      wrapper.unmount();
      await fx.restore?.();
    }

    // Slow revalidate routes for second mount
    const slowRoutes: Route[] = [
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-1', 'A-2'], { fromId: 1 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c4' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-5', 'A-6'], { fromId: 5 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c6' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-7', 'A-8'], { fromId: 7 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c8' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-9', 'A-10'], { fromId: 9 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'B' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['B-1', 'B-2'], { fromId: 100 }) } }),
      },
    ];

    const App = PostsHarness(POSTS_APPEND, 'cache-and-network');
    const { wrapper, fx, cache } = await mountWithClient(App, slowRoutes);

    // seed cached page-2 for A into THIS cache as well
    await seedCache(cache, {
      query: POSTS_APPEND,
      variables: { filter: 'A', first: 2, after: 'c2' },
      data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) },
    });

    // A leader — union may list p2 before p1 (order not guaranteed)
    await wrapper.setProps({ filter: 'A', first: 2 });
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);

    // A after c2 — union p1+p2
    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    // A after c4 — union grows with p3
    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    // Switch to B
    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any);
    await delay(51);
    expect(rows(wrapper)).toEqual(['B-1', 'B-2']);

    // Back to A leader — canonical union still includes previously fetched p3
    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any);
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);

    // A after c2 — union p1+p2
    await wrapper.setProps({ filter: 'A', first: 2, after: 'c2' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);

    // A after c4 — union p1+p2+p3
    await wrapper.setProps({ filter: 'A', first: 2, after: 'c4' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);

    // A after c6 — revalidate slow then grow union with p4
    await wrapper.setProps({ filter: 'A', first: 2, after: 'c6' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);

    wrapper.unmount();
    await fx.restore?.();
  });
});

/* -------------------------------------------------------------------------- */
/* Proxy shape invariants & identity stability                                 */
/* -------------------------------------------------------------------------- */
describe('Integration • Proxy shape invariants & identity (Posts)', () => {
  it('View A (page1) and View B (page1+page2) do not fight; both stay stable & reactive (edges reactive, pageInfo not)', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2'], { fromId: 1 }) } })
      },
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'c2' && variables.first === 2,
        delay: 10, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
    ];

    const { client, fx, cache } = createTestClient(routes);

    const r1 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2 } });
    expect(r1.error).toBeFalsy();
    const connA = (r1.data as any).posts;

    expect(isReactive(connA.edges[0])).toBe(true);
    expect(isReactive(connA.pageInfo)).toBe(false);

    const edgesRefA = connA.edges;

    const r2 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2, after: 'c2' } });
    const connB = (r2.data as any).posts;
    const edgesRefB = connB.edges;

    expect(edgesRefB).not.toBe(edgesRefA);
    expect(connB.edges.length).toBe(4);
    expect(connB.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);

    const node = connB.edges[0].node;
    const same = (cache as any).readFragment({ id: `Post:${node.id}`, fragment: FRAG_POST });
    expect(isReactive(node)).toBe(true);
    expect(same.id).toBe(node.id);

    await fx.restore?.();
  });

  it('Stable identity for proxy node across multiple executions.', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['Post 1', 'Post 2']) } })
      },
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['Post 1', 'Post 2']) } })
      },
    ];

    const { client, fx, cache } = createTestClient(routes);

    const r1 = await client.execute({ query: POSTS_APPEND, variables: { first: 2 } });
    const n1 = (r1.data as any).posts.edges[0].node;
    const f1 = (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST });
    expect(n1.id).toBe(f1.id);

    const r2 = await client.execute({ query: POSTS_APPEND, variables: { first: 2 } });
    const n2 = (r2.data as any).posts.edges[0].node;
    const f2 = (cache as any).readFragment({ id: 'Post:1', fragment: FRAG_POST });

    expect(n2.id).toBe(n1.id);
    expect(f2.id).toBe(f1.id);

    await fx.restore?.();
  });
});
