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
  /** Pause query execution if true (can be reactive) */
  pause?: MaybeRefOrGetter<boolean>;
}

/**
 * Base useQuery return value
 */
export interface BaseUseQueryReturn<TData = any> {
  /** Query data (reactive) - undefined when not loaded, null when explicitly null, TData when loaded */
  data: Ref<TData | null | undefined>;
  /** Error if query failed */
  error: Ref<Error | null>;
  /** Fetching state */
  isFetching: Ref<boolean>;
  /** Refetch the query */
  refetch: () => Promise<void>;
}

/**
 * useQuery return value with Suspense support
 */
export interface UseQueryReturn<TData = any> extends BaseUseQueryReturn<TData> {
  /** Suspense support - makes the return value awaitable */
  then(
    onFulfilled: (value: BaseUseQueryReturn<TData>) => any
  ): Promise<BaseUseQueryReturn<TData>>;
}

/**
 * Reactive GraphQL query hook with cache policies
 * @param options - Query options
 * @returns Reactive query state
 */
export function useQuery<TData = any, TVars = any>(
  options: UseQueryOptions<TData, TVars>
): UseQueryReturn<TData> {
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
      immediate: true,
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
      const result = await client.executeQuery<TData, TVars>({
        query: options.query,
        variables: vars,
        cachePolicy: policy,
      });

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
   * Refetch the query
   */
  const refetch = async () => {
    if (watchHandle) {
      const vars = toValue(options.variables) || ({} as TVars);
      await executeQuery(vars);
    }
  };

  // Watch for pause changes
  watch(
    () => toValue(options.pause),
    (isPaused) => {
      if (isPaused) {
        // Destroy watcher when paused
        if (watchHandle) {
          watchHandle.unsubscribe();
          watchHandle = null;
        }
        isFetching.value = false;
      } else {
        const vars = toValue(options.variables) || ({} as TVars);
        const policy = toValue(options.cachePolicy);
        if (!watchHandle) {
          setupWatcher(vars);
          // Only execute query if not cache-only policy
          if (policy !== 'cache-only') {
            const promise = executeQuery(vars);
            // Capture the first execution for Suspense
            if (!initialExecutionPromise) {
              initialExecutionPromise = promise;
            }
          } else {
            // For cache-only, just resolve immediately
            if (!initialExecutionPromise) {
              initialExecutionPromise = Promise.resolve();
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
      const isPaused = toValue(options.pause);
      if (isPaused) return;

      const vars = newVars || ({} as TVars);
      const policy = toValue(options.cachePolicy)

      if (watchHandle) {
        watchHandle.update({ variables: vars });
        if (policy !== 'cache-only') {
          executeQuery(vars);
        }
      }
    },
    { deep: true }
  );

  // Watch for cache policy changes
  watch(
    () => toValue(options.cachePolicy),
    () => {
      const isPaused = toValue(options.pause);
      if (isPaused || !watchHandle) return;

      const vars = toValue(options.variables) || ({} as TVars);
      const policy = toValue(options.cachePolicy)

      // Re-execute query with new policy (unless cache-only)
      if (policy !== 'cache-only') {
        executeQuery(vars);
      }
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
