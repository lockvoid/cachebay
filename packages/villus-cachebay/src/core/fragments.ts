// src/core/fragments.ts
import {
  parse,
  Kind,
  type FragmentDefinitionNode,
  type FieldNode,
  type ValueNode,
} from "graphql";
import type { GraphAPI } from "./graph";
import type { SelectionsAPI } from "./selections";

export type FragmentsConfig = Record<string, never>;
export type FragmentsDeps = { graph: GraphAPI; selections: SelectionsAPI };

export type ReadFragmentArgs = {
  id: string;
  fragment: string;
  variables?: Record<string, any>;
  materialized?: boolean; // default true
};

export type WriteFragmentArgs = {
  id: string;
  fragment: string;
  data: any;
  variables?: Record<string, any>;
};

export function createFragments({ dependencies }: { dependencies: FragmentsDeps }) {
  const { graph, selections } = dependencies;

  // ──────────────────────────────────────────────
  // helpers / guards
  // ──────────────────────────────────────────────
  const assertString = (name: string, val: unknown) => {
    if (typeof val !== "string" || val.trim() === "") {
      throw new Error(`[fragments] "${name}" must be a non-empty string`);
    }
  };

  const assertObject = (name: string, val: unknown) => {
    if (!val || typeof val !== "object") {
      throw new Error(`[fragments] "${name}" must be an object`);
    }
  };

  const parseSingleFragment = (source: string): FragmentDefinitionNode => {
    assertString("fragment", source);
    const doc = parse(source);
    const frag = doc.definitions.find(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );
    if (!frag) {
      throw new Error("[fragments] Expected a single fragment definition");
    }
    return frag;
  };

  const valueNodeToJS = (node: ValueNode, vars?: Record<string, any>): any => {
    switch (node.kind) {
      case Kind.NULL:
        return null;
      case Kind.INT:
      case Kind.FLOAT:
        return Number(node.value);
      case Kind.STRING:
        return node.value;
      case Kind.BOOLEAN:
        return node.value;
      case Kind.ENUM:
        return node.value;
      case Kind.LIST:
        return node.values.map((v) => valueNodeToJS(v, vars));
      case Kind.OBJECT: {
        const o: Record<string, any> = {};
        for (const f of node.fields) o[f.name.value] = valueNodeToJS(f.value, vars);
        return o;
      }
      case Kind.VARIABLE:
        return vars ? vars[node.name.value] : undefined;
      default:
        return undefined;
    }
  };

  const argsToObject = (field: FieldNode, vars?: Record<string, any>) => {
    if (!field.arguments || field.arguments.length === 0) return undefined;
    const out: Record<string, any> = {};
    for (const a of field.arguments) {
      out[a.name.value] = valueNodeToJS(a.value, vars);
    }
    return out;
  };

  const fieldOutputKey = (node: FieldNode) => node.alias?.value ?? node.name.value;

  // ──────────────────────────────────────────────
  // READ
  // ──────────────────────────────────────────────
  function readFragment({
    id,
    fragment,
    variables,
    materialized = true, // default TRUE now
  }: ReadFragmentArgs): any {
    assertString("id", id);
    assertString("fragment", fragment);

    const frag = parseSingleFragment(fragment);

    // Does this fragment request any arg'd fields at the root? (e.g. posts(first:2))
    let hasArggedFields = false;
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind === Kind.FIELD && sel.arguments && sel.arguments.length) {
        hasArggedFields = true;
        break;
      }
    }

    // Case A: no arg'd fields → pure entity selection
    if (!hasArggedFields) {
      if (materialized) {
        // Return the entity proxy immediately; it will auto-populate as data arrives.
        const proxy = graph.materializeEntity(id);
        const out: Record<string, any> = {};
        for (const sel of frag.selectionSet.selections) {
          if (sel.kind !== Kind.FIELD) continue;
          const key = fieldOutputKey(sel);
          out[key] = (proxy as any)[key];
        }
        if ((proxy as any)?.__typename && !("__typename" in out)) {
          out.__typename = (proxy as any).__typename;
        }
        return out;
      } else {
        // Plain snapshot mode → return whatever we have now; undefined if no snapshot yet.
        const snap = graph.getEntity(id);
        if (!snap) return undefined;
        const out: Record<string, any> = {};
        for (const sel of frag.selectionSet.selections) {
          if (sel.kind !== Kind.FIELD) continue;
          const key = fieldOutputKey(sel);
          out[key] = (snap as any)[key];
        }
        // Keep a top-level __typename for convenience if present in the snapshot
        const typename = (graph.getEntity(id) as any)?.__typename;
        if (typename) out.__typename = typename;
        return out;
      }
    }

    // Case B: arg'd fields present → stitch selections from stored skeletons
    // - Root entity fields (no args) come from materialized proxy or snapshot
    // - Arg'd fields come from selectionStore (materialized wrappers)
    const out: Record<string, any> = {};
    const rootSource = materialized ? graph.materializeEntity(id) : graph.getEntity(id);

    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;
      const key = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        const args = argsToObject(sel, variables) || {};
        const fieldKey = selections.buildFieldSelectionKey(id, sel.name.value, args);
        out[key] = graph.materializeSelection(fieldKey);
      } else {
        out[key] = (rootSource as any)?.[key];
      }
    }

    if ((rootSource as any)?.__typename && !("__typename" in out)) {
      out.__typename = (rootSource as any).__typename;
    }
    return out;
  }

  // ──────────────────────────────────────────────
  // WRITE
  // ──────────────────────────────────────────────
  function writeFragment({ id, fragment, data, variables }: WriteFragmentArgs): void {
    assertString("id", id);
    assertString("fragment", fragment);
    assertObject("data", data);

    const frag = parseSingleFragment(fragment);

    // Root entity merge (graph decides merge semantics)
    if (data && typeof data === "object" && data.__typename) {
      graph.putEntity(data);
    }

    // Top-level fields: store selections for arg’d fields; identifiable nested entities via putEntity
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;

      const outKey = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        const argObj = argsToObject(sel, variables) || {};
        const selKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        const subtree = (data as any)[outKey];
        if (subtree !== undefined) {
          graph.putSelection(selKey, subtree);
        }
      } else {
        const subtree = (data as any)[outKey];
        if (subtree && subtree.__typename && subtree.id != null) {
          graph.putEntity(subtree);
        }
        // plain scalars/embedded objects are already covered by root putEntity
      }
    }
  }

  return { readFragment, writeFragment };
}
