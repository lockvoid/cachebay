import type { DocumentNode, GraphQLError } from "graphql";
import { print } from "graphql";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";
import type { SSRInstance } from "./ssr";
import { __DEV__ } from "./instrumentation";
import { StaleResponseError, CombinedError, CacheMissError } from "./errors";

/**
 * Types
 */

/**
 * GraphQL query variables
 *
 * @public
 * @example
 * ```typescript
 * const variables: QueryVariables = {
 *   id: "123",
 *   first: 10,
 *   after: "cursor"
 * };
 * ```
 */
export type QueryVariables = Record<string, any>;

/**
 * Cache policy determines how the cache interacts with the network
 *
 * @public
 * - `cache-first`: Return cached data if available, otherwise fetch from network
 * - `cache-only`: Only return cached data, never fetch from network (throws if not cached)
 * - `network-only`: Always fetch from network, ignore cache
 * - `cache-and-network`: Return cached data immediately, then fetch from network and update
 *
 * @example
 * ```typescript
 * const policy: CachePolicy = "cache-first";
 *
 * // Or use constants
 * import { CACHE_POLICIES } from 'cachebay';
 * const policy = CACHE_POLICIES.CACHE_FIRST;
 * ```
 */
export type CachePolicy = "cache-and-network" | "network-only" | "cache-first" | "cache-only";

export const CACHE_AND_NETWORK = "cache-and-network" as const;
export const NETWORK_ONLY = "network-only" as const;
export const CACHE_FIRST = "cache-first" as const;
export const CACHE_ONLY = "cache-only" as const;

/**
 * GraphQL operation configuration
 *
 * @public
 * @template TData - Expected data type returned from the operation
 * @template TVars - Variables type for the operation
 * @example
 * ```typescript
 * const operation: Operation<{ user: User }, { id: string }> = {
 *   query: gql`query GetUser($id: ID!) { user(id: $id) { id name } }`,
 *   variables: { id: "123" },
 *   cachePolicy: "cache-first"
 * };
 * ```
 */
export interface Operation<TData = any, TVars = QueryVariables> {
  /** GraphQL query string or DocumentNode */
  query: string | DocumentNode;
  /** Variables for the GraphQL operation */
  variables?: TVars;
  /** Cache policy for this operation */
  cachePolicy?: CachePolicy;
  /** Callback when data is successfully fetched/read */
  onSuccess?: (data: TData) => void;
  /** Callback when an error occurs */
  onError?: (error: CombinedError) => void;
}

// CombinedError is now imported from ./errors

/**
 * Result of a GraphQL operation
 *
 * @public
 * @template TData - Type of data returned
 * @example
 * ```typescript
 * const result: OperationResult<{ user: User }> = {
 *   data: { user: { id: "123", name: "Alice" } },
 *   error: null,
 *   meta: { source: 'cache' }
 * };
 * ```
 */
export interface OperationResult<TData = any> {
  /** Operation data if successful, null if error */
  data: TData | null;
  /** Error if operation failed, null if successful */
  error: CombinedError | null;
  /** Metadata about the operation result */
  meta?: {
    /** Source of the data: 'cache' for cached data, 'network' for fresh network data */
    source?: 'cache' | 'network';
  };
}

export interface ObserverLike<T> {
  next: (value: T) => void;
  error: (err: any) => void;
  complete?: () => void;
}

export interface Unsubscribable {
  unsubscribe: () => void;
}

export interface ObservableLike<T> {
  subscribe(observer: Partial<ObserverLike<T>>): Unsubscribable;
}

export interface HttpTransport {
  (context: HttpContext): Promise<OperationResult>;
}

export interface WsTransport {
  (context: WsContext): Promise<ObservableLike<OperationResult>>;
}

/**
 * Transport layer for GraphQL operations
 * Provides HTTP transport (required) and WebSocket transport (optional)
 *
 * @public
 * @example
 * ```typescript
 * const transport: Transport = {
 *   http: async (ctx) => {
 *     const res = await fetch('/graphql', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({
 *         query: ctx.query,
 *         variables: ctx.variables
 *       })
 *     });
 *     return res.json();
 *   },
 *   ws: async (ctx) => {
 *     // WebSocket implementation for subscriptions
 *     return createWebSocketObservable(ctx);
 *   }
 * };
 * ```
 */
export interface Transport {
  /** HTTP transport for queries and mutations (required) */
  http: HttpTransport;
  /** WebSocket transport for subscriptions (optional) */
  ws?: WsTransport;
}

export interface HttpContext {
  query: string | DocumentNode;
  variables?: QueryVariables;
  operationType: "query" | "mutation";
  compiledQuery: any; // CachePlan from planner
}

export interface WsContext {
  query: string | DocumentNode;
  variables?: QueryVariables;
  operationType: "subscription";
  compiledQuery: any; // CachePlan from planner
}

/**
 * Operations
 */

