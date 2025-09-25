import { createClient, fetch as fetchPlugin, dedup as dedupPlugin } from 'villus';
import { createCache } from 'villus-cachebay';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const settings = useSettings();

  const cachebay = createCache({
    //
  });

  const villus = createClient({
    url: config.public.graphqlEndpoint,

    cachePolicy: settings.cachePolicy,

    use: [
      cachebay,
      dedupPlugin(),
      fetchPlugin(),
    ],
  });

  nuxtApp.vueApp.use(villus);
  nuxtApp.vueApp.use(cachebay);

  nuxtApp.provide('villus', villus);
  nuxtApp.provide('cachebay', cachebay);

  if (import.meta.client && settings.ssr) {
    const state = useState<any>('cachebay').value;

    if (state) {
      cachebay.hydrate(state);
    }
  }

  nuxtApp.hook("app:rendered", () => {
    if (import.meta.server) {
      useState("cachebay").value = cachebay.dehydrate();
    }
  });

  if (import.meta.client) {
    window.CACHEBAY = cachebay;
  }
});
