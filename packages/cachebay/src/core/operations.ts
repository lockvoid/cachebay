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
 * @template Tvariables - Variables type for the operation
 * @example
 * ```typescript
 * const operation: Operation<{ user: User }, { id: string }> = {
 *   query: gql`query GetUser($id: ID!) { user(id: $id) { id name } }`,
 *   variables: { id: "123" },
 *   cachePolicy: "cache-first"
 * };
 * ```
 */
export interface Operation<TData = any, Tvariables = any> {
  /** GraphQL query document */
  query: CachePlan | DocumentNode | string;
  /** Query variables */
  variables?: Tvariables;
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
  onQueryNetworkData?: (signature: string, data: any, fingerprints: any, dependencies: Set<string>) => boolean; // Returns true if watchers caught the data, false otherwise
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

  // Mutation and subscription clocks for unique rootIds
  let mutationClock = 0;
  let subscriptionClock = 0;

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
  const executeQuery = async <TData = any, Tvariables = QueryVariables>({
    query,
    variables = {},
    cachePolicy,
    onNetworkData,
    onCacheData,
    onError,
  }: Operation<TData, Tvariables>): Promise<OperationResult<TData>> => {
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
            const wasCaught = onQueryNetworkData(canonicalSignature, freshMaterialization.data, freshMaterialization.fingerprints, freshMaterialization.dependencies);

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

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data, cached.fingerprints, cached.dependencies) ?? false;

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