export interface OperationsOptions {
  transport: Transport;
  suspensionTimeout?: number;
  onQueryError?: (signature: string, error: CombinedError) => void;
  onQueryData?: (event: {
    signature: string;
    data: any;
    dependencies: Set<string>;
    cachePolicy: CachePolicy;
  }) => void;
  cachePolicy?: CachePolicy;
}

export interface OperationsDependencies {
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr: SSRInstance;
}

export const createOperations = (
  { transport, suspensionTimeout = 1000, onQueryError, onQueryData, cachePolicy: defaultCachePolicy }: OperationsOptions,
  { planner, documents, ssr }: OperationsDependencies
) => {
  // Track query epochs to prevent stale responses from notifying watchers
  // Key: query signature, Value: current epoch number
  const queryEpochs = new Map<string, number>();

  // Suspension tracking: last terminal emit time per query signature
  const lastEmitBySig = new Map<string, number>();

  // No need for error tracking maps - just call onQueryError callback

  /**
   * Check if we're within the suspension window for a query signature
   */
  const isWithinSuspension = (signature: string): boolean => {
    console.log("isWithinSuspension", suspensionTimeout);
    const last = lastEmitBySig.get(signature);
    return last != null && performance.now() - last <= suspensionTimeout;
  };

  /**
   * Mark a query signature as having emitted (for suspension tracking)
   */
  const markEmitted = (signature: string): void => {
    lastEmitBySig.set(signature, performance.now());
  };

  /**
   * Execute a GraphQL query with suspension and hydration support
   */
  const executeQuery = async <TData = any, TVars = QueryVariables>({
    query,
    variables = {},
    cachePolicy,
    onSuccess,
    onError,
  }: Operation<TData, TVars>): Promise<OperationResult<TData>> => {
    const effectiveCachePolicy = cachePolicy ?? defaultCachePolicy ?? 'network-only';
    const plan = planner.getPlan(query);
    const signature = plan.makeSignature("canonical", variables);  // Always canonical

    // Read from cache using documents directly
    // Always read cache during SSR hydration, even for network-only
    let cached;

    if (effectiveCachePolicy !== 'network-only' || ssr.isHydrating()) {
      cached = documents.materializeDocument({
        document: query,
        variables,
        canonical: true,
        fingerprint: true, // Get dependencies for watcher tracking
        force: false,
      });
    }

    const performRequest = async () => {
      console.log("perofrm request");
      try {
        const currentEpoch = (queryEpochs.get(signature) || 0) + 1;

        queryEpochs.set(signature, currentEpoch);

        // Network fetch
        const context: HttpContext = {
          query: plan.networkQuery, // Use the pre-compiled network-safe query string
          variables,
          operationType: "query",
          compiledQuery: plan,
        };

        const result = await transport.http(context);

        const isStale = queryEpochs.get(signature) !== currentEpoch;

        // If stale, return null data with StaleResponseError wrapped in CombinedError
        if (isStale) {
          throw new StaleResponseError();
        }

        // Write result to cache if we have data (even with partial errors)
        // This matches Relay/Apollo behavior: partial data is still useful
        if (result.data) {
          console.log('NORMALIZE', result);
          documents.normalizeDocument({
            document: query,
            variables,
            data: result.data,
          });

          // Read back from cache to get normalized/materialized data
          // This ensures the same reference as watchQuery would emit
          const cachedAfterWrite = documents.materializeDocument({
            document: query,
            variables,
            canonical: true,
            fingerprint: true, // Get dependencies for watcher tracking
            force: true,
          });

          // Notify watchers about query execution with data and dependencies
          onQueryData?.({
            signature,
            data: cachedAfterWrite.data,
            dependencies: cachedAfterWrite.dependencies,
            cachePolicy: effectiveCachePolicy,
          });

          // Validate that we can materialize the data we just wrote
          if (cachedAfterWrite.source === "none") {
            if (__DEV__ && cachedAfterWrite.ok.miss) {
              console.error(
                '[cachebay] Failed to materialize query after network response.\n' +
                'This usually means the response is missing required fields.\n' +
                'Missing data:',
                cachedAfterWrite.ok.miss
              );
            }
            return {
              data: null,
              error: new CombinedError({
                networkError: new Error(
                  'Failed to materialize query after write. ' +
                  'The response may be missing required fields like __typename or id.'
                ),
              }),
            };
          }

          markEmitted(signature);

          const successResult = {
            data: cachedAfterWrite.data as TData,
            error: result.error || null,
            meta: { source: 'network' as const },
          };
          onSuccess?.(successResult.data);
          return successResult;
        }

        // Mark as emitted for suspension tracking
        markEmitted(signature);

        // If we have an error but no data, propagate the error
        if (result.error) {
          const combinedError = result.error instanceof CombinedError
            ? result.error
            : new CombinedError({ networkError: result.error as Error });

          onError?.(combinedError);
          onQueryError?.(signature, combinedError);
        }

        return result as OperationResult<TData>;
      } catch (error) {
        const combinedError = new CombinedError({ networkError: error as Error });

        onError?.(combinedError);

        // Only notify error callback if not a stale response
        // Stale errors should be silently dropped
        if (!(error instanceof StaleResponseError)) {
          onQueryError?.(signature, combinedError);
        }

        return {
          data: null,
          error: combinedError,
        };
      }
    };

    console.log("isHydrating", ssr.isHydrating(), isWithinSuspension(signature));
    // SSR hydration or suspension window: return cached data if available
    if (ssr.isHydrating() || isWithinSuspension(signature)) {
      if (cached && cached.source !== "none") {
        const result = { data: cached.data as TData, error: null };
        onSuccess?.(result.data);
        return result;
      }
    }

    if (effectiveCachePolicy === 'cache-only') {
      if (!cached || cached.source === "none") {
        const error = new CombinedError({ networkError: new CacheMissError() });
        onError?.(error);

        // Notify error callback
        onQueryError?.(signature, error);

        return { data: null, error };
      }

      // Notify watchers about cache-only hit with data and dependencies
      onQueryData?.({
        signature,
        data: cached.data,
        dependencies: cached.dependencies,
        cachePolicy: effectiveCachePolicy,
      });

      const result = { data: cached.data as TData, error: null };
      onSuccess?.(result.data);
      return result;
    }

    if (effectiveCachePolicy === 'cache-first') {
      if (cached && cached.ok.canonical && cached.ok.strict) {
        // Notify watchers about cache hit with data and dependencies
        onQueryData?.({
          signature,
          data: cached.data,
          dependencies: cached.dependencies,
          cachePolicy: effectiveCachePolicy,
        });

        const result = { data: cached.data as TData, error: null };
        onSuccess?.(result.data);
        return result;
      }
    }

    if (effectiveCachePolicy === 'cache-and-network') {
      if (cached && cached.ok.canonical) {
        // Notify watchers about cache hit with data and dependencies
        onQueryData?.({
          signature,
          data: cached.data,
          dependencies: cached.dependencies,
          cachePolicy: effectiveCachePolicy,
        });

        performRequest().catch((err) => {
          if (__DEV__) {
            console.warn('Cachebay: Cache hit, but network request failed', err);
          }
        });

        const result = {
          data: cached.data as TData,
          error: null,
          meta: { source: 'cache' as const }
        };
        onSuccess?.(result.data);
        return result;
      }
    }

    return performRequest();
  };

  /**
   * Execute a GraphQL mutation
   */
  const executeMutation = async <TData = any, TVars = QueryVariables>({
    query,
    variables,
    ...restOptions
  }: Operation<TData, TVars>): Promise<OperationResult<TData>> => {
    const vars = variables || ({} as TVars);
    const compiledQuery = planner.getPlan(query);

    const context: HttpContext = {
      query,
      variables: vars,
      operationType: "mutation",
      compiledQuery,
    };

    try {
      const result = await transport.http(context);

      // Write successful mutation result to cache
      if (result.data && !result.error) {
        documents.normalizeDocument({
          document: query,
          variables: vars,
          data: result.data,
        });
      }

      return result as OperationResult<TData>;
    } catch (err) {
      return {
        data: null,
        error: new CombinedError({
          networkError: err as Error,
        }),
      };
    }
  };

  /**
   * Execute a GraphQL subscription - returns observable that writes data to cache
   */
  const executeSubscription = async <TData = any, TVars = QueryVariables>({
    query,
    variables,
  }: Operation<TData, TVars>): Promise<ObservableLike<OperationResult<TData>>> => {
    if (!transport.ws) {
      throw new Error(
        "WebSocket transport is not configured. Please provide 'transport.ws' in createCachebay options to use subscriptions."
      );
    }

    const vars = variables || ({} as TVars);
    const plan = planner.getPlan(query);

    const context: WsContext = {
      query: plan.networkQuery,
      variables: vars,
      operationType: "subscription",
      compiledQuery: plan,
    };

    try {
      const observable = await transport.ws(context);

      // Wrap observable to write incoming data to cache
      return {
        subscribe(observer: Partial<ObserverLike<OperationResult<TData>>>) {
          return observable.subscribe({
            next: (result: OperationResult<TData>) => {
              // Write successful subscription data to cache
              if (result.data && !result.error) {
                documents.normalizeDocument({
                  document: query,
                  variables: vars,
                  data: result.data,
                });
              }

              // Forward to observer
              if (observer.next) {
                observer.next(result);
              }
            },
            error: (err: any) => {
              // Forward error to observer
              if (observer.error) {
                observer.error(err);
              }
            },
            complete: () => {
              // Forward completion to observer
              if (observer.complete) {
                observer.complete();
              }
            },
          });
        },
      };
    } catch (err) {
      return {
        subscribe(observer: Partial<ObserverLike<OperationResult<TData>>>) {
          if (observer.error) {
            observer.error(err);
          }
          return { unsubscribe: () => { } };
        },
      };
    }
  };

  return {
    executeQuery,
    executeMutation,
    executeSubscription,
  };
};

export type OperationsInstance = ReturnType<typeof createOperations>;
