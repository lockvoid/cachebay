import { setContext, getContext } from "svelte";
import type { CachebayInstance } from "../../core";

const CACHEBAY_KEY = Symbol("CACHEBAY_KEY");

/**
 * Provide a Cachebay instance to all child components via Svelte context.
 * Call this in a root +layout.svelte or top-level component.
 * @param instance - Cachebay cache instance created with createCachebay()
 */
export function setCachebay(instance: CachebayInstance): void {
  setContext(CACHEBAY_KEY, instance);
}

/**
 * Retrieve the Cachebay instance from Svelte context.
 * Must be called inside a component that is a descendant of one that called setCachebay().
 * @returns Cachebay cache instance
 * @throws Error if called before setCachebay()
 */
export function getCachebay(): CachebayInstance {
  const instance = getContext<CachebayInstance | undefined>(CACHEBAY_KEY);
  if (!instance) {
    throw new Error("[cachebay] getCachebay() called before setCachebay(). Call setCachebay(instance) in a parent component first.");
  }
  return instance;
}
