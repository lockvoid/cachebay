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
 * Infer child parent typename for a field's selection set using type conditions
 * across inline fragments and spreads; fallback to provided default.
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
      continue;
    }

    if (sel.kind === "FragmentSpread") {
      const spread = sel as FragmentSpreadNode;
      const frag = fragmentsByName.get(spread.name.value);
      if (frag) typeNames.add(frag.typeCondition.name.value);
      continue;
    }
  }

  if (typeNames.size === 1) {
    return typeNames.values().next().value as string;
  }

  return defaultParent;
}

/** Build responseKey -> PlanField map for a child selection. */
function buildSelectionMap(child: PlanField[] | null): Map<string, PlanField> | undefined {
  if (!child || child.length === 0) return undefined;
  const m = new Map<string, PlanField>();
  for (let i = 0; i < child.length; i++) m.set(child[i].responseKey, child[i]);
  return m;
}

/**
 * Lower a selection set to flat PlanField[]:
 *  - flattens fragments
 *  - preserves aliases (responseKey)
 *  - marks connections based on parent typename
 *  - attaches selectionMap for each selectionSet (compile time)
 */
export const lowerSelectionSet = (
  selectionSet: SelectionSetNode | null | undefined,
  parentTypename: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  connections: ConnectionsConfig
): PlanField[] => {
  if (!selectionSet) return [];

  const output: PlanField[] = [];
  const selections = selectionSet.selections;

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];

    if (sel.kind === "Field") {
      const f = sel as FieldNode;
      const responseKey = f.alias?.value || f.name.value;
      const fieldName = f.name.value;
      const isConnection = !!connections?.[parentTypename]?.[fieldName];

      // child lowering if any
      let child: PlanField[] | null = null;
      if (f.selectionSet) {
        const childParent = inferChildParentTypename(f.selectionSet, parentTypename, fragmentsByName);
        child = lowerSelectionSet(f.selectionSet, childParent, fragmentsByName, connections);
      }

      const buildArgs = compileArgBuilder(f.arguments || []);
      const stringifyArgs = (rawVars: any) => {
        const stable = (x: any): string => {
          if (x === null || typeof x !== "object") return JSON.stringify(x);
          if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
          const keys = Object.keys(x).sort();
          const pairs = new Array(keys.length);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            pairs[i] = JSON.stringify(k) + ":" + stable(x[k]);
          }
          return "{" + pairs.join(",") + "}";
        };
        return stable(buildArgs(rawVars));
      };

      const planField: PlanField = {
        responseKey,
        fieldName,
        isConnection,
        buildArgs,
        stringifyArgs,
        selectionSet: child,
      };

      (planField as any).selectionMap = buildSelectionMap(child);
      output.push(planField);
      continue;
    }

    if (sel.kind === "InlineFragment") {
      const ifrag = sel as InlineFragmentNode;
      const nextParent = ifrag.typeCondition ? ifrag.typeCondition.name.value : parentTypename;
      const lowered = lowerSelectionSet(ifrag.selectionSet, nextParent, fragmentsByName, connections);
      for (let j = 0; j < lowered.length; j++) output.push(lowered[j]);
      continue;
    }

    if (sel.kind === "FragmentSpread") {
      const spread = sel as FragmentSpreadNode;
      const frag = fragmentsByName.get(spread.name.value);
      if (!frag) continue;
      const nextParent = frag.typeCondition.name.value;
      const lowered = lowerSelectionSet(frag.selectionSet, nextParent, fragmentsByName, connections);
      for (let j = 0; j < lowered.length; j++) output.push(lowered[j]);
      continue;
    }
  }

  return output;
};
