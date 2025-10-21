import { inject } from "vue";
import { CACHEBAY_KEY } from "../core/constants";
import type { CachebayInstance } from "../core/client";

/**
 * Get the Cachebay instance from Vue context
 * Must be called after provideCachebay(app, cache)
 * @returns Cachebay cache instance
 * @throws Error if called before provideCachebay
 */
export function useCache(): CachebayInstance {
  const instance = inject<CachebayInstance | null>(CACHEBAY_KEY, null);
  if (!instance) {
    throw new Error("[cachebay] useCache() called before provideCachebay()");
  }
  return instance;
}
