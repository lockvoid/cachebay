import type { DocumentNode, GraphQLError } from "graphql";
import { print } from "graphql";
import type { PlannerInstance } from "./planner";
import type { QueriesInstance } from "./queries";
import type { SSRInstance } from "./ssr";
import { __DEV__ } from "./instrumentation";
import { StaleResponseError } from "./errors";

/**
 * Types
 */

export type QueryVariables = Record<string, any>;

export type CachePolicy = "cache-and-network" | "network-only" | "cache-first" | "cache-only";

export interface Operation<TData = any, TVars = QueryVariables> {
  query: string | DocumentNode;
  variables?: TVars;
  cachePolicy?: CachePolicy;
  canonical?: boolean;
}

/**
 * CombinedError - handles both network and GraphQL errors
 */
const generateErrorMessage = (networkError?: Error, graphqlErrors?: GraphQLError[]) => {
  let error = "";
  if (networkError !== undefined) {
    return (error = `[Network] ${networkError.message}`);
  }

  if (graphqlErrors !== undefined) {
    for (let i = 0; i < graphqlErrors.length; i++) {
      error += `[GraphQL] ${graphqlErrors[i].message}\n`;
    }
  }

  return error.trim();
};

export class CombinedError extends Error {
  public name: "CombinedError";
  public message: string;
  public response: any;
  public networkError?: Error;
  public graphqlErrors?: GraphQLError[];

  constructor({
    response,
    networkError,
    graphqlErrors,
  }: {
    response?: any;
    networkError?: Error;
    graphqlErrors?: GraphQLError[];
  }) {
    const message = generateErrorMessage(networkError, graphqlErrors);
    super(message);

    this.name = "CombinedError";
    this.response = response;
    this.message = message;
    this.networkError = networkError;
    this.graphqlErrors = graphqlErrors;
  }

  toString() {
    return this.message;
  }
}

