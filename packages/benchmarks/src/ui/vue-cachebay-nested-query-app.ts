import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, reactive } from "vue";
import { createCachebay } from "../../../cachebay/src/core/client";
import { createCachebayPlugin, useQuery } from "../../../cachebay/src/adapters/vue";

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

  const cachebay = createCachebay({
    interfaces: { Node: ["User", "Post", "Comment"] },
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });

  const plugin = createCachebayPlugin(cachebay);

  let totalRenderTime = 0;
  let app: any = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  const NestedList = defineComponent({
    setup() {
      // Make variables reactive so useQuery can watch for changes
      const variables = reactive<{ first: number; after: string | null }>({ first: 10, after: null });

      const { data, error, refetch, isFetching } = useQuery({
        query: USERS_QUERY,
        variables: () => variables,
        cachePolicy,
      });

      // watch(() => data.value, () => {
      //  console.log('data.value.users.edges changed', data.value.users.edges.length);
      // });

      const loadNextPage = async () => {
        try {
          const t0 = performance.now();

          console.log('Before - variables:', JSON.stringify(variables));
          console.log('Before - data:', data.value);
          console.log('Before - isFetching:', isFetching.value);
          
          // Get endCursor from current data and update variables
          const endCursor = data.value?.users?.pageInfo?.endCursor ?? null;
          if (endCursor) {
            variables.after = endCursor;
            console.log('Updated variables.after to:', endCursor);
            
            // Wait for the watch to trigger and query to complete
            await nextTick();
            
            // Wait for isFetching to become false
            while (isFetching.value) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          console.log('After - data:', data.value);
          console.log('After - error:', error.value);

          // Ensure DOM paint before measuring render time.
          await nextTick();

          const t1 = performance.now();
          totalRenderTime += (t1 - t0);
        } catch (err) {
          // swallow errors so the bench keeps going

          console.warn("Cachebay execute error (ignored):", err);
        }
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

    getCount() {
      return componentInstance?.data?.users?.edges?.length ?? 0;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    },
  };
}
