// src/compiler/types.ts
export type PlanField = {
  responseKey: string;
  fieldName: string;
  isConnection: boolean;
  buildArgs: (vars: any) => any;
  /**
   * stringifyArgs MUST receive the raw variables object.
   * It applies buildArgs internally and returns a stable JSON string.
   */
  stringifyArgs: (vars: any) => string;
  selectionSet: PlanField[] | null;
  /**
   * selectionMap is built at compile time; it maps responseKey -> PlanField
   * for O(1) lookups at runtime.
   */
  selectionMap?: Map<string, PlanField>;
};

/**
 * Unified plan returned by compileToPlan for operations AND fragments.
 * `operation` may be: "query" | "mutation" | "subscription" | "fragment".
 */
export type CachePlanV1 = {
  __kind: "CachePlanV1";
  operation: "query" | "mutation" | "subscription" | "fragment";
  /**
   * For operations: "Query" | "Mutation" | "Subscription".
   * For fragments: the fragment's type condition (parent typename).
   */
  rootTypename: string;
  /**
   * Root lowered fields (flat, merged across spreads).
   */
  root: PlanField[];
  /**
   * Map from responseKey -> PlanField at root (compile-time).
   */
  rootSelectionMap?: Map<string, PlanField>;
};

export const isCachePlanV1 = (x: any): x is CachePlanV1 =>
  !!x && x.__kind === "CachePlanV1";
