import {
  Kind,
  type SelectionSetNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type InlineFragmentNode,
  type FragmentSpreadNode,
  type ValueNode,
} from "graphql";
import type { PlanField } from "../types";
import { fingerprintField } from "../fingerprint";
import { collectFieldVars } from "../variables";

/* ────────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const indexByResponseKey = (fields: PlanField[] | null | undefined): Map<string, PlanField> | undefined => {
  if (!fields || fields.length === 0) return undefined;
  const m = new Map<string, PlanField>();
  for (let i = 0; i < fields.length; i++) m.set(fields[i].responseKey, fields[i]);
  return m;
};

/** infer child parent typename from inline fragments / spreads when unambiguous */
const inferChildParentTypename = (
  selectionSet: SelectionSetNode,
  defaultParent: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
): string => {
  const typeNames = new Set<string>();
  for (const sel of selectionSet.selections) {
    if (sel.kind === Kind.INLINE_FRAGMENT && sel.typeCondition) {
      typeNames.add(sel.typeCondition.name.value);
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const frag = fragmentsByName.get(sel.name.value);
      if (frag) typeNames.add(frag.typeCondition.name.value);
    }
  }
  return typeNames.size === 1 ? Array.from(typeNames)[0]! : defaultParent;
};

/** resolve a ValueNode to JS (vars is a flat dictionary) */
const valueToJS = (node: ValueNode, vars?: Record<string, any>): any => {
  switch (node.kind) {
    case Kind.NULL: return null;
    case Kind.INT:
    case Kind.FLOAT: return Number(node.value);
    case Kind.STRING: return node.value;
    case Kind.BOOLEAN: return node.value;
    case Kind.ENUM: return node.value;
    case Kind.LIST: return node.values.map(v => valueToJS(v, vars));
    case Kind.OBJECT: {
      const o: Record<string, any> = {};
      for (const f of node.fields) o[f.name.value] = valueToJS(f.value, vars);
      return o;
    }
    case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
    default: return undefined;
  }
};

/** compile argument resolver from field arguments */
const compileArgBuilder = (args: readonly any[] | undefined): {
  buildArgs: (vars: Record<string, any>) => Record<string, any>;
  expectedArgNames: string[];
} => {
  const entries = (args || []).map(a => [a.name.value, a.value as ValueNode]) as Array<[string, ValueNode]>;
  const expectedArgNames = entries.map(([k]) => k);

  const buildArgs = (vars: Record<string, any>) => {
    if (!entries.length) return {};
    const out: Record<string, any> = {};
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const val = valueToJS(v, vars);
      if (val !== undefined) out[k] = val;
    }
    return out;
  };

  return { buildArgs, expectedArgNames };
};

