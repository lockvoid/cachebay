import { inject } from "vue";
import type { CachebayInstance } from "@/src/core";
import { CACHEBAY_KEY } from "./constants";

/**
 * Get the Cachebay instance from Vue context
 * Must be called after provideCachebay(app, cache) or app.use(plugin)
 * @returns Cachebay cache instance
 * @throws Error if called before setup
 */
export function useCachebay(): CachebayInstance {
  const instance = inject<CachebayInstance | null>(CACHEBAY_KEY, null);
  if (!instance) {
    throw new Error("[cachebay] useCachebay() called before setup. Call app.use(cachebayPlugin) first");
  }
  return instance;
}
