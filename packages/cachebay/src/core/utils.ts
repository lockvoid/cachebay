import { IDENTITY_FIELDS, CONNECTION_FIELDS, ROOT_ID } from "./constants";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler/types";


export const isObject = (value: any): value is Record<string, any> => {
  return value !== null && typeof value === "object";
};

/**
 * Deep equality comparison for JSON data structures (normalized cache data).
 * Optimized for common patterns: __ref objects, __refs arrays, primitives.
 * Not a true deep equal - designed specifically for cache comparison.
 */
export const isDataDeepEqual = (a: any, b: any): boolean => {
  // Fast path: reference equality (includes null === null, undefined === undefined)
  if (a === b) return true;

  // null and undefined are different values
  if (a == null || b == null) return false;

  // Fast path: different types (string vs number, etc)
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;

  // Fast path: primitives (already handled by a === b above, but helps V8 optimize)
  if (typeA !== 'object') return false;

  // Special case: __ref objects (very common in normalized cache)
  if (a.__ref !== undefined && b.__ref !== undefined) {
    return a.__ref === b.__ref;
  }

  // Special case: __refs arrays (single-level array of refs, no recursion needed)
  if (Array.isArray(a.__refs) && Array.isArray(b.__refs)) {
    if (a.__refs.length !== b.__refs.length) return false;
    for (let i = 0; i < a.__refs.length; i++) {
      if (a.__refs[i] !== b.__refs[i]) return false;
    }
    return true;
  }

  // Fast path: array vs non-array
  const isArrayA = Array.isArray(a);
  const isArrayB = Array.isArray(b);
  if (isArrayA !== isArrayB) return false;

  // Arrays
  if (isArrayA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDataDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Objects - check key count first (fast rejection)
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  // Compare object properties
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!isDataDeepEqual(a[key], b[key])) return false;
  }

  return true;
};

export const hasTypename = (value: any): boolean => {
  return !!(value && typeof value === "object" && typeof value.__typename === "string");
};

