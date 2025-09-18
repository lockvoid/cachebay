// src/compiler/types.ts
export type PlanField = {
  responseKey: string;
  fieldName: string;

  // Tagged only via @connection
  isConnection: boolean;

  // @connection metadata (identity & default behavior hint)
  connectionMode?: string;    // "infinite" | "page" (default "infinite" if not provided)
  connectionArgs?: string[];  // identity args (if omitted, compiler defaults to non-pagination args)

  buildArgs: (vars: any) => any;

  /**
   * stringifyArgs MUST receive the raw variables object.
   * It applies buildArgs internally and returns a stable JSON string.
   */
  stringifyArgs: (vars: any) => string;

  // lowered child set
  selectionSet: PlanField[] | null;

  /**
   * selectionMap is built at compile time; it maps responseKey -> PlanField
   * for O(1) lookups at runtime.
   */
  selectionMap?: Map<string, PlanField>;
};

export type CachePlanV1 = {
  __kind: "CachePlanV1";
  operation: "query" | "mutation" | "subscription" | "fragment";
  /**
   * For operations: "Query" | "Mutation" | "Subscription".
   * For fragments: the fragment’s type condition (parent typename).
   */
  rootTypename: string;

  root: PlanField[];
  rootSelectionMap?: Map<string, PlanField>;
};

export const isCachePlanV1 = (x: any): x is CachePlanV1 =>
  !!x && x.__kind === "CachePlanV1";
