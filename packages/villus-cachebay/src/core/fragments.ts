// src/core/fragments.ts
import type { GraphAPI } from './graph';
import type { SelectionsAPI } from './selections';
import {
  parse,
  Kind,
  type FragmentDefinitionNode,
  type SelectionNode,
  type FieldNode,
  type ValueNode,
} from 'graphql';

export type FragmentsConfig = Record<string, never>;

export type FragmentsDeps = {
  graph: GraphAPI;
  selections: SelectionsAPI;
};

export type CreateFragmentsArgs = {
  config?: FragmentsConfig;
  dependencies: FragmentsDeps;
};

export type ReadFragmentArgs = {
  id: string;                 // canonical entity key, e.g. "User:1"
  fragment: string;           // GraphQL fragment source (string)
  variables?: Record<string, any>;
  /** when false, return raw store snapshot for entity-only fragments */
  materialized?: boolean;
};

export type WriteFragmentArgs = {
  id: string;                 // canonical entity key to write to (root entity)
  fragment: string;           // GraphQL fragment source (string)
  data: any;                  // payload for the fragment (root + any nested fields-with-args)
  variables?: Record<string, any>;
};

// ──────────────────────────────────────────────
// AST helpers
// ──────────────────────────────────────────────
function parseSingleFragment(source: string): FragmentDefinitionNode {
  const doc = parse(source);
  const frag = doc.definitions.find(
    (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
  );
  if (!frag) throw new Error(`fragments.read/write: expected a single fragment definition`);
  return frag;
}

function fieldOutputKey(node: FieldNode): string {
  return node.alias?.value ?? node.name.value;
}

function valueNodeToJS(node: ValueNode, vars?: Record<string, any>): any {
  switch (node.kind) {
    case Kind.NULL: return null;
    case Kind.INT:
    case Kind.FLOAT: return Number(node.value);
    case Kind.STRING: return node.value;
    case Kind.BOOLEAN: return node.value;
    case Kind.ENUM: return node.value;
    case Kind.LIST: return node.values.map(v => valueNodeToJS(v, vars));
    case Kind.OBJECT: {
      const o: Record<string, any> = {};
      for (const f of node.fields) o[f.name.value] = valueNodeToJS(f.value, vars);
      return o;
    }
    case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
    default: return undefined;
  }
}

function argsToObject(field: FieldNode, vars?: Record<string, any>): Record<string, any> | undefined {
  if (!field.arguments || field.arguments.length === 0) return undefined;
  const out: Record<string, any> = {};
  for (const arg of field.arguments) out[arg.name.value] = valueNodeToJS(arg.value, vars);
  return out;
}
const isArgdField = (f: FieldNode) => !!(f.arguments && f.arguments.length);

// ──────────────────────────────────────────────
// API
// ─────────────────────────────────────────────-
export function createFragments({ dependencies }: CreateFragmentsArgs) {
  const { graph, selections } = dependencies;

  /** READ — supports both new (object) and compat (id + options) forms */
  function readFragment(a: ReadFragmentArgs | string, b?: { materialized?: boolean }): any {
    // Compat form: readFragment("User:1", { materialized?: boolean })
    if (typeof a === 'string') {
      const id = a;
      const materialized = b?.materialized !== false; // default true
      const has = graph.getEntity(id);
      if (!has) return undefined;
      return materialized ? graph.materializeEntity(id) : graph.getEntity(id);
    }

    // New form
    const { id, fragment, variables, materialized } = a;
    const frag = parseSingleFragment(fragment);

    // collect fields
    const fields = frag.selectionSet.selections.filter((s): s is FieldNode => s.kind === Kind.FIELD);
    const hasArgd = fields.some(isArgdField);

    // If the entity is missing → undefined
    const snapshot = graph.getEntity(id);
    if (!snapshot) return undefined;

    // Entity-only fragment
    if (!hasArgd) {
      if (materialized === false) {
        // raw store snapshot (non-reactive)
        return graph.getEntity(id);
      }
      // reactive proxy
      return graph.materializeEntity(id);
    }

    // Arg-bearing fragment: build object with selection wrappers + identity
    const rootProxy = graph.materializeEntity(id);
    const out: Record<string, any> = {
      __typename: rootProxy.__typename,
      id: rootProxy.id,
    };

    for (const sel of fields) {
      const key = fieldOutputKey(sel);
      const hasArgs = isArgdField(sel);

      if (!hasArgs) {
        // plain entity field read through proxy (keeps reactivity)
        out[key] = (rootProxy as any)[key];
      } else {
        const argObj = argsToObject(sel, variables) || {};
        const selectionKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        out[key] = graph.materializeSelection(selectionKey);
      }
    }

    return out;
  }

  /** WRITE */
  function writeFragment({ id, fragment, data, variables }: WriteFragmentArgs): void {
    const frag = parseSingleFragment(fragment);

    // If caller provided entity root data, ensure it exists & merge
    const typename = data?.__typename;
    const idFromKey = id.includes(':') ? id.split(':')[1] : undefined;
    if (typename) {
      graph.putEntity({ __typename: typename, id: idFromKey, ...data });
    }

    const fields = frag.selectionSet.selections.filter((s): s is FieldNode => s.kind === Kind.FIELD);
    for (const sel of fields) {
      const outKey = fieldOutputKey(sel);
      const argObj = argsToObject(sel, variables) || undefined;

      if (argObj) {
        // selection subtree
        const selectionKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        const subtree = data ? (data as any)[outKey] : undefined;
        if (subtree !== undefined) {
          graph.putSelection(selectionKey, subtree);
        }
      } else {
        // plain entity field: if provided, merge via putEntity
        if (data && data.__typename) {
          graph.putEntity(data);
        }
      }
    }
  }

  return {
    readFragment,
    writeFragment,
  };
}
