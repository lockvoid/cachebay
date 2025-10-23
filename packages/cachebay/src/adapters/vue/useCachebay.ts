import { inject } from "vue";
import { CACHEBAY_KEY } from "./constants";
import type { CachebayInstance } from "../../core/client";

/**
 * Get the Cachebay instance from Vue context
 * Must be called after provideCachebay(app, cache) or app.use(plugin)
 * @returns Cachebay cache instance
 * @throws Error if called before setup
 */
export function useCachebay(): CachebayInstance {
  const instance = inject<CachebayInstance | null>(CACHEBAY_KEY, null);
  if (!instance) {
    throw new Error(
      "[cachebay] useCachebay() called before cache setup. " +
      "Make sure to call app.use(cachebayPlugin) or provideCachebay(app, cache) first."
    );
  }
  return instance;
}
