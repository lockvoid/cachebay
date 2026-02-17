/**
 * Svelte integration test helpers.
 *
 * Since setContext/getContext only work during component init, we bypass
 * context and call the core cache API directly — then test the Svelte
 * reactive primitives ($state, $effect) by running inside $effect.root().
 */
import { flushSync } from "svelte";
import { createCachebay } from "@/src/core/client";
import { tick, delay } from "@/test/helpers/concurrency";
import type { CachebayInstance } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";
import type { CachePolicy } from "@/src/core/types";
import type { DocumentNode } from "graphql";

export { tick, delay, flushSync };
export { fixtures, operations } from "@/test/helpers";

// ---- Transport mock (identical to Vue tests) ----

export type Route = {
  when: (op: { body: string; variables: any; context: any }) => boolean;
  respond: (op: { body: string; variables: any; context: any }) => { data?: any; error?: any };
  delay?: number;
};

export function createTransportMock(routes: Route[] = []) {
  const calls: Array<{ query: string; variables: any }> = [];
  let pending = 0;

  const transport: Transport = {
    http: async (context) => {
      const { query, variables } = context;
      const queryStr = typeof query === "string" ? query : (query as any).loc?.source.body || "";
      const op = { body: queryStr, variables, context };

      const route = routes.find((r) => r.when(op));
      if (!route) {
        return { data: null, error: null };
      }

      calls.push({ query: queryStr, variables });
      pending++;

      try {
        if (route.delay && route.delay > 0) {
          await delay(route.delay);
        }

        const payload = route.respond(op);

        if (payload && typeof payload === "object" && "error" in payload && (payload as any).error) {
          return { data: null, error: (payload as any).error };
        }

        return { data: payload?.data || payload, error: null };
      } finally {
        if (pending > 0) pending--;
      }
    },
  };

  return {
    transport,
    calls,
    async restore(timeoutMs = 200) {
      const end = Date.now() + timeoutMs;
      while (pending > 0 && Date.now() < end) {
        await tick();
      }
    },
  };
}

// ---- Test client factory ----

export function createTestClient({ routes, cache, cacheOptions }: { routes?: Route[]; cache?: any; cacheOptions?: any } = {}) {
  const fx = createTransportMock(routes);

  let finalCache: CachebayInstance;

  if (cache) {
    const state = cache.dehydrate();

    finalCache = createCachebay({
      cachePolicy: "network-only",
      suspensionTimeout: 0,
      hydrationTimeout: 0,
      transport: fx.transport,
      ...(cacheOptions || {}),
      keys: {
        Comment: (comment: any) => String(comment.uuid),
        ...(cacheOptions?.keys || {}),
      },
      interfaces: {
        Post: ["AudioPost", "VideoPost"],
        ...(cacheOptions?.interfaces || {}),
      },
    });

    finalCache.hydrate(state);
  } else {
    finalCache = createCachebay({
      cachePolicy: "network-only",
      suspensionTimeout: 0,
      transport: fx.transport,
      ...(cacheOptions || {}),
      keys: {
        Comment: (comment: any) => String(comment.uuid),
        ...(cacheOptions?.keys || {}),
      },
      interfaces: {
        Post: ["AudioPost", "VideoPost"],
        ...(cacheOptions?.interfaces || {}),
      },
    });
  }

  return { cache: finalCache, fx };
}

export async function seedCache(cache: CachebayInstance, { query, variables, data }: { query: any; variables: any; data: any }) {
  cache.writeQuery({ query, variables, data });
  await tick();
}

// ---- Reactive query wrapper ----
// Wraps the core watchQuery + executeQuery in Svelte $state/$effect,
// mirroring the exact behavior of createQuery.svelte.ts but without context.

