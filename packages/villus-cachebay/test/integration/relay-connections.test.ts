// test/integration/relay-connections.test.ts
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
      @connection(mode: "infinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const POSTS_PREPEND = gql`
  query PostsPrepend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "infinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/** Page-mode → replace semantics */
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
// Harnesses
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
      return () => {
        const edges = (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || '')
        );
        const pi = h('div', { class: 'pi' }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
        return [...edges, pi];
      };
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
      return () => {
        const edges = (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || '')
        );
        const pi = h('div', { class: 'pi' }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
        return [...edges, pi];
      };
    },
  });

const rows = (w: any) => w.findAll('div:not(.pi)').map((d: any) => d.text());
const readPI = (w: any) => {
  const t = w.find('.pi').text();
  try { return JSON.parse(t || '{}'); } catch { return {}; }
};

// ─────────────────────────────────────────────────────────────────────────────
// Flows
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration • Relay flows (@connection) • Posts', () => {
  it('append mode: adds at end; pageInfo from tail (leader head, after tail)', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2'], { fromId: 1 }) } })
      },
      {
        when: ({ variables }) => variables.after === 'p2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
    ];
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);
    expect(readPI(wrapper).endCursor).toBe('p2'); // head (leader) end

    await wrapper.setProps({ first: 2, after: 'p2' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4']);
    // tail end
    expect(readPI(wrapper).endCursor).toBe('p4');

    await fx.restore?.();
  });

  it('prepend mode: adds at start; pageInfo start from head page after prepend', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.before && variables.first === 2,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2'], { fromId: 1, pageInfo: { hasPreviousPage: true, hasNextPage: true } }) }
        })
      },
      {
        when: ({ variables }) => variables.before === 'p1' && variables.last === 2,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A-1', 'A0'], { fromId: -1, pageInfo: { hasPreviousPage: false, hasNextPage: true } }) }
        })
      },
    ];
    const Comp = harnessEdges(POSTS_PREPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);
    expect(readPI(wrapper).startCursor).toBe('p1');

    await wrapper.setProps({ last: 2, before: 'p1' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A-1', 'A0', 'A1', 'A2']);
    // new head (from before page)
    expect(readPI(wrapper).startCursor).toBe('p-1');

    await fx.restore?.();
  });

  it('replace (page-mode): shows only the latest page; pageInfo follows last page', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2']) } })
      },
      {
        when: ({ variables }) => variables.after === 'p2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
      {
        when: ({ variables }) => !variables.after && variables.first === 2, // later revalidate leader
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1-new', 'A2'], { fromId: 1 }) } })
      },
    ];

    const Comp = harnessEdges(POSTS_REPLACE, 'cache-and-network');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2']);
    expect(readPI(wrapper).endCursor).toBe('p2');

    await wrapper.setProps({ first: 2, after: 'p2' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A3', 'A4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    await fx.restore?.();
  });

  it('cursor replay: after page applies after leader; pageInfo tail end', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => !variables.after,
        respond: () => ({
          data: {
            __typename: 'Query',
            posts: fixtures.posts.connection(['A'], { fromId: 1, pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: 'n1', endCursor: 'n1' } })
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
              pageInfo: { __typename: 'PageInfo', startCursor: 'n2', endCursor: 'n2', hasNextPage: false, hasPreviousPage: true },
            }
          }
        })
      },
    ];
    const Comp = harnessEdges(POSTS_APPEND, 'network-only');
    const { wrapper, fx } = await mountWithClient(Comp, routes);

    await tick(2);
    expect(rows(wrapper)).toEqual(['A']);
    expect(readPI(wrapper).endCursor).toBe('n1');

    await wrapper.setProps({ first: 1, after: 'n1' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A', 'B']);
    expect(readPI(wrapper).endCursor).toBe('n2');

    await fx.restore?.();
  });
});

describe('Integration • Relay pagination reset & append from cache — extended', () => {
  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 from cache; slow revalidate; pageInfo tail anchored', async () => {
    // Quick register A p1 + seed p2 into the same cache
    {
      const fast: Route[] = [{
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-1', 'A-2'], { fromId: 1 }) } }),
      }];

      const AppQuick = PostsHarness(POSTS_APPEND, 'cache-and-network');
      const { wrapper, fx, cache } = await mountWithClient(AppQuick, fast);

      await seedCache(cache, {
        query: POSTS_APPEND,
        variables: { filter: 'A', first: 2, after: 'p2' },
        data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) },
      });

      await wrapper.setProps({ filter: 'A', first: 2 });
      await tick(2);
      expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);
      expect(readPI(wrapper).endCursor).toBe('p2');

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
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'p2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'p4' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-5', 'A-6'], { fromId: 5 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'p6' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A-7', 'A-8'], { fromId: 7 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'p8' && variables.first === 2,
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

    await seedCache(cache, {
      query: POSTS_APPEND,
      variables: { filter: 'A', first: 2, after: 'p2' },
      data: { __typename: 'Query', posts: fixtures.posts.connection(['A-3', 'A-4'], { fromId: 3 }) },
    });

    // A leader
    await wrapper.setProps({ filter: 'A', first: 2 });
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);
    expect(readPI(wrapper).endCursor).toBe('p2');

    // A after p2 — union p1+p2
    await wrapper.setProps({ filter: 'A', first: 2, after: 'p2' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    // A after p4 — union grows with p3
    await wrapper.setProps({ filter: 'A', first: 2, after: 'p4' });
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    // Switch to B
    await wrapper.setProps({ filter: 'B', first: 2, after: undefined } as any);
    await delay(51);
    expect(rows(wrapper)).toEqual(['B-1', 'B-2']);
    expect(readPI(wrapper).endCursor).toBe('p101');

    // Back to A leader — leader slice
    await wrapper.setProps({ filter: 'A', first: 2, after: undefined } as any);
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await delay(53)

    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2']);
    expect(readPI(wrapper).endCursor).toBe('p2');

    // A after p2 — union p1+p2
    await wrapper.setProps({ filter: 'A', first: 2, after: 'p2' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    await delay(53)

    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    // A after p4 — union p1+p2+p3
    await wrapper.setProps({ filter: 'A', first: 2, after: 'p4' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await delay(53)

    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    // A after p6 — slow grow with p4
    await wrapper.setProps({ filter: 'A', first: 2, after: 'p6' });
    await tick(2);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');
    await delay(51);
    expect(rows(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);
    expect(readPI(wrapper).endCursor).toBe('p8');

    wrapper.unmount();
    await fx.restore?.();
  });
});

/* -------------------------------------------------------------------------- */
/* Proxy shape invariants & identity stability */
/* -------------------------------------------------------------------------- */
describe('Integration • Proxy shape invariants & identity (Posts)', () => {
  it('View A (page1) and View B (page1+page2) stable & reactive (edges reactive, pageInfo not)', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.filter === 'A' && !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2'], { fromId: 1 }) } })
      },
      {
        when: ({ variables }) => variables.filter === 'A' && variables.after === 'p2' && variables.first === 2,
        delay: 10, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.connection(['A3', 'A4'], { fromId: 3 }) } })
      },
    ];

    const { client, fx, cache } = createTestClient(routes);

    const r1 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2 } });
    const connA = (r1.data as any).posts;
    expect(isReactive(connA.edges[0])).toBe(true);
    expect(isReactive(connA.pageInfo)).toBe(false);
    const edgesRefA = connA.edges;

    const r2 = await client.execute({ query: POSTS_APPEND, variables: { filter: 'A', first: 2, after: 'p2' } });
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

  it('Stable proxy node identity across executions', async () => {
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
