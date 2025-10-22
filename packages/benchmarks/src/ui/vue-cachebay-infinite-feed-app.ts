import { gql } from "graphql-tag";
import { createClient, useQuery, fetch as fetchPlugin } from "villus";
import { createApp, defineComponent, ref, reactive, nextTick, computed, watch } from "vue";
import { createCachebay } from "../../villus-cachebay/src/core/client";

const FEED_QUERY = gql`
  query Feed($first: Int!, $after: String) {
    feed(first: $first, after: $after) @connection {
      edges {
        cursor
        node { id title }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

export type VueCachebayController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueCachebayApp(
  serverUrl: string,
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only"
): VueCachebayController {
  const cachebay = createCachebay({});

  const client = createClient({
    url: serverUrl,
    use: [cachebay, fetchPlugin()],
    cachePolicy,
  });

  let totalRenderTime = 0;
  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;
  let onRenderComplete: (() => void) | null = null;

  const InfiniteList = defineComponent({
    setup() {
      const variables = reactive({
        first: 50,
        after: null as string | null,
      });

      const { data, execute } = useQuery({
        query: FEED_QUERY,
        paused: true,
      });

      const edgeCount = computed(() => data.value?.feed?.edges?.length || 0);
      let previousCount = 0;

      watch(edgeCount, (newCount) => {
        if (newCount > previousCount) {
          previousCount = newCount;
          nextTick(() => {
            onRenderComplete?.();
          });
        }
      });

      const loadNextPage = async () => {
        try {
          const renderStart = performance.now();

          const renderComplete = new Promise<void>(resolve => {
            onRenderComplete = resolve;
          });

          await execute({ variables });

          if (data.value?.feed?.pageInfo?.endCursor) {
            variables.after = data.value.feed.pageInfo.endCursor;
          }

          await renderComplete;
          onRenderComplete = null;

          const renderEnd = performance.now();
          totalRenderTime += renderEnd - renderStart;

        } catch (error) {
          console.warn("Cachebay execute error (ignored):", error);
        }
      };

      // watch(data, (newData) => {
      //   console.log('Cachebay data updated:', newData?.feed?.edges?.length || 0, 'edges');
      // });

      return {
        data,
        loadNextPage,
      };
    },

    template: `
      <div>
        <ul>
          <li v-for="edge in data?.feed?.edges" :key="edge.node.id">
            {{ edge.node.title }}
          </li>
        </ul>
      </div>
    `,
  });

  let componentInstance: any = null;

  return {
    mount(target?: Element) {
      if (app) return;

      container = target ?? document.createElement("div");
      if (!target) document.body.appendChild(container);

      app = createApp(InfiniteList);
      app.use(client);
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

    getCount() {
      return componentInstance?.data?.feed?.edges?.length || 0;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    },
  };
}
