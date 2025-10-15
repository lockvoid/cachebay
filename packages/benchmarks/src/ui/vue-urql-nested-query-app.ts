import { createApp, defineComponent, reactive, nextTick, computed, watch } from 'vue';
import urql, { useQuery } from '@urql/vue';
import { createClient as createUrqlClient, fetchExchange } from '@urql/core';
import { cacheExchange as graphcache } from '@urql/exchange-graphcache';
import { relayPagination } from '@urql/exchange-graphcache/extras';
import { gql } from 'graphql-tag';

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

export type VueUrqlNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueUrqlNestedApp(serverUrl: string): VueUrqlNestedController {
  const cache = graphcache({
    resolvers: {
      Query: { 
        users: relayPagination(),
      },
      User: {
        posts: relayPagination(),
        followers: relayPagination(),
      },
      Post: {
        comments: relayPagination(),
      },
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

  const NestedList = defineComponent({
    setup() {
      const variables = reactive<{ first: number; after: string | null }>({
        first: 10,
        after: null,
      });

      const { data, executeQuery } = useQuery({
        query: USERS_QUERY,
        variables,
        pause: true,
      });

      const loadNextPage = async () => {
        const renderStart = performance.now();

        await executeQuery({ variables, requestPolicy: 'network-only' });

        const endCursor = data.value?.users?.pageInfo?.endCursor ?? null;
        if (endCursor) variables.after = endCursor;

        // Wait for next tick to ensure DOM is updated
        await nextTick();
        
        const renderEnd = performance.now();
        totalRenderTime += renderEnd - renderStart;
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
    `
  });

  return {
    mount(target?: Element) {
      if (app) return;

      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);

      app = createApp(NestedList);
      app.use(urql, client);
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
      let count = 0;
      const users = componentInstance?.data?.users?.edges || [];
      for (const userEdge of users) {
        count++;
        const posts = userEdge.node.posts?.edges || [];
        for (const postEdge of posts) {
          count++;
          const comments = postEdge.node.comments?.edges || [];
          count += comments.length;
        }
      }
      return count;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    }
  };
}
