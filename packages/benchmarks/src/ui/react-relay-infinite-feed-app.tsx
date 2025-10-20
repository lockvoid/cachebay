import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Environment, Network, RecordSource, Store } from 'relay-runtime';
import {
  RelayEnvironmentProvider,
  graphql,
  useLazyLoadQuery,
  usePaginationFragment,
} from 'react-relay';

export type ReactRelayController = {
  mount(target?: Element): void;
  unmount(): void;
  loadNextPage(): Promise<void>;
  getCount(): number;
  getTotalRenderTime(): number;
};

function createRelayEnvironment(serverUrl: string) {
  const network = Network.create(async (operation, variables) => {
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: operation.text, variables }),
    });
    return await res.json();
  });
  return new Environment({ network, store: new Store(new RecordSource()) });
}

// Names must start with module name: reactRelayInfiniteFeedApp_*

const FeedRootQuery = graphql`
  query reactRelayInfiniteFeedAppFeedRootQuery($count: Int!, $cursor: String) {
    ...reactRelayInfiniteFeedApp_FeedList_query @arguments(count: $count, cursor: $cursor)
  }
`;

const FeedListFragment = graphql`
  fragment reactRelayInfiniteFeedApp_FeedList_query on Query
  @refetchable(queryName: "reactRelayInfiniteFeedAppFeedPaginationQuery")
  @argumentDefinitions(
    count: { type: "Int!" }
    cursor: { type: "String" }
  ) {
    feed(first: $count, after: $cursor) @connection(key: "FeedList_feed") {
      edges { cursor node { id title } }
      pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
    }
  }
`;

function FeedList(props: {
  onAfterRender: () => void;
  onUpdateCount: (n: number) => void;
  setLoadNext: (fn: () => Promise<void>) => void;
}) {
  const rootData = useLazyLoadQuery(
    FeedRootQuery,
    { count: 50, cursor: null },
    { fetchPolicy: 'network-only' },
  );

  const { data, hasNext, loadNext, isLoadingNext } = usePaginationFragment(
    FeedListFragment,
    rootData,
  );

  const edges = data?.feed?.edges ?? [];

  // Expose a promise that resolves when the network completes (onComplete)
  useEffect(() => {
    props.setLoadNext(async () => {
      if (!isLoadingNext && hasNext) {
        await new Promise<void>((resolve, reject) => {
          loadNext(50, { onComplete: (err) => (err ? reject(err) : resolve()) });
        });
      }
      // If no more data, resolve immediately
    });
  }, [hasNext, isLoadingNext, loadNext, props]);

  // Notify render completion after list length actually changes
  const first = useRef(true);
  useEffect(() => {
    props.onUpdateCount(edges.length);
    if (first.current) {
      first.current = false;
    } else {
      props.onAfterRender();
    }
  }, [edges.length, props]);

  return (
    <div>
      <ul>
        {edges.map((e: any) => <li key={e.node.id}>{e.node.title}</li>)}
      </ul>
    </div>
  );
}

export function createReactRelayApp(serverUrl: string): ReactRelayController {
  const environment = createRelayEnvironment(serverUrl);

  // render-only total (post-data -> DOM commit)
  let totalRenderTime = 0;

  let container: Element | null = null;
  let root: Root | null = null;
  let resolveRender: (() => void) | null = null;
  let lastCount = 0;
  let doLoadNext: (() => Promise<void>) | null = null;

  // Ready gate: resolved once FeedList exposes loadNext
  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>(r => { readyResolve = r; });

  return {
    mount(target?: Element) {
      if (root) return;
      container = target ?? document.createElement('div');
      if (!target) document.body.appendChild(container);
      root = createRoot(container as HTMLElement);

      const onAfterRender = () => { resolveRender?.(); resolveRender = null; };
      const onUpdateCount = (n: number) => { lastCount = n; };
      const setLoadNext = (fn: () => Promise<void>) => { doLoadNext = fn; readyResolve?.(); };

      root.render(
        <RelayEnvironmentProvider environment={environment}>
          <FeedList
            onAfterRender={onAfterRender}
            onUpdateCount={onUpdateCount}
            setLoadNext={setLoadNext}
          />
        </RelayEnvironmentProvider>
      );
    },

    async loadNextPage() {
      await ready;
      if (!doLoadNext) return;

      const tStart = performance.now();

      // Wait for network + cache to finish
      await doLoadNext();

      // Wait a microtask to ensure React has committed
      await new Promise(resolve => setTimeout(resolve, 0));

      const tEnd = performance.now();
      totalRenderTime += tEnd - tStart;
    },

    unmount() {
      if (root) { root.unmount(); root = null; }
      if (container && container.parentElement) container.parentElement.removeChild(container);
      container = null;
    },

    getCount() { return lastCount; },
    getTotalRenderTime() { return totalRenderTime; },
  };
}
