// test/helpers/integration.ts
import { defineComponent, h, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src/core/internals';
import { provideCachebay } from '@/src/core/plugin';
import { createFetchMock, type Route } from './transport';
import { tick, delay } from './concurrency';
import gql from 'graphql-tag';

/**
 * Seed the cache by running the current normalize path (documents).
 * Accepts a GraphQL DocumentNode (or string) + variables + a server-like { data } payload.
 */
export async function seedCache(
  cache: any,
  {
    query,
    variables = {},
    data,
  }: {
    query: any;
    variables?: Record<string, any>;
    data: any;
  }
) {
  const internals = (cache as any).__internals;
  if (!internals) throw new Error("[seedCache] cache.__internals is missing");
  const { documents } = internals;

  const document =
    typeof query === 'string'
      ? (gql as any)([query] as any)
      : query;

  // run normalization like the plugin would
  documents.normalizeDocument({
    document,
    variables,
    data: data?.data ?? data,
  });

  // give time for any reactive overlays (usually not needed)
  await tick();
}

/**
 * Cache configs
 */
export const cacheConfigs = {
  basic: () => createCache(),
  withRelay: () => createCache(),          // connections are annotated with @connection in the queries below
  withCustomKeys: (keys: Record<string, (o: any) => string | null>) => createCache({ keys }),
};

/**
 * Create a test client with cache and mock fetch
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
        const items = (data?.value?.[dataPath]?.[itemPath]) ?? [];
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

      watch(data, (newData) => {
        if (newData && options.onData) {
          options.onData(newData);
        }
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
        {
          install(app) {
            provideCachebay(app as any, cache);
          }
        }
      ],
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
 * Standard GraphQL queries for testing (annotated with @connection)
 */
export const testQueries = {
  POSTS: /* GraphQL */ gql`
    query Posts($filter: String, $first: Int, $after: String) {
      posts(filter: $filter, first: $first, after: $after) @connection(mode: "infinite", args: ["filter"]) {
        __typename
        edges {
          __typename
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
          __typename
          endCursor
          hasNextPage
        }
      }
    }
  `,

  POST: /* GraphQL */ gql`
    query Post($id: ID!) {
      post(id: $id) {
        __typename
        id
        title
        content
        authorId
      }
    }
  `,

  COMMENTS: /* GraphQL */ `
    query Comments($postId: ID, $first: Int, $after: String) {
      comments(postId: $postId, first: $first, after: $after) @connection(mode: "infinite", args: ["postId"]) {
        __typename
        edges {
          __typename
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
          __typename
          startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }
      }
    }
  `,

  USERS: /* GraphQL */ gql`
    query Users($first: Int, $after: String) {
      users(first: $first, after: $after) @connection(mode: "infinite") {
        __typename
        edges {
          __typename
          cursor
          node {
            __typename
            id
            name
            email
          }
        }
        pageInfo {
          __typename
          endCursor
          hasNextPage
        }
      }
    }
  `,

  SIMPLE_POSTS: /* GraphQL */ gql`
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
  posts: (titles: string[], { fromId = 1 } = {}) => ({
    data: {
      __typename: 'Query',
      posts: {
        __typename: 'PostConnection',
        edges: titles.map((title, i) => ({
          __typename: 'PostEdge',
          cursor: `c${fromId + i}`,
          node: {
            __typename: 'Post',
            id: String(fromId + i),
            title,
            content: `Content for ${title}`,
            authorId: '1',
          },
        })),
        pageInfo: {
          __typename: 'PageInfo',
          endCursor: titles.length > 0 ? `c${fromId + titles.length - 1}` : null,
          hasNextPage: true,
        },
      },
    },
  }),

  post: (title: string, id: string = '1') => ({
    data: {
      __typename: 'Query',
      post: {
        __typename: 'Post',
        id,
        title,
        content: `Content for ${title}`,
        authorId: '1',
      },
    },
  }),

  comments: (texts: string[], { postId = '1', fromId = 1 } = {}) => ({
    data: {
      __typename: 'Query',
      comments: {
        __typename: 'CommentConnection',
        edges: texts.map((text, i) => ({
          __typename: 'CommentEdge',
          cursor: `c${fromId + i}`,
          node: {
            __typename: 'Comment',
            id: String(fromId + i),
            text,
            postId,
            authorId: '1',
          },
        })),
        pageInfo: {
          __typename: 'PageInfo',
          startCursor: texts.length > 0 ? `c${fromId}` : null,
          endCursor: texts.length > 0 ? `c${fromId + texts.length - 1}` : null,
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
          __typename: 'UserEdge',
          cursor: `c${i + 1}`,
          node: {
            __typename: 'User',
            id: String(i + 1),
            name,
            email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
          },
        })),
        pageInfo: {
          __typename: 'PageInfo',
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
