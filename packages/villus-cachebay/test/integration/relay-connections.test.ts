import { isReactive } from 'vue';
import { mount } from '@vue/test-utils';
import { createTestClient, createConnectionComponent, seedCache, getPageInfo, getEdges, fixtures, operations, delay, tick } from '@/test/helpers';

describe('Relay connections', () => {
  it('appends new pages at end and updates pageInfo from tail cursor', async () => {
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

  it('prepends new pages at start and updates pageInfo from head cursor', async () => {
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

  it('replaces connection with latest page and updates pageInfo accordingly', async () => {
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

  it('maintains stable reactive edges while keeping pageInfo non-reactive across views', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.category === 'A' && !variables.after && variables.first === 2;
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
          return variables.category === 'A' && variables.after === 'p2' && variables.first === 2;
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

    const response1 = await client.execute({ query: operations.POSTS_QUERY, variables: { category: 'A', first: 2 } });
    const connection1 = response1.data.posts;
    const edgesRef1 = connection1.edges;

    expect(isReactive(connection1.pageInfo)).toBe(false);
    expect(isReactive(connection1.edges)).toBe(false);
    expect(isReactive(connection1.edges[0])).toBe(true);
    expect(isReactive(connection1.edges[1])).toBe(true);

    const response2 = await client.execute({ query: operations.POSTS_QUERY, variables: { category: 'A', first: 2, after: 'p2' } });
    const connection2 = response2.data.posts;
    const edgesRef2 = connection2.edges;

    expect(edgesRef2).not.toBe(edgesRef1);

    const post1 = connection2.edges[0].node;
    const postFragment1 = cache.readFragment({ id: `Post:p1`, fragment: operations.POST_FRAGMENT });

    expect(isReactive(post1)).toBe(true);
    expect(postFragment1).toEqual(post1);
  });

  it('handles complex pagination flow with caching, filtering, and network revalidation', async () => {
    const routes = [
      {
        when: ({ variables }) => {
          return variables.category === 'A' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pa1', title: 'A1' }, { id: 'pa2', title: 'A2' }]) } };
        },

        delay: 50,
      },

      {
        when: ({ variables }) => {
          return variables.category === 'A' && variables.after === 'pa2' && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pa3', title: 'A3' }, { id: 'pa4', title: 'A4' }]) } };
        },

        delay: 50,
      },

      {
        when: ({ variables }) => {
          return variables.category === 'A' && variables.after === 'pa4' && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pa5', title: 'A5' }, { id: 'pa6', title: 'A6' }]) } };
        },

        delay: 50,
      },

      {
        when: ({ variables }) => {
          return variables.category === 'A' && variables.after === 'pa6' && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pa7', title: 'A7' }, { id: 'pa8', title: 'A8' }]) } };
        },

        delay: 50,
      },

      {
        when: ({ variables }) => {
          return variables.category === 'A' && variables.after === 'pa8' && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pa9', title: 'A9' }, { id: 'pa10', title: 'A10' }]) } };
        },

        delay: 50,
      },

      {
        when: ({ variables }) => {
          return variables.category === 'B' && !variables.after && variables.first === 2;
        },

        respond: () => {
          return { data: { __typename: 'Query', posts: fixtures.posts.buildConnection([{ id: 'pb3', title: 'B1' }, { id: 'pb4', title: 'B2' }]) } };
        },

        delay: 50,
      },
    ];

    const { client, cache } = createTestClient({ routes });

    await seedCache(cache, {
      query: operations.POSTS_QUERY,

      variables: {
        category: 'A',
        first: 2,
        after: 'pa2',
      },

      data: {
        __typename: 'Query',

        posts: fixtures.posts.buildConnection([{ id: 'pa3', title: 'A3' }, { id: 'pa4', title: 'A4' }]),
      },
    });

    const Cmp = createConnectionComponent(operations.POSTS_QUERY, {
      cachePolicy: "cache-and-network",

      connectionFn: (data) => {
        return data.posts;
      }
    });

    const wrapper = mount(Cmp, {
      props: {
        category: 'A',
        first: 2,
        after: null,
      },

      global: {
        plugins: [client, cache],
      },
    });

    // 1. Initial load: empty while network request is pending
    await tick()
    expect(getEdges(wrapper, "title")).toEqual([]);

    await delay(51);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

    // 2. Paginate: load second page after 'pa2' (cached data available immediately)
    wrapper.setProps({ category: 'A', first: 2, after: 'pa2' });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);

    await delay(51);
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);

    // 3. Continue pagination: load third page after 'pa4'
    wrapper.setProps({ category: 'A', first: 2, after: 'pa4' });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);

    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 4. Filter switch: change to category B posts
    wrapper.setProps({ category: 'B', first: 2, after: null });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["B1", "B2"]);

    // 5. Filter back: return to category A (cached state preserved)
    wrapper.setProps({ category: 'A', first: 2, after: null });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 6. Network revalidation: server overwrites cached state
    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2"]);

    // 7. Re-paginate: load second page again (cached data available)
    wrapper.setProps({ category: 'A', first: 2, after: 'pa2' });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);

    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4"]);

    // 8. Continue pagination: load third page from cache
    wrapper.setProps({ category: 'A', first: 2, after: 'pa4' });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 9. Final pagination: load fourth page after 'pa6'
    wrapper.setProps({ category: 'A', first: 2, after: 'pa6' });

    await tick()
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    await delay(51)
    expect(getEdges(wrapper, "title")).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
  });
});
