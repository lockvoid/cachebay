/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Kind,
  parse,
  visit,
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type FieldNode,
} from "graphql";
import { lowerSelectionSet } from "./lowering/flatten";
import type { CachePlanV1, PlanField } from "./types";
import { isCachePlanV1 } from "./utils";

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

const indexByResponseKey = (
  fields: PlanField[] | null | undefined
): Map<string, PlanField> | undefined => {
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

/* ────────────────────────────────────────────────────────────────────────── */
/* Sanitizer: add __typename, strip @connection                              */
/* ────────────────────────────────────────────────────────────────────────── */

function ensureTypename(ss: SelectionSetNode): SelectionSetNode {
  const has = ss.selections.some(
    s => s.kind === Kind.FIELD && s.name.value === "__typename"
  );
  if (has) return ss;
  const typenameField: FieldNode = { kind: Kind.FIELD, name: { kind: Kind.NAME, value: "__typename" } };
  return { ...ss, selections: [...ss.selections, typenameField] };
}

/** Create a network-safe copy: adds __typename to all selection sets; strips @connection. */
function buildNetworkQuery(doc: DocumentNode): DocumentNode {
  return visit(doc, {
    OperationDefinition: {
      enter(node) {
        if (node.selectionSet) {
          return { ...node, selectionSet: ensureTypename(node.selectionSet) };
        }
        return node;
      },
    },
    FragmentDefinition: {
      enter(node) {
        return { ...node, selectionSet: ensureTypename(node.selectionSet) };
      },
    },
    Field: {
      enter(node) {
        const directives = (node.directives || []).filter(d => d.name.value !== "connection");
        let selectionSet = node.selectionSet;
        if (selectionSet) selectionSet = ensureTypename(selectionSet);
        if (directives.length !== (node.directives?.length || 0) || selectionSet !== node.selectionSet) {
          return { ...node, directives, selectionSet };
        }
        return node;
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public: compilePlan(document)                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Compile to a flat cache plan plus a network-safe DocumentNode.
 * - If called with a precompiled plan → returned as-is (pass-through).
 * - If called with a string → parsed to DocumentNode first.
 * - If the document contains an OperationDefinition → compiled as an operation.
 * - Else if it has one or more FragmentDefinitions:
 *    - with a single fragment → compiled as that fragment
 *    - with multiple fragments → requires opts.fragmentName to select
 */
export const compilePlan = (
  documentOrStringOrPlan: string | DocumentNode | CachePlanV1,
  opts?: { fragmentName?: string }
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

  // Operation path
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION
  );

  if (operation) {
    const rootTypename = opRootTypename(operation);

    // Lower the ORIGINAL doc (it still has @connection) so we retain metadata
    const root = lowerSelectionSet(operation.selectionSet, rootTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);

    // Build network-safe doc (strip @connection, add __typename)
    const networkQuery = buildNetworkQuery(document);

    return {
      __kind: "CachePlanV1",
      operation: operation.operation,   // "query" | "mutation" | "subscription"
      rootTypename,
      root,
      rootSelectionMap,
      networkQuery,
    };
  }

  // Fragment path (single or multiple)
  const fragmentDefs = document.definitions.filter(
    (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
  );

  if (fragmentDefs.length >= 1) {
    let frag: FragmentDefinitionNode | undefined;

    if (fragmentDefs.length === 1) {
      frag = fragmentDefs[0];
    } else {
      if (!opts?.fragmentName) {
        const names = fragmentDefs.map(f => f.name.value).join(", ");
        throw new Error(
          `compilePlan: document contains multiple fragments [${names}]; ` +
          `pass { fragmentName: "<one-of>" }`
        );
      }
      frag = fragmentDefs.find(f => f.name.value === opts.fragmentName);
      if (!frag) {
        const names = fragmentDefs.map(f => f.name.value).join(", ");
        throw new Error(
          `compilePlan: fragment "${opts.fragmentName}" not found. ` +
          `Available: [${names}]`
        );
      }
    }

    const parentTypename = frag.typeCondition.name.value;

    const root = lowerSelectionSet(frag.selectionSet, parentTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);

    const networkQuery = buildNetworkQuery(document);

    return {
      __kind: "CachePlanV1",
      operation: "fragment",
      rootTypename: parentTypename,
      root,
      rootSelectionMap,
      networkQuery,
    };
  }

  throw new Error("compilePlan: document has no OperationDefinition.");
};
