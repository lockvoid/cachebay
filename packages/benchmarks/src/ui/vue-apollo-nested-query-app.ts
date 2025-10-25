import { ApolloClient, InMemoryCache, ApolloLink, Observable } from "@apollo/client/core";
import { relayStylePagination } from "@apollo/client/utilities";
import { DefaultApolloClient, useLazyQuery, useQuery } from "@vue/apollo-composable";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createDeferred } from "../utils/render";
import { createNestedYoga } from "../server/schema-nested";
import { makeNestedDataset } from "../utils/seed-nested";

try {
  const { loadErrorMessages, loadDevMessages } = require("@apollo/client/dev");
  loadDevMessages?.();
  loadErrorMessages?.();
} catch { /* ignore */ }

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

export type VueApolloNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
};

export function createVueApolloNestedApp(
  serverUrl: string, // unused - kept for API compatibility
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  debug: boolean = false
): VueApolloNestedController {
  // Create dataset and Yoga instance once
  const dataset = makeNestedDataset();
  const yoga = createNestedYoga(dataset, 0);

  // Custom Apollo Link using Yoga directly (in-memory, no HTTP)
  const yogaLink = new ApolloLink((operation) => {
    return new Observable((observer) => {
      (async () => {
        try {
          // Use print from graphql to convert the query AST to string
          const { print } = await import('graphql');
          const query = print(operation.query);

          const response = await yoga.fetch('http://localhost/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              variables: operation.variables,
              operationName: operation.operationName,
            }),
          });

          const result = await response.json();
          observer.next(result);
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();
    });
  });

  const client = new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            users: relayStylePagination(["first"]),
          },
        },
        User: {
          fields: {
            posts: relayStylePagination(["first"]),
            followers: relayStylePagination(["first"]),
          },
        },
        Post: {
          fields: {
            comments: relayStylePagination(["first"]),
          },
        },
      },
    }),
    link: yogaLink,
    defaultOptions: { query: { fetchPolicy: cachePolicy } },
  });

  // keep client behavior unchanged
  const stripCanon = (o?: Record<string, unknown>) => {
    if (!o) return;
    if ("canonizeResults" in o) {
      try { delete (o as any).canonizeResults; }
      catch { (o as any).canonizeResults = undefined; }
    }
  };
  stripCanon(client.defaultOptions?.query);
  stripCanon(client.defaultOptions?.watchQuery);
  stripCanon(client.defaultOptions?.mutate);

  const _watchQuery = client.watchQuery.bind(client);
  client.watchQuery = (opts: any) => {
    stripCanon(opts);
    return _watchQuery(opts);
  };
  const _query = client.query.bind(client);
  client.query = (opts: any) => {
    stripCanon(opts);
    return _query(opts);
  };

  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;

  let deferred = createDeferred();

  const NestedList = defineComponent({
    setup() {
      const { result, load, fetchMore, loading } = useQuery(USERS_QUERY, { first: 30, after: null }, { fetchPolicy: cachePolicy });

      const endCursor = ref(null)

      watch(result, (v) => {
        const totalUsers = result.value?.users?.edges?.length ?? 0;

          console.log(`Apollo total users:`, totalUsers);

        globalThis.apollo.totalEntities += totalUsers;
      }, { immediate: true });

      watch(() => result.value?.users?.pageInfo?.endCursor , (v) => {
        deferred.resolve();
      });

      const loadNextPage = async () => {
        const t0 = performance.now();

        await deferred.promise;

        deferred = createDeferred();

        await fetchMore({ variables: { after: result.value.users.pageInfo.endCursor } });

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
