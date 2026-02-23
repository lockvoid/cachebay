import { createCanonical } from "./canonical";
import { createDocuments } from "./documents";
import { createFragments } from "./fragments";
import { createGraph } from "./graph";
import { createInspect } from "./inspect";
import { createOperations } from "./operations";
import { createOptimistic } from "./optimistic";
import { createPlanner } from "./planner";
import { createQueries } from "./queries";
import { createSSR } from "./ssr";
import type { CachebayOptions } from "./types";
import type { StorageAdapter, StorageInspection } from "../storage/idb";

/**
 * Main Cachebay instance type
 * Framework-agnostic GraphQL cache client with Relay support
 *
 * @public
 * @example
 * ```typescript
 * import { createCachebay } from 'cachebay';
 *
 * const cachebay = createCachebay({
 *   transport: {
 *     http: async (ctx) => {
 *       const res = await fetch('/graphql', {
 *         method: 'POST',
 *         body: JSON.stringify({ query: ctx.query, variables: ctx.variables })
 *       });
 *       return res.json();
 *     }
 *   }
 * });
 *
 * // Read from cache
 * const user = cachebay.readFragment({
 *   id: 'User:123',
 *   fragment: USER_FRAGMENT
 * });
 *
 * const result = await cachebay.executeQuery({
 *   query: GET_USER_QUERY,
 *   variables: { id: '123' },
 *   cachePolicy: 'cache-first'
 * });
 * ```
 */
export type CachebayInstance = {
  /**
   * Serialize cache state for SSR
   * @returns Serializable snapshot of the cache
   */
  dehydrate: () => Record<string, unknown>;

  /**
   * Restore cache state from SSR snapshot
   * @param input - Snapshot object or function that emits snapshot
   */
  hydrate: (input: Record<string, unknown> | ((emit: (snapshot: Record<string, unknown>) => void) => void)) => void;

  /**
   * Check if currently in SSR hydration window
   * @returns true if within hydration timeout, false otherwise
   */
  isHydrating: () => boolean;

  /**
   * Generate stable cache key for an object
   * @param obj - GraphQL object with __typename and id
   * @returns Cache key string (typename:id) or null if not identifiable
   */
  identify: (obj: Record<string, unknown>) => string | null;

  /**
   * Read fragment data from cache reactively
   * @template TData - Expected fragment data type
   * @param args - Fragment read arguments
   * @returns Reactive fragment data or undefined
   */
  readFragment: <TData = unknown>(args: {
    id: string;
    fragment: unknown;
    fragmentName?: string;
    variables?: Record<string, unknown>;
  }) => TData | undefined;

  /**
   * Write fragment data into cache
   * @template TData - Fragment data type
   * @param args - Fragment write arguments
   */
  writeFragment: <TData = unknown>(args: {
    id: string;
    fragment: unknown;
    fragmentName?: string;
    data: TData;
    variables?: Record<string, unknown>;
  }) => void;

  /**
   * Watch fragment reactively (returns unsubscribe handle)
   */
  watchFragment: ReturnType<typeof createFragments>["watchFragment"];

  /**
   * Read query from cache (sync)
   */
  readQuery: ReturnType<typeof createQueries>["readQuery"];

  /**
   * Write query to cache (sync, triggers reactive updates)
   */
  writeQuery: ReturnType<typeof createQueries>["writeQuery"];

  /**
   * Watch query reactively (returns unsubscribe handle)
   */
  watchQuery: ReturnType<typeof createQueries>["watchQuery"];

  /**
   * Apply optimistic updates with transaction support
   */
  modifyOptimistic: ReturnType<typeof createOptimistic>["modifyOptimistic"];

  /**
   * Execute a GraphQL query (always hits network, writes to cache)
   */
  executeQuery: ReturnType<typeof createOperations>["executeQuery"];

  /**
   * Execute a GraphQL mutation (always hits network, writes to cache)
   */
  executeMutation: ReturnType<typeof createOperations>["executeMutation"];

  /**
   * Execute a GraphQL subscription (returns observable, writes to cache)
   */
  executeSubscription: ReturnType<typeof createOperations>["executeSubscription"];

  /**
   * Get compiled query plan
   */
  getPlan: ReturnType<typeof createOperations>["getPlan"];

  /**
   * Debug inspection API for cache internals
   */
  inspect: ReturnType<typeof createInspect>;

  /**
   * Storage API (only present when `storage` option is provided).
   * Provides debug inspection, manual journal eviction, and forced sync.
   */
  storage: {
    /** Debug inspection of storage state */
    inspect: () => Promise<StorageInspection>;
    /** Manually evict old journal entries */
    evictJournal: () => Promise<void>;
    /** Force an immediate journal poll */
    flushJournal: () => Promise<void>;
  } | null;

  /**
   * Evict all cached data from memory and persistent storage.
   * Active watchers are preserved — they will re-materialize with empty data.
   */
  evictAll: () => Promise<void>;

  /**
   * Dispose: stop storage polling, close connections.
   * Call when the cache instance is no longer needed.
   */
  dispose: () => void;

  /**
   * Internal APIs for testing and debugging
   * @internal
   */
  __internals: {
    planner: ReturnType<typeof createPlanner>;
    graph: ReturnType<typeof createGraph>;
    optimistic: ReturnType<typeof createOptimistic>;
    canonical: ReturnType<typeof createCanonical>;
    documents: ReturnType<typeof createDocuments>;
    queries: ReturnType<typeof createQueries>;
    fragments: ReturnType<typeof createFragments>;
    operations: ReturnType<typeof createOperations>;
    ssr: ReturnType<typeof createSSR>;
    inspect: ReturnType<typeof createInspect>;
  };
};

