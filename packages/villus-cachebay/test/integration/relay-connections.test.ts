import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, seedCache, getPageInfo, getEdges, fixtures, operations, delay, tick } from '@/test/helpers';

describe('Relay connections', () => {
  it('append mode: adds at end; pageInfo from tail (leader head, after tail)', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return !variables.after && variables.first === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',
              posts: fixtures.posts.buildConnection([{ id: 'p1', title: 'A1' }, { id: 'p2', title: 'A2' }], { hasNextPage: true }),
            }
          };
        }
      },

      {
        when: ({ variables }) => {
          return variables.after === 'p2' && variables.first === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',
              posts: fixtures.posts.buildConnection([{ id: 'p3', title: 'A3' }, { id: 'p4', title: 'A4' }]),
            }
          };
        }
      },
    ];

    const { client, cache } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const wrapper = mount(Cmp, {
      props: {
        first: 2,
        after: null,
      },

      global: {
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false });

    wrapper.setProps({ first: 2, after: 'p2' });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });
  });

  it('prepend mode: adds at start; pageInfo start from head page after prepend', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return !variables.before && variables.last === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',

              posts: fixtures.posts.buildConnection([{ id: 'p3', title: 'A3' }, { id: 'p4', title: 'A4' }], { hasPreviousPage: true }),
            }
          }
        },
      },

      {
        when: ({ variables }) => {
          return variables.before === 'p3' && variables.last === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',

              posts: fixtures.posts.buildConnection([{ id: 'p1', title: 'A1' }, { id: 'p2', title: 'A2' }]),
            }
          }
        },
      },
    ];
    const { client, cache } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const wrapper = mount(Cmp, {
      props: {
        last: 2,
        before: null,
      },

      global: {
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A3", "A4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: 'p3', endCursor: 'p4', hasNextPage: false, hasPreviousPage: true });

    wrapper.setProps({ last: 2, before: 'p3' });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: 'p1', endCursor: 'p4', hasNextPage: false, hasPreviousPage: false });
  });

  it.only('replace (page-mode): shows only the latest page; pageInfo follows last page', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return !variables.after && variables.first === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',
              posts: fixtures.posts.buildConnection([{ id: 'p1', title: 'A1' }, { id: 'p2', title: 'A2' }], { hasNextPage: true }),
            }
          };
        }
      },

      {
        when: ({ variables }) => {
          return variables.after === 'p2' && variables.first === 2;
        },

        respond: () => {
          return {
            data: {
              __typename: 'Query',
              posts: fixtures.posts.buildConnection([{ id: 'p3', title: 'A3' }, { id: 'p4', title: 'A4' }]),
            }
          };
        }
      },
    ];

    const { client, cache } = createTestClient({ routes });

    const Cmp = createConnectionComponent(operations.POSTS_WITH_PAGE_QUERY, {
      cachePolicy: "cache-and-network",

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const wrapper = mount(Cmp, {
      props: {
        first: 2,
        after: null,
      },

      global: {
        plugins: [client, cache],
      },
    });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: 'p1', endCursor: 'p2', hasNextPage: true, hasPreviousPage: false });

    wrapper.setProps({ first: 2, after: 'p2' });

    await tick();
    expect(getEdges(wrapper, "title")).toEqual(["A3", "A4"]);
    expect(getPageInfo(wrapper)).toEqual({ startCursor: 'p3', endCursor: 'p4', hasNextPage: false, hasPreviousPage: false });
  });

  it('A→(p2,p3) → B → A (reset) → paginate p2,p3,p4 from cache; slow revalidate; pageInfo tail anchored', async () => {

    {
      const fast = [{
        when: ({ variables }) => variables.category === 'A' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-1', 'A-2'], { fromId: 1 }) } }),
      }];

      const AppQuick = PostsHarness(operations.POSTS_QUERY, 'cache-and-network');
      const { wrapper, fx, cache } = await mountWithClient(AppQuick, fast);

      await seedCache(cache, {
        query: operations.POSTS_QUERY,
        variables: { category: 'A', first: 2, after: 'p2' },
        data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-3', 'A-4'], { fromId: 3 }) },
      });

      await wrapper.setProps({ category: 'A', first: 2 });
      await tick(2);
      expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2']);
      expect(readPI(wrapper).endCursor).toBe('p2');

      wrapper.unmount();
      await fx.restore?.();
    }

    const slowRoutes = [
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'A' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-1', 'A-2'], { fromId: 1 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'A' && variables.after === 'p2' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-3', 'A-4'], { fromId: 3 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'A' && variables.after === 'p4' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-5', 'A-6'], { fromId: 5 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'A' && variables.after === 'p6' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-7', 'A-8'], { fromId: 7 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'A' && variables.after === 'p8' && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-9', 'A-10'], { fromId: 9 }) } }),
      },
      {
        delay: 50,
        when: ({ variables }) => variables.category === 'B' && !variables.after && variables.first === 2,
        respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['B-1', 'B-2'], { fromId: 100 }) } }),
      },
    ];

    const App = PostsHarness(operations.POSTS_QUERY, 'cache-and-network');
    const { wrapper, fx, cache } = await mountWithClient(App, slowRoutes);

    await seedCache(cache, {
      query: operations.POSTS_QUERY,
      variables: { category: 'A', first: 2, after: 'p2' },
      data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A-3', 'A-4'], { fromId: 3 }) },
    });

    await wrapper.setProps({ category: 'A', first: 2 });
    await delay(51);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2']);
    expect(readPI(wrapper).endCursor).toBe('p2');

    await wrapper.setProps({ category: 'A', first: 2, after: 'p2' });
    await tick(2);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    await wrapper.setProps({ category: 'A', first: 2, after: 'p4' });
    await delay(51);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await wrapper.setProps({ category: 'B', first: 2, after: undefined } as any);
    await delay(51);
    expect(rowsRelayConnections(wrapper)).toEqual(['B-1', 'B-2']);
    expect(readPI(wrapper).endCursor).toBe('p101');

    await wrapper.setProps({ category: 'A', first: 2, after: undefined } as any);
    await tick(2);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await delay(53)

    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2']);
    expect(readPI(wrapper).endCursor).toBe('p2');

    await wrapper.setProps({ category: 'A', first: 2, after: 'p2' });
    await tick(2);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    await delay(53)

    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4']);
    expect(readPI(wrapper).endCursor).toBe('p4');

    await wrapper.setProps({ category: 'A', first: 2, after: 'p4' });
    await tick(2);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await delay(53)

    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');

    await wrapper.setProps({ category: 'A', first: 2, after: 'p6' });
    await tick(2);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
    expect(readPI(wrapper).endCursor).toBe('p6');
    await delay(51);
    expect(rowsRelayConnections(wrapper).slice()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8']);
    expect(readPI(wrapper).endCursor).toBe('p8');

    wrapper.unmount();
    await fx.restore?.();
  });

  it('View A (page1) and View B (page1+page2) stable & reactive (edges reactive, pageInfo not)', async () => {
    const routes = [
      {
        when: ({ variables }) => variables.category === 'A' && !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A1', 'A2'], { fromId: 1 }) } })
      },
      {
        when: ({ variables }) => variables.category === 'A' && variables.after === 'p2' && variables.first === 2,
        delay: 10, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['A3', 'A4'], { fromId: 3 }) } })
      },
    ];

    const { client, fx, cache } = createTestClient(routes);

    const r1 = await client.execute({ query: operations.POSTS_QUERY, variables: { category: 'A', first: 2 } });
    const connA = (r1.data as any).posts;
    expect(isReactive(connA.edges[0])).toBe(true);
    expect(isReactive(connA.pageInfo)).toBe(false);
    const edgesRefA = connA.edges;

    const r2 = await client.execute({ query: operations.POSTS_QUERY, variables: { category: 'A', first: 2, after: 'p2' } });
    const connB = (r2.data as any).posts;
    const edgesRefB = connB.edges;

    expect(edgesRefB).not.toBe(edgesRefA);
    expect(connB.edges.length).toBe(4);
    expect(connB.edges.map((e: any) => e.node.title)).toEqual(['A1', 'A2', 'A3', 'A4']);

    const node = connB.edges[0].node;
    const same = (cache as any).readFragment({ id: `Post:${node.id}`, fragment: operations.POST_FRAGMENT });
    expect(isReactive(node)).toBe(true);
    expect(same.id).toBe(node.id);

    await fx.restore?.();
  });

  it('Stable proxy node identity across executions', async () => {
    const routes = [
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['Post 1', 'Post 2']) } })
      },
      {
        when: ({ variables }) => !variables.after && variables.first === 2,
        delay: 0, respond: () => ({ data: { __typename: 'Query', posts: fixtures.posts.buildConnection(['Post 1', 'Post 2']) } })
      },
    ];

    const { client, fx, cache } = createTestClient(routes);

    const r1 = await client.execute({ query: operations.POSTS_QUERY, variables: { first: 2 } });
    const n1 = (r1.data as any).posts.edges[0].node;
    const f1 = (cache as any).readFragment({ id: 'Post:1', fragment: operations.POST_FRAGMENT });
    expect(n1.id).toBe(f1.id);

    const r2 = await client.execute({ query: operations.POSTS_QUERY, variables: { first: 2 } });
    const n2 = (r2.data as any).posts.edges[0].node;
    const f2 = (cache as any).readFragment({ id: 'Post:1', fragment: operations.POST_FRAGMENT });

    expect(n2.id).toBe(n1.id);
    expect(f2.id).toBe(f1.id);

    await fx.restore?.();
  });
});
