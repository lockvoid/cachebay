// src/compiler/lowering/flatten.ts
import type {
  SelectionSetNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  FragmentSpreadNode,
} from "graphql";
import { compileArgBuilder } from "./args";
import type { PlanField } from "../types";

export type ConnectionsConfig = Record<
  string,
  Record<string, { mode?: "infinite" | "page"; args?: string[] }>
>;

/**
 * Try to infer the child type for a field's selection set by looking at
 * inline fragments and fragment spreads. If there is exactly one distinct
 * type condition, return it; otherwise fall back to the provided default.
 */
function inferChildParentTypename(
  selectionSet: SelectionSetNode,
  defaultParent: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>
): string {
  const typeNames = new Set<string>();

  const selections = selectionSet.selections;
  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    if (sel.kind === "InlineFragment") {
      const ifrag = sel as InlineFragmentNode;
      const t = ifrag.typeCondition?.name.value;
      if (t) typeNames.add(t);
    } else if (sel.kind === "FragmentSpread") {
      const frag = fragmentsByName.get((sel as FragmentSpreadNode).name.value);
      if (frag) typeNames.add(frag.typeCondition.name.value);
    }
  }

  if (typeNames.size === 1) {
    return typeNames.values().next().value as string;
  }

  return defaultParent;
}

/**
 * Lower a selection set to a flat list of PlanField entries.
 * - Flattens fragments and inline fragments
 * - Preserves aliases as responseKey
 * - Annotates connections from config based on *current* parent typename
 * - For nested selection sets, infers the child type context from type conditions
 */
export const lowerSelectionSet = (
  selectionSet: SelectionSetNode | null | undefined,
  parentTypename: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  connections: ConnectionsConfig
): PlanField[] => {
  if (!selectionSet) {
    return [];
  }

  const output: PlanField[] = [];
  const selections = selectionSet.selections;

  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];

    // Field
    if (selection.kind === "Field") {
      const fieldNode = selection as FieldNode;
      const responseKey = fieldNode.alias?.value || fieldNode.name.value;
      const fieldName = fieldNode.name.value;

      // Mark connection based on the *current* parent typename
      const isConnection = Boolean(connections?.[parentTypename]?.[fieldName]);

      // Recurse into children with the *child* type context (inferred)
      let childPlan: PlanField[] | null = null;
      if (fieldNode.selectionSet) {
        const childParentTypename = inferChildParentTypename(
          fieldNode.selectionSet,
          parentTypename,
          fragmentsByName
        );
        childPlan = lowerSelectionSet(
          fieldNode.selectionSet,
          childParentTypename,
          fragmentsByName,
          connections
        );
      }

      const buildArgs = compileArgBuilder(fieldNode.arguments || []);

      const stringifyArgs = (value: any) => {
        const stableStringify = (obj: any): string => {
          if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
          }

          if (Array.isArray(obj)) {
            return '[' + obj.map(stableStringify).join(',') + ']';
          }

          // Sort keys alphabetically for stable ordering
          const sortedKeys = Object.keys(obj).sort();
          const pairs = sortedKeys.map(key =>
            JSON.stringify(key) + ':' + stableStringify(obj[key])
          );

          return '{' + pairs.join(',') + '}';
        };

        return stableStringify(buildArgs(value));
      };

      output.push({
        responseKey,
        fieldName,
        isConnection,
        buildArgs,
        stringifyArgs,
        selectionSet: childPlan,
      });

      continue;
    }

    // Inline fragment
    if (selection.kind === "InlineFragment") {
      const inlineFragment = selection as InlineFragmentNode;
      const nextParentTypename = inlineFragment.typeCondition
        ? inlineFragment.typeCondition.name.value
        : parentTypename;

      const lowered = lowerSelectionSet(
        inlineFragment.selectionSet,
        nextParentTypename,
        fragmentsByName,
        connections
      );

      for (let j = 0; j < lowered.length; j++) {
        output.push(lowered[j]);
      }
      continue;
    }

    // Fragment spread
    if (selection.kind === "FragmentSpread") {
      const spread = selection as FragmentSpreadNode;
      const fragment = fragmentsByName.get(spread.name.value);
      if (!fragment) {
        continue; // unknown fragment; ignore
      }
      const nextParentTypename = fragment.typeCondition.name.value;
      const lowered = lowerSelectionSet(
        fragment.selectionSet,
        nextParentTypename,
        fragmentsByName,
        connections
      );
      for (let j = 0; j < lowered.length; j++) {
        output.push(lowered[j]);
      }
      continue;
    }
  }

  return output;
};
