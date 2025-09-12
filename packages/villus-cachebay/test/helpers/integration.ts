import { defineComponent, h, computed, watch, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient, type Client } from 'villus';
import { createCache, relay } from '@/src';
import { CACHEBAY_KEY, provideCachebay } from '@/src/core/plugin'; // ⟵ import provideCachebay
import { createFetchMock, type Route, tick, delay } from './index';

/**
 * Common cache configurations for integration tests
 */
export const cacheConfigs = {
  basic: () => createCache({
    addTypename: true,
  }),

  withRelay: (resolverFn?: any) => {
    const cache = createCache({
      addTypename: true,
      resolvers: {
        Query: {
          posts: resolverFn || relay({}),
          comments: resolverFn || relay({}),
          users: resolverFn || relay({}),
        }
      },
    });
    return cache;
  },

  withCustomKeys: (keys: Record<string, (o: any) => string | null>) => createCache({
    addTypename: true,
    keys,
  }),
};

/**
 * Creates a test client with cache and mock fetch
 */
export function createTestClient(routes: Route[], cacheConfig?: any) {
  const cache = cacheConfig || cacheConfigs.basic();
  const fx = createFetchMock(routes);
  const client = createClient({
    url: '/test',
    use: [cache as any, fx.plugin]
  });
  return { client, cache, fx };
}

/**
 * Standard list rendering component for testing queries
 */
export function createListComponent(
  query: string,
  variables: any = {},
  options: {
    cachePolicy?: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only';
    dataPath?: string;
    itemPath?: string;
    keyPath?: string;
  } = {}
) {
  const { cachePolicy, dataPath = 'posts', itemPath = 'edges', keyPath = 'node.title' } = options;

  return defineComponent({
    name: 'TestList',
    setup() {
      const { useQuery } = require('villus');
      const { data } = useQuery({
        query,
        variables,
        cachePolicy
      });

      return () => {
        const items = data?.value?.[dataPath]?.[itemPath] ?? [];
        return h(
          'ul',
          {},
          items.map((item: any) => {
            const value = keyPath.split('.').reduce(
              (obj, key) => obj?.[key],
              item
            );
            return h('li', {}, value || '');
          })
        );
      };
    },
  });
}

/**
 * Component that tracks data changes over time
 */
export function createWatcherComponent(
  query: string,
  variables: any = {},
  options: {
    cachePolicy?: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only';
    onData?: (data: any) => void;
    onError?: (error: any) => void;
  } = {}
) {
  return defineComponent({
    name: 'TestWatcher',
    setup() {
      const { useQuery } = require('villus');
      const { data, error } = useQuery({
        query,
        variables,
        cachePolicy: options.cachePolicy
      });

      const renders: any[] = [];

      watch(data, (newData) => {
        if (newData && options.onData) {
          options.onData(newData);
        }
        renders.push(newData);
      }, { immediate: true });

      watch(error, (newError) => {
        if (newError && options.onError) {
          options.onError(newError);
        }
      }, { immediate: true });

      return () => h('div', {}, JSON.stringify(data.value));
    },
  });
}

/**
 * Mount a component with a test client
 */
export async function mountWithClient(
  component: any,
  routes: Route[],
  cacheConfig?: any
) {
  const { client, cache, fx } = createTestClient(routes, cacheConfig);

  const wrapper = mount(component, {
    global: {
      plugins: [
        client as any,
        // use a tiny plugin to call provideCachebay with the *actual* cache instance
        {
          install(app) {
            provideCachebay(app as any, cache);
          }
        }
      ],
      // ⚠️ remove manual provide of CACHEBAY_KEY — provideCachebay handles it
    },
  });

  return { wrapper, client, cache, fx };
}

/** Helper to extract list text from wrapper */
export function getListItems(wrapper: any): string[] {
  return wrapper.findAll('li').map((li: any) => li.text());
}

/** Helper to wait for data and return list items */
export async function waitForList(wrapper: any, delayMs: number = 10): Promise<string[]> {
  await delay(delayMs);
  return getListItems(wrapper);
}

/** Clean variables by removing null/undefined */
export function cleanVars(v: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (val !== undefined && val !== null) out[k] = val;
  }
  return out;
}

/**
 * Standard GraphQL queries for testing
 */
export const testQueries = {
  POSTS: /* GraphQL */ `
    query Posts($filter: String, $first: Int, $after: String) {
      posts(filter: $filter, first: $first, after: $after) {
        edges {
          cursor
          node {
            __typename
            id
            title
            content
            authorId
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,

  COMMENTS: /* GraphQL */ `
    query Comments($postId: ID, $first: Int, $after: String) {
      comments(postId: $postId, first: $first, after: $after) {
        edges {
          cursor
          node {
            __typename
            id
            text
            postId
            authorId
          }
        }
        pageInfo {
          startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }
      }
    }
  `,

  USERS: /* GraphQL */ `
    query Users($first: Int, $after: String) {
      users(first: $first, after: $after) {
        edges {
          cursor
          node {
            __typename
            id
            name
            email
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,

  SIMPLE_POSTS: /* GraphQL */ `
    query SimplePosts {
      posts {
        __typename
        id
        title
        content
      }
    }
  `,
};

/**
 * Standard mock responses for testing
 */
export const mockResponses = {
  posts: (titles: string[]) => ({
    data: {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: titles.map((title, i) => ({
          cursor: `c${i + 1}`,
          node: {
            __typename: 'Post',
            id: String(i + 1),
            title,
            content: `Content for ${title}`,
            authorId: '1',
          },
        })),
        pageInfo: {
          endCursor: titles.length > 0 ? `c${titles.length}` : null,
          hasNextPage: false,
        },
      },
    },
  }),

  comments: (texts: string[], postId = '1') => ({
    data: {
      __typename: 'Query',
      comments: {
        __typename: 'CommentConnection',
        edges: texts.map((text, i) => ({
          cursor: `c${i + 1}`,
          node: {
            __typename: 'Comment',
            id: String(i + 1),
            text,
            postId,
            authorId: '1',
          },
        })),
        pageInfo: {
          startCursor: texts.length > 0 ? 'c1' : null,
          endCursor: texts.length > 0 ? `c${texts.length}` : null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  }),

  users: (names: string[]) => ({
    data: {
      __typename: 'Query',
      users: {
        __typename: 'UserConnection',
        edges: names.map((name, i) => ({
          cursor: `c${i + 1}`,
          node: {
            __typename: 'User',
            id: String(i + 1),
            name,
            email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
          },
        })),
        pageInfo: {
          endCursor: names.length > 0 ? `c${names.length}` : null,
          hasNextPage: false,
        },
      },
    },
  }),

  simplePosts: (items: Array<{ id: string; title: string; content?: string }>) => ({
    data: {
      __typename: 'Query',
      posts: items.map(item => ({
        __typename: 'Post',
        content: '',
        ...item,
      })),
    },
  }),
};
