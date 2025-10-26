import type { CachePlan, PlanField } from "./types";

export const isCachePlan = (v: any): v is CachePlan => {
  return v && typeof v === "object" && v.kind === "CachePlan";
};

// Connection pagination fields (Relay spec)
const CONNECTION_FIELDS = new Set(["first", "last", "after", "before"]);
const ROOT_ID = "@";

/**
 * Stable JSON stringify with sorted keys for consistent output.
 */
const stableStringify = (object: any): string => {
  const walk = (object: any): any => {
    if (object === null || typeof object !== "object") {
      return object;
    }

    if (Array.isArray(object)) {
      return object.map(walk);
    }

    const result: Record<string, any> = {};
    const keys = Object.keys(object).sort();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      result[key] = walk(object[key]);
    }

    return result;
  };

  try {
    return JSON.stringify(walk(object));
  } catch {
    return "";
  }
};

/**
 * Build a field link key used on a record snapshot, e.g.:
 *   user({"id":"u1"})
 *
 * NOTE: `field.stringifyArgs(vars)` expects RAW variables; it internally runs the compiled
 * `buildArgs` to map variable names → field-arg names and drops undefined.
 */
export const buildFieldKey = (field: PlanField, variables: Record<string, any>): string => {
  const args = field.stringifyArgs(variables);
  return args === "" || args === "{}" ? field.fieldName : `${field.fieldName}(${args})`;
};

/**
 * Build a connection key for a specific page, e.g.:
 *   @.posts({"category":"tech","first":10,"after":"c1"})
 *   @.User:u1.posts({"first":10,"after":"p2"})
 */
export const buildConnectionKey = (
  field: PlanField,
  parentId: string,
  variables: Record<string, any>,
): string => {
  // parentId can be "@", "Type:id", "Type:id.container", or already absolute like "@.X.Y"
  const base = parentId[0] === ROOT_ID ? parentId : `${ROOT_ID}.${parentId}`;
  return `${base}.${field.fieldName}(${field.stringifyArgs(variables)})`;
};

/**
 * Build the canonical connection key (filters-only identity) under the `@connection.` namespace, e.g.:
 *   @connection.posts({"category":"tech"})
 *   @connection.User:u1.posts({"category":"tech","sort":"hot"})
 *
 * - Uses `field.connectionKey` (directive key) when available; falls back to the field name.
 * - If `field.connectionFilters` is present, use only those arg names (when present in args).
 * - Otherwise, include all non-pagination args derived from `buildArgs(vars)`.
 */
export const buildConnectionCanonicalKey = (
  field: PlanField,
  parentId: string,
  variables: Record<string, any>,
): string => {
  const allArgs = field.buildArgs(variables) || {};
  const identity: Record<string, any> = {};

  // Compiler always sets connectionFilters as an array (explicit or inferred)
  // Note: Explicit filters from @connection directive could include pagination fields,
  // so we must filter them out here
  if (field.connectionFilters) {
    for (let i = 0; i < field.connectionFilters.length; i++) {
      const name = field.connectionFilters[i];
      if (CONNECTION_FIELDS.has(name)) continue; // Skip pagination fields
      if (name in allArgs) identity[name] = allArgs[name];
    }
  }

  const keyPart = field.connectionKey || field.fieldName; // prefer directive key; fallback to field
  const parentPart = parentId === ROOT_ID ? "@connection." : `@connection.${parentId}.`;
  return `${parentPart}${keyPart}(${stableStringify(identity)})`;
};
