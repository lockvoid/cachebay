import { createClient, handleSubscriptions, fetch as fetchPlugin, dedup as dedupPlugin } from "villus";
import { createCachebay } from "villus-cachebay";
import * as sse from 'graphql-sse';

const createSubscriptions = (url: string) => {
  const client = sse.createClient({
    url,
  })

  return handleSubscriptions(operation => ({
    subscribe: (observer) => {
      const unsubscribe = client.subscribe(
        {
          query: operation.query,
          variables: operation.variables,
        },

        {
          next: (value) => {
            observer.next?.(value);
          },

          error: (error) => {
            observer.error?.(error);
          },

          complete: () => {
            observer.complete?.();
          },
        }
      )

      return { unsubscribe }
    },
  }));
};

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const settings = useSettings();

  const cachebay = createCachebay({
    // keys: { ... }, etc
  });

  const villus = createClient({
    url: import.meta.server ? config.graphqlServerEndpoint : config.public.graphqlClientEndpoint,

    cachePolicy: settings.cachePolicy,

    use: import.meta.server ? [
      cachebay,
      dedupPlugin(),
      fetchPlugin(),
    ] : [
      cachebay,
      createSubscriptions(config.public.graphqlClientEndpoint),
      dedupPlugin(),
      fetchPlugin(),
    ],
  });

  nuxtApp.vueApp.use(villus);
  nuxtApp.vueApp.use(cachebay);

  nuxtApp.provide("villus", villus);
  nuxtApp.provide("cachebay", cachebay);

  if (import.meta.server) {
    nuxtApp.hook("app:rendered", () => {
      useState("cachebay").value = cachebay.dehydrate();
    });
  };

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
