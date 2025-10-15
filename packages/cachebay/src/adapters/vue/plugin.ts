import { createCachebay as createAgnosticCachebay } from "../../core";
import { CACHEBAY_KEY } from "./constants";
import type { CachebayOptions, CachebayInstance } from "../../core";
import type { App, Plugin } from "vue";

/**
 * Cachebay Vue plugin instance
 * Extends the cache client with Vue-specific functionality
 */
export type CachebayPlugin = CachebayInstance & Plugin;

/**
 * Create a Cachebay instance with Vue plugin support
 * This is the main entry point for Vue users
 * @param options - Cachebay configuration options
 * @returns Cachebay instance with Vue plugin install method
 * @example
 * ```ts
 * import { createCachebay } from 'cachebay/vue'
 *
 * const cachebay = createCachebay({
 *   transport: { http: async (ctx) => fetch(...) }
 * })
 *
 * app.use(cachebay)
 * ```
 */
export function createCachebay(options: CachebayOptions): CachebayPlugin {
  const cachebay = createAgnosticCachebay(options) as CachebayPlugin;

  cachebay.install = (app: App) => {
    app.provide(CACHEBAY_KEY, cachebay);
  };

  return cachebay;
}

/**
 * Provide Cachebay instance to Vue app
 * Alternative to using createCachebay if you want manual control
 * @param app - Vue application instance
 * @param cache - Cachebay cache instance
 */
export function provideCachebay(app: App, cache: CachebayInstance): void {
  app.provide(CACHEBAY_KEY, cache);
}
