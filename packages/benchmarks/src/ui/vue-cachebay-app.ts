import { createApp, defineComponent, ref, watch, reactive, nextTick } from 'vue';
import { createClient, useQuery, fetch as fetchPlugin } from 'villus';
import { gql } from 'graphql-tag';
import { createCache } from 'villus-cachebay';

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

export function createVueCachebayApp(serverUrl: string): VueCachebayController {
  const cachebay = createCache({});

  const client = createClient({
    url: serverUrl,
    use: [cachebay, fetchPlugin()],
    cachePolicy: 'network-only'
  });

  let totalRenderTime = 0; // render-only total (post-data -> nextTick)
  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;

  const InfiniteList = defineComponent({
    setup() {
      const variables = reactive({
        first: 50,
        after: null as string | null
      });

      const { data, execute } = useQuery({
        query: FEED_QUERY,
        paused: true,
      });

      const loadNextPage = async () => {
        try {
          await execute({ variables });

          if (data.value?.feed?.pageInfo?.endCursor) {
            variables.after = data.value.feed.pageInfo.endCursor;
          }

          // ---- render-only timing (post-data -> DOM flush) ----
          const renderStart = performance.now();
          await nextTick();
          const renderEnd = performance.now();
          totalRenderTime += renderEnd - renderStart;
          // -----------------------------------------------------

        } catch (error) {
          console.warn('Cachebay execute error (ignored):', error);
        }
      };

      // watch(data, (newData) => {
      //   console.log('Cachebay data updated:', newData?.feed?.edges?.length || 0, 'edges');
      // });

      return {
        data,
        loadNextPage
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
    `
  });

  let componentInstance: any = null;

  return {
    mount(target?: Element) {
      if (app) return;

      container = target ?? document.createElement('div');
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
    }
  };
}
