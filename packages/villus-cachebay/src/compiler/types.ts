// src/compiler/types.ts
export type ArgBuilder = (variables: Record<string, any>) => Record<string, any>;

export type PlanField = {
  /**
   * What appears in the JSON payload (alias or name).
   * Example: for `aliasName: user(id:$id)` this is "aliasName".
   */
  responseKey: string;

  /**
   * Canonical field name (without alias).
   * Example: "user", "posts", "edges", "node", "pageInfo".
   */
  fieldName: string;

  /**
   * True if this field is configured as a connection on its parent typename
   * (from DocumentsOptions.connections[parentTypename][fieldName]).
   */
  isConnection: boolean;

  /**
   * Build a plain object of arguments for the field from variables.
   * Must omit undefined values, preserve nulls, and be stable in key order.
   */
  buildArgs: ArgBuilder;

  stringifyArgs: (value: any) => string;

  /**
   * Nested selections (flattened fragments); null for leaf fields.
   */
  selectionSet: PlanField[] | null;
};

export type CachePlanV1 = {
  __kind: "CachePlanV1";
  operation: "query" | "mutation" | "subscription";
  rootTypename: string; // "Query" | "Mutation" | "Subscription"
  root: PlanField[];    // top-level fields
};

/** Type guard so runtime can accept either a plan or a raw DocumentNode. */
export function isCachePlanV1(value: any): value is CachePlanV1 {
  return Boolean(value && value.__kind === "CachePlanV1");
}
