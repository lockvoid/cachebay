import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client/core";
import { relayStylePagination } from "@apollo/client/utilities";
import { DefaultApolloClient, useLazyQuery } from "@vue/apollo-composable";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick } from "vue";
import { metrics } from "./instrumentation"; // ← shared metrics bucket

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
                    hasNextPage
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

export type VueApolloNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueApolloNestedApp(serverUrl: string): VueApolloNestedController {
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
    link: new HttpLink({ uri: serverUrl, fetch }),
    defaultOptions: { query: { fetchPolicy: "cache-first" } },
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

  let totalRenderTime = 0;
  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;

  const NestedList = defineComponent({
    setup() {
      const { result, load, fetchMore } = useLazyQuery(
        USERS_QUERY,
        {},
        { fetchPolicy: "cache-first", errorPolicy: "ignore" },
      );

      const loadNextPage = async () => {
        try {
          const t0 = performance.now();

          if (!result.value) {
            await load(USERS_QUERY, { first: 10, after: null });
          } else {
            const endCursor = result.value?.users?.pageInfo?.endCursor;
            if (endCursor) {
              await fetchMore({ variables: { first: 10, after: endCursor } });
            }
          }

          const t1 = performance.now();
          metrics.apollo.computeMs += (t1 - t0);
          metrics.apollo.pages += 1;

          await nextTick();

          const t2 = performance.now();
          const renderDelta = t2 - t1;
          totalRenderTime += renderDelta;
          metrics.apollo.renderMs += renderDelta;

        } catch (error) {
          console.warn("Apollo execute error (ignored):", error);
        }
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
      if (componentInstance) {
        await componentInstance.loadNextPage();
      }
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

    // Count only top-level user edges (to match other apps)
    getCount() {
      return componentInstance?.result?.users?.edges?.length ?? 0;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    },
  };
}