/** stable stringify (keys sorted, deep) - kept for backward compatibility */
const stableStringify = (v: any): string => {
  if (v == null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
};

/**
 * Compile a fast stringifyArgs function using precomputed arg order.
 * This avoids the need for stableStringify by iterating args in a fixed order.
 */
const compileStringifyArgs = (
  buildArgs: (vars: Record<string, any>) => Record<string, any>,
  expectedArgNames: string[],
): (vars: Record<string, any>) => string => {
  if (expectedArgNames.length === 0) {
    return () => "";
  }

  return (vars: Record<string, any>) => {
    const args = buildArgs(vars);
    let result = "{";
    let first = true;

    for (let i = 0; i < expectedArgNames.length; i++) {
      const argName = expectedArgNames[i];
      if (args[argName] !== undefined) {
        if (!first) result += ",";
        result += JSON.stringify(argName) + ":" + JSON.stringify(args[argName]);
        first = false;
      }
    }

    result += "}";
    return result;
  };
};

/** read @connection(key, filters, mode) on a field */
const parseConnectionDirective = (field: FieldNode): {
  isConnection: boolean;
  key?: string;
  filters?: string[];
  mode?: "infinite" | "page";
} => {
  if (!field.directives) return { isConnection: false };
  const dir = field.directives.find(d => d.name.value === "connection");
  if (!dir) return { isConnection: false };

  let key: string | undefined;
  let filters: string[] | undefined;
  let mode: "infinite" | "page" | undefined;

  for (const arg of dir.arguments || []) {
    const name = arg.name.value;
    if (name === "key") {
      const v = valueToJS(arg.value);
      if (typeof v === "string" && v.trim()) key = v.trim();
    } else if (name === "filters") {
      const v = valueToJS(arg.value);
      if (Array.isArray(v)) {
        filters = v.map(s => String(s)).filter(Boolean);
      }
    } else if (name === "mode") {
      const v = String(valueToJS(arg.value));
      if (v === "infinite" || v === "page") mode = v;
    }
  }

  return {
    isConnection: true,
    key,
    filters,
    // ✅ default to "infinite"
    mode: mode ?? "infinite",
  };
};

/* ────────────────────────────────────────────────────────────────────────── */
/* main lowering                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Lower a GraphQL SelectionSet into PlanField[].
 * `guardType` is the active inline-fragment/fragment-spread type condition to apply
 * to produced fields (so runtime can skip mismatched implementors).
 */
export const lowerSelectionSet = (
  selectionSet: SelectionSetNode | null | undefined,
  parentTypename: string,
  fragmentsByName: Map<string, FragmentDefinitionNode>,
  guardType?: string, // ← NEW
): PlanField[] => {
  if (!selectionSet) return [];

  const out: PlanField[] = [];

  for (const sel of selectionSet.selections) {
    // Field
    if (sel.kind === Kind.FIELD) {
      const fieldNode = sel as FieldNode;
      const responseKey = fieldNode.alias?.value || fieldNode.name.value;
      const fieldName = fieldNode.name.value;

      // child plan
      let childPlan: PlanField[] | null = null;
      let childMap: Map<string, PlanField> | undefined;
      if (fieldNode.selectionSet) {
        const childParent = inferChildParentTypename(fieldNode.selectionSet, parentTypename, fragmentsByName);
        // propagate current guardType down the tree
        childPlan = lowerSelectionSet(fieldNode.selectionSet, childParent, fragmentsByName, guardType);
        childMap = indexByResponseKey(childPlan);
      }

      // args
      const { buildArgs, expectedArgNames } = compileArgBuilder(fieldNode.arguments || []);
      const stringifyArgs = compileStringifyArgs(buildArgs, expectedArgNames);

      // connection directive (+ defaults)
      let isConnection = false;
      let connectionKey: string | undefined;
      let connectionFilters: string[] | undefined;
      let connectionMode: "infinite" | "page" | undefined;
      let pageArgs: string[] | undefined;

      if (fieldNode.directives?.some(d => d.name.value === "connection")) {
        const meta = parseConnectionDirective(fieldNode);
        isConnection = meta.isConnection;
        connectionKey = meta.key || fieldName;

        // If filters not provided: infer from field args excluding pagination args.
        const paginationArgs = new Set(["first", "last", "after", "before"]);
        if (meta.filters && meta.filters.length > 0) {
          connectionFilters = meta.filters.slice();
        } else {
          connectionFilters = (fieldNode.arguments || [])
            .map(a => a.name.value)
            .filter(n => !paginationArgs.has(n));
        }

        connectionMode = meta.mode || "infinite"; // meta already defaults; keep for clarity

        // Collect window/pagination args for this connection
        pageArgs = (fieldNode.arguments || [])
          .map(a => a.name.value)
          .filter(n => paginationArgs.has(n));
      }

      // Collect arg names and vars for fingerprinting
      const { argNames } = collectFieldVars(fieldNode);

      // Build the field object first (without selId)
      const planField: PlanField = {
        responseKey,
        fieldName,
        selectionSet: childPlan,
        selectionMap: childMap,
        buildArgs,
        stringifyArgs,
        expectedArgNames,
        isConnection,
        connectionKey,
        connectionFilters,
        connectionMode,
        typeCondition: guardType,
        pageArgs,
      };

      // Compute stable fingerprint for this field subtree
      planField.selId = fingerprintField(planField, argNames);

      out.push(planField);
      continue;
    }

    // Inline fragment
    if (sel.kind === Kind.INLINE_FRAGMENT) {
      const ifrag = sel as InlineFragmentNode;
      const nextParent = ifrag.typeCondition ? ifrag.typeCondition.name.value : parentTypename;

      // If the fragment has a type condition, it *becomes* the active guard for its subtree.
      const nextGuard = ifrag.typeCondition ? ifrag.typeCondition.name.value : guardType;

      const lowered = lowerSelectionSet(ifrag.selectionSet, nextParent, fragmentsByName, nextGuard);
      for (let i = 0; i < lowered.length; i++) out.push(lowered[i]);
      continue;
    }

    // Fragment spread
    if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const spread = sel as FragmentSpreadNode;
      const frag = fragmentsByName.get(spread.name.value);
      if (!frag) continue;

      const nextParent = frag.typeCondition.name.value;
      const nextGuard = frag.typeCondition.name.value; // spreads always carry a type condition

      const lowered = lowerSelectionSet(frag.selectionSet, nextParent, fragmentsByName, nextGuard);
      for (let i = 0; i < lowered.length; i++) out.push(lowered[i]);
      continue;
    }
  }

  return out;
};
