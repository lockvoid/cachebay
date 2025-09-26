// src/composables/useCache.ts
import { inject } from "vue";
import { CACHEBAY_KEY } from "../core/constants";

/** Return the Cachebay instance provided via `provideCachebay(app, cache)` */
export function useCache<T = any>(): T {
  const instance = inject<T | null>(CACHEBAY_KEY, null);
  if (!instance) {
    throw new Error("[cachebay] useCache() called before provideCachebay()");
  }
  return instance;
}

export type CacheAPI = ReturnType<typeof useCache>;