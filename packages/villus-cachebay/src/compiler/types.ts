/* eslint-disable @typescript-eslint/no-explicit-any */
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

  // Arguments
  buildArgs: (vars: Record<string, any>) => Record<string, any>;
  stringifyArgs: (vars: Record<string, any>) => string;

  // Connections (when @connection is present)
  isConnection: boolean;
  connectionKey?: string;                       // explicit key || fieldName
  connectionFilters?: string[];                 // names used to compute canonical key
  connectionMode?: "infinite" | "page";         // default "infinite"
};

export type CachePlanV1 = {
  kind: "CachePlanV1";
  operation: OpKind;                            // "query" | "mutation" | "subscription" | "fragment"
  rootTypename: string;
  root: PlanField[];
  rootSelectionMap?: Map<string, PlanField>;

  /** Network-safe document: __typename added; @connection stripped. */
  networkQuery: DocumentNode;
};
