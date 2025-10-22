import { ref, computed, watch, onBeforeUnmount, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useClient } from "./useClient";
import type { CachePolicy, Operation, OperationResult } from "../../core/operations";
import type { DocumentNode } from "graphql";
import { StaleResponseError, CacheMissError } from "../../core/errors";

/**
 * useQuery options
 */
export interface UseQueryOptions<TData = any, TVars = any> {
  /** GraphQL query document */
  query: DocumentNode | string;
  /** Query variables (can be reactive) */
  variables?: MaybeRefOrGetter<TVars>;
  /** Cache policy (default: cache-first) */
  cachePolicy?: CachePolicy;
  /** Pause query execution if true (can be reactive) */
  pause?: MaybeRefOrGetter<boolean>;
  /** Use canonical mode for cache reads (default: true) */
  canonical?: boolean;
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
  const client = useClient();

  const data = ref<TData | null | undefined>() as Ref<TData | null | undefined>;
  const error = ref<Error | null>(null);
  const isFetching = ref(false);

  let watchHandle: { unsubscribe: () => void; refetch: () => void } | null = null;
  let initialExecutionPromise: Promise<void> | null = null;

  const policy = options.cachePolicy || "cache-first";
  const canonical = options.canonical ?? true;

  /**
   * Setup watchQuery which handles both initial fetch and reactive updates
   * Returns a promise that resolves when initial data is available (for Suspense)
   */
  const setupWatch = async (): Promise<void> => {
    console.log('ssdsd', options.variables)
    const vars = toValue(options.variables) || ({} as TVars);
    const isPaused = toValue(options.pause);

    // Cleanup previous watch
    if (watchHandle) {
      watchHandle.unsubscribe();
      watchHandle = null;
    }

    if (isPaused) {
      isFetching.value = false;
      return;
    }

    error.value = null;

    // Check cache first
    const cached = client.readQuery({
      query: options.query,
      variables: vars,
      canonical,
    });

    const isCanonical = cached?.ok?.canonical ?? false;
    const isStrict = cached?.ok?.strict ?? false;

    // Determine if we should fetch from network based on policy
    let shouldFetchFromNetwork = false;
    let shouldShowCachedData = false;

    if (policy === "network-only") {
      shouldFetchFromNetwork = true;
      shouldShowCachedData = false;
    } else if (policy === "cache-and-network") {
      shouldFetchFromNetwork = true;
      shouldShowCachedData = isCanonical;
    } else if (policy === "cache-first") {
      // cache-first logic:
      // 1. canonical: true + strict: true → show data, don't send request
      // 2. canonical: true + strict: false → show data, send request (partial, need completion)
      // 3. canonical: false + strict: false → don't show data, send request
      if (isCanonical && isStrict) {
        shouldShowCachedData = true;
        shouldFetchFromNetwork = false;
      } else if (isCanonical && !isStrict) {
        shouldShowCachedData = true;
        shouldFetchFromNetwork = true;
      } else {
        shouldShowCachedData = false;
        shouldFetchFromNetwork = true;
      }
    } else if (policy === "cache-only") {
      shouldFetchFromNetwork = false;
      shouldShowCachedData = isCanonical;
    }

    // Set initial data from cache if we should show it
    if (shouldShowCachedData) {
      data.value = cached.data as TData;
    } else if (policy === "cache-only") {
      error.value = new CacheMissError();
    }

    // Setup single watcher for all reactive updates
    return new Promise<void>((resolve) => {
      let settled = false;

      watchHandle = client.watchQuery({
        query: options.query,
        variables: vars,
        canonical,
        onData: (newData) => {
          data.value = newData as TData;
          error.value = null;
          isFetching.value = false;
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        onError: (err) => {
          error.value = err;
          isFetching.value = false;
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        immediate: false, // We already handled initial cache data above
      });

      // If we're showing cached data and don't need network, resolve immediately
      if (shouldShowCachedData && !shouldFetchFromNetwork) {
        settled = true;
        resolve();
        return;
      }

      // Fetch from network if needed
      if (shouldFetchFromNetwork) {
        isFetching.value = true;

        client.executeQuery<TData, TVars>({
          query: options.query,
          variables: vars,
        }).then((result) => {
          // If executeQuery returns an error (not thrown), handle it
          if (result.error && !settled) {
            // Ignore stale errors - they're expected and shouldn't surface to UI
            // Check if the error is a StaleResponseError (wrapped in CombinedError)
            const isStale = result.error.networkError instanceof StaleResponseError;

            if (isStale) {
              isFetching.value = false;
              settled = true;
              resolve();
              return;
            }

            error.value = result.error;
            isFetching.value = false;
            settled = true;
            resolve();
          }
          // Otherwise watcher will handle the success case
        }).catch((err) => {
          // executeQuery threw an exception
          if (!settled) {
            error.value = err as Error;
            isFetching.value = false;
            settled = true;
            resolve();
          }
        });
      } else if (!shouldShowCachedData) {
        // No cached data to show and not fetching - resolve immediately
        settled = true;
        resolve();
      }
    });
  };

  /**
   * Refetch the query
   */
  const refetch = async () => {
    if (watchHandle) {
      watchHandle.refetch();
    }
  };

  // Watch for variable and pause changes
  watch(
    () => [toValue(options.variables), toValue(options.pause)],
    () => {
      const promise = setupWatch();
      // Capture the first execution for Suspense
      if (!initialExecutionPromise) {
        initialExecutionPromise = promise;
      }
    },
    { immediate: true, deep: true }
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
