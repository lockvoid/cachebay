import { defineComponent, h, computed, watch, Suspense } from "vue";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { useQuery } from "@/src/adapters/vue/useQuery";
import { createCachebay } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";
import { tick, delay } from "./concurrency";

export async function seedCache(cache, { query, variables, data }) {
  cache.writeQuery({ query, variables, data });

  await tick();
}

export function createTestClient({ routes, cache, cacheOptions }: { routes?: Route[], cache?: any, cacheOptions?: any } = {}) {
  console.log("Creating test client", routes);
  const fx = createTransportMock(routes);

  let finalCache;

  // If cache is provided, dehydrate it and create a fresh one with new transport
  if (cache) {
    const state = cache.dehydrate();

    finalCache = createCachebay({
      suspensionTimeout: 0,
      transport: fx.transport,

      ...(cacheOptions || {}),

      keys: {
        Comment: (comment: any) => {
          return String(comment.uuid);
        },

        ...(cacheOptions?.keys || {}),
      },

      interfaces: {
        Post: ["AudioPost", "VideoPost"],

        ...(cacheOptions?.interfaces || {}),
      },
    });

    // Hydrate the state into the new cache
    finalCache.hydrate(state);
  } else {
    // Create new cache with the transport
    finalCache = createCachebay({
      suspensionTimeout: 0,
      transport: fx.transport,

      ...(cacheOptions || {}),

      keys: {
        Comment: (comment: any) => {
          return String(comment.uuid);
        },

        ...(cacheOptions?.keys || {}),
      },

      interfaces: {
        Post: ["AudioPost", "VideoPost"],

        ...(cacheOptions?.interfaces || {}),
      },
    });
  }

  // Create Vue plugin that provides the cache
  const client = {
    install(app: any) {
      provideCachebay(app, finalCache);
    },
  };

  return { client, cache: finalCache, fx };
}

export type Route = {
  when: (op: { body: string; variables: any; context: any }) => boolean;
  respond: (op: { body: string; variables: any; context: any }) => { data?: any; error?: any }
  delay?: number;
};

type RecordedCall = { query: string; variables: any };

export function createTransportMock(routes: Route[] = []) {
  const calls: Array<RecordedCall> = [];
  let pending = 0;

  const transport: Transport = {
    http: async (context) => {
      const { query, variables } = context;
      const queryStr = typeof query === "string" ? query : query.loc?.source.body || "";
      const op = { body: queryStr, variables, context };

      console.log('routes', routes)
      const route = routes.find(r => {
        const found = r.when(op);
        console.log('FOUND ROUTE', found, op)
        return found;
      });
      if (!route) {
        console.log('NO ROUTE', op)
        // unmatched: return benign payload; do not count as "call"
        return { data: null, error: null };
      }

      calls.push({ query: queryStr, variables });
      pending++;

      try {
        console.log('DELAY', route.delay)
        if (route.delay && route.delay > 0) {
          await delay(route.delay);
        }

        const payload = route.respond(op);

        if (payload && typeof payload === "object" && "error" in payload && (payload as any).error) {
          return {
            data: null,
            error: (payload as any).error,
          };
        }

        return {
          data: payload?.data || payload,
          error: null,
        };
      } finally {
        if (pending > 0) pending--;
      }
    },
  };

  return {
    transport,
    calls,

    async restore(timeoutMs = 200) {
      const end = Date.now() + timeoutMs;
      while (pending > 0 && Date.now() < end) {
        await tick();
      }
    },
  };
}

export const getEdges = (wrapper: any, fieldName: string) => {
  return wrapper.findAll(`li.edge div.${fieldName}`).map((field: any) => field.text());
};

export const getPageInfo = (wrapper: any) => {
  const pageInfoDiv = wrapper.find("div.pageInfo");

  if (!pageInfoDiv.exists()) {
    return {};
  }

  return {
    startCursor: pageInfoDiv.find("div.startCursor").text() || null,
    endCursor: pageInfoDiv.find("div.endCursor").text() || null,
    hasNextPage: pageInfoDiv.find("div.hasNextPage").text() === "true",
    hasPreviousPage: pageInfoDiv.find("div.hasPreviousPage").text() === "true",
  };
};

export const createConnectionComponent = (
  query: any,

  options: {
    cachePolicy: "cache-first" | "cache-and-network" | "network-only" | "cache-only";
    connectionFn: (data: any) => any;
  },
) => {
  const { cachePolicy, connectionFn } = options;

  const renders: any[] = [];
  const errors: any[] = [];

  const component = defineComponent({
    name: "ListComponent",

    inheritAttrs: false,

    setup(props, { attrs }) {
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
        console.log('[Component]', Date.now(), 'WATCH FIRED: data.value =', JSON.stringify(value, null, 2));
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
          return h("div", { class: "error" }, error.value.message || JSON.stringify(error.value));
        }

        return h("div", {}, [
          h("div", { class: "pageInfo" }, [
            h("div", { class: "startCursor" }, String(connection.value?.pageInfo?.startCursor ?? "")),
            h("div", { class: "endCursor" }, String(connection.value?.pageInfo?.endCursor ?? "")),
            h("div", { class: "hasNextPage" }, String(connection.value?.pageInfo?.hasNextPage ?? false)),
            h("div", { class: "hasPreviousPage" }, String(connection.value?.pageInfo?.hasPreviousPage ?? false)),
          ]),

          h("ul", { class: "edges" },
            (connection.value?.edges ?? []).map((edge: any, index: number) => {
              const node = edge?.node ?? {};

              return h("li", { class: "edge", key: node.id || index },
                Object.keys(node).map(field =>
                  h("div", { class: field }, String(node[field])),
                ),
              );
            }),
          ),
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
  },
) => {
  const { cachePolicy, connectionFn } = options;

  const renders: any[][] = [];
  const errors: any[] = [];

  const ConnectionComponent = defineComponent({
    name: "ListComponentSuspense",

    inheritAttrs: false,

    async setup(props, { attrs }) {
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
            h("div", { class: "hasPreviousPage" }, String(connection.value?.pageInfo?.hasPreviousPage ?? false)),
          ]),

          h("ul", { class: "edges" },
            (connection.value?.edges ?? []).map((edge: any, index: number) => {
              const node = edge?.node ?? {};

              return h("li", { class: "edge", key: node.id || index },
                Object.keys(node).map(field =>
                  h("div", { class: field }, String(node[field])),
                ),
              );
            }),
          ),
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
        fallback: () => h("div", { class: "loading" }, "Loading..."),
      });
    },
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
  },
) => {
  const { cachePolicy, detailFn } = options;

  const renders: any[][] = [];
  const errors: any[] = [];

  const component = defineComponent({
    name: "DetailComponent",

    inheritAttrs: false,

    setup(props, { attrs }) {
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
          return h("div", { class: "error" }, error.value.message || JSON.stringify(error.value));
        }

        return h("ul", { class: "edges" }, [
          h("li", { class: "edge" },
            Object.keys(detail.value ?? {}).map(fieldName =>
              h("div", { class: fieldName }, String(detail.value[fieldName])),
            ),
          ),
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
  },
) => {
  const { cachePolicy, detailFn } = options;

  const renders: any[][] = [];
  const errors: any[] = [];

  const DetailComponent = defineComponent({
    name: "DetailComponentSuspense",

    inheritAttrs: false,

    async setup(props, { attrs }) {
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
              h("div", { class: fieldName }, String(detail.value[fieldName])),
            ),
          ),
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
        fallback: () => h("div", { class: "loading" }, "Loading..."),
      });
    },
  });

  (component as any).renders = renders;
  (component as any).errors = errors;

  return component;
};
