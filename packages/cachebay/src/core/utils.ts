import { __DEV__ } from "./instrumentation";

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
  if (typeA !== "object") return false;

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

const FINGERPRINT_KEY = "__version";

/**
 * Recycles subtrees from prevData by replacing equal subtrees in nextData.
 * Uses fingerprints for O(1) equality checks.
 *
 * @param prevData - Previous materialized snapshot
 * @param nextData - New materialized snapshot to recycle into
 * @param prevFingerprints - Fingerprints tree for prevData
 * @param nextFingerprints - Fingerprints tree for nextData
 * @returns Recycled snapshot (reuses prevData subtrees where possible)
 */
export function recycleSnapshots<T>(
  prevData: T,
  nextData: T,
  prevFingerprints: any,
  nextFingerprints: any
): T {
  // Fast path: reference equality
  if (prevData === nextData) {
    return nextData;
  }

  // Only recycle objects and arrays
  if (
    typeof prevData !== "object" ||
    !prevData ||
    typeof nextData !== "object" ||
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

  // Compare fingerprints from separate fingerprint trees
  const prevVersion = prevFingerprints?.[FINGERPRINT_KEY];
  const nextVersion = nextFingerprints?.[FINGERPRINT_KEY];

  if (prevVersion !== undefined && nextVersion !== undefined && prevVersion === nextVersion) {
    // Fingerprints match - data is identical, reuse prevData
    return prevData;
  }

  // Fingerprints differ or are missing - recycle children but return nextData
  // (unless all children are identical AND fingerprints are both undefined)
  const fingerprintsDiffer = prevVersion !== undefined && nextVersion !== undefined && prevVersion !== nextVersion;
  
  if (prevIsArray && nextIsArray) {
    const prevArray = prevData as any[];
    const nextArray = nextData as any[];

    // Try to recycle each element by comparing all elements
    // This handles both append and prepend cases
    let allEqual = prevArray.length === nextArray.length;

    for (let i = 0; i < nextArray.length; i++) {
      const nextItem = nextArray[i];
      const nextItemFp = nextFingerprints?.[i];
      const nextFp = nextItemFp?.[FINGERPRINT_KEY];

      // Try to find matching item in prevArray by fingerprint
      let recycled = nextItem;
      if (nextFp !== undefined) {
        for (let j = 0; j < prevArray.length; j++) {
          const prevItem = prevArray[j];
          const prevItemFp = prevFingerprints?.[j];
          const prevFp = prevItemFp?.[FINGERPRINT_KEY];
          if (prevFp === nextFp) {
            recycled = prevItem;
            break;
          }
        }
      }

      if (recycled !== nextItem) {
        nextArray[i] = recycled;
      }
      if (i >= prevArray.length || recycled !== prevArray[i]) {
        allEqual = false;
      }
    }

    // If fingerprints differ, always return nextData even if children are equal
    return (fingerprintsDiffer || !allEqual) ? nextData : prevData;
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
      if (key === FINGERPRINT_KEY) continue; // Skip __version key
      
      const recycled = recycleSnapshots(
        prevObject[key],
        nextObject[key],
        prevFingerprints?.[key],
        nextFingerprints?.[key]
      );
      if (recycled !== nextObject[key]) {
        nextObject[key] = recycled;
      }
      if (recycled !== prevObject[key]) {
        allEqual = false;
      }
    }

    // If fingerprints differ, always return nextData even if children are equal
    return (fingerprintsDiffer || !allEqual) ? nextData : prevData;
  }
}

/**
 * Valid cache policies
 */
const VALID_CACHE_POLICIES: readonly CachePolicy[] = [
  "cache-and-network",
  "network-only",
  "cache-first",
  "cache-only",
] as const;

/**
 * Validate and normalize cache policy
 * In dev: throws on invalid policy
 * In prod: warns and returns default policy
 */
export const validateCachePolicy = (policy: any, defaultPolicy: CachePolicy = "cache-first"): CachePolicy => {
  if (!policy) {
    return defaultPolicy;
  }

  if (VALID_CACHE_POLICIES.includes(policy as CachePolicy)) {
    return policy as CachePolicy;
  }

  const errorMessage = `Invalid cache policy: "${policy}". Valid policies are: ${VALID_CACHE_POLICIES.join(", ")}`;

  if (__DEV__) {
    throw new Error(errorMessage);
  } else {
    console.warn(`[cachebay] ${errorMessage}. Falling back to "${defaultPolicy}".`);
    return defaultPolicy;
  }
};