      const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data, cached.fingerprints, cached.dependencies) ?? false;

      if (!dataPropagated) {
        documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
      }

      return { data: cached.data as TData, error: null };
    }

    if (finalCachePolicy === CACHE_FIRST) {
      if (cached && cached.ok.canonical && cached.ok.strict && cached.ok.strictSignature === strictSignature) {
        onCacheData?.(cached.data, { willFetchFromNetwork: false });

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data, cached.fingerprints, cached.dependencies) ?? false;

        if (!dataPropagated) {
          documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
        }

        return { data: cached.data as TData, error: null };
      }
    }

    if (finalCachePolicy === CACHE_AND_NETWORK) {
      if (cached && cached.ok.canonical) {
        onCacheData?.(cached.data as TData, { willFetchFromNetwork: true });

        const dataPropagated = onQueryNetworkData?.(canonicalSignature, cached.data, cached.fingerprints, cached.dependencies) ?? false;

        if (!dataPropagated) {
          documents.invalidate({ document: query, variables, canonical: true, fingerprint: true });
        }

        return performRequest();
      }
    }

    if (finalCachePolicy === NETWORK_ONLY) {
      return performRequest();
    }

    return performRequest();
  };

  /**
   * Execute a GraphQL mutation
   */
  const executeMutation = async <TData = any, Tvariables = QueryVariables>({
    query,
    variables = {},
    onData,
    onError,
  }: Operation<TData, Tvariables> & {
    onData?: (data: TData) => void;
  }): Promise<OperationResult<TData>> => {
    const compiledQuery = planner.getPlan(query);
    const rootId = `@mutation.${mutationClock++}`;

    const context: HttpContext = {
      query: compiledQuery.networkQuery,
      variables,
      operationType: "mutation",
      compiledQuery,
    };

    try {
      const result = await transport.http(context);

      // Write mutation result to cache (including partial data)
      if (result.data) {
        documents.normalize({
          document: query,
          variables,
          data: result.data,
          rootId,
        });

        // Materialize from the mutation rootId to get the result
        const freshMaterialization = documents.materialize({
          document: query,
          variables,
          canonical: true,
          fingerprint: true,
          preferCache: false,
          updateCache: false,
          rootId: rootId,
        });

        // Check if materialization succeeded
        if (freshMaterialization.source === "none") {
          let errorMessage = "[cachebay] Mutation materialization failed after write - missing required fields";
          
          // Add detailed miss information in development mode
          if (__DEV__ && freshMaterialization.ok.miss && freshMaterialization.ok.miss.length > 0) {
            const misses = freshMaterialization.ok.miss.map((m: any) => {
              if (m.kind === "entity-missing") {
                return `  - Entity missing: ${m.id} at ${m.at}`;
              } else if (m.kind === "root-link-missing") {
                return `  - Root field missing: ${m.fieldKey} at ${m.at}`;
              } else if (m.kind === "field-link-missing") {
                return `  - Field missing: ${m.fieldKey} on ${m.parentId} at ${m.at}`;
              }
              return `  - ${JSON.stringify(m)}`;
            }).join("\n");
            errorMessage += "\n\nMissing fields:\n" + misses;
          }
          
          const error = new CombinedError({
            networkError: new Error(errorMessage),
          });
          if (onError) onError(error);
          return { data: null, error };
        }

        // Notify watchers if callback provided (only for successful mutations without errors)
        if (onQueryNetworkData && freshMaterialization.data && !result.error) {
          const plan = planner.getPlan(query);
          const signature = plan.makeSignature("canonical", variables);
          const caught = onQueryNetworkData(
            signature,
            freshMaterialization.data,
            freshMaterialization.fingerprints,
            freshMaterialization.dependencies || new Set(),
          );

          // If no watchers caught it, invalidate the cache
          if (!caught) {
            documents.invalidate({
              document: query,
              variables,
              canonical: true,
              fingerprint: true,
            });
          }
        }

        // Call onData callback (only for successful mutations)
        if (onData && freshMaterialization.data && !result.error) {
          onData(freshMaterialization.data as TData);
        }

        // Handle errors
        if (result.error && onError) {
          onError(result.error);
        }

        return { data: freshMaterialization.data as TData, error: result.error || null };
      }

      // No data at all - just error
      if (result.error) {
        if (onError) onError(result.error);
      }

      return result as OperationResult<TData>;
    } catch (error) {
      const combinedError = new CombinedError({ networkError: error });
      if (onError) onError(combinedError);
      return { data: null, error: combinedError };
    }
  };

  /**
   * Execute a GraphQL subscription - returns observable that writes data to cache
   */
  const executeSubscription = <TData = any, Tvariables = QueryVariables>({
    query,
    variables = {},
    onData,
    onError: onErrorCallback,
    onComplete: onCompleteCallback,
  }: Operation<TData, Tvariables> & {
    onData?: (data: TData) => void;
    onComplete?: () => void;
  }): ObservableLike<OperationResult<TData>> => {
    if (!transport.ws) {
      throw new Error(
        "WebSocket transport is not configured. Please provide 'transport.ws' in createCachebay options to use subscriptions.",
      );
    }

    const plan = planner.getPlan(query);

    const context: WsContext = {
      query: plan.networkQuery,
      variables,
      operationType: "subscription",
      compiledQuery: plan,
    };

    try {
      const observableOrPromise = transport.ws(context);

      // Check if transport returns a Promise (async) or Observable (sync)
      const isPromise = observableOrPromise && typeof (observableOrPromise as any).then === 'function';

      // Common handlers for both sync and async paths
      const createHandlers = (observer: Partial<ObserverLike<OperationResult<TData>>>) => ({
        next: (eventData: any) => {
          // Handle GraphQL errors in subscription events
          if (eventData.errors && !eventData.data) {
            const error = new CombinedError({ graphqlErrors: eventData.errors });
            if (onErrorCallback) onErrorCallback(error);
            if (observer.next) observer.next({ data: null, error });
            return;
          }

          const result = eventData as OperationResult<TData>;

          // Write successful subscription data to cache with unique rootId
          if (result.data && !result.error) {
            const rootId = `@subscription.${subscriptionClock++}`;

            documents.normalize({
              document: query,
              variables,
              data: result.data,
              rootId,
            });

            // Materialize from the subscription rootId to get the result
            const freshMaterialization = documents.materialize({
              document: query,
              variables,
              canonical: true,
              fingerprint: true,
              preferCache: false,
              updateCache: false,
              rootId: rootId,
            });

            // Check if materialization succeeded
            if (freshMaterialization.source === "none") {
              const error = new CombinedError({
                networkError: new Error("[cachebay] Subscription materialization failed after write - missing required fields"),
              });
              if (onErrorCallback) onErrorCallback(error);
              if (observer.next) observer.next({ data: null, error });
              return;
            }

            // Call onData callback
            if (onData && freshMaterialization.data) {
              onData(freshMaterialization.data as TData);
            }

            if (observer.next) {
              observer.next({ data: freshMaterialization.data as TData, error: result.error || null });
            }
          } else {
            // Forward errors as-is
            if (result.error && onErrorCallback) {
              onErrorCallback(result.error);
            }
            if (observer.next) {
              observer.next(result);
            }
          }
        },
        error: (err: any) => {
          // Forward error to observer and callback
          const error = new CombinedError({ networkError: err });
          if (onErrorCallback) onErrorCallback(error);
          if (observer.error) {
            observer.error(error);
          }
        },
        complete: () => {
          // Forward completion to observer and callback
          if (onCompleteCallback) onCompleteCallback();
          if (observer.complete) {
            observer.complete();
          }
        },
      });

      // Wrap observable to write incoming data to cache
      return {
        subscribe(observer: Partial<ObserverLike<OperationResult<TData>>>) {
          if (isPromise) {
            // Async transport - wait for promise then subscribe
            let subscription: any = null;

            (observableOrPromise as Promise<ObservableLike<OperationResult<TData>>>)
              .then(observable => {
                subscription = observable.subscribe(createHandlers(observer));
              })
              .catch(err => {
                const error = new CombinedError({ networkError: err });
                if (onErrorCallback) onErrorCallback(error);
                if (observer.error) observer.error(error);
              });

            return {
              unsubscribe: () => {
                if (subscription) subscription.unsubscribe();
              },
            };
          }

          // Sync transport - subscribe immediately
          const observable = observableOrPromise as ObservableLike<OperationResult<TData>>;
          return observable.subscribe(createHandlers(observer));
        },
      };
    } catch (err) {
      return {
        subscribe(observer: Partial<ObserverLike<OperationResult<TData>>>) {
          const error = new CombinedError({ networkError: err });
          if (onErrorCallback) onErrorCallback(error);
          if (observer.error) {
            observer.error(error);
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