/**
 * Create a new Cachebay cache instance
 * @param options - Configuration options for the cache
 * @returns Configured cache instance
 */
export function createCachebay(options: CachebayOptions): CachebayInstance {
  // Validate transport configuration
  if (!options.transport) {
    throw new Error("Missing required 'transport' with 'http' function. Example: { transport: { http: async (ctx) => { ... } } }");
  }

  if (typeof options.transport.http !== "function") {
    throw new Error("'transport.http' must be a function: async (ctx) => Promise<OperationResult>");
  }

  if (options.transport.ws && typeof options.transport.ws !== "function") {
    throw new Error("'transport.ws' must be a function: async (ctx) => Promise<ObservableLike<OperationResult>>");
  }

  const planner = createPlanner();

  // Storage integration: mutable refs captured by onChange closure
  let storageAdapter: StorageAdapter | null = null;
  let isApplyingRemote = false;

  const graph = createGraph({
    keys: options.keys || {},
    interfaces: options.interfaces || {},

    onChange: (touchedIds) => {
      queries.notifyDataByDependencies(touchedIds);
      fragments.notifyDataByDependencies(touchedIds);

      // Persist delta to storage (skip if applying remote updates from another tab)
      if (storageAdapter && !isApplyingRemote) {
        const updates: Array<[string, Record<string, unknown>]> = [];
        const removes: string[] = [];

        for (const id of touchedIds) {
          const record = graph.getRecord(id);

          if (record !== undefined) {
            updates.push([id, record]);
          } else {
            removes.push(id);
          }
        }

        if (updates.length > 0) storageAdapter.put(updates);
        if (removes.length > 0) storageAdapter.remove(removes);
      }
    },
  });

  const optimistic = createOptimistic({ graph, planner });
  const ssr = createSSR({ hydrationTimeout: options.hydrationTimeout }, { graph });
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, planner, canonical });
  const fragments = createFragments({ planner, documents });
  const queries = createQueries({ planner, documents });

  // Operations (always created since transport is required)
  const operations = createOperations(
    {
      cachePolicy: options.cachePolicy,
      transport: options.transport,
      suspensionTimeout: options.suspensionTimeout,

      onQueryNetworkData: (signature, data, fingerprints, dependencies) => {
        return queries.notifyDataBySignature(signature, data, fingerprints, dependencies);
      },

      onQueryNetworkError: (signature, error) => {
        return queries.notifyErrorBySignature(signature, error);
      },
    },

    {
      planner,
      documents,
      ssr,
    },
  );

  const inspect = createInspect({ graph, optimistic });

  const cache = {} as CachebayInstance;

  cache.identify = graph.identify;

  // Fragments API
  cache.readFragment = fragments.readFragment;
  cache.writeFragment = fragments.writeFragment;
  cache.watchFragment = fragments.watchFragment;

  // Queries API
  cache.readQuery = queries.readQuery;
  cache.writeQuery = queries.writeQuery;
  cache.watchQuery = queries.watchQuery;

  // Optimistic API
  cache.modifyOptimistic = optimistic.modifyOptimistic;

  // Operations API
  cache.executeQuery = operations.executeQuery;
  cache.executeMutation = operations.executeMutation;
  cache.executeSubscription = operations.executeSubscription;

  // Inspect (debug)
  cache.inspect = inspect;

  // SSR API
  cache.dehydrate = ssr.dehydrate;
  cache.hydrate = ssr.hydrate;
  cache.isHydrating = ssr.isHydrating;

  // Planner
  cache.getPlan = planner.getPlan;

  // Storage API
  cache.storage = null;

  // Storage integration
  if (options.storage) {
    const instanceId = Math.random().toString(36).slice(2, 10);

    storageAdapter = options.storage({
      instanceId,

      onUpdate(records) {
        isApplyingRemote = true;

        for (let i = 0; i < records.length; i++) {
          const [id, snap] = records[i];

          graph.putRecord(id, snap);
        }

        graph.flush();
        isApplyingRemote = false;
      },

      onRemove(ids) {
        isApplyingRemote = true;

        for (let i = 0; i < ids.length; i++) {
          graph.removeRecord(ids[i]);
        }

        graph.flush();
        isApplyingRemote = false;
      },
    });

    cache.storage = {
      inspect: storageAdapter.inspect,
      evictJournal: storageAdapter.evictJournal,
      flushJournal: storageAdapter.flushJournal,
    };

    // Async load from storage — only fill gaps (don't overwrite SSR-hydrated data)
    storageAdapter.load().then((records) => {
      if (records.length === 0) return;

      isApplyingRemote = true;

      for (let i = 0; i < records.length; i++) {
        const [id, snap] = records[i];

        if (!graph.getRecord(id)) {
          graph.putRecord(id, snap);
        }
      }

      graph.flush();
      isApplyingRemote = false;
    });
  }

  // Evict all
  cache.evictAll = async () => {
    // Snapshot keys before clearing so we can notify watchers
    const allKeys = graph.keys();

    // Clear optimistic layers first (they reference graph data)
    optimistic.evictAll();

    // Clear materialization caches
    documents.evictAll();

    // Clear the normalized graph store
    graph.evictAll();

    // Clear persistent storage if present
    if (storageAdapter) {
      await storageAdapter.evictAll();
    }

    // Notify watchers directly (bypasses graph.onChange to avoid storage re-persistence)
    if (allKeys.length > 0) {
      const touchedIds = new Set<string>(allKeys);

      queries.notifyDataByDependencies(touchedIds);
      fragments.notifyDataByDependencies(touchedIds);
    }
  };

  // Dispose
  cache.dispose = () => {
    storageAdapter?.dispose();
    storageAdapter = null;
  };

  // Internals for tests
  cache.__internals = {
    graph,
    optimistic,
    planner,
    canonical,
    documents,
    fragments,
    queries,
    operations,
    ssr,
    inspect,
  };

  return cache;
}
