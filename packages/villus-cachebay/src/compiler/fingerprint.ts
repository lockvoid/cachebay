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
    const childFingerprints = field.selectionSet.map(child => child.selId || "");
    parts.push(`{${childFingerprints.join(",")}}`);
  }

  return parts.join(":");
};

/**
 * Build a stable fingerprint for the entire plan root.
 * This is the basis for plan.id.
 */
export const fingerprintPlan = (root: PlanField[]): string => {
  const rootFingerprints = root.map(field => field.selId || "");
  return `[${rootFingerprints.join(",")}]`;
};

/**
 * Compute a stable numeric ID from a fingerprint string.
 */
export const hashFingerprint = (fingerprint: string): number => {
  return fnv1a32(fingerprint);
};
