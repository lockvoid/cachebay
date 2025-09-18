// src/compiler/compile.ts
import type {
  DocumentNode,
  OperationDefinitionNode,
  FragmentDefinitionNode,
} from "graphql";
import type { CachePlanV1, PlanField } from "./types";
import { lowerSelectionSet, type ConnectionsConfig } from "./lowering/flatten";

/**
 * Map GraphQL operation kind → logical root typename
 */
const rootTypenameOf = (
  operation: "query" | "mutation" | "subscription"
): string => {
  switch (operation) {
    case "query":
      return "Query";
    case "mutation":
      return "Mutation";
    case "subscription":
      return "Subscription";
  }
};

export function compileToPlan(
  document: DocumentNode,
  options: { connections: ConnectionsConfig }
): CachePlanV1 {
  // Pick the first operation definition
  let operation: OperationDefinitionNode | null = null;
  const fragmentsByName = new Map<string, FragmentDefinitionNode>();

  for (let i = 0; i < document.definitions.length; i++) {
    const definition = document.definitions[i];
    if (definition.kind === "OperationDefinition") {
      if (!operation) {
        operation = definition as OperationDefinitionNode;
      }
    } else if (definition.kind === "FragmentDefinition") {
      const fragment = definition as FragmentDefinitionNode;
      fragmentsByName.set(fragment.name.value, fragment);
    }
  }

  if (!operation) {
    throw new Error("compileToPlan: document has no OperationDefinition.");
  }

  const kind = operation.operation; // "query" | "mutation" | "subscription"
  const rootTypename = rootTypenameOf(kind);
  const rootFields: PlanField[] = lowerSelectionSet(
    operation.selectionSet,
    rootTypename,
    fragmentsByName,
    options.connections || {}
  );

  const plan: CachePlanV1 = {
    __kind: "CachePlanV1",
    operation: kind,
    rootTypename,
    root: rootFields,
  };

  return plan;
}
