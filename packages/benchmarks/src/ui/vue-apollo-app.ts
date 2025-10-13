import { createApp, defineComponent, ref, watch, nextTick } from 'vue';
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client/core';
import { relayStylePagination } from '@apollo/client/utilities';
import { gql } from 'graphql-tag';
import { DefaultApolloClient, useLazyQuery } from '@vue/apollo-composable';

// Dev/error messages so Apollo stops giving opaque URLs
try {
  // These are no-ops in prod builds
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadErrorMessages, loadDevMessages } = require('@apollo/client/dev');
  loadDevMessages?.();
  loadErrorMessages?.();
} catch { /* ignore if not present */ }

const FEED_QUERY = gql`
  query Feed($first: Int!, $after: String) {
    feed(first: $first, after: $after) {
      edges { cursor node { id title } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export type VueApolloController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueApolloApp(serverUrl: string): VueApolloController {
  const client = new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            // keep your original behavior
            feed: relayStylePagination(['first']),
          },
        },
      },
    }),
    link: new HttpLink({ uri: serverUrl, fetch }),
    defaultOptions: { query: { fetchPolicy: 'cache-first' } },
  });

  // Strip any 'canonizeResults' that might be set elsewhere (3.14 removed it)
  const stripCanon = (o?: Record<string, unknown>) => {
    if (!o) return;
    // delete + fallback to undefined in case delete is blocked by TS narrowing
    if ('canonizeResults' in o) { try { delete (o as any).canonizeResults; } catch { (o as any).canonizeResults = undefined; } }
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

  let totalRenderTime = 0; // render-only (post-data -> nextTick)
  let app: ReturnType<typeof createApp> | null = null;
  let container: Element | null = null;

  const InfiniteList = defineComponent({
    setup() {
      const { result, load, fetchMore, loading } = useLazyQuery(
        FEED_QUERY,
        {},
        { fetchPolicy: 'cache-first', errorPolicy: 'ignore' }
      );

      let isFirstLoad = true;

      const loadNextPage = async () => {
        if (loading.value) return;

        try {
          if (isFirstLoad) {
            // keep your original call signature
            await load(FEED_QUERY, { first: 50, after: null });
            isFirstLoad = false;
          } else {
            await fetchMore({
              variables: {
                first: 50,
                after: result.value?.feed?.pageInfo?.endCursor,
              },
            });
          }

          // ---- render-only timing (post-data -> DOM flush) ----
          const renderStart = performance.now();
          await nextTick();
          const renderEnd = performance.now();
          totalRenderTime += renderEnd - renderStart;
          // -----------------------------------------------------

        } catch (error) {
          console.warn('Apollo load/fetchMore error (ignored):', error);
        }
      };

      // watch(result, (newData) => {
      //   console.log('Apollo data updated:', newData?.feed?.edges?.length || 0, 'edges');
      // });

      return {
        data: result,
        loadNextPage,
        loading,
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

      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);

      app = createApp(InfiniteList);
      app.provide(DefaultApolloClient, client);
      componentInstance = app.mount(container);
    },

    async loadNextPage() {
      await componentInstance?.loadNextPage();
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
      client.stop();
    },

    getCount() {
      return componentInstance?.data?.feed?.edges?.length || 0;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    },
  };
}
