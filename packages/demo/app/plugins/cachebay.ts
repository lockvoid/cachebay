import { createCachebay } from "cachebay/vue";
import type { HttpContext, WsContext, OperationResult } from "cachebay";
import * as sse from 'graphql-sse';
import { print, type DocumentNode } from 'graphql';

const createHttpTransport = (url: string) => {
  return async (ctx: HttpContext): Promise<OperationResult> => {
    const query = typeof ctx.query === 'string' ? ctx.query : print(ctx.query as DocumentNode);

    try {
      const result = await $fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          query,
          variables: ctx.variables,
        },
      });

      return {
        data: result.data,
        error: result.errors?.[0] ? new Error(result.errors[0].message) : null,
      };
    } catch (error: any) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };
};

const createWsTransport = (url: string) => {
  if (import.meta.server) {
    return undefined;
  }

  const sseClient = sse.createClient({ url });

  return async (ctx: WsContext) => {
    return {
      subscribe: (observer: any) => {
        const unsubscribe = sseClient.subscribe({ query: ctx.query, variables: ctx.variables }, {
          next: (value: any) => {
            observer.next?.({ data: value.data, error: value.errors?.[0] ? new Error(value.errors[0].message) : null });
          },

          error: (error: any) => {
            observer.error?.(error);
          },

          complete: () => {
            observer.complete?.();
          },
        });

        return { unsubscribe };
      },
    };
  };
};

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const settings = useSettings();

  const url = import.meta.server ? config.graphqlServerEndpoint : config.public.graphqlClientEndpoint;

  const cachebay = createCachebay({
    cachePolicy: settings.cachePolicy,

    transport: {
      http: createHttpTransport(url),
      ws: createWsTransport(url),
    },
  });

  nuxtApp.vueApp.use(cachebay);

  nuxtApp.provide("cachebay", cachebay);

  if (import.meta.server) {
    nuxtApp.hook("app:rendered", () => {
      useState("cachebay").value = cachebay.dehydrate();
    });
  }

  if (import.meta.client && settings.ssr) {
    const state = useState("cachebay").value;

    if (state) {
      cachebay.hydrate(state);
    }
  }

  if (import.meta.client) {
    window.CACHEBAY = cachebay;
  }
});
