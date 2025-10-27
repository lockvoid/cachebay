import { DefaultApolloClient, useLazyQuery } from "@vue/apollo-composable";
import { createApp, defineComponent, ref, watch, nextTick } from "vue";
import { createApolloClient } from "../adapters";
import { createDeferred } from "../utils/concurrency";
import { USERS_APOLLO_QUERY } from "../utils/queries";

export const createVueApolloNestedApp = (
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  yoga: any
) => {
    const client = createApolloClient({ yoga, cachePolicy });

  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;

  let deferred = createDeferred();
  let lastUserCount = 0;

  const NestedList = defineComponent({
    setup() {
      const { result, load, fetchMore, loading } = useLazyQuery(USERS_APOLLO_QUERY, { first: 30, after: null }, { fetchPolicy: cachePolicy });

      watch(result, (v) => {
        const totalUsers = result.value?.users?.edges?.length ?? 0;

        globalThis.apollo.totalEntities += totalUsers;

        if (totalUsers > lastUserCount) {
          lastUserCount = totalUsers;
          deferred.resolve();
        }
      }, { immediate: true });

      const loadNextPage = async () => {
        const t0 = performance.now();

        try {
          if (!result.value) {
            await load();

            await deferred.promise;
            deferred = createDeferred();
          } else {
            const cursor = result.value.users.pageInfo.endCursor;
            const hasNext = result.value.users.pageInfo.hasNextPage;

            if (!hasNext) {
              console.warn("Apollo: No more pages to load");
              return;
            }

            await fetchMore({ variables: { after: cursor } });

            await deferred.promise;
            deferred = createDeferred();
          }
        } catch (error) {
          console.error("Apollo loadNextPage error:", error);
          throw error;
        }

        const t2 = performance.now();

        await nextTick();

        const t3 = performance.now();

        globalThis.apollo.totalRenderTime += (t3 - t0);
        globalThis.apollo.totalNetworkTime += (t2 - t0);
      };

      return {
        result,
        loadNextPage,
      };
    },

    template: `
      <div>
        <div v-for="userEdge in result?.users?.edges" :key="userEdge.node.id">
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

  let componentInstance: any = null;

  return {
    mount(target?: Element) {
      if (app) return;

      container = target ?? document.createElement("div");
      if (!target) document.body.appendChild(container);

      app = createApp(NestedList);
      app.provide(DefaultApolloClient, client);
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
