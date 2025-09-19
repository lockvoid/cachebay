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

// test/helpers/transport.ts
import { fetch as villusFetch } from 'villus';
import { delay, tick } from './concurrency';

export type Route = {
  when: (op: { body: string; variables: any; context: any }) => boolean;
  respond: (op: { body: string; variables: any; context: any }) =>
    | { data?: any; error?: any }
    | any;
  delay?: number; // ms
};

type RecordedCall = { body: string; variables: any; context: any };

/** Build a Response compatible object (works in happy-dom too) */
function buildResponse(obj: any) {
  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return {
    ok: true,
    status: 200,
    async json() { return obj; },
    async text() { return JSON.stringify(obj); },
  } as any;
}

export function createFetchMock(routes: Route[]) {
  const calls: Array<RecordedCall> = [];
  const originalFetch = globalThis.fetch;
  let pending = 0;

  globalThis.fetch = async (_input: any, init?: any) => {
    try {
      const bodyObj =
        init && typeof (init as any).body === 'string'
          ? JSON.parse((init as any).body as string)
          : {};
      const body = bodyObj.query || '';
      const variables = bodyObj.variables || {};
      const context = {};
      const op = { body, variables, context };

      const route = routes.find(r => r.when(op));
      if (!route) {
        // unmatched: return benign payload; do not count as "call"
        return buildResponse({ data: null });
      }

      calls.push(op);
      pending++;
      if (route.delay && route.delay > 0) {
        await delay(route.delay);
      }

      const payload = route.respond(op);
      const resp =
        payload && typeof payload === 'object' && 'error' in payload && (payload as any).error
          ? { errors: [{ message: (payload as any).error?.message || 'Mock error' }] }
          : (payload && typeof payload === 'object' && 'data' in payload
            ? payload
            : { data: payload });

      return buildResponse(resp);
    } finally {
      if (pending > 0) pending--;
    }
  };

  return {
    plugin: villusFetch(),
    calls,
    async waitAll(timeoutMs = 200) {
      const end = Date.now() + timeoutMs;
      while (pending > 0 && Date.now() < end) {
        await tick();
      }
    },
    restore() { globalThis.fetch = originalFetch; },
  };
}


/** Treat the cache (plugin) as a function Villus will call with a context. */
export function asPlugin(cache: any) {
  return cache; // CachebayInstance is a ClientPlugin (callable)
}

/**
 * Publish a result through the plugin pipeline.
 * Returns the value passed to ctx.useResult — convenient for grabbing the view.
 */
export function publish(
  cache: any,
  data: any,
  query: string = 'query Q { __typename }',
  variables: Record<string, any> = {},
) {
  const plugin = asPlugin(cache);
  let published: any = null;

  const ctx: any = {
    operation: { type: 'query', query, variables, cachePolicy: 'cache-and-network', context: {} },
    useResult: (payload: any) => {
      published = payload;
    },
    afterQuery: () => { },
  };

  plugin(ctx);
  ctx.useResult({ data });
  return published;
}

/**
 * Seed an empty Relay connection so tests can mutate it optimistically later.
 */
export function seedRelay(
  cache: any,
  {
    field,
    connectionTypename,
    pageInfo = {
      __typename: 'PageInfo',
      endCursor: null,
      hasNextPage: false,
      startCursor: null,
      hasPreviousPage: false,
    },
    edges = [],
    query = `query Seed { ${field} { edges { cursor node { __typename id } } pageInfo { endCursor hasNextPage } } }`,
    variables = {},
  }: {
    field: string;
    connectionTypename: string;
    pageInfo?: any;
    edges?: any[];
    query?: string;
    variables?: Record<string, any>;
  },
) {
  return publish(
    cache,
    {
      __typename: 'Query',
      [field]: { __typename: connectionTypename, edges, pageInfo },
    },
    query,
    variables,
  );
}