export interface OperationResult<TData = any> {
  data: TData | null;
  error: CombinedError | null;
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

export interface Transport {
  http: HttpTransport;
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
}

export interface OperationsDependencies {
  planner: PlannerInstance;
  queries: QueriesInstance;
  ssr: SSRInstance;
}

export const createOperations = (
  { transport, suspensionTimeout = 1000 }: OperationsOptions,
  { planner, queries, ssr }: OperationsDependencies
) => {
  // Track query epochs to prevent stale responses from notifying watchers
  // Key: query signature, Value: current epoch number
  const queryEpochs = new Map<string, number>();

  // Suspension tracking: last terminal emit time per query signature
  const lastEmitBySig = new Map<string, number>();

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
    cachePolicy = 'network-only',
    canonical = true,
  }: Operation<TData, TVars>): Promise<OperationResult<TData>> => {
    const plan = planner.getPlan(query);
    const signature = plan.makeSignature("canonical", variables);
    const cached = queries.readQuery({ query, variables, canonical });

    const performRequest = async () => {
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

      // Check if this response is stale (a newer request was made)
      const isStale = queryEpochs.get(signature) !== currentEpoch;

      // If stale, return null data with StaleResponseError wrapped in CombinedError
      if (isStale) {
        return {
          data: null,
          error: new CombinedError({
            networkError: new StaleResponseError(),
          }),
        };
      }

      // Write result to cache if we have data (even with partial errors)
      // This matches Relay/Apollo behavior: partial data is still useful
      if (result.data) {
        queries.writeQuery({
          query,
          variables: vars,
          data: result.data,
        });

        // Read back from cache to get normalized/materialized data
        // This ensures the same reference as watchQuery would emit
        const cached = queries.readQuery({
          query,
          variables,
          canonical: true,
        });

        // Validate that we can materialize the data we just wrote
        if (cached.source === "none") {
          if (__DEV__ && cached.ok.miss) {
            console.error(
              '[cachebay] Failed to materialize query after network response.\n' +
              'This usually means the response is missing required fields.\n' +
              'Missing data:',
              cached.ok.miss
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

        // Mark as emitted for suspension tracking
        markEmitted(signature);

        // Return data with error if present (partial data scenario)
        return {
          data: cached.data as TData,
          error: result.error || null,
        };
      }

      // Mark as emitted for suspension tracking
      markEmitted(signature);

      return result as OperationResult<TData>; ee
    }

    if (ssr.isHydrating() || isWithinSuspension(signature)) {
      if (cached && cached.data !== undefined) {
        return { data: cached.data as TData, error: null };
      }

      if (cachePolicy === 'cache-only') {
        if (cached && cached.data === undefined) {
          return { data: null, error: new CombineeError({ networkError: new CacheMissError() }) };
        }

        return { data: cached.data as TData, error: null };
      }

      if (cachePolicy === 'cache-first') {
        if (!canonical && cached.ok.strict) {
          return { data: cached.data as TData, error: null };
        }

        if (canonical && cached.ok.canonical) {
          return { data: cached.data as TData, error: null };
        }
      }

      if (cachePolicy === 'cache-and-network') {
        if (!canonical && cached.ok.strict) {
          performRequest().catch(() => {
            if (__DEV__) {
              console.warn('Cachebay: Cache hit, but network request failed');
            }
          });

          return { data: cached.data as TData, error: null };
        }

        if (canonical && cached.ok.canonical) {
          performRequest().catch(() => {
            if (__DEV__) {
              console.warn('Cachebay: Cache hit, but network request failed');
            }
          });

          return { data: cached.data as TData, error: null };
        }
      }

      try {
        const result = await performRequest();

        return result;
      } catch (err) {
        return {
          data: null,
          error: new CombinedError({
            networkError: err as Error,
          }),
        };
      }

      /*
      const currentEpoch = (queryEpochs.get(signature) || 0) + 1;

      queryEpochs.set(signature, currentEpoch);

      // Network fetch
      const context: HttpContext = {
        query: plan.networkQuery, // Use the pre-compiled network-safe query string
        variables,
        operationType: "query",
        compiledQuery: plan,
      };

      try {
        const result = await transport.http(context);

        // Check if this response is stale (a newer request was made)
        const isStale = queryEpochs.get(signature) !== currentEpoch;

        // If stale, return null data with StaleResponseError wrapped in CombinedError
        if (isStale) {
          return {
            data: null,
            error: new CombinedError({
              networkError: new StaleResponseError(),
            }),
          };
        }

        // Write result to cache if we have data (even with partial errors)
        // This matches Relay/Apollo behavior: partial data is still useful
        if (result.data) {
          queries.writeQuery({
            query,
            variables: vars,
            data: result.data,
          });

          // Read back from cache to get normalized/materialized data
          // This ensures the same reference as watchQuery would emit
          const cached = queries.readQuery({
            query,
            variables,
            canonical: true,
          });

          // Validate that we can materialize the data we just wrote
          if (cached.source === "none") {
            if (__DEV__ && cached.ok.miss) {
              console.error(
                '[cachebay] Failed to materialize query after network response.\n' +
                'This usually means the response is missing required fields.\n' +
                'Missing data:',
                cached.ok.miss
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

          // Mark as emitted for suspension tracking
          markEmitted(signature);

          // Return data with error if present (partial data scenario)
          return {
            data: cached.data as TData,
            error: result.error || null,
          };
        }

        // Mark as emitted for suspension tracking
        markEmitted(signature);

        return result as OperationResult<TData>;
      } catch (err) {
        return {
          data: null,
          error: new CombinedError({
            networkError: err as Error,
          }),
        };
      } */
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
          queries.writeQuery({
            query,
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
      ...restOptions
    }: Operation<TData, TVars>): Promise<ObservableLike<OperationResult<TData>>> => {
      // Check if ws transport is available
      if (!transport.ws) {
        throw new Error(
          "WebSocket transport is not configured. Please provide 'transport.ws' in createCachebay options to use subscriptions."
        );
      }

      const vars = variables || ({} as TVars);
      const compiledQuery = planner.getPlan(query);

      const context: WsContext = {
        query,
        variables: vars,
        operationType: "subscription",
        compiledQuery,
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
                  queries.writeQuery({
                    query,
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
        // Return an observable that immediately errors
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
