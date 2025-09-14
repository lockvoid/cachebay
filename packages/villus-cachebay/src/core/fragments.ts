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

export type FragmentsDeps = { graph: GraphAPI; selections: SelectionsAPI };

export type ReadFragmentArgs = {
  id: string;                     // e.g. "User:1"
  fragment: string;               // single GraphQL fragment source
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  id: string;                     // root entity key
  fragment: string;
  data: any;                      // payload to write
  variables?: Record<string, any>;
};

export function createFragments({ dependencies }: { dependencies: FragmentsDeps }) {
  const { graph, selections } = dependencies;

  // ──────────────────────────────────────────────
  // guards
  // ──────────────────────────────────────────────
  const ensureString = (name: string, v: unknown) => {
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`[fragments] "${name}" must be a non-empty string`);
    }
  };

  const ensureObject = (name: string, v: unknown) => {
    if (!v || typeof v !== "object") {
      throw new Error(`[fragments] "${name}" must be an object`);
    }
  };

  // ──────────────────────────────────────────────
  // AST helpers
  // ──────────────────────────────────────────────
  function parseSingleFragment(source: string): FragmentDefinitionNode {
    const doc = parse(source);
    const frag = doc.definitions.find(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );
    if (!frag) throw new Error("[fragments] expected a single fragment definition");
    return frag;
  }

  const fieldKey = (node: FieldNode) => node.alias?.value ?? node.name.value;

  const valueNodeToJS = (node: ValueNode, vars?: Record<string, any>): any => {
    switch (node.kind) {
      case Kind.NULL: return null;
      case Kind.INT:
      case Kind.FLOAT: return Number(node.value);
      case Kind.STRING: return node.value;
      case Kind.BOOLEAN: return node.value;
      case Kind.ENUM: return node.value;
      case Kind.LIST: return node.values.map(v => valueNodeToJS(v, vars));
      case Kind.OBJECT: {
        const out: Record<string, any> = {};
        for (const f of node.fields) out[f.name.value] = valueNodeToJS(f.value, vars);
        return out;
      }
      case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
      default: return undefined;
    }
  };

  const argsToObject = (node: FieldNode, vars?: Record<string, any>) => {
    if (!node.arguments || node.arguments.length === 0) return undefined;
    const out: Record<string, any> = {};
    for (const a of node.arguments) out[a.name.value] = valueNodeToJS(a.value, vars);
    return out;
  };

  // ──────────────────────────────────────────────
  // selection skeleton → plain snapshot
  // ──────────────────────────────────────────────
  const snapshotFromSelection = (skel: any): any => {
    if (!skel || typeof skel !== "object") return skel;

    if (Array.isArray(skel)) {
      const arr = new Array(skel.length);
      for (let i = 0; i < skel.length; i++) arr[i] = snapshotFromSelection(skel[i]);
      return arr;
    }

    if (typeof skel.__ref === "string") {
      const snap = graph.getEntity(skel.__ref);
      if (!snap) return undefined;

      const out: Record<string, any> = {};
      if (snap.__typename) out.__typename = snap.__typename;
      if (snap.id != null) out.id = String(snap.id);

      const keys = Object.keys(snap);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === "__typename" || k === "id") continue;
        out[k] = snapshotFromSelection((snap as any)[k]);
      }
      return out;
    }

    const out: Record<string, any> = {};
    const keys = Object.keys(skel);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = snapshotFromSelection(skel[keys[i]]);
    return out;
  };

  // ──────────────────────────────────────────────
  // READ (snapshot)
  // ──────────────────────────────────────────────
  function readFragment({ id, fragment, variables }: ReadFragmentArgs): any {
    ensureString("id", id);
    ensureString("fragment", fragment);

    const frag = parseSingleFragment(fragment);
    const root = graph.getEntity(id);
    if (!root) return undefined;

    const out: Record<string, any> = {};

    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;
      const key = fieldKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (!hasArgs) {
        out[key] = (root as any)[key];
      } else {
        const args = argsToObject(sel, variables) || {};
        const selKey = selections.buildFieldSelectionKey(id, sel.name.value, args);
        const skel = graph.getSelection(selKey);
        out[key] = skel ? snapshotFromSelection(skel) : undefined;
      }
    }

    if (root.__typename && !("__typename" in out)) out.__typename = root.__typename;
    return out;
  }

  // ──────────────────────────────────────────────
  // WRITE
  // ──────────────────────────────────────────────
  function writeFragment({ id, fragment, data, variables }: WriteFragmentArgs): void {
    ensureString("id", id);
    ensureString("fragment", fragment);
    ensureObject("data", data);

    const frag = parseSingleFragment(fragment);

    // Write root entity if identifiable
    if (data && typeof data === "object" && data.__typename) {
      graph.putEntity(data);
    }

    // Arg’d top-level fields → store selection skeletons
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;

      const key = fieldKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (!hasArgs) {
        const subtree = (data as any)[key];
        if (subtree && subtree.__typename && subtree.id != null) {
          graph.putEntity(subtree);
        }
      } else {
        const args = argsToObject(sel, variables) || {};
        const selKey = selections.buildFieldSelectionKey(id, sel.name.value, args);
        const subtree = (data as any)[key];
        if (subtree !== undefined) {
          graph.putSelection(selKey, subtree);
        }
      }
    }
  }

  return { readFragment, writeFragment };
}
