import type { App, Plugin } from "vue";
import type { CachebayInstance } from "../../core/client";
import { CACHEBAY_KEY } from "../../core/constants";

/**
 * Vue plugin options
 */
export interface CachebayPluginOptions {
  /** Timeout in ms for Suspense result caching (default: 1000) */
  suspensionTimeout?: number;
}

/**
 * Cachebay Vue plugin instance
 * Extends the cache client with Vue-specific functionality
 */
export type CachebayPlugin = CachebayInstance & Plugin;

/**
 * Create a Vue plugin from a Cachebay cache instance
 * @param cache - Cachebay cache instance
 * @param options - Vue plugin options
 * @returns Vue plugin with install method
 */
export function createCachebayPlugin(
  cache: CachebayInstance,
  options: CachebayPluginOptions = {}
): CachebayPlugin {
  const plugin = cache as CachebayPlugin;

  // Add Vue plugin install method
  plugin.install = (app: App) => {
    // Provide cache instance to all components
    app.provide(CACHEBAY_KEY, cache);

    // Store options for hooks to access
    (cache as any).__vueOptions = {
      suspensionTimeout: options.suspensionTimeout ?? 1000,
    };
  };

  return plugin;
}

/**
 * Provide Cachebay instance to Vue app
 * Alternative to using createCachebayPlugin if you want manual control
 * @param app - Vue application instance
 * @param cache - Cachebay cache instance
 * @param options - Vue plugin options
 */
export function provideCachebay(
  app: App,
  cache: CachebayInstance,
  options: CachebayPluginOptions = {}
): void {
  app.provide(CACHEBAY_KEY, cache);

  // Store options for hooks to access
  (cache as any).__vueOptions = {
    suspensionTimeout: options.suspensionTimeout ?? 1000,
  };
}
