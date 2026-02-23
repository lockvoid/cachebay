import { onDestroy } from "svelte";
import { getCachebay } from "./context";
import type { CachePolicy, OperationResult } from "../../core";
import type { DocumentNode } from "graphql";

/**
 * Reactive getter type for Svelte 5 runes
 */
type MaybeGetter<T> = T | (() => T);

/**
 * Resolve a MaybeGetter to its current value
 */
const resolve = <T>(value: MaybeGetter<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;

/**
 * createQuery options
 */
export interface CreateQueryOptions<TVars = any> {
  /** GraphQL query document */
  query: DocumentNode | string;
  /** Query variables (can be a reactive getter) */
  variables?: MaybeGetter<TVars>;
  /** Cache policy (default: cache-first) - can be a reactive getter */
  cachePolicy?: MaybeGetter<CachePolicy>;
  /** Enable query execution (default: true, can be a reactive getter) */
  enabled?: MaybeGetter<boolean>;
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
 * createQuery return value.
 *
 * **IMPORTANT: Do not destructure this object.**
 * Destructuring (`const { data } = createQuery(...)`) breaks Svelte reactivity
 * because JS destructuring evaluates getters once and copies the plain value.
 * Use `query.data` in templates instead.
 */
export interface CreateQueryReturn<TData = any, TVars = any> {
  /** Query data - undefined when not loaded, null when explicitly null, TData when loaded */
  readonly data: TData | null | undefined;
  /** Error if query failed */
  readonly error: Error | null;
  /** Fetching state */
  readonly isFetching: boolean;
  /**
   * Refetch the query with optional variables and cache policy.
   * Defaults to network-only policy to force fresh data from server (Apollo behavior).
   */
  refetch: (options?: RefetchOptions<TVars>) => Promise<void>;
}

/**
 * Reactive GraphQL query with cache policies.
 *
 * **IMPORTANT: Do not destructure the return value.**
 * The returned object uses getters backed by `$state` for reactivity.
 * Destructuring (`const { data } = createQuery(...)`) evaluates getters once,
 * capturing a static value that never updates. Instead, assign to a single variable:
 *
 * ```svelte
 * // Correct
 * const query = createQuery({ query: MY_QUERY });
 * // use query.data, query.error, query.isFetching in template
 *
 * // WRONG - breaks reactivity
 * const { data } = createQuery({ query: MY_QUERY });
 * ```
 *
 * @param options - Query options
 * @returns Reactive query state with refetch
 */
export function createQuery<TData = any, TVars = any>(
  options: CreateQueryOptions<TVars>,
): CreateQueryReturn<TData, TVars> {
  const client = getCachebay();

  let data = $state<TData | null | undefined>(undefined);
  let error = $state<Error | null>(null);
  let isFetching = $state(false);

  let watchHandle: ReturnType<typeof client.watchQuery> | null = null;

  // Track previous values for $effect change detection
  let prevEnabled: boolean | undefined;
  let prevVars: TVars | undefined;
  let prevPolicy: CachePolicy | undefined;

  /**
   * Setup watcher (first time only)
   */
  const setupWatcher = (vars: TVars) => {
    watchHandle = client.watchQuery({
      query: options.query,
      variables: vars,
      onData: (newData) => {
        data = newData as TData;
        error = null;
      },
      onError: (err) => {
        error = err;
      },
      immediate: false, // Don't materialize immediately - executeQuery will handle initial data
    });
  };

  /**
   * Execute query with current variables
   */
  const performQuery = async (vars: TVars, policy: CachePolicy): Promise<OperationResult<TData> | undefined> => {
    error = null;
    isFetching = true;

    const result = await client.executeQuery<TData, TVars>({
      query: options.query,
      variables: vars,
      cachePolicy: policy,

      onNetworkData: () => {
        isFetching = false; // Set synchronously to prevent loading flash
      },

      // onCacheData is called synchronously for cache hits (before Promise resolves)
      // This prevents loading flash for cache-only, cache-first, and shows stale data for cache-and-network
      onCacheData: (cachedData, { willFetchFromNetwork }) => {
        data = cachedData;

        // Only set isFetching to false if no network request will be made
        // If network request is pending, keep isFetching true to show loading indicator
        if (!willFetchFromNetwork) {
          isFetching = false;
        }
      },
      // onError is called synchronously for cache-only misses (before Promise resolves)
      // This prevents loading flash by setting error AND isFetching before first render
      onError: (err) => {
        error = err;
        isFetching = false; // Set synchronously to prevent loading flash
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
    const isEnabled = resolve(options.enabled) ?? true;

    if (!isEnabled || !watchHandle) {
      return;
    }

    const currentVars = resolve(options.variables) || ({} as TVars);

    // Merge variables (Apollo behavior: omitted variables use original values)
    const vars = refetchOptions?.variables ? { ...currentVars, ...refetchOptions.variables } as TVars : currentVars;

    // Default to network-only if no cache policy specified (Apollo behavior)
    const refetchPolicy = refetchOptions?.cachePolicy || "network-only";

    // Update watcher with new variables if provided (before performQuery)
    if (refetchOptions?.variables) {
      watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - notifyDataBySignature will update dependencies
    }

    // Execute query with refetch policy using performQuery
    await performQuery(vars, refetchPolicy);
  };

  // Single $effect that watches enabled, variables, and cachePolicy.
  // Svelte 5 $effect auto-tracks all reactive reads inside the callback,
  // so calling resolve() on getter-based options is enough to register deps.
  $effect(() => {
    const isEnabled = resolve(options.enabled) ?? true;
    const vars = resolve(options.variables) || ({} as TVars);
    const policy = resolve(options.cachePolicy);

    // --- Enabled changed ---
    if (prevEnabled !== undefined && prevEnabled !== isEnabled) {
      if (!isEnabled) {
        // Destroy watcher when disabled
        if (watchHandle) {
          watchHandle.unsubscribe();
          watchHandle = null;
        }
        isFetching = false;
        prevEnabled = isEnabled;
        prevVars = vars;
        prevPolicy = policy;
        return;
      } else if (!watchHandle) {
        // Re-enable: recreate watcher and execute unless lazy
        setupWatcher(vars);
        if (!options.lazy) {
          performQuery(vars, policy).catch(() => { /* NOOP */ });
        }
        prevEnabled = isEnabled;
        prevVars = vars;
        prevPolicy = policy;
        return;
      }
    }

    // --- First run (initialization) ---
    if (prevEnabled === undefined) {
      prevEnabled = isEnabled;
      prevVars = vars;
      prevPolicy = policy;

      if (!isEnabled) {
        return;
      }

      setupWatcher(vars);

      if (!options.lazy) {
        performQuery(vars, policy).catch(() => { /* NOOP */ });
      }
      return;
    }

    // Guard: not enabled or no watcher
    if (!isEnabled || !watchHandle) {
      prevEnabled = isEnabled;
      prevVars = vars;
      prevPolicy = policy;
      return;
    }

    // --- Variables changed ---
    if (prevVars !== vars) {
      watchHandle.update({ variables: vars, immediate: false }); // Don't materialize - performQuery will handle it
      performQuery(vars, policy).catch(() => { /* NOOP */ });
      prevVars = vars;
      prevPolicy = policy;
      prevEnabled = isEnabled;
      return;
    }

    // --- Cache policy changed ---
    if (prevPolicy !== policy) {
      performQuery(vars, policy).catch(() => { /* NOOP */ });
      prevPolicy = policy;
      prevEnabled = isEnabled;
      return;
    }

    prevEnabled = isEnabled;
    prevVars = vars;
    prevPolicy = policy;
  });

  // Cleanup on unmount
  onDestroy(() => {
    if (watchHandle) {
      watchHandle.unsubscribe();
      watchHandle = null;
    }
  });

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
    refetch,
  };
}
