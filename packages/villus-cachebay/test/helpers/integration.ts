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

export function createTestClient({ routes, cache, cacheOptions }: { routes?: Route[], cache?: any, cacheOptions?: any } = {}) {
  const finalCache = cache ?? createCache({
    suspensionTimeout: 0,

    ...(cacheOptions || {}),

    keys: {
      Comment: (comment: any) => {
        return String(comment.uuid);
      },

      ...(cacheOptions?.keys || {}),
    },

    interfaces: {
      Post: ['AudioPost', 'VideoPost'],

      ...(cacheOptions?.interfaces || {}),
    },
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

export function createFetchMock(routes: Route[] = []) {
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

  const renders: any[] = [];
  const errors: any[] = [];

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

      watch(error, (value) => {
        if (value) {
          errors.push(value);
        }
      }, { immediate: true });

      return () => {
        if (!connection.value && isFetching.value) {
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
  (component as any).errors = errors;

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
  const errors: any[] = [];

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
        errors.push(error.value);

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

    inheritAttrs: false,

    props: {
      // Accept any props that will be passed to the inner component
    },

    setup(props, { attrs }) {
      return () => h(Suspense, {}, {
        default: () => h(ConnectionComponent, attrs),
        fallback: () => h("div", { class: "loading" }, "Loading...")
      });
    }
  });

  (component as any).renders = renders;
  (component as any).errors = errors;

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
  const errors: any[] = [];

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

      watch(data, (value) => {
        if (!value) {
          return;
        }

        renders.push(detailFn(value));
      }, { immediate: true });

      watch(error, (value) => {
        if (value) {
          errors.push(value);
        }
      }, { immediate: true });

      return () => {
        if (!detail.value && isFetching.value) {
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
  (component as any).errors = errors;

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
  const errors: any[] = [];

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
        errors.push(error.value);

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
  (component as any).errors = errors;

  return component;
};
