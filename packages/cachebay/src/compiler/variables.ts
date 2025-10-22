import {
  Kind,
  type ValueNode,
  type SelectionSetNode,
  type FieldNode,
  type InlineFragmentNode,
  type FragmentSpreadNode,
  type FragmentDefinitionNode,
} from "graphql";
import type { PlanField } from "./types";

/**
 * Extract all variable names referenced in a ValueNode (recursively).
 */
const collectVarsFromValue = (node: ValueNode, out: Set<string>): void => {
  switch (node.kind) {
    case Kind.VARIABLE:
      out.add(node.name.value);
      break;
    case Kind.LIST:
      for (const v of node.values) collectVarsFromValue(v, out);
      break;
    case Kind.OBJECT:
      for (const f of node.fields) collectVarsFromValue(f.value, out);
      break;
  }
};

/**
 * Collect all variable names used in arguments for a single field.
 * Returns both the full set and the arg names (for fingerprinting).
 */
export const collectFieldVars = (
  fieldNode: { arguments?: readonly any[] },
): { vars: Set<string>; argNames: string[] } => {
  const vars = new Set<string>();
  const argNames: string[] = [];

  if (fieldNode.arguments) {
    for (const arg of fieldNode.arguments) {
      argNames.push(arg.name.value);
      collectVarsFromValue(arg.value as ValueNode, vars);
    }
  }

  return { vars, argNames };
};

/**
 * Recursively collect all variables used in a PlanField tree.
 * Also collects window args from connection fields.
 */
export const collectPlanVars = (
  fields: PlanField[],
): { strictVars: Set<string>; windowArgs: Set<string> } => {
  const strictVars = new Set<string>();
  const windowArgs = new Set<string>();

  const walk = (field: PlanField): void => {
    // Collect vars from this field's args (already compiled, but we need the raw AST)
    // Since we don't have the raw AST here, we'll rely on the field's pageArgs
    // which were computed during lowering.

    if (field.isConnection && field.pageArgs) {
      for (const arg of field.pageArgs) {
        windowArgs.add(arg);
      }
    }

    if (field.selectionSet) {
      for (const child of field.selectionSet) {
        walk(child);
      }
    }
  };

  for (const field of fields) {
    walk(field);
  }

  return { strictVars, windowArgs };
};

/**
 * Collect all variable names from a SelectionSet AST (recursively).
 * This walks the raw AST before lowering.
 */
export const collectVarsFromSelectionSet = (
  selectionSet: SelectionSetNode,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  visited = new Set<string>(),
): Set<string> => {
  const vars = new Set<string>();

  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.FIELD) {
      const field = sel as FieldNode;
      if (field.arguments) {
        for (const arg of field.arguments) {
          collectVarsFromValue(arg.value as ValueNode, vars);
        }
      }
      if (field.selectionSet) {
        const childVars = collectVarsFromSelectionSet(field.selectionSet, fragmentsByName, visited);
        for (const v of childVars) vars.add(v);
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      const ifrag = sel as InlineFragmentNode;
      const childVars = collectVarsFromSelectionSet(ifrag.selectionSet, fragmentsByName, visited);
      for (const v of childVars) vars.add(v);
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const spread = sel as FragmentSpreadNode;
      const fragName = spread.name.value;
      if (!visited.has(fragName)) {
        visited.add(fragName);
        const frag = fragmentsByName.get(fragName);
        if (frag) {
          const childVars = collectVarsFromSelectionSet(frag.selectionSet, fragmentsByName, visited);
          for (const v of childVars) vars.add(v);
        }
      }
    }
  }

  return vars;
};

/**
 * Build a precompiled function that extracts masked variables and returns a stable key.
 * This is ultra-fast at runtime: just pick keys, sort, and stringify.
 */
export const makeMaskedVarsKeyFn = (
  strictMask: string[],
  canonicalMask: string[],
): ((mode: "strict" | "canonical", vars: Record<string, any>) => string) => {
  // Pre-sort masks for stable output
  const strictSorted = strictMask.slice().sort();
  const canonicalSorted = canonicalMask.slice().sort();

  return (mode: "strict" | "canonical", vars: Record<string, any>): string => {
    const mask = mode === "strict" ? strictSorted : canonicalSorted;
    if (mask.length === 0) return "{}";

    const pairs: string[] = [];
    for (let i = 0; i < mask.length; i++) {
      const k = mask[i];
      if (k in vars) {
        const v = vars[k];
        pairs.push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
      }
    }

    return `{${pairs.join(",")}}`;
  };
};
