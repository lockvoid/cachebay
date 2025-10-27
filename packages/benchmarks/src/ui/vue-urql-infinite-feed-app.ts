import { createClient as createUrqlClient, fetchExchange } from "@urql/core";
import { cacheExchange as graphcache } from "@urql/exchange-graphcache";
import { relayPagination } from "@urql/exchange-graphcache/extras";
import urql, { useQuery } from "@urql/vue";
import { createApp, defineComponent, ref, watch, nextTick } from "vue";
import { createDeferred } from "../utils/concurrency";
import { USERS_APOLLO_QUERY } from "../utils/queries";

const DEBUG = process.env.DEBUG === "true";

export type VueUrqlNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
};

const mapCachePolicyToUrql = (policy: "network-only" | "cache-first" | "cache-and-network"): "network-only" | "cache-first" | "cache-and-network" => {
  return policy;
};

export const createVueUrqlNestedApp = (
  serverUrl: string,
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  sharedYoga: any
): VueUrqlNestedController => {
  const yoga = sharedYoga;

  const cache = graphcache({
    resolvers: {
      Query: { users: relayPagination() },
      User: { posts: relayPagination(), followers: relayPagination() },
      Post: { comments: relayPagination() },
    },
  });

  const customFetch = async (url: string, options: any) => {
    return await yoga.fetch(url, options);
  };

  const client = createUrqlClient({
    url: serverUrl,
    requestPolicy: mapCachePolicyToUrql(cachePolicy),
    exchanges: [cache, fetchExchange],
    fetch: customFetch,
  });

  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  let deferred = createDeferred();
  let isFirstCall = true;

  const NestedList = defineComponent({
    setup() {
      const variables = ref({ first: 30, after: null });

      const { data, executeQuery } = useQuery({
        query: USERS_APOLLO_QUERY,
        variables,
      });

      watch(data, (v) => {
        const totalUsers = data.value?.users?.edges?.length ?? 0;

        globalThis.urql.totalEntities += totalUsers;

        deferred.resolve();
      }, { immediate: true });

      const loadNextPage = async (isLastPage) => {
        if (isFirstCall) {
          await deferred.promise;
          isFirstCall = false;
        }

        const t0 = performance.now();

        deferred = createDeferred();

        variables.value = {
          first: 30,
          after: data.value?.users?.pageInfo?.endCursor || null,
        };

        executeQuery({ requestPolicy: "network-only" });

        await deferred.promise;

        const t2 = performance.now();

        await nextTick();

        const t3 = performance.now();

        globalThis.urql.totalRenderTime += (t3 - t0);
        globalThis.urql.totalNetworkTime += (t2 - t0);
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
      app.use(urql, client);
      componentInstance = app.mount(container);
    },

    async loadNextPage() {
      await componentInstance?.loadNextPage?.();
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
