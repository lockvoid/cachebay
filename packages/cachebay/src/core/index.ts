// Main client
export { createCachebay } from "./client";
export type { CachebayInstance } from "./client";

// Types
export type {
  CachebayOptions,
  KeysConfig,
  InterfacesConfig,
  KeyFunction,
  PageInfo,
  Edge,
  Connection,
  EdgeRef,
  ConnectionRecord,
  ConnectionRef,
  CachePolicy,
} from "./types";

// Operations
export type {
  Operation,
  OperationResult,
  QueryVariables,
  Transport,
  HttpTransport,
  WsTransport,
  HttpContext,
  WsContext,
  ObservableLike,
  ObserverLike,
} from "./operations";

// Constants
export {
  CACHE_AND_NETWORK,
  NETWORK_ONLY,
  CACHE_FIRST,
  CACHE_ONLY,
  ROOT_ID,
  ID_FIELD,
  TYPENAME_FIELD,
  CONNECTION_FIELDS,
  CONNECTION_EDGES_FIELD,
  CONNECTION_PAGE_INFO_FIELD,
  CONNECTION_NODE_FIELD,
  CONNECTION_FIRST_FIELD,
  CONNECTION_LAST_FIELD,
  CONNECTION_AFTER_FIELD,
  CONNECTION_BEFORE_FIELD,
  CONNECTION_DIRECTIVE,
  CONNECTION_MODE_INFINITE,
  CONNECTION_MODE_PAGE,
  CONNECTION_TYPENAME,
  CONNECTION_PAGE_INFO_TYPENAME,
} from "./constants";

// Fragments
export type {
  ReadFragmentArgs,
  WriteFragmentArgs,
  WatchFragmentOptions,
  WatchFragmentHandle,
} from "./fragments";

// Queries
export type {
  ReadQueryOptions,
  WriteQueryOptions,
  WatchQueryOptions,
  WatchQueryHandle,
} from "./queries";

// Errors
export { CacheMissError, StaleResponseError, CombinedError } from "./errors";

// Graph utilities
export type { GraphInstance, GraphOptions } from "./graph";

// Inspect utilities
export type { InspectAPI } from "./inspect";

// Storage types
export type { StorageAdapterFactory, StorageAdapter, StorageContext, StorageInspection } from "../storage/idb";
