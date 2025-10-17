import { createApp, defineComponent, nextTick } from 'vue';
import { createClient, useQuery, fetch as fetchPlugin } from 'villus';
import { gql } from 'graphql-tag';
import { createCache } from '../../../villus-cachebay/src/core/internals';
import { metrics } from './instrumentation';

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

export function createVueCachebayNestedApp(serverUrl: string): VueCachebayNestedController {
  // Reset metrics bucket for this app/run.

  const cachebay = createCache({
    interfaces: { Node: ['User', 'Post', 'Comment'] },
  });

  const client = createClient({
    url: serverUrl,
    use: [cachebay, fetchPlugin()],
    cachePolicy: 'network-only',
  });

  let totalRenderTime = 0;
  let app: any = null;
  let container: Element | null = null;
  let componentInstance: any = null;

  const NestedList = defineComponent({
    setup() {
      // Plain, non-reactive vars to avoid extra watchers.
      const variables: { first: number; after: string | null } = { first: 10, after: null };

      const { data, execute } = useQuery({
        query: USERS_QUERY,
        paused: true,
      });

      const loadNextPage = async () => {
        try {
          const t0 = performance.now();

          // Includes network + cache work.
          await execute({ variables });

          const t1 = performance.now();
          metrics.cachebay.computeMs += (t1 - t0);

          const endCursor = data.value?.users?.pageInfo?.endCursor ?? null;
          if (endCursor) variables.after = endCursor;

          // Ensure DOM paint before measuring render time.
          await nextTick();

          const t2 = performance.now();
          const renderDelta = (t2 - t1);

          metrics.cachebay.renderMs += renderDelta;
          metrics.cachebay.pages += 1;

          totalRenderTime += (t2 - t0); // legacy aggregate if you still want it
        } catch (err) {
          // swallow errors so the bench keeps going
          // eslint-disable-next-line no-console
          console.warn('Cachebay execute error (ignored):', err);
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
      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);

      app = createApp(NestedList);
      app.use(client);
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
