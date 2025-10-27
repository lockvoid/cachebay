import { createApp, defineComponent, watch, ref, nextTick } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";
import { USERS_CACHEBAY_QUERY } from "../utils/queries";

export const createVueCachebayNestedApp = (
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  sharedYoga: any
) => {
  const yoga = sharedYoga;

  const transport = {
    http: async (context: any) => {
      const response = await yoga.fetch("http://localhost/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });

      const result = await response.json();

      return { data: result.data, error: result.errors?.[0] };
    },
  };

  const plugin = createCachebay({
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });

  let app: any = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  const NestedList = defineComponent({
    setup() {
      const { data, error, refetch, isFetching } = useQuery({ query: USERS_CACHEBAY_QUERY, variables: { first: 30, after: null }, cachePolicy, lazy: true });

      const endCursor = ref(null);

      watch(data, () => {
        const totalUsers = data.value?.users?.edges?.length ?? 0;

        globalThis.cachebay.totalEntities += totalUsers;
      }, { immediate: true });

      const loadNextPage = async () => {
        const t0 = performance.now();

        await refetch({ variables: { first: 30, after: endCursor.value } }).then((result) => {
          endCursor.value = result.data?.users?.pageInfo?.endCursor;
        });

        const t2 = performance.now();

        await nextTick();

        const t3 = performance.now();

        globalThis.cachebay.totalRenderTime += (t3 - t0);
        globalThis.cachebay.totalNetworkTime += (t2 - t0);
      };

      return { data, loadNextPage };
    },

    template: `
      <div>
        <div v-for="userEdge in data?.users?.edges" :key="userEdge.node.id">
          <h3>{{ userEdge.node.name }}</h3>
          <div v-for="postEdge in userEdge.node.posts?.edges" :key="postEdge.node.id">
            <h4>{{ postEdge.node.title }} ({{ postEdge.node.likeCount }} likes)</h4>
            <ul>
              <li v-for="commentEdge in postEdge.node.comments?.edges" :key="commentEdge.node.id">
                {{ commentEdge.node.text }} - {{ commentEdge.node.author.name }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    `,
  });

  return {
    mount(target?: Element) {
      if (app) return;
      container = target ?? document.createElement("div");
      if (!target) document.body.appendChild(container);

      app = createApp(NestedList);
      app.use(plugin);
      componentInstance = app.mount(container);
    },

    async loadNextPage() {
      await componentInstance.loadNextPage();
    },

    unmount() {
      if (app && container) {
        app.unmount();
        if (!container.parentElement) {
          container.remove();
        }
        app = null;
        container = null;
        componentInstance = null;
      }
    },
  };
}
