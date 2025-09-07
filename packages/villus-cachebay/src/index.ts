// Cachebay for Villus — compact, human-friendly cache with Relay support.
// Perf: AST/doc caching, Relay view syncing, weak caches, microtask batching.

// Public entry for consumers.
export { createCache } from "./core/internals";
export type { CachebayInstance } from "./core/internals";

// Vue composables
export { useCache } from "./composables/useCache";
export { useFragments } from "./composables/useFragments";
export { useFragment } from "./composables/useFragment";

// Public types + helpers for user-land
export * from "./types";

// Optional resolver helpers users can opt into
export { relay } from "./resolvers/relay";
