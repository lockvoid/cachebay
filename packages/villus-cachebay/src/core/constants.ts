/**
 * Core constants used throughout the cache system
 */

export const CACHEBAY_KEY = Symbol("CACHEBAY_KEY");

export const ROOT_ID = "@";

export const ID_FIELD = "id";

export const TYPENAME_FIELD = "__typename";

export const IDENTITY_FIELDS = new Set(["__typename", "id"]);

export const CONNECTION_FIELDS = new Set(["first", "last", "after", "before"]);
