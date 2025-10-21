// Cachebay for Villus — compact, human-friendly cache with Relay support.
// Perf: AST/doc caching, Relay view syncing, weak caches, microtask batching.

// Public entry for consumers.
export { createCache } from "./core/client";
export type { CachebayInstance } from "./core/client";

// Vue composables
export { useCache } from "./composables/useCache";
export { useFragment } from "./composables/useFragment";
export type { UseFragmentOptions } from "./composables/useFragment";

// Fragment operations
export type { ReadFragmentArgs, WriteFragmentArgs } from "./core/fragments";

// Public types + helpers for user-land
export * from "./core/types";