export function createTestQuery(
  cache: CachebayInstance,
  query: DocumentNode | string,
  options: {
    variables?: () => any;
    cachePolicy?: CachePolicy;
    enabled?: () => boolean;
    lazy?: boolean;
  } = {},
) {
  let data = $state<any>(undefined);
  let error = $state<Error | null>(null);
  let isFetching = $state(false);

  let watchHandle: ReturnType<typeof cache.watchQuery> | null = null;
  const dataUpdates: any[] = [];
  const errorUpdates: any[] = [];
  let prevEnabled: boolean | undefined;
  let prevVars: any;
  let prevPolicy: CachePolicy | undefined;

  const resolveOpt = <T>(value: T | (() => T) | undefined): T | undefined =>
    typeof value === "function" ? (value as () => T)() : value;

  const setupWatcher = (vars: any) => {
    watchHandle = cache.watchQuery({
      query,
      variables: vars,
      onData: (newData: any) => {
        data = newData;
        error = null;
      },
      onError: (err: Error) => {
        error = err;
      },
      immediate: false,
    });
  };

  const performQuery = async (vars: any, policy: CachePolicy | undefined) => {
    error = null;
    isFetching = true;

    return await cache.executeQuery({
      query,
      variables: vars,
      cachePolicy: policy,
      onNetworkData: () => {
        isFetching = false;
      },
      onCacheData: (cachedData: any, { willFetchFromNetwork }: any) => {
        data = cachedData;
        if (!willFetchFromNetwork) isFetching = false;
      },
      onError: (err: any) => {
        error = err;
        isFetching = false;
      },
    });
  };

  const refetch = async (refetchOptions?: { variables?: any; cachePolicy?: CachePolicy }) => {
    const isEnabled = resolveOpt(options.enabled) ?? true;
    if (!isEnabled || !watchHandle) return;

    const currentVars = resolveOpt(options.variables) || {};
    const vars = refetchOptions?.variables ? { ...currentVars, ...refetchOptions.variables } : currentVars;
    const refetchPolicy = refetchOptions?.cachePolicy || "network-only";

    if (refetchOptions?.variables) {
      watchHandle.update({ variables: vars, immediate: false });
    }

    await performQuery(vars, refetchPolicy);
  };

  const dispose = $effect.root(() => {
    // Track data updates
    $effect(() => {
      dataUpdates.push(data === undefined ? "undefined" : data);
    });

    // Track error updates
    $effect(() => {
      if (error) errorUpdates.push(error);
    });

    // Main effect: watches enabled, variables, cachePolicy
    $effect(() => {
      const isEnabled = resolveOpt(options.enabled) ?? true;
      const vars = resolveOpt(options.variables) || {};
      const policy = resolveOpt(options.cachePolicy) as CachePolicy | undefined;

      // Enabled changed
      if (prevEnabled !== undefined && prevEnabled !== isEnabled) {
        if (!isEnabled) {
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
          setupWatcher(vars);
          if (!options.lazy) performQuery(vars, policy).catch(() => {});
          prevEnabled = isEnabled;
          prevVars = vars;
          prevPolicy = policy;
          return;
        }
      }

      // First run
      if (prevEnabled === undefined) {
        prevEnabled = isEnabled;
        prevVars = vars;
        prevPolicy = policy;
        if (!isEnabled) return;
        setupWatcher(vars);
        if (!options.lazy) performQuery(vars, policy).catch(() => {});
        return;
      }

      if (!isEnabled || !watchHandle) {
        prevEnabled = isEnabled;
        prevVars = vars;
        prevPolicy = policy;
        return;
      }

      // Variables changed
      if (prevVars !== vars) {
        watchHandle.update({ variables: vars, immediate: false });
        performQuery(vars, policy).catch(() => {});
        prevVars = vars;
        prevPolicy = policy;
        prevEnabled = isEnabled;
        return;
      }

      // Policy changed
      if (prevPolicy !== policy) {
        performQuery(vars, policy).catch(() => {});
        prevPolicy = policy;
        prevEnabled = isEnabled;
        return;
      }

      prevEnabled = isEnabled;
      prevVars = vars;
      prevPolicy = policy;
    });
  });

  flushSync();

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
    refetch,
    dataUpdates,
    errorUpdates,
    dispose() {
      if (watchHandle) {
        watchHandle.unsubscribe();
        watchHandle = null;
      }
      dispose();
    },
  };
}

