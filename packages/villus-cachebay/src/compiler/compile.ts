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
import { isCachePlan } from "./utils";
import type { CachePlan, PlanField } from "./types";
import { fingerprintPlan, hashFingerprint } from "./fingerprint";
import { collectVarsFromSelectionSet, makeMaskedVarsKeyFn } from "./variables";

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
  fields: PlanField[] | null | undefined,
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

/**
 * Compute plan metadata: id, varMask, makeVarsKey, windowArgs.
 * This walks the lowered plan to collect window args and combines with
 * variables collected from the original AST.
 */
const computePlanMetadata = (
  root: PlanField[],
  selectionSet: SelectionSetNode,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  operation: string,
  rootTypename: string,
): {
  id: number;
  varMask: { strict: string[]; canonical: string[] };
  makeVarsKey: (mode: "strict" | "canonical", vars: Record<string, any>) => string;
  makeSignature: (mode: "strict" | "canonical", vars: Record<string, any>) => string;
  windowArgs: Set<string>;
  selectionFingerprint: string;
} => {
  // 1. Compute stable fingerprint and hash it to get numeric ID
  const selectionFingerprint = fingerprintPlan(root, operation, rootTypename);
  const id = hashFingerprint(selectionFingerprint);

  // 2. Collect all variables from the AST
  const strictVars = collectVarsFromSelectionSet(selectionSet, fragmentsByName);

  // 3. Collect window args from connection fields
  const windowArgs = new Set<string>();
  const walkFields = (fields: PlanField[]): void => {
    for (const field of fields) {
      if (field.isConnection && field.pageArgs) {
        for (const arg of field.pageArgs) {
          windowArgs.add(arg);
        }
      }
      if (field.selectionSet) {
        walkFields(field.selectionSet);
      }
    }
  };
  walkFields(root);

  // 4. Compute canonical vars (strict minus window args)
  const canonicalVars = new Set<string>();
  for (const v of strictVars) {
    if (!windowArgs.has(v)) {
      canonicalVars.add(v);
    }
  }

  // 5. Build masks and precompiled key function
  const strictMask = Array.from(strictVars);
  const canonicalMask = Array.from(canonicalVars);
  const makeVarsKey = makeMaskedVarsKeyFn(strictMask, canonicalMask);

  // 6. Build convenience signature helper
  const makeSignature = (mode: "strict" | "canonical", vars: Record<string, any>): string => {
    return `${id}|${mode}|${makeVarsKey(mode, vars)}`;
  };

  return {
    id,
    varMask: { strict: strictMask, canonical: canonicalMask },
    makeVarsKey,
    makeSignature,
    windowArgs,
    selectionFingerprint,
  };
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Sanitizer: add __typename (except at op root), strip @connection           */
/* ────────────────────────────────────────────────────────────────────────── */

function ensureTypename(ss: SelectionSetNode): SelectionSetNode {
  const has = ss.selections.some(
    s => s.kind === Kind.FIELD && s.name.value === "__typename",
  );
  if (has) return ss;
  
  const typenameField: FieldNode = { kind: Kind.FIELD, name: { kind: Kind.NAME, value: "__typename" } };
  const newSelections = new Array(ss.selections.length + 1);
  for (let i = 0; i < ss.selections.length; i++) {
    newSelections[i] = ss.selections[i];
  }
  newSelections[ss.selections.length] = typenameField;
  
  return { kind: ss.kind, selections: newSelections };
}

/** Recursively add __typename to all selection sets (for fragments) */
function ensureTypenameRecursive(ss: SelectionSetNode): SelectionSetNode {
  // First add __typename to this level
  const withTypename = ensureTypename(ss);
  
  // Then recursively process all field selections
  let hasChanges = false;
  const selections = new Array(withTypename.selections.length);
  for (let i = 0; i < withTypename.selections.length; i++) {
    const sel = withTypename.selections[i];
    if (sel.kind === Kind.FIELD && sel.selectionSet) {
      const newSelectionSet = ensureTypenameRecursive(sel.selectionSet);
      if (newSelectionSet !== sel.selectionSet) {
        selections[i] = { kind: sel.kind, name: sel.name, alias: sel.alias, arguments: sel.arguments, directives: sel.directives, selectionSet: newSelectionSet };
        hasChanges = true;
      } else {
        selections[i] = sel;
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
      const newSelectionSet = ensureTypenameRecursive(sel.selectionSet);
      if (newSelectionSet !== sel.selectionSet) {
        selections[i] = { kind: sel.kind, typeCondition: sel.typeCondition, directives: sel.directives, selectionSet: newSelectionSet };
        hasChanges = true;
      } else {
        selections[i] = sel;
      }
    } else {
      selections[i] = sel;
    }
  }
  
  if (!hasChanges && selections === withTypename.selections) {
    return withTypename;
  }
  
  return { kind: withTypename.kind, selections };
}

/** Add __typename to nested selections but NOT at root level (for operations) */
function ensureTypenameNested(ss: SelectionSetNode): SelectionSetNode {
  // Don't add __typename at this level (root), only to nested selections
  let hasChanges = false;
  const selections = new Array(ss.selections.length);
  for (let i = 0; i < ss.selections.length; i++) {
    const sel = ss.selections[i];
    if (sel.kind === Kind.FIELD && sel.selectionSet) {
      const newSelectionSet = ensureTypenameRecursive(sel.selectionSet);
      if (newSelectionSet !== sel.selectionSet) {
        selections[i] = { kind: sel.kind, name: sel.name, alias: sel.alias, arguments: sel.arguments, directives: sel.directives, selectionSet: newSelectionSet };
        hasChanges = true;
      } else {
        selections[i] = sel;
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT && sel.selectionSet) {
      const newSelectionSet = ensureTypenameRecursive(sel.selectionSet);
      if (newSelectionSet !== sel.selectionSet) {
        selections[i] = { kind: sel.kind, typeCondition: sel.typeCondition, directives: sel.directives, selectionSet: newSelectionSet };
        hasChanges = true;
      } else {
        selections[i] = sel;
      }
    } else {
      selections[i] = sel;
    }
  }
  
  if (!hasChanges) {
    return ss;
  }
  
  return { kind: ss.kind, selections };
}

/** Create a network-safe copy: strip @connection directives. __typename is already added during compilation. */
function buildNetworkQuery(doc: DocumentNode): DocumentNode {
  return visit(doc, {
    Field: {
      enter(node) {
        if (!node.directives || node.directives.length === 0) {
          return node;
        }
        
        const directives = (node.directives || []).filter(d => d.name.value !== "connection");
        if (directives.length === node.directives.length) {
          return node; // No @connection found, return as-is
        }
        
        // Avoid spread operator - create new object directly
        return {
          kind: node.kind,
          name: node.name,
          alias: node.alias,
          arguments: node.arguments,
          directives: directives.length > 0 ? directives : undefined,
          selectionSet: node.selectionSet,
        };
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public: compilePlan(document)                                             */
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
  documentOrStringOrPlan: string | DocumentNode | CachePlan,
  opts?: { fragmentName?: string },
): CachePlan => {
  // Precompiled plan? done.
  if (isCachePlan(documentOrStringOrPlan)) {
    return documentOrStringOrPlan;
  }

  // String? parse first.
  const document: DocumentNode =
    typeof documentOrStringOrPlan === "string"
      ? parse(documentOrStringOrPlan)
      : (documentOrStringOrPlan as DocumentNode);

  const fragmentsByName = indexFragments(document);

  // Operation path
  const operation = document.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );

  if (operation) {
    const rootTypename = opRootTypename(operation);

    // Add __typename to nested selections (not root) once
    // This ensures both the plan and networkQuery have matching __typename fields
    const selectionWithTypename = ensureTypenameNested(operation.selectionSet);
    
    // Lower the selection set (it still has @connection) so we retain metadata
    const root = lowerSelectionSet(selectionWithTypename, rootTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);

    // Build network-safe doc with __typename added to operation and all fragments
    // Just need to strip @connection directives
    // Avoid spread operators for performance
    const operationWithTypename: OperationDefinitionNode = {
      kind: operation.kind,
      operation: operation.operation,
      name: operation.name,
      variableDefinitions: operation.variableDefinitions,
      directives: operation.directives,
      selectionSet: selectionWithTypename,
    };
    
    const newDefinitions = new Array(document.definitions.length);
    for (let i = 0; i < document.definitions.length; i++) {
      const d = document.definitions[i];
      if (d.kind === Kind.OPERATION_DEFINITION) {
        newDefinitions[i] = operationWithTypename;
      } else if (d.kind === Kind.FRAGMENT_DEFINITION) {
        // Add __typename to all fragments in the document
        const fragWithTypename = ensureTypenameRecursive(d.selectionSet);
        newDefinitions[i] = {
          kind: d.kind,
          name: d.name,
          typeCondition: d.typeCondition,
          directives: d.directives,
          selectionSet: fragWithTypename,
        };
      } else {
        newDefinitions[i] = d;
      }
    }
    
    const docWithTypename: DocumentNode = {
      kind: document.kind,
      definitions: newDefinitions,
    };
    
    const networkQuery = buildNetworkQuery(docWithTypename);

    // Compute plan metadata (id, varMask, makeVarsKey, windowArgs)
    const metadata = computePlanMetadata(
      root,
      operation.selectionSet,
      fragmentsByName,
      operation.operation,
      rootTypename,
    );

    return {
      kind: "CachePlan",
      operation: operation.operation,   // "query" | "mutation" | "subscription"
      rootTypename,
      root,
      rootSelectionMap,
      networkQuery,
      id: metadata.id,
      varMask: metadata.varMask,
      makeVarsKey: metadata.makeVarsKey,
      makeSignature: metadata.makeSignature,
      windowArgs: metadata.windowArgs,
      selectionFingerprint: metadata.selectionFingerprint,
    };
  }

  // Fragment path (single or multiple)
  const fragmentDefs = document.definitions.filter(
    (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION,
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
          'pass { fragmentName: "<one-of>" }',
        );
      }
      frag = fragmentDefs.find(f => f.name.value === opts.fragmentName);
      if (!frag) {
        const names = fragmentDefs.map(f => f.name.value).join(", ");
        throw new Error(
          `compilePlan: fragment "${opts.fragmentName}" not found. ` +
          `Available: [${names}]`,
        );
      }
    }

    const parentTypename = frag.typeCondition.name.value;

    // For fragments, ensure __typename is in ALL selections recursively (unlike operations where we skip root __typename)
    const fragSelectionWithTypename = ensureTypenameRecursive(frag.selectionSet);
    const root = lowerSelectionSet(fragSelectionWithTypename, parentTypename, fragmentsByName);
    const rootSelectionMap = indexByResponseKey(root);

    // Build network-safe doc with __typename added to ALL fragments
    // Just need to strip @connection directives
    const newDefinitions = new Array(document.definitions.length);
    for (let i = 0; i < document.definitions.length; i++) {
      const d = document.definitions[i];
      if (d.kind === Kind.FRAGMENT_DEFINITION) {
        // Add __typename to all fragments, not just the target one
        const fragWithTypename = ensureTypenameRecursive(d.selectionSet);
        newDefinitions[i] = {
          kind: d.kind,
          name: d.name,
          typeCondition: d.typeCondition,
          directives: d.directives,
          selectionSet: fragWithTypename,
        };
      } else {
        newDefinitions[i] = d;
      }
    }
    
    const docWithTypename: DocumentNode = {
      kind: document.kind,
      definitions: newDefinitions,
    };
    
    const networkQuery = buildNetworkQuery(docWithTypename);

    // Compute plan metadata (id, varMask, makeVarsKey, windowArgs)
    const metadata = computePlanMetadata(
      root,
      frag.selectionSet,
      fragmentsByName,
      "fragment",
      parentTypename,
    );

    return {
      kind: "CachePlan",
      operation: "fragment",
      rootTypename: parentTypename,
      root,
      rootSelectionMap,
      networkQuery,
      id: metadata.id,
      varMask: metadata.varMask,
      makeVarsKey: metadata.makeVarsKey,
      makeSignature: metadata.makeSignature,
      windowArgs: metadata.windowArgs,
      selectionFingerprint: metadata.selectionFingerprint,
    };
  }

  throw new Error("compilePlan: document has no OperationDefinition.");
};
