// test/helpers/integration.ts
import { defineComponent, h, watch, computed } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src/core/internals';
import { provideCachebay } from '@/src/core/plugin';
import { tick, delay } from './concurrency';
import gql from 'graphql-tag';
import { fetch as villusFetch } from 'villus';
import * as operations from './operations';

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

      suspensionTimeout: 0,
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

export async function mountWithClient(
  component: any,
  routes: Route[],
  cacheConfig?: any,
  props?: Record<string, any>
) {
  const { client, cache, fx } = createTestClient(routes, cacheConfig);
  const wrapper = mount(component, {
    props,
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

export function MakeHarnessErrorHandling(cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network') {
  return defineComponent({
    props: {
      first: Number,
      after: String,
      renders: Array,
      errors: Array,
      empties: Array,
      name: String,
    },
    setup(props) {
      const { useQuery } = require('villus');

      const vars = computed(() => {
        const v: any = {};
        if (props.first != null) v.first = props.first;
        if (props.after != null) v.after = props.after;
        return v;
      });

      // operations is imported at the top of the file
      const { data, error } = useQuery({
        query: operations.POSTS_QUERY,
        variables: vars,
        cachePolicy,
      });

      watch(
        () => data.value,
        (v) => {
          const edges = v?.posts?.edges;
          if (Array.isArray(edges) && edges.length > 0) {
            (props.renders as any[]).push(edges.map((e: any) => e?.node?.title || ''));
          } else if (v && v.posts && Array.isArray(v.posts.edges) && v.posts.edges.length === 0) {
            (props.empties as any[]).push('empty');
          }
        },
        { immediate: true },
      );

      watch(
        () => error.value,
        (e) => {
          if (e) (props.errors as any[]).push(e.message || 'error');
        },
        { immediate: true },
      );

      return () =>
        (data?.value?.posts?.edges ?? []).map((e: any) =>
          h('div', {}, e?.node?.title || ''),
        );
    },
  });
}

// Shared helper functions from integration tests
export const rows = (wrapper: any) =>
  wrapper.findAll("div").map((n: any) => n.text()).filter((t: string) => t !== "");

export const rowsByClass = (wrapper: any, cls = ".row") =>
  wrapper.findAll(cls).map((n: any) => n.text());

export const rowsNoPI = (wrapper: any) =>
  wrapper.findAll("div:not(.pi)").map((n: any) => n.text());

// Shared component helpers from integration tests
export const UsersList = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
  vars: any
) =>
  defineComponent({
    name: "UsersList",
    setup() {
      const { useQuery } = require("villus");
      // operations is imported at the top of the file
      const { data } = useQuery({ query: operations.USERS_QUERY, variables: vars, cachePolicy: policy });
      return () => {
        const usersEdges = data.value?.users?.edges ?? [];
        return usersEdges.map((e: any) => h("div", {}, e?.node?.email ?? ""));
      };
    },
  });

export const UserTitle = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
  id: string
) =>
  defineComponent({
    name: "UserTitle",
    setup() {
      const { useQuery } = require("villus");
      // operations is imported at the top of the file
      const { data } = useQuery({ query: operations.USER_QUERY, variables: { id }, cachePolicy: policy });
      return () => h("div", {}, data.value?.user?.email ?? "");
    },
  });

export const UserPostComments = (
  policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only"
) =>
  defineComponent({
    name: "UserPostComments",
    setup() {
      const { useQuery } = require("villus");
      // operations is imported at the top of the file
      const vars = {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      };
      const { data } = useQuery({ query: operations.USER_POSTS_COMMENTS_QUERY, variables: vars, cachePolicy: policy });
      return () => {
        const postEdges = data.value?.user?.posts?.edges ?? [];
        const firstPost = postEdges[0]?.node;
        const commentEdges = firstPost?.comments?.edges ?? [];
        return commentEdges.map((e: any) => h("div", {}, e?.node?.text ?? ""));
      };
    },
  });

export const CanonPosts = defineComponent({
  name: "CanonPosts",
  props: { first: Number, after: String },
  setup(props) {
    const { useQuery } = require('villus');
    // operations is imported at the top of the file
    const { data } = useQuery({
      query: operations.POSTS_QUERY,
      variables: props,
      cachePolicy: "cache-first",
    });
    return () =>
      (data.value?.posts?.edges || []).map((e: any) =>
        h("div", { class: "row", key: e?.node?.id }, e?.node?.title || "")
      );
  },
});

export function harnessEdges(
  queryDoc: any,
  cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only'
) {
  return defineComponent({
    name: 'EdgesHarness',
    props: { after: String, before: String, first: Number, last: Number, filter: String },
    setup(props) {
      const { useQuery } = require('villus');
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

export const PostsHarness = (
  queryDoc: any,
  cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network'
) =>
  defineComponent({
    name: 'PostsHarness',
    props: { filter: String, first: Number, after: String },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => {
        const v: Record<string, any> = { filter: props.filter, first: props.first, after: props.after };
        Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
        return v;
      });
      const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
      return () => {
        const edges = (data?.value?.posts?.edges ?? []).map((e: any) => h('div', {}, e?.node?.title || ''));
        const pi = h('div', { class: 'pi' }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
        return [...edges, pi];
      };
    },
  });

// Additional helper functions from relay-connections test
export const rowsRelayConnections = (w: any) => w.findAll('div:not(.pi)').map((d: any) => d.text());
export const readPI = (w: any) => {
  const t = w.find('.pi').text();
  try { return JSON.parse(t || '{}'); } catch { return {}; }
};

/* ──────────────────────────────────────────────────────────────────────────
 * GraphQL Queries and Fragments from Integration Tests
 * ------------------------------------------------------------------------ */

// From optimistic-updates.test.ts
export const POSTS_APPEND_OPTIMISTIC = gql`
  query PostsAppend($filter: String, $first: Int, $after: String) {
    posts(filter: $filter, first: $first, after: $after)
      @connection(mode: "infinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

// From relay-connections.test.ts
export const POSTS_APPEND_RELAY = gql`
  query PostsAppend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "infinite", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const POSTS_PREPEND = gql`
  query PostsAppend($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "prepend", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const POSTS_REPLACE = gql`
  query PostsReplace($filter: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(filter: $filter, first: $first, after: $after, last: $last, before: $before)
      @connection(mode: "page", args: ["filter"]) {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const FRAG_POST_RELAY = gql`
  fragment Post on Post {
    __typename
    id
    title
  }
`;

// From fragments-lifecycle.test.ts
export const FRAG_USER_POSTS_PAGE = gql`
  fragment UserPostsPage on User {
    posts(first: 2) @connection {
      __typename
      edges { __typename cursor node { __typename id title } }
      pageInfo { __typename hasNextPage endCursor }
    }
  }
`;

export const FRAG_USER_NAME = gql`
  fragment U on User { 
    id 
    name 
  }
`;

/* ──────────────────────────────────────────────────────────────────────────
 * Shared Components from Integration Tests
 * ------------------------------------------------------------------------ */

// From edgecases-behaviour.test.ts
export const PostListTracker = (renders: string[][], firstNodeIds: string[]) => 
  defineComponent({
    name: 'PostList',
    props: { first: Number, after: String },
    setup(props) {
      const vars = computed(() => {
        const v: Record<string, any> = {};
        if (props.first != null) v.first = props.first;
        if (props.after != null) v.after = props.after;
        return v;
      });

      const { useQuery } = require('villus');
      const { data } = useQuery({
        query: operations.POSTS_QUERY, // @connection on posts
        variables: vars,
        cachePolicy: 'network-only',
      });

      watch(
        () => data.value,
        (v) => {
          const conn = v?.posts;
          const edges = Array.isArray(conn?.edges) ? conn!.edges : [];
          if (edges.length > 0) {
            const titles = edges.map((e: any) => e?.node?.title || '');
            renders.push(titles);
            if (edges[0]?.node?.id != null) firstNodeIds.push(String(edges[0].node.id));
          }
        },
        { immediate: true }
      );

      return () => (data.value?.posts?.edges || []).map((e: any) =>
        h('div', { key: e.node.id }, e?.node?.title || '')
      );
    },
  });

// From cache-policies.test.ts
export const UsersDiffTracker = (renders: string[][]) =>
  defineComponent({
    name: "UsersDiff",
    setup() {
      const { useQuery } = require("villus");
      const { data } = useQuery({
        query: operations.USERS_QUERY,
        variables: { usersRole: "diff", usersFirst: 2, usersAfter: null },
        cachePolicy: "cache-and-network",
      });
      watch(
        () => data.value,
        (v) => {
          const emails = (v?.users?.edges ?? []).map((e: any) => e?.node?.email ?? "");
          if (emails.length) renders.push(emails);
        },
        { immediate: true }
      );
      return () => (data.value?.users?.edges ?? []).map((e: any) => h("div", {}, e?.node?.email ?? ""));
    },
  });

// Simple empty div component for cache-only tests
export const EmptyDivComponent = defineComponent({ render: () => h("div") });