// ---- Fragment test helper ----

export function createTestFragment<TData = any>(
  cache: CachebayInstance,
  fragment: DocumentNode | string,
  options: {
    id: string | (() => string);
    fragmentName?: string;
    variables?: () => Record<string, unknown>;
  },
) {
  let data = $state<TData | undefined>(undefined);
  let handle: ReturnType<typeof cache.watchFragment> | null = null;

  const dispose = $effect.root(() => {
    $effect(() => {
      const id = typeof options.id === "function" ? options.id() : options.id;
      const variables = options.variables ? options.variables() : {};

      if (!id) {
        if (handle) {
          handle.unsubscribe();
          handle = null;
        }
        data = undefined;
        return;
      }

      if (handle) {
        handle.update({ id, variables });
      } else {
        handle = cache.watchFragment({
          id,
          fragment,
          fragmentName: options.fragmentName,
          variables,
          onData: (newData: TData) => {
            data = newData;
          },
        });
      }
    });
  });

  flushSync();

  return {
    get data() { return data; },
    dispose() {
      if (handle) {
        handle.unsubscribe();
        handle = null;
      }
      dispose();
    },
  };
}

// ---- Mutation test helper ----

export function createTestMutation<TData = any, TVars = any>(
  cache: CachebayInstance,
  query: DocumentNode | string,
) {
  let data = $state<TData | null>(null);
  let error = $state<Error | null>(null);
  let isFetching = $state(false);

  const execute = async (variables?: TVars) => {
    isFetching = true;
    error = null;

    try {
      const result = await cache.executeMutation<TData, TVars>({
        query,
        variables: variables || ({} as TVars),
      });

      if (result.error) {
        error = result.error;
      } else {
        data = result.data;
      }

      return result;
    } catch (err) {
      error = err as Error;
      return { data: null, error: err as Error };
    } finally {
      isFetching = false;
    }
  };

  const dispose = $effect.root(() => {});

  flushSync();

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
    execute,
    dispose,
  };
}

// ---- Subscription test helper ----

export function createTestSubscription<TData = any, TVars = any>(
  cache: CachebayInstance,
  query: DocumentNode | string,
  options: {
    variables?: () => TVars;
    enabled?: () => boolean;
    onData?: (data: TData) => void;
    onError?: (error: Error) => void;
    onComplete?: () => void;
  } = {},
) {
  let data = $state<TData | null>(null);
  let error = $state<Error | null>(null);
  let isFetching = $state(true);
  let teardown: (() => void) | null = null;

  const resolveOpt = <T>(value: T | (() => T) | undefined): T | undefined =>
    typeof value === "function" ? (value as () => T)() : value;

  const setupSubscription = () => {
    const vars = resolveOpt(options.variables) || ({} as TVars);
    const isEnabled = resolveOpt(options.enabled) ?? true;

    if (teardown) {
      teardown();
      teardown = null;
    }

    if (!isEnabled) {
      isFetching = false;
      return;
    }

    isFetching = true;
    error = null;

    try {
      const observable = cache.executeSubscription<TData, TVars>({
        query,
        variables: vars,
        onData: options.onData,
        onError: options.onError,
        onComplete: options.onComplete,
      });

      const subscription = observable.subscribe({
        next: (result: any) => {
          if (result.error) {
            error = result.error;
          } else {
            data = result.data;
            error = null;
          }
          isFetching = false;
        },
        error: (err: any) => {
          error = err;
          isFetching = false;
        },
        complete: () => {
          isFetching = false;
        },
      });

      teardown = () => subscription.unsubscribe();
    } catch (err) {
      error = err as Error;
      isFetching = false;
    }
  };

  const dispose = $effect.root(() => {
    $effect(() => {
      resolveOpt(options.variables);
      resolveOpt(options.enabled);
      setupSubscription();

      return () => {
        if (teardown) {
          teardown();
          teardown = null;
        }
      };
    });
  });

  flushSync();

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
    dispose() {
      if (teardown) {
        teardown();
        teardown = null;
      }
      dispose();
    },
  };
}
