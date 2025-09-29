import { defineComponent, h, computed, watch, Suspense } from 'vue';
import { createClient } from 'villus';
import { createCache } from '@/src/core/internals';
import { tick, delay } from './concurrency';
import { fetch as villusFetch } from 'villus';

export async function seedCache(cache, { query, variables, data }) {
  const internals = cache.__internals;

  if (!internals) {
    throw new Error('[seedCache] cache.__internals is missing');
  }

  const { documents } = internals;

  documents.normalizeDocument({ document: query, variables, data });

  await tick();
}

export function createTestClient({ routes = [], cache }: { routes?: Route[], cache?: any } = {}) {
  const finalCache = cache ?? createCache({
    keys: {
      Comment: (comment: any) => {
        return String(comment.uuid);
      },
    },

    interfaces: {
      Post: ['AudioPost', 'VideoPost']
    },

    suspensionTimeout: 0,
  });

  const fx = createFetchMock(routes);

  const client = createClient({
    url: '/test',

    use: [finalCache, fx.plugin],
  });

  return { client, cache: finalCache, fx };
}

export type Route = {
  when: (op: { body: string; variables: any; context: any }) => boolean;
  respond: (op: { body: string; variables: any; context: any }) => { data?: any; error?: any }
  delay?: number;
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

export const getEdges = (wrapper: any, fieldName: string) => {
  return wrapper.findAll(`li.edge div.${fieldName}`).map((field: any) => field.text());
}

export const getPageInfo = (wrapper: any) => {
  const pageInfoDiv = wrapper.find("div.pageInfo");

  if (!pageInfoDiv.exists()) {
    return {};
  }

  return {
    startCursor: pageInfoDiv.find("div.startCursor").text() || null,
    endCursor: pageInfoDiv.find("div.endCursor").text() || null,
    hasNextPage: pageInfoDiv.find("div.hasNextPage").text() === "true",
    hasPreviousPage: pageInfoDiv.find("div.hasPreviousPage").text() === "true"
  };
};

export const createConnectionComponent = (
  query: any,

  options: {
    cachePolicy: "cache-first" | "cache-and-network" | "network-only" | "cache-only";
    connectionFn: (data: any) => any;
  }
) => {
  const { cachePolicy, connectionFn } = options;

  const renders: any[][] = [];

  const component = defineComponent({
    name: "ListComponent",

    inheritAttrs: false,

    setup(props, { attrs }) {
      const { useQuery } = require("villus");

      const variables = computed(() => {
        return attrs;
      });

      const { data, error, isFetching } = useQuery({ query, variables, cachePolicy });

      const connection = computed(() => {
        if (!data.value) {
          return null;
        }

        return connectionFn(data.value);
      });

      watch(data, (value) => {
        if (!value) {
          return;
        }
        renders.push(connectionFn(value));
      }, { immediate: true });

      return () => {
        if (isFetching.value) {
          return h("div", { class: "loading" }, "Loading...");
        }

        if (error.value) {
          return h("div", { class: "error" }, JSON.stringify(error.value));
        }

        return h("div", {}, [
          h("div", { class: "pageInfo" }, [
            h("div", { class: "startCursor" }, String(connection.value?.pageInfo?.startCursor ?? "")),
            h("div", { class: "endCursor" }, String(connection.value?.pageInfo?.endCursor ?? "")),
            h("div", { class: "hasNextPage" }, String(connection.value?.pageInfo?.hasNextPage ?? false)),
            h("div", { class: "hasPreviousPage" }, String(connection.value?.pageInfo?.hasPreviousPage ?? false))
          ]),

          h("ul", { class: "edges" },
            (connection.value?.edges ?? []).map((edge: any, index: number) => {
              const node = edge?.node ?? {};

              return h("li", { class: "edge", key: node.id || index },
                Object.keys(node).map(field =>
                  h("div", { class: field }, String(node[field]))
                )
              );
            })
          )
        ]);
      };
    },
  });

  (component as any).renders = renders;

  return component;
};

export const createConnectionComponentSuspense = (
  query: any,

  options: {
    cachePolicy: "cache-first" | "cache-and-network" | "network-only" | "cache-only";
    connectionFn: (data: any) => any;
  }
) => {
  const { cachePolicy, connectionFn } = options;

  const renders: any[][] = [];

  const ConnectionComponent = defineComponent({
    name: "ListComponentSuspense",

    inheritAttrs: false,

    async setup(props, { attrs }) {
      const { useQuery } = require("villus");

      const variables = computed(() => {
        return attrs;
      });

      const { data, error } = await useQuery({ query, variables, cachePolicy });

      if (error.value) {
        throw error.value;
      }

      const connection = computed(() => {
        if (!data.value) {
          return null;
        }

        return connectionFn(data.value);
      });

      watch(data, (value) => {
        if (!value) {
          return;
        }

        renders.push(connectionFn(value));
      }, { immediate: true });

      return () => {
        return h("div", {}, [
          h("div", { class: "pageInfo" }, [
            h("div", { class: "startCursor" }, String(connection.value?.pageInfo?.startCursor ?? "")),
            h("div", { class: "endCursor" }, String(connection.value?.pageInfo?.endCursor ?? "")),
            h("div", { class: "hasNextPage" }, String(connection.value?.pageInfo?.hasNextPage ?? false)),
            h("div", { class: "hasPreviousPage" }, String(connection.value?.pageInfo?.hasPreviousPage ?? false))
          ]),

          h("ul", { class: "edges" },
            (connection.value?.edges ?? []).map((edge: any, index: number) => {
              const node = edge?.node ?? {};

              return h("li", { class: "edge", key: node.id || index },
                Object.keys(node).map(field =>
                  h("div", { class: field }, String(node[field]))
                )
              );
            })
          )
        ]);
      };
    },
  });

  const component = defineComponent({
    name: "SuspenseWrapper",

    props: {
      // Accept any props that will be passed to the inner component
    },

    setup(props) {
      return () => h(Suspense, {}, {
        default: () => h(ConnectionComponent, props),
        fallback: () => h("div", { class: "loading" }, "Loading...")
      });
    }
  });

  (component as any).renders = renders;

  return component;
};

export const createDetailComponent = (
  query: any,

  options: {
    cachePolicy: "cache-first" | "cache-and-network" | "network-only" | "cache-only";
    detailFn: (data: any) => any;
  }
) => {
  const { cachePolicy, detailFn } = options;

  const renders: any[][] = [];

  const component = defineComponent({
    name: "DetailComponent",

    inheritAttrs: false,

    setup(props, { attrs }) {
      const { useQuery } = require("villus");

      const variables = computed(() => {
        return attrs;
      });

      const { data, isFetching, error } = useQuery({ query, variables, cachePolicy });

      const detail = computed(() => {
        if (!data.value) {
          return null;
        }

        return detailFn(data.value);
      });

      if (renders) {
        watch(data, (value) => {
          if (!value) {
            return;
          }

          renders.push(detailFn(value));
        }, { immediate: true });
      }

      return () => {
        if (isFetching.value) {
          return h("div", { class: "loading" }, "Loading...");
        }

        if (error.value) {
          return h("div", { class: "error" }, JSON.stringify(error.value));
        }

        return h("ul", { class: "edges" }, [
          h("li", { class: "edge" },
            Object.keys(detail.value ?? {}).map(fieldName =>
              h("div", { class: fieldName }, String(detail.value[fieldName]))
            )
          )
        ]);
      };
    },
  });

  (component as any).renders = renders;

  return component;
};

export const createDetailComponentSuspense = (
  query: any,

  options: {
    cachePolicy: "cache-first" | "cache-and-network" | "network-only" | "cache-only";
    detailFn: (data: any) => any;
  }
) => {
  const { cachePolicy, detailFn } = options;

  const renders: any[][] = [];

  const DetailComponent = defineComponent({
    name: "DetailComponentSuspense",

    inheritAttrs: false,

    async setup(props, { attrs }) {
      const { useQuery } = require("villus");

      const variables = computed(() => {
        return attrs;
      });

      const { data, error } = await useQuery({ query, variables, cachePolicy });

      if (error.value) {
        throw error.value;
      }

      const detail = computed(() => {
        if (!data.value) {
          return null;
        }

        return detailFn(data.value);
      });

      if (renders) {
        watch(data, (value) => {
          if (!value) {
            return;
          }

          renders.push(detailFn(value));
        }, { immediate: true });
      }

      return () => {
        return h("ul", { class: "edges" }, [
          h("li", { class: "edge" },
            Object.keys(detail.value ?? {}).map(fieldName =>
              h("div", { class: fieldName }, String(detail.value[fieldName]))
            )
          )
        ]);
      };
    },
  });

  const component = defineComponent({
    name: "DetailSuspenseWrapper",

    props: {
      // Accept any props that will be passed to the inner component
    },

    setup(props) {
      return () => h(Suspense, {}, {
        default: () => h(DetailComponent, props),
        fallback: () => h("div", { class: "loading" }, "Loading...")
      });
    }
  });


  (component as any).renders = renders;

  return component;
};

// export async function mountWithClient(component: any, routes: Route[], props?: any) {
//   const { client, cache, fx } = createTestClient(routes);
//
//   const wrapper = mount(component, {
//     props,
//
//     global: {
//       plugins: [
//         client,
//
//         {
//           install(app) {
//             provideCachebay(app, cache);
//           },
//         },
//       ],
//     },
//   });
//
//   return { wrapper, client, cache, fx };
// }
//
//
// /* ──────────────────────────────────────────────────────────────────────────
//  * Test client (cache + mocked fetch)
//  * - default cache keys include Comment keyed by `uuid`
//  * - default interfaces include Post: ['AudioPost','VideoPost']
//  * ------------------------------------------------------------------------ */
//
//
// /* ──────────────────────────────────────────────────────────────────────────
//  * Mount helpers
//  * ------------------------------------------------------------------------ */
// export function createListComponent(
//   query: any,
//   variables: any = {},
//   options: {
//     cachePolicy?: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only';
//     dataPath?: string;
//     itemPath?: string;
//     keyPath?: string;
//   } = {}
// ) {
//   const { cachePolicy, dataPath = 'posts', itemPath = 'edges', keyPath = 'node.title' } = options;
//
//   return defineComponent({
//     name: 'TestList',
//     setup() {
//       const { useQuery } = require('villus');
//       const { data } = useQuery({ query, variables, cachePolicy });
//
//       return () => {
//         const items = (data?.value?.[dataPath]?.[itemPath]) ?? [];
//         return h(
//           'div',
//           {},
//           items.map((item: any) => {
//             const value = keyPath.split('.').reduce((obj, key) => obj?.[key], item);
//             return h('div', {}, value || '');
//           })
//         );
//       };
//     },
//   });
// }
//
// export function createWatcherComponent(
//   query: any,
//   variables: any = {},
//   options: {
//     cachePolicy?: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only';
//     onData?: (data: any) => void;
//     onError?: (error: any) => void;
//   } = {}
// ) {
//   return defineComponent({
//     name: 'TestWatcher',
//     setup() {
//       const { useQuery } = require('villus');
//       const { data, error } = useQuery({ query, variables, cachePolicy: options.cachePolicy });
//
//       watch(
//         data,
//         (v) => { if (v && options.onData) options.onData(v); },
//         { immediate: true }
//       );
//       watch(
//         error,
//         (e) => { if (e && options.onError) options.onError(e); },
//         { immediate: true }
//       );
//
//       return () => h('div', {}, JSON.stringify(data.value));
//     },
//   });
// }
//
//
// /* ──────────────────────────────────────────────────────────────────────────
//  * Embedded transport mock (was ./transport.ts)
//  * ------------------------------------------------------------------------ */
//
//
// export function MakeHarnessErrorHandling(cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network') {
//   return defineComponent({
//     props: {
//       first: Number,
//       after: String,
//       renders: Array,
//       errors: Array,
//       empties: Array,
//       name: String,
//     },
//     setup(props) {
//       const { useQuery } = require('villus');
//
//       const vars = computed(() => {
//         const v: any = {};
//         if (props.first != null) v.first = props.first;
//         if (props.after != null) v.after = props.after;
//         return v;
//       });
//
//       // operations is imported at the top of the file
//       const { data, error } = useQuery({
//         query: operations.POSTS_QUERY,
//         variables: vars,
//         cachePolicy,
//       });
//
//       watch(
//         () => data.value,
//         (v) => {
//           const edges = v?.posts?.edges;
//           if (Array.isArray(edges) && edges.length > 0) {
//             (props.renders as any[]).push(edges.map((e: any) => e?.node?.title || ''));
//           } else if (v && v.posts && Array.isArray(v.posts.edges) && v.posts.edges.length === 0) {
//             (props.empties as any[]).push('empty');
//           }
//         },
//         { immediate: true },
//       );
//
//       watch(
//         () => error.value,
//         (e) => {
//           if (e) (props.errors as any[]).push(e.message || 'error');
//         },
//         { immediate: true },
//       );
//
//       return () =>
//         (data?.value?.posts?.edges ?? []).map((e: any) =>
//           h('div', {}, e?.node?.title || ''),
//         );
//     },
//   });
// }
//
//
// // Legacy helpers (deprecated - use getEdges instead)
// export const rows = (wrapper: any) =>
//   wrapper.findAll("div").map((n: any) => n.text()).filter((t: string) => t !== "");
//
// export const rowsByClass = (wrapper: any, cls = ".row") =>
//   wrapper.findAll(cls).map((n: any) => n.text());
//
// export const rowsNoPI = (wrapper: any) =>
//   wrapper.findAll("div:not(.pi)").map((n: any) => n.text());
// // Shared component helpers from integration tests
// export const UsersList = (
//   policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
//   vars: any
// ) =>
//   defineComponent({
//     name: "UsersList",
//     setup() {
//       const { useQuery } = require("villus");
//       // operations is imported at the top of the file
//       const { data } = useQuery({ query: operations.USERS_QUERY, variables: vars, cachePolicy: policy });
//       return () => {
//         const usersEdges = data.value?.users?.edges ?? [];
//         return usersEdges.map((e: any) => h("div", {}, e?.node?.email ?? ""));
//       };
//     },
//   });
//
// export const UserTitle = (
//   policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only",
//   id: string
// ) =>
//   defineComponent({
//     name: "UserTitle",
//     setup() {
//       const { useQuery } = require("villus");
//       // operations is imported at the top of the file
//       const { data } = useQuery({ query: operations.USER_QUERY, variables: { id }, cachePolicy: policy });
//       return () => h("div", {}, data.value?.user?.email ?? "");
//     },
//   });
//
// export const UserPostComments = (
//   policy: "cache-first" | "cache-and-network" | "network-only" | "cache-only"
// ) =>
//   defineComponent({
//     name: "UserPostComments",
//     setup() {
//       const { useQuery } = require("villus");
//       // operations is imported at the top of the file
//       const vars = {
//         id: "u1",
//         postsCategory: "tech",
//         postsFirst: 1,
//         postsAfter: null,
//         commentsFirst: 2,
//         commentsAfter: null,
//       };
//       const { data } = useQuery({ query: operations.USER_POSTS_COMMENTS_QUERY, variables: vars, cachePolicy: policy });
//       return () => {
//         const postEdges = data.value?.user?.posts?.edges ?? [];
//         const firstPost = postEdges[0]?.node;
//         const commentEdges = firstPost?.comments?.edges ?? [];
//         return commentEdges.map((e: any) => h("div", {}, e?.node?.text ?? ""));
//       };
//     },
//   });
//
// export const CanonPosts = defineComponent({
//   name: "CanonPosts",
//   props: { first: Number, after: String },
//   setup(props) {
//     const { useQuery } = require('villus');
//     // operations is imported at the top of the file
//     const { data } = useQuery({
//       query: operations.POSTS_QUERY,
//       variables: props,
//       cachePolicy: "cache-first",
//     });
//     return () =>
//       (data.value?.posts?.edges || []).map((e: any) =>
//         h("div", { class: "row", key: e?.node?.id }, e?.node?.title || "")
//       );
//   },
// });
//
// export function harnessEdges(
//   queryDoc: any,
//   cachePolicy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only'
// ) {
//   return defineComponent({
//     name: 'EdgesHarness',
//     props: { after: String, before: String, first: Number, last: Number, filter: String },
//     setup(props) {
//       const { useQuery } = require('villus');
//       const vars = computed(() => {
//         const v: Record<string, any> = {
//           first: props.first ?? 2,
//           after: props.after,
//           last: props.last,
//           before: props.before,
//           filter: props.filter,
//         };
//         Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
//         return v;
//       });
//       // const connection = computed(() => {
//       //   if (!data.value) return null;
//       //   return extractConnection(data.value);
//       //   const pi = h('div', { class: 'pi' }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
//       //   return [...edges, pi];
//       // };
//     },
//   });
// }
//
// export const PostsHarness = (
//   queryDoc: any,
//   cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' = 'cache-and-network'
// ) =>
//   defineComponent({
//     name: 'PostsHarness',
//     props: { category: String, first: Number, after: String },
//     setup(props) {
//       const { useQuery } = require('villus');
//       const vars = computed(() => {
//         const v: Record<string, any> = { ...props };
//         Object.keys(v).forEach((k) => v[k] === undefined && delete v[k]);
//         return v;
//       });
//       const { data } = useQuery({ query: queryDoc, variables: vars, cachePolicy });
//       return () => {
//         const edges = (data?.value?.posts?.edges ?? []).map((e: any) => h('div', {}, e?.node?.title || ''));
//         const pi = h('div', { class: 'pi' }, JSON.stringify(data?.value?.posts?.pageInfo ?? {}));
//         return [...edges, pi];
//       };
//     },
//   });
//
// // Additional helper functions from relay-connections test
// export const rowsRelayConnections = (w: any) => w.findAll('div:not(.pi)').map((d: any) => d.text());
// export const readPI = (w: any) => {
//   const t = w.find('.pi').text();
//   try { return JSON.parse(t || '{}'); } catch { return {}; }
// };
//
//
// /* ──────────────────────────────────────────────────────────────────────────
//  * Shared Components from Integration Tests
//  * ------------------------------------------------------------------------ */
//
// // From edgecases-behaviour.test.ts
// export const PostListTracker = (renders: string[][], firstNodeIds: string[]) =>
//   defineComponent({
//     name: 'PostList',
//     props: { first: Number, after: String },
//     setup(props) {
//       const vars = computed(() => {
//         const v: Record<string, any> = {};
//         if (props.first != null) v.first = props.first;
//         if (props.after != null) v.after = props.after;
//         return v;
//       });
//
//       const { useQuery } = require('villus');
//       const { data } = useQuery({
//         query: operations.POSTS_QUERY, // @connection on posts
//         variables: vars,
//         cachePolicy: 'network-only',
//       });
//
//       watch(
//         () => data.value,
//         (v) => {
//           const conn = v?.posts;
//           const edges = Array.isArray(conn?.edges) ? conn!.edges : [];
//           if (edges.length > 0) {
//             const titles = edges.map((e: any) => e?.node?.title || '');
//             renders.push(titles);
//             if (edges[0]?.node?.id != null) firstNodeIds.push(String(edges[0].node.id));
//           }
//         },
//         { immediate: true }
//       );
//
//       return () => (data.value?.posts?.edges || []).map((e: any) =>
//         h('div', { key: e.node.id }, e?.node?.title || '')
//       );
//     },
//   });
//
// // From cache-policies.test.ts
// export const UsersDiffTracker = (renders: string[][]) =>
//   defineComponent({
//     name: "UsersDiff",
//     setup() {
//       const { useQuery } = require("villus");
//       const { data } = useQuery({
//         query: operations.USERS_QUERY,
//         variables: { usersRole: "diff", usersFirst: 2, usersAfter: null },
//         cachePolicy: "cache-and-network",
//       });
//       watch(
//         () => data.value,
//         (v) => {
//           const emails = (v?.users?.edges ?? []).map((e: any) => e?.node?.email ?? "");
//           if (emails.length) renders.push(emails);
//         },
//         { immediate: true }
//       );
//       return () => (data.value?.users?.edges ?? []).map((e: any) => h("div", {}, e?.node?.email ?? ""));
//     },
//   });
//
// // Simple empty div component for cache-only tests
// export const EmptyDivComponent = defineComponent({ render: () => h("div") });
//
