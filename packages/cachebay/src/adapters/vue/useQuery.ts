import { ref, watch, onBeforeUnmount, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useCachebay } from "./useCachebay";
import { createDeferred } from "./utils";
import type { CachePolicy } from "../../core";
import type { DocumentNode } from "graphql";

/**
 * useQuery options
 */
export interface UseQueryOptions<TVars = any> {
  /** GraphQL query document */
  query: DocumentNode | string;
  /** Query variables (can be reactive) */
  variables?: MaybeRefOrGetter<TVars>;
  /** Cache policy (default: cache-first) - can be reactive */
  cachePolicy?: MaybeRefOrGetter<CachePolicy>;
  /** Enable query execution (default: true, can be reactive) */
  enabled?: MaybeRefOrGetter<boolean>;
  /** Lazy mode - skip initial query execution (default: false) */
  lazy?: boolean;
}

/**
 * Refetch options
 */
export interface RefetchOptions<TVars = any> {
  /** New variables to merge with existing variables */
  variables?: Partial<TVars>;
  /** Cache policy for this refetch (default: network-only) */
  cachePolicy?: CachePolicy;
}

/**
 * Base useQuery return value
 */
export interface BaseUseQueryReturn<TData = any, TVars = any> {
  /** Query data (reactive) - undefined when not loaded, null when explicitly null, TData when loaded */
  data: Ref<TData | null | undefined>;
  /** Error if query failed */
  error: Ref<Error | null>;
  /** Fetching state */
  isFetching: Ref<boolean>;
  /**
   * Refetch the query with optional variables and cache policy.
   * Defaults to network-only policy to force fresh data from server (Apollo behavior).
   */
  refetch: (options?: RefetchOptions<TVars>) => Promise<void>;
}

/**
 * useQuery return value with Suspense support
 */
export interface UseQueryReturn<TData = any, TVars = any> extends BaseUseQueryReturn<TData, TVars> {
  /** Suspense support - makes the return value awaitable */
  then(
    onFulfilled: (value: BaseUseQueryReturn<TData, TVars>) => any
  ): Promise<BaseUseQueryReturn<TData, TVars>>;
}

/**
 * Reactive GraphQL query hook with cache policies
 * @param options - Query options
 * @returns Reactive query state
 */
