import { createApp, defineComponent, ref, reactive, nextTick, computed, watch } from 'vue';
import { createClient, useQuery, fetch as fetchPlugin } from 'villus';
import { gql } from 'graphql-tag';
import { createCache } from 'villus-cachebay';

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

export type VueCachebayNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

export function createVueCachebayNestedApp(serverUrl: string): VueCachebayNestedController {
  const cachebay = createCache({
    interfaces: {
      Node: ['User', 'Post', 'Comment'],
    },
  });

  const client = createClient({
    url: serverUrl,
    use: [cachebay, fetchPlugin()],
    cachePolicy: 'network-only'
  });

  let totalRenderTime = 0;
  let app: any = null;
  let container: Element | null = null;
  let onRenderComplete: (() => void) | null = null;

  const NestedList = defineComponent({
    setup() {
      const variables = reactive({
        first: 10,
        after: null as string | null
      });

      const { data, execute } = useQuery({
        query: USERS_QUERY,
        paused: true,
      });

      const loadNextPage = async () => {
        try {
          const renderStart = performance.now();
          
          await execute({ variables });

          if (data.value?.users?.pageInfo?.endCursor) {
            variables.after = data.value.users.pageInfo.endCursor;
          }

          // Wait for next tick to ensure DOM is updated
          await nextTick();
          
          const renderEnd = performance.now();
          totalRenderTime += renderEnd - renderStart;

        } catch (error) {
          console.warn('Cachebay execute error (ignored):', error);
        }
      };

      return {
        data,
        loadNextPage
      };
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

  let componentInstance: any = null;

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
        count++; // user
        const posts = userEdge.node.posts?.edges || [];
        for (const postEdge of posts) {
          count++; // post
          const comments = postEdge.node.comments?.edges || [];
          count += comments.length; // comments
        }
      }
      return count;
    },

    getTotalRenderTime() {
      return totalRenderTime;
    }
  };
}
