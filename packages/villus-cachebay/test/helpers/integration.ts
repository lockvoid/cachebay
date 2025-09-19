// test/helpers/integration.ts
import { defineComponent, h, watch } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src/core/internals';
import { provideCachebay } from '@/src/core/plugin';
import { tick, delay } from './concurrency';
import gql from 'graphql-tag';
import { fetch as villusFetch } from 'villus';

/* ──────────────────────────────────────────────────────────────────────────
 * Seed via normalize (like the plugin path)
 * ------------------------------------------------------------------------ */
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
  if (!internals) throw new Error('[seedCache] cache.__internals is missing');
  const { documents } = internals;

  const document =
    typeof query === 'string'
      ? (gql as any)([query] as any)
      : query;

  documents.normalizeDocument({
    document,
    variables,
    data: data?.data ?? data,
  });

  await tick();
}

/* ──────────────────────────────────────────────────────────────────────────
 * Test client (cache + mocked fetch)
 * - default cache keys include Comment keyed by `uuid`
 * - default interfaces include Post: ['AudioPost','VideoPost']
 * ------------------------------------------------------------------------ */
export function createTestClient(routes: Route[], cacheConfig?: any) {
  const cache =
    cacheConfig ||
    createCache({
      keys: {
        Comment: (o: any) => (o?.uuid != null ? String(o.uuid) : null),
      },
      interfaces: { Post: ['AudioPost', 'VideoPost'] },
    });

  const fx = createFetchMock(routes);
  const client = createClient({
    url: '/test',
    use: [cache as any, fx.plugin],
  });
  return { client, cache, fx };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Mount helpers
 * ------------------------------------------------------------------------ */
export function createListComponent(
  query: any,
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
      const { data } = useQuery({ query, variables, cachePolicy });

      return () => {
        const items = (data?.value?.[dataPath]?.[itemPath]) ?? [];
        return h(
          'div',
          {},
          items.map((item: any) => {
            const value = keyPath.split('.').reduce((obj, key) => obj?.[key], item);
            return h('div', {}, value || '');
          })
        );
      };
    },
  });
}

export function createWatcherComponent(
  query: any,
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
      const { data, error } = useQuery({ query, variables, cachePolicy: options.cachePolicy });

      watch(
        data,
        (v) => { if (v && options.onData) options.onData(v); },
        { immediate: true }
      );
      watch(
        error,
        (e) => { if (e && options.onError) options.onError(e); },
        { immediate: true }
      );

      return () => h('div', {}, JSON.stringify(data.value));
    },
  });
}

export async function mountWithClient(component: any, routes: Route[], cacheConfig?: any) {
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
/* ──────────────────────────────────────────────────────────────────────────
 * Publish helper (pushes a payload through the plugin pipeline)
 * ------------------------------------------------------------------------ */
export function publish(
  cache: any,
  data: any,
  query: string = 'query Q { __typename }',
  variables: Record<string, any> = {},
) {
  const plugin = cache;
  let published: any = null;

  const ctx: any = {
    operation: { type: 'query', query, variables, cachePolicy: 'cache-and-network', context: {} },
    useResult: (payload: any) => { published = payload; },
    afterQuery: () => { },
  };

  plugin(ctx);
  ctx.useResult({ data });
  return published;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Embedded transport mock (was ./transport.ts)
 * ------------------------------------------------------------------------ */
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

    async restore(timeoutMs = 200) {
      const end = Date.now() + timeoutMs;
      while (pending > 0 && Date.now() < end) {
        await tick();
      }

      globalThis.fetch = originalFetch;
    },
  };
}
