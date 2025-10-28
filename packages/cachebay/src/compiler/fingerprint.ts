import type { PlanField } from "./types";

/**
 * Fast 32-bit FNV-1a hash for strings.
 * Produces stable numeric IDs from selection fingerprints.
 */
const fnv1a32 = (str: string): number => {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
};

/**
 * Build a stable fingerprint for a field subtree.
 * Includes: responseKey, fieldName, typeCondition, isConnection, arg names (not values),
 * and recursively child selections.
 */
export const fingerprintField = (field: PlanField, argNames: string[]): string => {
  const parts: string[] = [
    field.responseKey,
    field.fieldName,
  ];

  if (field.typeCondition) {
    parts.push(`@${field.typeCondition}`);
  }

  if (field.isConnection) {
    parts.push("@connection");
  }

  if (argNames.length > 0) {
    // Sort arg names for stability
    parts.push(`(${argNames.slice().sort().join(",")})`);
  }

  if (field.selectionSet && field.selectionSet.length > 0) {
    // Sort children by responseKey, then fieldName for order-insensitive fingerprints
    const sortedChildren = field.selectionSet.slice().sort((a, b) => {
      const cmp = a.responseKey.localeCompare(b.responseKey);
      return cmp !== 0 ? cmp : a.fieldName.localeCompare(b.fieldName);
    });
    const childFingerprints = sortedChildren.map(child => child.selId || "");
    parts.push(`{${childFingerprints.join(",")}}`);
  }

  return parts.join(":");
};

/**
 * Build a stable fingerprint for the entire plan root.
 * This is the basis for plan.id.
 * Includes operation and rootTypename to prevent collisions between different roots.
 */
export const fingerprintPlan = (
  root: PlanField[],
  operation: string,
  rootTypename: string,
): string => {
  // Sort root fields by responseKey, then fieldName for order-insensitive fingerprints
  const sortedRoot = root.slice().sort((a, b) => {
    const cmp = a.responseKey.localeCompare(b.responseKey);
    return cmp !== 0 ? cmp : a.fieldName.localeCompare(b.fieldName);
  });
  const rootFingerprints = sortedRoot.map(field => field.selId || "");
  return `${operation}:${rootTypename}:[${rootFingerprints.join(",")}]`;
};

/**
 * Compute a stable numeric ID from a fingerprint string.
 */
export const hashFingerprint = (fingerprint: string): number => {
  return fnv1a32(fingerprint);
};
