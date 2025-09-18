import {
  Kind,
  parse, // ← add parse so strings are supported
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
} from "graphql";
import { lowerSelectionSet } from "./lowering/flatten";
import type { CachePlanV1, PlanField } from "./types";

/** Tiny type guard so other modules can pass plans directly */
export const isCachePlanV1 = (v: any): v is CachePlanV1 =>
  v != null &&
  typeof v === "object" &&
  v.__kind === "CachePlanV1" &&
  Array.isArray((v as any).root);

/** Build a Map of fragment name -> fragment definition for lowering. */
const indexFragments = (doc: DocumentNode): Map<string, FragmentDefinitionNode> => {
  const m = new Map<string, FragmentDefinitionNode>();
  for (let i = 0; i < doc.definitions.length; i++) {
    const d = doc.definitions[i];
    if (d.kind === Kind.FRAGMENT_DEFINITION) {
      m.set(d.name.value, d as FragmentDefinitionNode);
    }
  }
  return m;
};

const indexByResponseKey = (fields: PlanField[] | null): Map<string, PlanField> | undefined => {
  if (!fields || fields.length === 0) return undefined;
  const m = new Map<string, PlanField>();
  for (let i = 0; i < fields.length; i++) m.set(fields[i].responseKey, fields[i]);
  return m;
};

const opRootTypename = (op: OperationDefinitionNode): string => {
  switch (op.operation) {
    case "query": return "Query";
    case "mutation": return "Mutation";
    case "subscription": return "Subscription";
    default: return "Query";
  }
};

/**
 * compileToPlan:
 *  - Accepts: string | DocumentNode | CachePlanV1
 *  - String → parse() to DocumentNode
 *  - Plan   → returned as-is (zero work)
 *  - Doc    → compiled like before
 *
 *  - If the DocumentNode has an OperationDefinition, compile it
 *  - Otherwise, if it has a single FragmentDefinition, compile as "fragment"
 *  - Throws when neither is present
 */
export const compileToPlan = (
  documentOrStringOrPlan: string | DocumentNode | CachePlanV1,
): CachePlanV1 => {
  // Precompiled plan? done.
  if (isCachePlanV1(documentOrStringOrPlan)) {
    return documentOrStringOrPlan;
  }

  // String? parse first.
  const document: DocumentNode =
    typeof documentOrStringOrPlan === "string"
      ? parse(documentOrStringOrPlan)
      : documentOrStringOrPlan;

  const fragmentsByName = indexFragments(document);

  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION
  );

  if (operation) {
    const rootTypename = opRootTypename(operation);
    const root = lowerSelectionSet(operation.selectionSet, rootTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);
    return {
      __kind: "CachePlanV1",
      operation: operation.operation, // "query" | "mutation" | "subscription"
      rootTypename,
      root,
      rootSelectionMap,
    };
  }

  const fragmentDefs = document.definitions.filter(
    (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
  );

  if (fragmentDefs.length === 1) {
    const frag = fragmentDefs[0];
    const parentTypename = frag.typeCondition.name.value;
    const root = lowerSelectionSet(frag.selectionSet, parentTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);

    return {
      __kind: "CachePlanV1",
      operation: "fragment",
      rootTypename: parentTypename,
      root,
      rootSelectionMap,
    };
  }

  throw new Error("compileToPlan: document has no OperationDefinition.");
};
