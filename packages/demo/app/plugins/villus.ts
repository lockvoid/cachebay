import { createClient, fetch as fetchPlugin, dedup as dedupPlugin } from "villus";
import { createCache } from "villus-cachebay";

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();

  const settings = useSettings();

  const cachebay = createCache({
    //
  });

  console.log("Cachebay initialized", config.public);

  const villus = createClient({
    url: import.meta.server ? config.graphqlServerEndpoint : config.public.graphqlClientEndpoint,

    cachePolicy: settings.cachePolicy,

    use: [
      cachebay,
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
