// test/integration/optimistic-limit-window.test.ts
import { describe, it, expect } from 'vitest';
import { defineComponent, h, computed } from 'vue';
import gql from 'graphql-tag';
import { useQuery } from 'villus';
import { delay, tick, type Route } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';
import { fixtures } from '@/test/helpers';

// Canonical/infinite: union semantics; limit window will control how much is shown
const POSTS_APPEND = gql`
  query PostsAppend($filter: String, $first: Int, $after: String) {
    posts(filter: $filter, first: $first, after: $after)
      @connection(mode: "inifinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

const rows = (w: any) => w.findAll('div:not(.pi)').map((d: any) => d.text());

const readPI = (w: any) => {
  const t = w.find('.pi').text();
  try { return JSON.parse(t || '{}'); } catch { return {}; }
};

const PostsHarness = (
  queryDoc: any,
  cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network'
) =>
  defineComponent({
    name: 'PostsHarness',
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: Record<string, any> = { filter: props.filter , first: props.first, after: props.after };
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () => {
        const edges = (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || '')
        );
        const pi = h(
          'div',
          { class: 'pi' },
          JSON.stringify(data?.value?.posts?.pageInfo ?? {})
        );
        return [...edges, pi];
      };
    },
  });

describe('Integration • limit window (no leader reset) + optimistic reapply', () => {
  it('full flow: pages, optimistic remove, filters, window growth, late page change', async () => {
    let requestIndex = 0;

    const routes: Route[] = [
      // 0) A page1: A1,A2,A3 (initial load)
      {
        when: () => {
          if (requestIndex === 0) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2', 'A3'], { fromId: 1 }) },
        }),
      },
      // 1) A page2: A4,A5,A6 (first time)
      {
        when: () => {
          if (requestIndex === 1) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A4', 'A5', 'A6'], { fromId: 4 }) },
        }),
      },

      {
        when: () => {
          if (requestIndex === 2) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A7', 'A8', 'A9'], { fromId: 7 }) },
        }),
      },

      {
        when: () => {
          if (requestIndex === 3) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['B1', 'B2'], { fromId: 101 }) },
        }),
      },
      // 3) A page1 revalidate (slow): A1,A2,A3
      {
        when: () => {
          if (requestIndex === 4) {
            requestIndex++;

            return true;
          }
        },
        delay: 30,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2', 'A3'], { fromId: 1 }) },
        }),
      },
      // 4) A page2 replay (fast): A4,A5,A6
      {
        when: () => {
          if (requestIndex === 5) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A4', 'A5', 'A6'], { fromId: 4 }) },
        }),
      },

      // 5) B page1 again: B1,B2
      {
        when: () => {
          if (requestIndex === 6) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['B1', 'B2'], { fromId: 101 }) },
        }),
      },
      // 6) A page1 (fast)
      {
        when: () => {
          if (requestIndex === 7) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A1', 'A2', 'A3'], { fromId: 1 }) },
        }),
      },
      // 7) A page2 (fast) — can be same as before; we’ll commit before late update
      {
        when: () => {
          if (requestIndex === 8) {
            requestIndex++;

            return true;
          }
        },
        delay: 5,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A4', 'A5', 'A6'], { fromId: 4 }) },
        }),
      },
      // 8) LATE page2 change: A4,A6,A7
      {
        when: () => {
          if (requestIndex === 9) {
            requestIndex++;

            return true;
          }
        },
        delay: 40,
        respond: () => ({
          data: { __typename: 'Query', posts: fixtures.posts.connection(['A4', 'A6', 'A7'], { fromId: 4 }) },
        }),
      },
    ];

    // 1) A page1 request
    const Comp = PostsHarness(POSTS_APPEND, 'cache-and-network');
    const { wrapper, fx, cache } = await mountWithClient(Comp, routes, undefined, { filter: 'A', first: 3, after: null });
    await delay(6);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3']);

    // 2) A page2 request
    await wrapper.setProps({ filter: 'A', first: 3, after: 'c3' });
    await delay(6);
    // With limit growth wired, window shows both pages (6 items)
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);

    // 3) optimistic remove A5 (no commit)
    const T = (cache as any).modifyOptimistic((tx: any) => {
      tx.connection({ parent: 'Query', key: 'posts', filters: { filter: 'A' }  })
        .remove({ __typename: 'Post', id: '5' });
    });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6']);

    // 4)
    await wrapper.setProps({ filter: 'A', first: 3, after: 'c6' });
    await delay(6);
    // With limit growth wired, window shows both pages (6 items)
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6', 'A7', 'A8', 'A9']);

    // 5) switch to B
    await wrapper.setProps({ filter: 'B', first: 2, after: null });
    await delay(9);
    expect(rows(wrapper)).toEqual(['B1', 'B2']);

    // 6) back to A leader — should show only first window immediately (A1,A2,A3)
    await wrapper.setProps({ filter: 'A', first: 3, after: null });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3']);

    // slow revalidate lands; still first window (no leader reset behavior)
    await delay(31);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3']);

    // 7) ask page2 again — window grows; overlay still hides A5
    await wrapper.setProps({ filter: 'A', first: 3, after: 'c3' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6']);
    await delay(6);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6']); // replay didn’t resurrect A5 due to overlay

    // 8) switch to B
    await wrapper.setProps({ filter: 'B', first: 2, after: null });
    await delay(6);
    expect(rows(wrapper)).toEqual(['B1', 'B2']);

    // 9) back to A leader — first window again
    await wrapper.setProps({ filter: 'A', first: 3, after: null });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3']);

    // 10) commit optimistic; fetch page2 again
    T.commit?.();
    await wrapper.setProps({ filter: 'A', first: 3, after: 'c3' });
    await tick(2);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6']);

    // 11) late page2 change arrives (A4,A6,A7) → add A7
    await delay(41);
    expect(rows(wrapper)).toEqual(['A1', 'A2', 'A3', 'A4', 'A6', 'A7']);

    await fx.restore?.();
  });
});
