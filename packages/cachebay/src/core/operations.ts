import { CACHE_AND_NETWORK, NETWORK_ONLY, CACHE_FIRST, CACHE_ONLY } from "./constants";
import { StaleResponseError, CombinedError, CacheMissError } from "./errors";
import { __DEV__ } from "./instrumentation";
import { validateCachePolicy } from "./utils";
import type { DocumentsInstance } from "./documents";
import type { PlannerInstance } from "./planner";
import type { SSRInstance } from "./ssr";
import type { CachePlan } from "../compiler";
import type { CachePolicy } from "./types";
import type { DocumentNode } from "graphql";

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
  query: CachePlan | DocumentNode | string;
  /** Query variables */
  variables?: TVars;
  /** Cache policy (default: cache-first) */
  cachePolicy?: CachePolicy;
  /** Canonical mode - read from canonical containers (default: true) */
  canonical?: boolean;
  /** Callback when operation succeeds */
  onNetworkData?: (data: TData) => void;
  /** Callback when an error occurs */
  onError?: (error: CombinedError) => void;
  /** Callback for cached data (called synchronously before Promise resolves for cache hits) */
  onCacheData?: (data: TData, meta: { willFetchFromNetwork: boolean }) => void;
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
    source?: "cache" | "network";
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
  cachePolicy?: CachePolicy;
  suspensionTimeout?: number;
  onQueryNetworkError?: (signature: string, error: CombinedError) => boolean; // Returns true if watchers caught the error, false otherwise
  onQueryNetworkData?: (signature: string, data: any) => boolean; // Returns true if watchers caught the data, false otherwise
}

export interface OperationsDependencies {
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr: SSRInstance;
}

export const createOperations = (
  { transport, suspensionTimeout = 1000, onQueryNetworkData, onQueryNetworkError, cachePolicy: defaultCachePolicy }: OperationsOptions,
  { planner, documents, ssr }: OperationsDependencies,
) => {
  // Track query epochs to prevent stale responses from notifying watchers
  // Key: query signature, Value: current epoch number
  const queryEpochs = new Map<string, number>();

  // Suspension tracking: last terminal emit time per query signature
  const lastEmitBySig = new Map<string, number>();

  // No need for error tracking maps - just call onQueryNetworkError callback

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
    onNetworkData,
    onCacheData,
    onError,
  }: Operation<TData, TVars>): Promise<OperationResult<TData>> => {
    const finalCachePolicy = validateCachePolicy(cachePolicy ?? defaultCachePolicy, NETWORK_ONLY);
    const plan = planner.getPlan(query);
    const canonicalSignature = plan.makeSignature(true, variables);
    const strictSignature = plan.makeSignature(false, variables);

    let cached;

    if (finalCachePolicy !== NETWORK_ONLY || ssr.isHydrating()) {
      cached = documents.materialize({
        document: query,
        variables,
        canonical: true,
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });
    }

    const performRequest = async () => {
      try {
        const currentEpoch = (queryEpochs.get(canonicalSignature) || 0) + 1;

        queryEpochs.set(canonicalSignature, currentEpoch);

        const context: HttpContext = {
          query: plan.networkQuery,
          variables,
          operationType: "query",
          compiledQuery: plan,
        };

        const result = await transport.http(context);

        const isStale = queryEpochs.get(canonicalSignature) !== currentEpoch;

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

          // Materialize to update cache and get dependencies for watcher tracking
          const freshMaterialization = documents.materialize({
            document: query,
            variables,
            canonical: true,
            fingerprint: true,
            preferCache: false,
            updateCache: true,
          });

          if (freshMaterialization.source === "none") {
            const errorMessage = "[cachebay] Query materialization failed: missing required fields in response";

            if (__DEV__ && freshMaterialization.ok.miss) {
              console.error(errorMessage, freshMaterialization.ok.miss);
            }

            return { data: null, error: new CombinedError({ networkError: new Error(errorMessage), }) };
          }

          markEmitted(strictSignature);

          onNetworkData?.(freshMaterialization.data);

          if (onQueryNetworkData) {
            const wasCaught = onQueryNetworkData(canonicalSignature, freshMaterialization.data);

            if (!wasCaught) {
              documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
            }
          }

          return { data: freshMaterialization.data || null, error: result.error || null, meta: { source: "network" }, };
        }

        // Mark as emitted for suspension tracking
        markEmitted(strictSignature);

        // If we have an error but no data, propagate the error
        if (result.error) {
          const combinedError = new CombinedError({ networkError: result.error as Error });

          onError?.(combinedError);
          onQueryNetworkError?.(canonicalSignature, combinedError);
        }

        return result;
      } catch (error) {
        const combinedError = new CombinedError({ networkError: error as Error });

        if (!(error instanceof StaleResponseError)) {
          onError?.(combinedError);
          onQueryNetworkError?.(canonicalSignature, combinedError);
        }

        return {
          data: null,
          error: combinedError,
        };
      }
    };

    if (ssr.isHydrating() || isWithinSuspension(strictSignature)) {
      if (cached && cached.source !== "none") {
        onCacheData?.(cached.data, { willFetchFromNetwork: false });

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data) ?? false;

        if (!dataPropagated) {
          documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
        }

        return { data: cached.data, error: null };
      }
    }

    if (finalCachePolicy === CACHE_ONLY) {
      if (!cached || cached.source === "none") {
        const error = new CombinedError({ networkError: new CacheMissError() });

        onError?.(error);
        onQueryNetworkError?.(canonicalSignature, error);

        return { data: null, error };
      }

      onCacheData?.(cached.data, { willFetchFromNetwork: false });

      const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data) ?? false;

      if (!dataPropagated) {
        documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
      }

      return { data: cached.data as TData, error: null };
    }

    if (finalCachePolicy === CACHE_FIRST) {
      if (cached && cached.ok.canonical && cached.ok.strict && cached.ok.strictSignature === strictSignature) {
        onCacheData?.(cached.data, { willFetchFromNetwork: false });

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data) ?? false;

        if (!dataPropagated) {
          documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
        }

        return { data: cached.data as TData, error: null };
      }
    }

    if (finalCachePolicy === CACHE_AND_NETWORK) {
      if (cached && cached.ok.canonical) {
        onCacheData?.(cached.data as TData, { willFetchFromNetwork: true });

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data) ?? false;

        if (!dataPropagated) {
          documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
        }

        return performRequest();
      }
    }

    if (finalCachePolicy === NETWORK_ONLY) {
      return performRequest();
    }

    // Fallback for any unhandled cache policy
    return performRequest();
  };

  /**
   * Execute a GraphQL mutation
   */
  const executeMutation = async <TData = any, TVars = QueryVariables>({
    query,
    variables,
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

      // Write successful mutation result to cache and notify watchers
      if (result.data && !result.error) {
        const freshMaterialization = normalizeAndNotify(query, vars, result.data, "cache-first");

        // Return materialized data - mutations can contain connections and complex structures
        return {
          data: freshMaterialization.data as TData,
          error: result.error,
        };
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
        "WebSocket transport is not configured. Please provide 'transport.ws' in createCachebay options to use subscriptions.",
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
              // Write successful subscription data to cache and notify watchers
              if (result.data && !result.error) {
                const freshMaterialization = normalizeAndNotify(query, vars, result.data, "cache-first");

                // Forward materialized data (normalized), not raw network response
                if (observer.next) {
                  observer.next({
                    data: freshMaterialization.data as TData,
                    error: result.error,
                  });
                }
              } else {
                // Forward errors as-is
                if (observer.next) {
                  observer.next(result);
                }
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
