
import type { DocumentNode } from "graphql";

export type OpKind = "query" | "mutation" | "subscription" | "fragment";

/**
 * One lowered field in a selection set.
 * - `selectionSet` is the linearized child plan (if any)
 * - `selectionMap` is an index by responseKey for fast lookups
 * - `buildArgs(vars)` resolves argument AST to plain values
 * - `stringifyArgs(vars)` returns a stable JSON string for key building
 * - connection metadata is present when the @connection directive exists
 */
export type PlanField = {
  responseKey: string;                          // alias || name
  fieldName: string;                            // actual field name
  selectionSet: PlanField[] | null;             // children (lowered)
  selectionMap?: Map<string, PlanField>;        // fast lookup by responseKey
  typeCondition?: string;                       // type guard for inline fragments

  // Arguments
  buildArgs: (vars: Record<string, any>) => Record<string, any>;
  stringifyArgs: (vars: Record<string, any>) => string;
  expectedArgNames: string[];                   // precomputed arg order for stable keys

  // Connections (when @connection is present)
  isConnection: boolean;
  connectionKey?: string;                       // explicit key || fieldName
  connectionFilters?: string[];                 // names used to compute canonical key
  connectionMode?: "infinite" | "page";         // default "infinite"

  /** Stable fingerprint for subtree; useful for memo/subtree caches. */
  selId?: string;

  /** Window args that this particular connection field uses (subset of plan.windowArgs). */
  pageArgs?: string[];
};

export type CachePlan = {
  kind: "CachePlan";
  operation: OpKind;                            // "query" | "mutation" | "subscription" | "fragment"
  rootTypename: string;
  root: PlanField[];
  rootSelectionMap?: Map<string, PlanField>;

  /** Network-safe query string: __typename added; @connection stripped. Ready to send to server. */
  networkQuery: string;

  /** Stable, selection-shape ID for watcher/caching signatures. */
  id: number;

  /** Variable masks precomputed for fast watcher keys. */
  varMask: {
    /** All variable names that affect the result (full fidelity). */
    strict: string[];
    /**
     * Variables that affect the "canonical" result. Typically strict minus
     * window/pagination args like first/last/after/before used on connection fields.
     */
    canonical: string[];
  };

  /** Precompiled fast path to derive the masked vars key (no allocations except result). */
  makeVarsKey: (mode: "strict" | "canonical", vars: Record<string, any>) => string;

  /**
   * Convenience helper to build a complete signature string for watcher/cache keys.
   * Returns: `${plan.id}|${mode}|${plan.makeVarsKey(mode, vars)}`
   */
  makeSignature: (mode: "strict" | "canonical", vars: Record<string, any>) => string;

  /** Union of arg names recognized as pagination/window args across all connection fields in this plan. */
  windowArgs: Set<string>;

  /** Optional: stable selection fingerprint for debugging/traceability. */
  selectionFingerprint?: string;
};
