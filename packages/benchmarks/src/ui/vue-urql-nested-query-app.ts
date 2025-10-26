import { createClient as createUrqlClient, fetchExchange } from "@urql/core";
import { cacheExchange as graphcache } from "@urql/exchange-graphcache";
import { relayPagination } from "@urql/exchange-graphcache/extras";
import urql, { useQuery } from "@urql/vue";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createDeferred } from "../utils/concurrency";
import { createNestedYoga } from "../server/nested-query-server";
import { makeNestedDataset } from "../utils/seed-nested-query";
const DEBUG = process.env.DEBUG === 'true';

const USERS_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) {
                  edges {
                    cursor
                    node {
                      id
                      text
                      author {
                        id
                        name
                      }
                    }
                  }
                  pageInfo {
                    startCursor
                    endCursor
                    hasPreviousPage
                    hasNextPage
                  }
                }
              }
            }
            pageInfo {
              startCursor
              endCursor
              hasPreviousPage
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        startCursor
        endCursor
        hasPreviousPage
        hasNextPage
      }
    }
  }
`;

export type VueUrqlNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
};

function mapCachePolicyToUrql(policy: "network-only" | "cache-first" | "cache-and-network"): "network-only" | "cache-first" | "cache-and-network" {
  return policy;
}

export function createVueUrqlNestedApp(
  serverUrl: string, // unused - kept for API compatibility
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  debug = false,
  sharedYoga?: any, // Optional shared Yoga instance
): VueUrqlNestedController {
  // Use shared Yoga instance if provided, otherwise create new one
  const yoga = sharedYoga || createNestedYoga(makeNestedDataset(), 0);

  const cache = graphcache({
    resolvers: {
      Query: { users: relayPagination() },
      User: { posts: relayPagination(), followers: relayPagination() },
      Post: { comments: relayPagination() },
    },
  });

  // Custom fetch using Yoga directly (in-memory, no HTTP)
  const customFetch = async (url: string, options: any) => {
    // urql uses GET with query params by default, we need to pass the full URL
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
        query: USERS_QUERY,
        variables,
      });

      watch(data, (v) => {
        const totalUsers = data.value?.users?.edges?.length ?? 0;

        //console.log(`urql total users:`, totalUsers);
        globalThis.urql.totalEntities += totalUsers;

        // Resolve deferred when data changes (cache merge completed)
        deferred.resolve();
      }, { immediate: true });

      const loadNextPage = async (isLastPage) => {
        // For first call, wait for initial data to be ready
        if (isFirstCall) {
          await deferred.promise;
          isFirstCall = false;
        }

        const t0 = performance.now();

        deferred = createDeferred();

        // Update variables and explicitly execute query
        variables.value = {
          first: 30,
          after: data.value?.users?.pageInfo?.endCursor || null
        };

        // Execute query with network-only to force fetch
        executeQuery({ requestPolicy: 'network-only' });

        // Wait for the new data to arrive (deferred will be resolved by watch)
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