export const stableStringify = (object: any): string => {
  const walk = (object: any): any => {
    if (!isObject(object)) {
      return object;
    }

    if (Array.isArray(object)) {
      return object.map(walk);
    }

    const result: Record<string, any> = {};

    for (let i = 0, keys = Object.keys(object).sort(); i < keys.length; i++) {
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
 * Simple LRU cache using Map's insertion order
 * Most recently used items are moved to the end
 */
export class LRU<K, V> {
  private m = new Map<K, V>();

  constructor(
    private cap: number,
    private onEvict?: (k: K, v: V) => void
  ) { }

  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      // Move to end (most recent)
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }

  set(k: K, v: V): void {
    // Remove if exists to update position
    if (this.m.has(k)) {
      this.m.delete(k);
    }
    this.m.set(k, v);

    // Evict oldest if over capacity
    if (this.m.size > this.cap) {
      const oldest = this.m.keys().next().value as K;
      const ov = this.m.get(oldest)!;
      this.m.delete(oldest);
      this.onEvict?.(oldest, ov);
    }
  }

  clear(): void {
    if (this.onEvict) {
      for (const [k, v] of this.m) {
        this.onEvict(k, v);
      }
    }
    this.m.clear();
  }

  get size(): number {
    return this.m.size;
  }
}

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

export const buildConnectionKey = (
  field: PlanField,
  parentId: string,
  variables: Record<string, any>,
): string => {
  // parentId can be "@", "Type:id", "Type:id.container", or already absolute like "@.X.Y"
  const base = parentId[0] === ROOT_ID ? parentId : `@.${parentId}`;
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

  const filters =
    Array.isArray(field.connectionFilters) && field.connectionFilters.length > 0
      ? field.connectionFilters
      : Object.keys(allArgs).filter((k) => !CONNECTION_FIELDS.has(k));

  const identity: Record<string, any> = {};
  for (let i = 0; i < filters.length; i++) {
    const name = filters[i];
    if (name in allArgs) identity[name] = allArgs[name];
  }

  const keyPart = field.connectionKey || field.fieldName; // prefer directive key; fallback to field
  const parentPart = parentId === ROOT_ID ? "@connection." : `@connection.${parentId}.`;
  return `${parentPart}${keyPart}(${stableStringify(identity)})`;
};

/**
 * FNV-1a hash utilities for fingerprinting
 * 32-bit FNV-1a style mixer; fast & stable enough for fingerprints
 * https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
const FNV_SEED = 0x811c9dc5 | 0;
const FNV_PRIME = 16777619;

/**
 * Combine base node fingerprint with child fingerprints using FNV-1a.
 * Order-dependent: child order matters for the final hash.
 * Inlined mixing for maximum performance.
 * 
 * For arrays without a base node, pass 0 as baseNode.
 */
export const fingerprintNodes = (baseNode: number, childNodes: number[]): number => {
  let h = Math.imul(FNV_SEED ^ baseNode, FNV_PRIME) | 0;
  for (let i = 0; i < childNodes.length; i++) {
    h = Math.imul(h ^ childNodes[i], FNV_PRIME) | 0;
  }
  return h >>> 0;
};

const FINGERPRINT_KEY = '__version';

/**
 * Recycles subtrees from prevData by replacing equal subtrees in nextData.
 * Uses __version fingerprints for O(1) equality checks.
 * 
 * IMPORTANT: Only works with materialized results that have __version fingerprints.
 * 
 * @param prevData - Previous materialized snapshot
 * @param nextData - New materialized snapshot to recycle into
 * @returns Recycled snapshot (reuses prevData subtrees where possible)
 */
export function recycleSnapshots<T>(prevData: T, nextData: T): T {
  // Fast path: reference equality
  if (prevData === nextData) {
    return nextData;
  }

  // Only recycle objects and arrays
  if (
    typeof prevData !== 'object' ||
    !prevData ||
    typeof nextData !== 'object' ||
    !nextData
  ) {
    return nextData;
  }

  // Only recycle plain objects and arrays
  const prevIsArray = Array.isArray(prevData);
  const nextIsArray = Array.isArray(nextData);
  
  if (prevIsArray !== nextIsArray) {
    return nextData;
  }

  if (!prevIsArray && prevData.constructor !== Object) {
    return nextData;
  }

  if (!nextIsArray && nextData.constructor !== Object) {
    return nextData;
  }

  // Compare fingerprints - materialized results always have __version
  const prevVersion = (prevData as any)[FINGERPRINT_KEY];
  const nextVersion = (nextData as any)[FINGERPRINT_KEY];
  
  if (prevVersion === nextVersion) {
    // Fingerprints match - data is identical, reuse prevData
    return prevData;
  }

  // Fingerprints differ - recycle children
  if (prevIsArray && nextIsArray) {
    const prevArray = prevData as any[];
    const nextArray = nextData as any[];
    
    if (prevArray.length !== nextArray.length) {
      return nextData;
    }

    let allEqual = true;
    for (let i = 0; i < nextArray.length; i++) {
      const recycled = recycleSnapshots(prevArray[i], nextArray[i]);
      if (recycled !== nextArray[i]) {
        nextArray[i] = recycled;
      }
      if (recycled !== prevArray[i]) {
        allEqual = false;
      }
    }
    
    return allEqual ? prevData : nextData;
  } else {
    // Both are plain objects
    const prevObject = prevData as Record<string, any>;
    const nextObject = nextData as Record<string, any>;
    const prevKeys = Object.keys(prevObject);
    const nextKeys = Object.keys(nextObject);
    
    if (prevKeys.length !== nextKeys.length) {
      return nextData;
    }

    let allEqual = true;
    for (const key of nextKeys) {
      const recycled = recycleSnapshots(prevObject[key], nextObject[key]);
      if (recycled !== nextObject[key]) {
        nextObject[key] = recycled;
      }
      if (recycled !== prevObject[key]) {
        allEqual = false;
      }
    }
    
    return allEqual ? prevData : nextData;
  }
}