export function useQuery<TData = any, TVars = any>(
  options: UseQueryOptions<TData, TVars>,
): UseQueryReturn<TData, TVars> {
  const client = useCachebay();

  const data = ref<TData | null | undefined>();
  const error = ref<Error | null>(null);
  const isFetching = ref(false);

  let watchHandle: ReturnType<typeof client.watchQuery> | null = null;
  const suspensionPromise = createDeferred();
  
  // Add a catch handler to prevent unhandled rejections when not using Suspense
  // If .then() is called (Suspense mode), it will override this handler
  suspensionPromise.promise.catch(() => {
    // Errors are handled via error.value for non-Suspense components
  });

  /**
   * Setup watcher (first time only)
   */
  const setupWatcher = (vars: TVars) => {
    watchHandle = client.watchQuery({
      query: options.query,
      variables: vars,
      onData: (newData) => {
        data.value = newData as TData;
        error.value = null;
      },
      onError: (err) => {
        error.value = err;
      },
      immediate: false, // Don't materialize immediately - executeQuery will handle initial data
    });
  };

  /**
   * Execute query with current variables
   */
  const performQuery = async (vars: TVars, policy: CachePolicy): Promise<OperationResult<TData> | undefined> => {
    error.value = null;

    isFetching.value = true;

    const result = await client.executeQuery<TData, TVars>({
      query: options.query,
      variables: vars,
      cachePolicy: policy,

      onNetworkData: (networkData) => {

        isFetching.value = false; // Set synchronously to prevent loading flash

        queueMicrotask(() => {
          suspensionPromise.resolve(networkData);
        });
      },

      // onCacheData is called synchronously for cache hits (before Promise resolves)
      // This prevents loading flash for cache-only, cache-first, and shows stale data for cache-and-network
      onCacheData: (cachedData, { willFetchFromNetwork }) => {
        data.value = cachedData;

        // Only set isFetching to false if no network request will be made
        // If network request is pending, keep isFetching true to show loading indicator
        if (!willFetchFromNetwork) {
          isFetching.value = false;
        }

        queueMicrotask(() => {
          suspensionPromise.resolve(cachedData);
        });
      },
      // onError is called synchronously for cache-only misses (before Promise resolves)
      // This prevents loading flash by setting error AND isFetching before first render
      onError: (err) => {
        error.value = err;
        isFetching.value = false; // Set synchronously to prevent loading flash
        
        // Always reject suspense promise so Vue Suspense error boundaries can catch it
        // The .catch() handler added to the promise prevents unhandled rejections for non-Suspense components
        queueMicrotask(() => {
          suspensionPromise.reject(err);
        });
      },
    });

    return result;
  };

  /**
   * Refetch the query with optional variables and cache policy.
   * Defaults to network-only to force fresh data (Apollo behavior).
   */
  const refetch = async (refetchOptions?: RefetchOptions<TVars>) => {
    // Don't execute if disabled or no watcher
    const isEnabled = toValue(options.enabled) ?? true;

    if (!isEnabled || !watchHandle) {
      return;
    }

    const currentVars = toValue(options.variables) || ({} as TVars);

    // Merge variables (Apollo behavior: omitted variables use original values)
    const vars = refetchOptions?.variables ? { ...currentVars, ...refetchOptions.variables } as TVars : currentVars;

    // Default to network-only if no cache policy specified (Apollo behavior)
    const refetchPolicy = refetchOptions?.cachePolicy || "network-only";

    // Update watcher with new variables if provided (before performQuery)
    if (refetchOptions?.variables) {
      watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - notifyDataBySignature will update dependencies
    }

    // Execute query with refetch policy using performQuery
    const result = await performQuery(vars, refetchPolicy);

    return result;
  };

  // Watch for enabled changes
  watch(
    () => toValue(options.enabled) ?? true,
    (isEnabled) => {
      if (!isEnabled) {
        // Destroy watcher when disabled
        if (watchHandle) {
          watchHandle.unsubscribe();
          watchHandle = null;
        }
        isFetching.value = false;
      } else {
        // Enable - recreate watcher
        const vars = toValue(options.variables) || ({} as TVars);
        const policy = toValue(options.cachePolicy);
        if (!watchHandle) {
          setupWatcher(vars);
          // Execute query unless lazy mode
          if (!options.lazy) {
            performQuery(vars, policy).catch(() => { /** **/ });
          }
        }
      }
    },
    { immediate: true },
  );

  // Watch for variable changes
  watch(
    () => toValue(options.variables),
    (newVars) => {
      const isEnabled = toValue(options.enabled) ?? true;
      if (!isEnabled) return;

      const vars = newVars || ({} as TVars);
      const policy = toValue(options.cachePolicy);

      if (watchHandle) {
        watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - performQuery will handle it
        performQuery(vars, policy).catch(() => { /* NOOP */ }); // performQuery handles all policies including cache-only
      }
    },
    { deep: true },
  );

  // Watch for cache policy changes
  watch(
    () => toValue(options.cachePolicy),
    (newPolicy) => {
      const isEnabled = toValue(options.enabled) ?? true;
      if (!isEnabled || !watchHandle) return;

      const vars = toValue(options.variables) || ({} as TVars);
      const policy = newPolicy || "cache-first";

      // Re-execute query with new policy (performQuery handles all policies)
      performQuery(vars, policy).catch(() => { /* NOOP */ });
    },
  );

  // Cleanup on unmount
  onBeforeUnmount(() => {
    if (watchHandle) {
      watchHandle.unsubscribe();
      watchHandle = null;
    }
  });

  const api: BaseUseQueryReturn<TData> = {
    data,
    error,
    isFetching,
    refetch,
  };

  return {
    ...api,
    /**
     * Suspense support - makes useQuery awaitable
     * Usage: await useQuery({ query, variables })
     */
    async then(
      onFulfilled?: (value: BaseUseQueryReturn<TData>) => any,
      onRejected?: (reason: any) => any,
    ): Promise<BaseUseQueryReturn<TData>> {
      // Throw if lazy mode is used with Suspense (async setup)
      // This makes lazy and Suspense mutually exclusive
      if (options.lazy) {
        const error = new Error(
          "[cachebay] useQuery: lazy mode is incompatible with Suspense (async setup). " +
          'Either remove "lazy: true" or don\'t use "await useQuery()" in async setup(). ' +
          "Use regular setup() and call refetch() manually instead.",
        );

        if (onRejected) {
          return onRejected(error);
        }

        throw error;
      }

      try {
        await suspensionPromise.promise;

        return onFulfilled ? onFulfilled(api) : api;
      } catch (err) {
        if (onRejected) {
          return onRejected(err);
        }

        throw err;
      }
    },
  };
}
