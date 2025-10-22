import { ref, computed, watch, onBeforeUnmount, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useClient } from "./useClient";
import type { CachePolicy, Operation, OperationResult } from "../../core/operations";
import type { DocumentNode } from "graphql";

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
  /** Query data (reactive) */
  data: Ref<TData | null>;
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

  const data = ref<TData | null>(null) as Ref<TData | null>;
  const error = ref<Error | null>(null);
  const isFetching = ref(false);

  let watchHandle: { unsubscribe: () => void; refetch: () => void } | null = null;
  let initialExecutionPromise: Promise<void> | null = null;

  const policy = options.cachePolicy || "cache-first";
  const canonical = options.canonical ?? true;

  /**
   * Setup watchQuery which handles both initial fetch and reactive updates
   */
  const setupWatch = async () => {
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

    // Determine if we should fetch from network based on policy
    let shouldFetchFromNetwork = false;

    // Check cache first for cache-first and cache-and-network policies
    const cached = (policy === "cache-first" || policy === "cache-and-network" || policy === "cache-only")
      ? client.readQuery({
        query: options.query,
        variables: vars,
        canonical,
      })
      : null;

    // Handle cache-only policy (never fetches from network)
    if (policy === "cache-only") {
      const cacheOk = canonical ? cached?.ok?.canonical : cached?.ok?.strict;
      if (cacheOk && cached?.data !== undefined) {
        data.value = cached.data as TData;
      } else {
        error.value = new Error("CacheMiss");
      }

      // Setup watch for reactive updates
      watchHandle = client.watchQuery({
        query: options.query,
        variables: vars,
        canonical,
        onData: (newData) => {
          data.value = newData as TData;
          error.value = null;
        },
        onError: (err) => {
          error.value = err;
        },
      });
      return;
    }

    // Determine network fetch based on policy and cache state
    // For cache-first: check if we have a valid cache hit (strict ok)
    const cacheOk = cached?.ok?.strict;

    if (policy === "network-only") {
      // Always fetch from network
      shouldFetchFromNetwork = true;
    } else if (policy === "cache-and-network") {
      // Return cached data immediately if available, but always fetch
      if (cacheOk && cached?.data !== undefined) {
        data.value = cached.data as TData;
      }
      shouldFetchFromNetwork = true;
    } else if (policy === "cache-first") {
      // Only fetch if cache miss (strict mode check)
      if (cacheOk && cached?.data !== undefined) {
        data.value = cached.data as TData;

        shouldFetchFromNetwork = false;
      } else {
        shouldFetchFromNetwork = true;
      }
    }

    // Fetch from network if needed
    if (shouldFetchFromNetwork) {
      isFetching.value = true;

      try {
        const result = await client.executeQuery<TData, TVars>({
          query: options.query,
          variables: vars,
        });

        if (result.error) {
          error.value = result.error;
        } else {
          data.value = result.data;
        }
      } catch (err) {
        error.value = err as Error;
      } finally {
        isFetching.value = false;
      }
    }

    // Setup watch for reactive updates
    watchHandle = client.watchQuery({
      query: options.query,
      variables: vars,
      canonical,
      onData: (newData) => {
        data.value = newData as TData;
        error.value = null;
      },
      onError: (err) => {
        error.value = err;
      },
      skipInitialEmit: true, // We already handled initial data
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
