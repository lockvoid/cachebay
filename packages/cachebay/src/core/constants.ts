/**
 * Core constants used throughout the cache system
 */

export const ROOT_ID = "@";

export const ID_FIELD = "id";

export const TYPENAME_FIELD = "__typename";

export const CACHE_AND_NETWORK = "cache-and-network" as const;

export const NETWORK_ONLY = "network-only" as const;

export const CACHE_FIRST = "cache-first" as const;

export const CACHE_ONLY = "cache-only" as const;

export const CONNECTION_FIELDS = new Set(["first", "last", "after", "before"]);

export const CONNECTION_EDGES = "edges" as const;

export const CONNECTION_PAGE_INFO = "pageInfo" as const;

export const CONNECTION_FIRST = "first" as const;

export const CONNECTION_LAST = "last" as const;

export const CONNECTION_AFTER = "after" as const;

export const CONNECTION_BEFORE = "before" as const;
