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

export const CONNECTION_EDGES_FIELD = "edges" as const;

export const CONNECTION_PAGE_INFO_FIELD = "pageInfo" as const;

export const CONNECTION_FIRST_FIELD = "first" as const;

export const CONNECTION_LAST_FIELD = "last" as const;

export const CONNECTION_AFTER_FIELD = "after" as const;

export const CONNECTION_BEFORE_FIELD = "before" as const;

export const CONNECTION_DIRECTIVE = "connection";

export const CONNECTION_MODE_INFINITE = "infinite";

export const CONNECTION_MODE_PAGE = "page";

export const CONNECTION_TYPENAME = "Connection" as const;

export const CONNECTION_PAGE_INFO_TYPENAME = "PageInfo" as const;
