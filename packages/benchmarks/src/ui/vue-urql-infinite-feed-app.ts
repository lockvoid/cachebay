import { createApp, defineComponent, reactive, nextTick, computed, watch } from 'vue';
import urql, { useQuery } from '@urql/vue';
import { createClient as createUrqlClient, fetchExchange } from '@urql/core';
import { cacheExchange as graphcache } from '@urql/exchange-graphcache';
import { relayPagination } from '@urql/exchange-graphcache/extras';
import { gql } from 'graphql-tag';

const FEED_QUERY = gql`
  query Feed($first: Int!, $after: String) {
    feed(first: $first, after: $after) {
      edges { cursor node { id title } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export type VueUrqlController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueUrqlApp(serverUrl: string): VueUrqlController {
  const cache = graphcache({
    resolvers: {
      Query: { feed: relayPagination() },
    },
  });

  const client = createUrqlClient({
    url: serverUrl,
    requestPolicy: 'network-only',
    exchanges: [cache, fetchExchange],
  });

  let totalRenderTime = 0;
  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;
  let componentInstance: any = null;
  let onRenderComplete: (() => void) | null = null;

  const InfiniteList = defineComponent({
    setup() {
      const variables = reactive<{ first: number; after: string | null }>({
        first: 50,
        after: null,
      });

      const { data, executeQuery } = useQuery({
        query: FEED_QUERY,
        variables,
        pause: true,
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
        const renderStart = performance.now();
        
        const renderComplete = new Promise<void>(resolve => {
          onRenderComplete = resolve;
        });

        await executeQuery({ variables, requestPolicy: 'network-only' });

        const endCursor = data.value?.feed?.pageInfo?.endCursor ?? null;
        if (endCursor) variables.after = endCursor;

        await renderComplete;
        onRenderComplete = null;
        
        const renderEnd = performance.now();
        totalRenderTime += renderEnd - renderStart;
      };

      // watch(data, (d) => {
      //   console.log('urql data updated:', d?.feed?.edges?.length || 0, 'edges');
      // });

      return { data, loadNextPage };
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

  return {
    mount(target?: Element) {
      if (app) return;
      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);
      app = createApp(InfiniteList);
      app.use(urql, client);
      componentInstance = app.mount(container);
    },

    async loadNextPage() {
      await componentInstance?.loadNextPage();
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

    getCount() {
      return componentInstance?.data?.feed?.edges?.length || 0;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    },
  };
}
