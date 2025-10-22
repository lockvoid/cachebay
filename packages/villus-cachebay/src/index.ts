// Cachebay — Framework-agnostic GraphQL cache with Relay support
// Perf: AST/doc caching, Relay view syncing, weak caches, microtask batching

// Core cache client (framework-agnostic)
export { createCache } from "./core/client";
export type { CachebayInstance } from "./core/client";

// Cache operations types
export type { ReadFragmentArgs, WriteFragmentArgs } from "./core/fragments";
export type { ReadQueryArgs, WriteQueryArgs } from "./core/queries";

// Operations types (for transport implementation)
export type { 
  Operation,
  OperationResult,
  CachePolicy,
  Transport,
  HttpTransport,
  WsTransport,
  HttpContext,
  WsContext,
  ObservableLike,
  ObserverLike,
} from "./core/operations";

// Public types
export type { CachebayOptions } from "./core/types";
