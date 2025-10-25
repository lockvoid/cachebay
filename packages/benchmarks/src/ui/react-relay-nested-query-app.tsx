import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Environment, Network, RecordSource, Store } from 'relay-runtime';
import {
  RelayEnvironmentProvider,
  graphql,
  useLazyLoadQuery,
  usePaginationFragment,
} from 'react-relay';
import { createNestedYoga } from '../server/schema-nested';
import { makeNestedDataset } from '../utils/seed-nested';

export type ReactRelayNestedController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
};

type RelayFetchPolicy = "network-only" | "store-or-network" | "store-and-network";

function mapCachePolicyToRelay(policy: "network-only" | "cache-first" | "cache-and-network"): RelayFetchPolicy {
  if (policy === "cache-first") return "store-or-network";
  if (policy === "cache-and-network") return "store-and-network";
  return "network-only";
}

function createRelayEnvironment(serverUrl: string, sharedYoga?: any) {
  // Use shared Yoga instance if provided, otherwise create new one
  const yoga = sharedYoga || createNestedYoga(makeNestedDataset(), 0);

  const network = Network.create(async (operation, variables) => {
    // Use Yoga's fetch directly (in-memory, no HTTP)
    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: operation.text, variables }),
    });
    return await response.json();
  });
  return new Environment({ network, store: new Store(new RecordSource()) });
}

const UsersRootQuery = graphql`
  query reactRelayNestedQueryAppUsersRootQuery($count: Int!, $cursor: String) {
    ...reactRelayNestedQueryApp_UsersList_query @arguments(count: $count, cursor: $cursor)
  }
`;

const UsersListFragment = graphql`
  fragment reactRelayNestedQueryApp_UsersList_query on Query
  @refetchable(queryName: "reactRelayNestedQueryAppUsersPaginationQuery")
  @argumentDefinitions(
    count: { type: "Int!" }
    cursor: { type: "String" }
  ) {
    users(first: $count, after: $cursor) @connection(key: "UsersList_users") {
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
        startCursor
        endCursor
        hasPreviousPage
        hasNextPage
      }
    }
  }
`;

function UsersList(props: {
  onAfterRender: () => void;
  onUpdateCount: (n: number) => void;
  setLoadNext: (fn: () => Promise<void>) => void;
  fetchPolicy: RelayFetchPolicy;
}) {
  const rootData = useLazyLoadQuery(
    UsersRootQuery,
    { count: 30, cursor: null },
    { fetchPolicy: props.fetchPolicy },
  );

  const { data, hasNext, loadNext, isLoadingNext } = usePaginationFragment(
    UsersListFragment,
    rootData,
  );

  const edges = data?.users?.edges ?? [];

  useEffect(() => {
    props.setLoadNext(async () => {
      if (!isLoadingNext && hasNext) {
        const r = await new Promise<void>((resolve, reject) => {
          loadNext(30, { onComplete: (err) => (err ? reject(err) : resolve()) });
        });
      }
      // If no more data, resolve immediately
    });
  }, [hasNext, isLoadingNext, loadNext, props]);

  const first = useRef(true);

  useEffect(() => {
    const totalUsers = edges.length;

    // Add total count (not delta) to match other libraries
    globalThis.relay.totalEntities += totalUsers;
    props.onUpdateCount(totalUsers);

    if (first.current) {
      first.current = false;
    } else {
      props.onAfterRender();
    }
  }, [edges.length, props]);

  return (
    <div>
      {edges.map((userEdge: any) => (
        <div key={userEdge.node.id}>
          <h3>{userEdge.node.name}</h3>
          {(userEdge.node.posts?.edges || []).map((postEdge: any) => (
            <div key={postEdge.node.id}>
              <h4>{postEdge.node.title} ({postEdge.node.likeCount} likes)</h4>
              <ul>
                {(postEdge.node.comments?.edges || []).map((commentEdge: any) => (
                  <li key={commentEdge.node.id}>
                    {commentEdge.node.text} - {commentEdge.node.author.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function createReactRelayNestedApp(
  serverUrl: string,
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  debug: boolean = false,
  sharedYoga?: any, // Optional shared Yoga instance
): ReactRelayNestedController {
  const environment = createRelayEnvironment(serverUrl, sharedYoga);
  const fetchPolicy = mapCachePolicyToRelay(cachePolicy);

  let root: Root | null = null;
  let container: Element | null = null;
  let lastCount = 0;
  let loadNextFn: (() => Promise<void>) | null = null;
  let resolveRender: (() => void) | null = null;

  // Ready gate: resolved once UsersList exposes loadNext
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>(r => { readyResolve = r; });

  return {
    mount(target?: Element) {
      if (root) return;

      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);

      root = createRoot(container);

      const onAfterRender = () => { resolveRender?.(); resolveRender = null; };
      const onUpdateCount = (n: number) => { lastCount = n; };
      const setLoadNext = (fn: () => Promise<void>) => { loadNextFn = fn; readyResolve?.(); };

      root.render(
        <RelayEnvironmentProvider environment={environment}>
          <UsersList
            onAfterRender={onAfterRender}
            onUpdateCount={onUpdateCount}
            setLoadNext={setLoadNext}
            fetchPolicy={fetchPolicy}
          />
        </RelayEnvironmentProvider>
      );
    },

    async loadNextPage() {
      await ready;
      if (!loadNextFn) return;

      const t0 = performance.now();

      // Wait for network + cache to finish
      await loadNextFn();

      const t2 = performance.now();

      // Wait a microtask to ensure React has committed
      await new Promise(resolve => setTimeout(resolve, 0));

      const t3 = performance.now();

      globalThis.relay.totalRenderTime += (t3 - t0);
      globalThis.relay.totalNetworkTime += (t2 - t0);
    },

    unmount() {
      if (root && container) {
        root.unmount();
        if (!container.parentElement) {
          container.remove();
        }
        root = null;
        container = null;
      }
    },
  };
}
