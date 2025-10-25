import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";

const USERS_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) @connection {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) @connection {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) @connection {
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
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
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

export type VueCachebayNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueCachebayNestedApp(
  serverUrl: string,
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only"
): VueCachebayNestedController {
  // Reset metrics bucket for this app/run.

  // Create transport using real fetch (like Relay's network)
  const transport = {
    http: async (context: any) => {
      const response = await fetch(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });
      const result = await response.json();
      return {
        data: result.data || null,
        error: result.errors?.[0] || null
      };
    },
  };


  const plugin = createCachebay({
    interfaces: { Node: ["User", "Post", "Comment"] },
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });

  let totalRenderTime = 0;
  let app: any = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  const NestedList = defineComponent({
    setup() {
      const { data, error, refetch, isFetching } = useQuery({ query: USERS_QUERY, variables: { first: 10, after: null }, cachePolicy });

      const loadNextPage = async () => {
        const t0 = performance.now();

        while (!data.value) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const endCursor = data.value.users.pageInfo.endCursor;

        if (endCursor) {
          await refetch({ variables: { first: 10, after: endCursor } });
        }

        const t2 = performance.now();

        await nextTick();

        const t3 = performance.now();

        globalThis.cachebay.totalRenderTime += (t3 - t0);
        globalThis.cachebay.totalNetworkTime += (t2 - t0);
        globalThis.cachebay.totalEntities += data.value.users.edges.length;
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
