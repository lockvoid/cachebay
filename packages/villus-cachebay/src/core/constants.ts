/**
 * Core constants used throughout the cache system
 */

export const ID_FIELD = "id";

export const TYPENAME_FIELD = "__typename";

export const RESOLVE_SIGNATURE = Symbol("CACHEBAY_RESOLVE_SIGNATURE");

export const QUERY_ROOT = "Query";

export const DEFAULT_WRITE_POLICY = "replace";

export const OPERATION_CACHE_LIMIT = 200;

export const IDENTITY_FIELDS = new Set(["__typename", "id"]);
