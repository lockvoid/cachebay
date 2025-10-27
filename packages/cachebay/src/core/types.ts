/**
 * GraphQL Relay PageInfo type
 * Contains pagination metadata for cursor-based pagination
 *
 * @public
 * @example
 * ```typescript
 * const pageInfo: PageInfo = {
 *   __typename: "PageInfo",
 *   startCursor: "cursor1",
 *   endCursor: "cursor10",
 *   hasNextPage: true,
 *   hasPreviousPage: false
 * };
 * ```
 */
export interface PageInfo {
  readonly __typename?: string;
  readonly startCursor: string | null;
  readonly endCursor: string | null;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/**
 * GraphQL Relay Edge type
 * Wraps a node with cursor and optional metadata
 *
 * @public
 * @template TNode - Type of the node contained in the edge
 * @example
 * ```typescript
 * type UserEdge = Edge<{ id: string; name: string }>;
 *
 * const edge: UserEdge = {
 *   __typename: "UserEdge",
 *   cursor: "user:123",
 *   node: { id: "123", name: "Alice" }
 * };
 * ```
 */
export interface Edge<TNode = unknown> {
  readonly __typename?: string;
  readonly cursor: string;
  readonly node: TNode;
  readonly [key: string]: unknown;
}

/**
 * GraphQL Relay Connection type
 * Container for paginated list with edges and pageInfo
 *
 * @public
 * @template TNode - Type of nodes in the connection
 * @example
 * ```typescript
 * type UserConnection = Connection<{ id: string; name: string }>;
 *
 * const connection: UserConnection = {
 *   __typename: "UserConnection",
 *   edges: [
 *     { cursor: "user:1", node: { id: "1", name: "Alice" } },
 *     { cursor: "user:2", node: { id: "2", name: "Bob" } }
 *   ],
 *   pageInfo: {
 *     startCursor: "user:1",
 *     endCursor: "user:2",
 *     hasNextPage: false,
 *     hasPreviousPage: false
 *   }
 * };
 * ```
 */
export interface Connection<TNode = unknown> {
  readonly __typename: string;
  readonly edges: ReadonlyArray<Edge<TNode>>;
  readonly pageInfo: PageInfo;
  readonly [key: string]: unknown;
}

/**
 * Normalized edge reference in the graph store
 * Points to edge record with node reference
 */
export interface EdgeRef {
  readonly __typename?: string;
  readonly cursor?: string;
  readonly node: { readonly __ref: string };
  readonly [key: string]: unknown;
}

/**
 * Array of edge references in normalized form
 */
export interface EdgesRef {
  readonly __refs: ReadonlyArray<string>;
}

/**
 * PageInfo reference pointing to a PageInfo record
 */
export interface PageInfoRef {
  readonly __ref: string;
}

/**
 * Normalized connection record with inline pageInfo
 * Used when pageInfo is stored directly in the connection
 */
export interface ConnectionRecord {
  readonly __typename: string;
  readonly edges: EdgesRef;
  readonly pageInfo: PageInfo;
  readonly [key: string]: unknown;
}

/**
 * Normalized connection reference with pageInfo reference
 * Used when pageInfo is stored separately and referenced
 */
export interface ConnectionRef {
  readonly __typename: string;
  readonly edges: EdgesRef;
  readonly pageInfo: PageInfoRef;
  readonly [key: string]: unknown;
}

/**
 * Interface configuration mapping interface types to their implementations
 * Used to help the cache understand GraphQL interface inheritance
 *
 * @public
 * @example
 * ```typescript
 * const interfaces: InterfacesConfig = {
 *   "Node": ["User", "Post", "Comment"],
 *   "Timestamped": ["Post", "Comment"]
 * };
 *
 * const cachebay = createCachebay({
 *   transport,
 *   interfaces
 * });
 * ```
 */
export type InterfacesConfig = Record<string, string[]>;

/**
 * Custom key function for entity identification
 * Allows custom cache key generation for entities without standard id field
 *
 * @public
 * @param obj - The GraphQL object to generate a key for
 * @param parent - Optional parent object for context
 * @returns Unique identifier string or null if object cannot be identified
 * @example
 * ```typescript
 * const keyFn: KeyFunction = (obj) => {
 *   if (obj.__typename === "User") {
 *     return obj.email as string; // Use email instead of id
 *   }
 *   return null;
 * };
 * ```
 */
export type KeyFunction = (obj: Record<string, unknown>, parent?: Record<string, unknown>) => string | null;

/**
 * Configuration for custom entity key generation
 * Maps typename to key generation function
 *
 * @public
 * @example
 * ```typescript
 * const keys: KeysConfig = {
 *   User: (obj) => obj.email as string,
 *   Comment: (obj) => obj.uuid as string
 * };
 *
 * const cachebay = createCachebay({
 *   transport,
 *   keys
 * });
 * ```
 */
export type KeysConfig = Record<string, KeyFunction>;

/**
 * Configuration options for Cachebay instance
 *
 * @public
 * @example
 * ```typescript
 * const options: CachebayOptions = {
 *   transport: {
 *     http: async (ctx) => {
 *       const res = await fetch('/graphql', {
 *         method: 'POST',
 *         headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify({
 *           query: ctx.query,
 *           variables: ctx.variables
 *         })
 *       });
 *       return res.json();
 *     }
 *   },
 *   keys: {
 *     User: (obj) => obj.email as string
 *   },
 *   interfaces: {
 *     Node: ["User", "Post"]
 *   },
 *   hydrationTimeout: 100,
 *   suspensionTimeout: 1000
 * };
 *
 * const cachebay = createCachebay(options);
 * ```
 */
export type CachebayOptions = {
  /** Cache policy for cachebay instance */
  cachePolicy: CachePolicy;
  /** Custom key functions for entity identification by typename */
  keys?: KeysConfig;
  /** Interface to implementation mappings for GraphQL interfaces */
  interfaces?: InterfacesConfig;
  /** Timeout in ms for SSR hydration window (default: 100) */
  hydrationTimeout?: number;
  /** Timeout in ms for Suspense result caching (default: 1000) */
  suspensionTimeout?: number;
  /** Transport layer for network operations (http and ws) - REQUIRED */
  transport: import("./operations").Transport;
};

/**
 * Cache policy determines how the cache interacts with the network
 *
 * @public
 * - `cache-first`: Return cached data if available, otherwise fetch from network
 * - `cache-only`: Only return cached data, never fetch from network (throws if not cached)
 * - `network-only`: Always fetch from network, ignore cache
 * - `cache-and-network`: Return cached data immediately, then fetch from network and update
 *
 * @example
 * ```typescript
 * const policy: CachePolicy = "cache-first";
 *
 * // Or use constants
 * import { CACHE_AND_NETWORK } from 'cachebay';
 * const policy = CACHE_AND_NETWORK;
 * ```
 */
export type CachePolicy = "cache-and-network" | "network-only" | "cache-first" | "cache-only";
