/**
 * GraphQL Relay PageInfo type
 * Contains pagination metadata for cursor-based pagination
 */
export interface PageInfo {
  __typename?: string;
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * GraphQL Relay Edge type
 * Wraps a node with cursor and optional metadata
 * @template TNode - Type of the node contained in the edge
 */
export interface Edge<TNode = unknown> {
  __typename?: string;
  cursor: string;
  node: TNode;
  [key: string]: unknown;
}

/**
 * GraphQL Relay Connection type
 * Container for paginated list with edges and pageInfo
 * @template TNode - Type of nodes in the connection
 */
export interface Connection<TNode = unknown> {
  __typename: string;
  edges: Array<Edge<TNode>>;
  pageInfo: PageInfo;
  [key: string]: unknown;
}

/**
 * Normalized edge reference in the graph store
 * Points to edge record with node reference
 */
export interface EdgeRef {
  __typename?: string;
  cursor?: string;
  node: { __ref: string };
  [key: string]: unknown;
}

/**
 * Array of edge references in normalized form
 */
export interface EdgesRef {
  __refs: string[];
}

/**
 * PageInfo reference pointing to a PageInfo record
 */
export interface PageInfoRef {
  __ref: string;
}

/**
 * Normalized connection record with inline pageInfo
 * Used when pageInfo is stored directly in the connection
 */
export interface ConnectionRecord {
  __typename: string;
  edges: EdgesRef;
  pageInfo: PageInfo;
  [key: string]: unknown;
}

/**
 * Normalized connection reference with pageInfo reference
 * Used when pageInfo is stored separately and referenced
 */
export interface ConnectionRef {
  __typename: string;
  edges: EdgesRef;
  pageInfo: PageInfoRef;
  [key: string]: unknown;
}

/**
 * Interface configuration mapping interface types to their implementations
 * @example { "Node": ["User", "Post", "Comment"] }
 */
export type InterfacesConfig = Record<string, string[]>;

/**
 * Custom key function for entity identification
 * @param obj - The GraphQL object to generate a key for
 * @param parent - Optional parent object for context
 * @returns Unique identifier string or null if object cannot be identified
 */
export type KeyFunction = (obj: Record<string, unknown>, parent?: Record<string, unknown>) => string | null;

/**
 * Configuration for custom entity key generation
 * Maps typename to key generation function
 */
export type KeysConfig = Record<string, KeyFunction>;

/**
 * Configuration options for Cachebay instance
 */
export type CachebayOptions = {
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
