import { inject } from "vue";
import { CACHEBAY_KEY } from "@/src/core/plugin";

/**
 * Access the Cachebay API that was provided by `provideCachebay(app, cache)`.
 *
 * Notes:
 * - We shim `writeFragment` to ALWAYS return an object with { commit, revert }.
 *   If the underlying instance already returns that, we just pass it through.
 *   If not, we perform the write immediately and return no-op commit/revert,
 *   which makes test code like `.commit?.()` safe.
 */
export function useCache<T = any>(): T {
  const instance = inject<any>(CACHEBAY_KEY, null);
  if (!instance) {
    throw new Error("[cachebay] useCache() called before provideCachebay()");
  }

  const writeFragmentShim = (args: {
    id: string;
    fragment: any; // string | DocumentNode | CachePlanV1
    data: any;
    variables?: Record<string, any>;
  }) => {
    const ret = instance.writeFragment?.(args);
    if (ret && typeof ret === "object" && ("commit" in ret || "revert" in ret)) {
      return ret; // transactional already
    }
    // Eager write; provide tx-like surface
    return {
      commit() {
        /* no-op */
      },
      revert() {
        /* optional: add history later */
      },
    };
  };

  return {
    ...instance,
    writeFragment: writeFragmentShim,
  } as T;
}

export type CacheAPI = ReturnType<typeof useCache>;
