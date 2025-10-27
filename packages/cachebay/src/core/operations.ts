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
 * Valid cache policies
 */
const VALID_CACHE_POLICIES: readonly CachePolicy[] = [
  "cache-and-network",
  "network-only",
  "cache-first",
  "cache-only",
] as const;

/**
 * Validate and normalize cache policy
 * In dev: throws on invalid policy
 * In prod: warns and returns default policy
 */
function validateCachePolicy(policy: any, defaultPolicy: CachePolicy = 'cache-first'): CachePolicy {
  if (!policy) {
    return defaultPolicy;
  }

  if (VALID_CACHE_POLICIES.includes(policy as CachePolicy)) {
    return policy as CachePolicy;
  }

  const errorMessage = `Invalid cache policy: "${policy}". Valid policies are: ${VALID_CACHE_POLICIES.join(', ')}`;

  if (__DEV__) {
    throw new Error(errorMessage);
  } else {
    console.warn(`[cachebay] ${errorMessage}. Falling back to "${defaultPolicy}".`);
    return defaultPolicy;
  }
}

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
export interface Operation<TData = any, TVars = any> {
  /** GraphQL query document */
  query: DocumentNode | string;
  /** Query variables */
  variables?: TVars;
  /** Cache policy (default: cache-first) */
  cachePolicy?: CachePolicy;
  /** Canonical mode - read from canonical containers (default: true) */
  canonical?: boolean;
  /** Callback when operation succeeds */
  onSuccess?: (data: TData) => void;
  /** Callback when an error occurs */
  onError?: (error: CombinedError) => void;
  /** Callback for cached data (called synchronously before Promise resolves for cache hits) */
  onCachedData?: (data: TData, meta: { willFetchFromNetwork: boolean }) => void;
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
    onCachedData,
  }: Operation<TData, TVars>): Promise<OperationResult<TData>> => {
    // Validate and normalize cache policy
    const rawPolicy = cachePolicy ?? defaultCachePolicy;
    const effectiveCachePolicy = validateCachePolicy(rawPolicy, 'network-only');
    const plan = planner.getPlan(query);
    const signature = plan.makeSignature(true, variables);  // Always canonical

    // Read from cache using documents directly
    // Always read cache during SSR hydration, even for network-only
    let cached;
    if (effectiveCachePolicy !== 'network-only' || ssr.isHydrating()) {
      cached = documents.materialize({
        document: query,
        variables,
        canonical: true,
        fingerprint: true,
        force: false,
      });
    }

    const performRequest = async () => {
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
          documents.normalize({
            document: query,
            variables,
            data: result.data,
          });

          // Read back from cache to get normalized/materialized data
          // This ensures the same reference as watchQuery would emit
          const cachedAfterWrite = documents.materialize({
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

        // Only notify error callbacks if not a stale response
        // Stale errors should be silently dropped
        if (!(error instanceof StaleResponseError)) {
          onError?.(combinedError);
          onQueryError?.(signature, combinedError);
        }

        return {
          data: null,
          error: combinedError,
        };
      }
    };

    // SSR hydration or suspension window: return cached data if available
    if (ssr.isHydrating() || isWithinSuspension(signature)) {
      if (cached && cached.source !== "none") {
        // Call onCachedData for SSR/suspension to set data synchronously
        // No network request will be made (early return)
        onCachedData?.(cached.data as TData, { willFetchFromNetwork: false });

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
      onCachedData?.(cached.data as TData, { willFetchFromNetwork: false });
      onSuccess?.(result.data);
      return result;
    }

    if (effectiveCachePolicy === 'cache-first') {
      if (cached && cached.ok.canonical && cached.ok.strict) {
        // Check if strict signature matches (pagination args haven't changed)
        // If strictSignature is present and matches, return cached data
        // If strictSignature doesn't match, fetch from network (pagination changed)
        const strictSignature = plan.makeSignature(false, variables);
        const strictMatches = cached.ok.strictSignature === strictSignature;

        if (strictMatches) {
          // Strict match: pagination args haven't changed, return cached data
          onQueryData?.({
            signature,
            data: cached.data,
            dependencies: cached.dependencies,
            cachePolicy: effectiveCachePolicy,
          });

          const result = { data: cached.data as TData, error: null };
          onCachedData?.(cached.data as TData, { willFetchFromNetwork: false });
          onSuccess?.(result.data);
          return result;
        }
        // No strict match: pagination args changed, fall through to network fetch
      }
    }

    if (effectiveCachePolicy === 'cache-and-network') {
      if (cached && cached.ok.canonical) {
        // Notify watchers so lastData is set (prevents duplicate emission if network data is same)
        onQueryData?.({
          signature,
          data: cached.data,
          dependencies: cached.dependencies,
          cachePolicy: effectiveCachePolicy,
        });

        onCachedData?.(cached.data as TData, { willFetchFromNetwork: true });

        // Return the network request Promise (resolves with fresh network data)
        return performRequest();
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
        documents.normalize({
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
                documents.normalize({
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
