import { ref, watch, onBeforeUnmount, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useCachebay } from "./useCachebay";
import type { CachePolicy } from "../../core/operations";
import type { DocumentNode } from "graphql";

/**
 * useQuery options
 */
export interface UseQueryOptions<TData = any, TVars = any> {
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
  options: UseQueryOptions<TData, TVars>
): UseQueryReturn<TData, TVars> {
  const client = useCachebay();

  const data = ref<TData | null | undefined>() as Ref<TData | null | undefined>;
  const error = ref<Error | null>(null);
  const isFetching = ref(false);

  let watchHandle: ReturnType<typeof client.watchQuery> | null = null;
  let initialExecutionPromise: Promise<void> | null = null;

  /**
   * Setup watcher (first time only)
   */
  const setupWatcher = (vars: TVars) => {
    const policy = toValue(options.cachePolicy);

    watchHandle = client.watchQuery({
      query: options.query,
      variables: vars,
      onData: (newData) => {
        data.value = newData as TData;
        error.value = null;
        isFetching.value = false;
      },
      onError: (err) => {
        error.value = err;
        isFetching.value = false;
      },
      immediate: false, // Don't materialize immediately - executeQuery will handle initial data
    });
  };

  /**
   * Execute query with current variables
   */
  const executeQuery = async (vars: TVars): Promise<void> => {
    const policy = toValue(options.cachePolicy);
    error.value = null;
    isFetching.value = true;

    try {
      console.log("Executing query1");
      const result = await client.executeQuery<TData, TVars>({
        query: options.query,
        variables: vars,
        cachePolicy: policy,
      });
      console.log("Executing query2", result);

      // For cache-and-network with cached data, keep isFetching true
      // The watcher will be notified when network data arrives and set isFetching to false
      if (policy === 'cache-and-network' && result.meta?.source === 'cache') {
        // Keep isFetching true - waiting for network data
        return;
      }

      // For all other cases, set isFetching to false
      isFetching.value = false;
    } catch (err) {
      // Watcher already set error through onError callback
      isFetching.value = false;
    }
  };

  /**
   * Refetch the query with optional variables and cache policy.
   * Defaults to network-only to force fresh data (Apollo behavior).
   */
  const refetch = async (refetchOptions?: RefetchOptions<TVars>) => {
    // Don't execute if disabled or no watcher
    const isEnabled = toValue(options.enabled) ?? true;
    if (!isEnabled || !watchHandle) return;

    const currentVars = toValue(options.variables) || ({} as TVars);

    // Merge variables (Apollo behavior: omitted variables use original values)
    const vars = refetchOptions?.variables
      ? { ...currentVars, ...refetchOptions.variables } as TVars
      : currentVars;

    // Default to network-only if no cache policy specified (Apollo behavior)
    const refetchPolicy = refetchOptions?.cachePolicy || 'network-only';

    // Update watcher with new variables if provided
    if (refetchOptions?.variables) {
      watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - executeQuery will handle it
    }

    // Execute query with refetch policy
    error.value = null;
    isFetching.value = true;

    try {
      const result = await client.executeQuery<TData, TVars>({
        query: options.query,
        variables: vars,
        cachePolicy: refetchPolicy,
      });

      return result;
    } catch (err) {
      // Watcher already set error through onError callback
      isFetching.value = false;
    }
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
          // Execute query unless lazy mode (executeQuery handles all policies)
          if (!options.lazy) {
            const promise = executeQuery(vars);
            // Capture the first execution for Suspense
            if (!initialExecutionPromise) {
              initialExecutionPromise = promise;
            }
          }
        }
      }
    },
    { immediate: true }
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
        watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - executeQuery will handle it
        executeQuery(vars); // executeQuery handles all policies including cache-only
      }
    },
    { deep: true }
  );

  // Watch for cache policy changes
  watch(
    () => toValue(options.cachePolicy),
    () => {
      const isEnabled = toValue(options.enabled) ?? true;
      if (!isEnabled || !watchHandle) return;

      const vars = toValue(options.variables) || ({} as TVars);

      // Re-execute query with new policy (executeQuery handles all policies)
      executeQuery(vars);
    }
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
      onFulfilled: (value: BaseUseQueryReturn<TData>) => any
    ): Promise<BaseUseQueryReturn<TData>> {
      // Wait for initial execution to complete
      if (initialExecutionPromise) {
        await initialExecutionPromise;
      }

      return onFulfilled(api);
    },
  };
}
