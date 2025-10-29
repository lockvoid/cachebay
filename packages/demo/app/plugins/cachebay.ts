import { createCachebay } from "cachebay/vue";
import type { HttpContext, WsContext, OperationResult } from "cachebay";
import * as sse from 'graphql-sse';

const createHttpTransport = (url: string) => {
  return async (ctx: HttpContext): Promise<OperationResult> => {
    try {
      const result = await $fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          query: ctx.query,
          variables: ctx.variables,
        },
      });

      return { data: result.data, error: result.errors?.[0] };
    } catch (error) {
      return { data: null, error };
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
        console.log('SUPERsubscribe')
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
      cachebay.hydrate(toRaw(state));
    }
  }

  if (import.meta.client) {
    window.CACHEBAY = cachebay;
  }
});
