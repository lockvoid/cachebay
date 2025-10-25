import { createClient as createUrqlClient, fetchExchange } from "@urql/core";
import { cacheExchange as graphcache } from "@urql/exchange-graphcache";
import { relayPagination } from "@urql/exchange-graphcache/extras";
import urql, { useQuery } from "@urql/vue";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick } from "vue";

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
                      author { id name }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
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
  serverUrl: string,
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only"
): VueUrqlNestedController {
  const cache = graphcache({
    resolvers: {
      Query: { users: relayPagination() },
      User: { posts: relayPagination(), followers: relayPagination() },
      Post: { comments: relayPagination() },
    },
  });

  const client = createUrqlClient({
    url: serverUrl,
    requestPolicy: mapCachePolicyToUrql(cachePolicy),
    exchanges: [cache, fetchExchange],
  });

  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  const NestedList = defineComponent({
    setup() {
      const { data, executeQuery } = useQuery({
        query: USERS_QUERY,
        variables: { first: 10, after: null },
      });

      const loadNextPage = async () => {
        const t0 = performance.now();

        while (!data.value) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const endCursor = data.value.users.pageInfo.endCursor;

        if (endCursor) {
          await executeQuery({ variables: { first: 10, after: endCursor } });
        }

        const t2 = performance.now();

        await nextTick();

        const t3 = performance.now();

        globalThis.urql.totalRenderTime += (t3 - t0);
        globalThis.urql.totalNetworkTime += (t2 - t0);
        globalThis.urql.totalEntities += data.value.users.edges.length;
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
      await componentInstance.loadNextPage();
    },

    unmount() {
      if (app && container) {
        app.unmount();
        if (container.parentElement) container.remove();
        app = null;
        container = null;
        componentInstance = null;
      }
    },
  };
}
