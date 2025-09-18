// src/compiler/lowering/flatten.ts
import type {
  SelectionSetNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  FragmentSpreadNode,
  DirectiveNode,
  ArgumentNode,
  ValueNode,
} from "graphql";
import { compileArgBuilder } from "./args";
import type { PlanField } from "../types";

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
    } else if (sel.kind === "FragmentSpread") {
      const frag = fragmentsByName.get((sel as FragmentSpreadNode).name.value);
      if (frag) typeNames.add(frag.typeCondition.name.value);
    }
  }

  if (typeNames.size === 1) return typeNames.values().next().value as string;
  return defaultParent;
}

/** Build responseKey -> PlanField map for a child selection (compile time). */
function buildSelectionMap(child: PlanField[] | null): Map<string, PlanField> | undefined {
  if (!child || child.length === 0) return undefined;
  const m = new Map<string, PlanField>();
  for (let i = 0; i < child.length; i++) m.set(child[i].responseKey, child[i]);
  return m;
}

/** Parse a literal GraphQL ValueNode to JS. */
function valueToJS(v: ValueNode): any {
  switch (v.kind) {
    case "StringValue":
    case "EnumValue":
      return v.value;
    case "BooleanValue":
      return v.value;
    case "IntValue":
    case "FloatValue":
      return Number(v.value);
    case "NullValue":
      return null;
    case "ListValue":
      return v.values.map(valueToJS);
    case "ObjectValue": {
      const out: Record<string, any> = {};
      for (let i = 0; i < v.fields.length; i++) out[v.fields[i].name.value] = valueToJS(v.fields[i].value);
      return out;
    }
    case "Variable":
      return undefined; // compile-time unknown → leave undefined
    default:
      return undefined;
  }
}

/** Parse @connection(mode?: string, args?: string[]) */
function parseConnectionDirective(
  dir: DirectiveNode | undefined,
  fieldNode: FieldNode
): { mode: string; args: string[] } | null {
  if (!dir) return null;

  let mode: string | undefined;
  let argsList: string[] | undefined;

  const args = dir.arguments || [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as ArgumentNode;
    const name = a.name.value;
    if (name === "mode") {
      const v = valueToJS(a.value);
      if (typeof v === "string") mode = v;
    } else if (name === "args") {
      const v = valueToJS(a.value);
      if (Array.isArray(v)) argsList = v.filter((x) => typeof x === "string") as string[];
    }
  }

  // Default identity args: all field args except pagination args
  const PAGINATION = new Set(["first", "last", "after", "before"]);
  if (!argsList) {
    argsList = (fieldNode.arguments || [])
      .map((a) => a.name.value)
      .filter((name) => !PAGINATION.has(name));
  }

  // Default mode
  if (!mode) mode = "infinite";

  return { mode, args: argsList };
}

/**
 * Lower a selection set to flat PlanField[]:
 *  - flattens fragments
 *  - preserves aliases (responseKey)
 *  - marks connections ONLY when @connection is present (no heuristics)
 *  - attaches selectionMap for each selectionSet (compile time)
 *  - attaches connectionMode / connectionArgs when @connection is present
 */
export const lowerSelectionSet = (
  selectionSet: SelectionSetNode | null | undefined,
  parentTypename: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>
): PlanField[] => {
  if (!selectionSet) return [];

  const output: PlanField[] = [];
  const selections = selectionSet.selections;

  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];

    // Field
    if (selection.kind === "Field") {
      const fieldNode = selection as FieldNode;
      const responseKey = fieldNode.alias?.value || fieldNode.name.value;
      const fieldName = fieldNode.name.value;

      // child lowering if any
      let childPlan: PlanField[] | null = null;
      if (fieldNode.selectionSet) {
        const childParent = inferChildParentTypename(fieldNode.selectionSet, parentTypename, fragmentsByName);
        childPlan = lowerSelectionSet(fieldNode.selectionSet, childParent, fragmentsByName);
      }

      // @connection directive (explicit-only)
      const connDir = (fieldNode.directives || []).find((d) => d.name.value === "connection");
      const connInfo = connDir ? parseConnectionDirective(connDir, fieldNode) : null;

      const buildArgs = compileArgBuilder(fieldNode.arguments || []);
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
        isConnection: !!connInfo,
        connectionMode: connInfo?.mode,
        connectionArgs: connInfo?.args,
        buildArgs,
        stringifyArgs,
        selectionSet: childPlan,
      };

      (planField as any).selectionMap = buildSelectionMap(childPlan);
      output.push(planField);
      continue;
    }

    // Inline fragment
    if (selection.kind === "InlineFragment") {
      const ifrag = selection as InlineFragmentNode;
      const nextParent = ifrag.typeCondition ? ifrag.typeCondition.name.value : parentTypename;
      const lowered = lowerSelectionSet(ifrag.selectionSet, nextParent, fragmentsByName);
      for (let j = 0; j < lowered.length; j++) output.push(lowered[j]);
      continue;
    }

    // Fragment spread
    if (selection.kind === "FragmentSpread") {
      const spread = selection as FragmentSpreadNode;
      const frag = fragmentsByName.get(spread.name.value);
      if (!frag) continue;
      const nextParent = frag.typeCondition.name.value;
      const lowered = lowerSelectionSet(frag.selectionSet, nextParent, fragmentsByName);
      for (let j = 0; j < lowered.length; j++) output.push(lowered[j]);
      continue;
    }
  }

  return output;
};
