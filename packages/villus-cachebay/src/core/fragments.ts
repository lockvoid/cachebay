// src/core/fragments.ts
import {
  parse,
  Kind,
  type FragmentDefinitionNode,
  type FieldNode,
  type ValueNode,
  type DocumentNode,
} from 'graphql';
import type { GraphAPI } from './graph';
import type { SelectionsAPI } from './selections';
import { shallowReactive } from 'vue';
export type FragmentsConfig = Record<string, never>;
export type FragmentsDeps = { graph: GraphAPI; selections: SelectionsAPI };

export type ReadFragmentArgs = {
  id: string;
  fragment: string;
  variables?: Record<string, any>;
  // note: readFragment ALWAYS returns a snapshot (non-reactive). This flag is ignored by design.
};

export type WriteFragmentArgs = {
  id: string;
  fragment: string;
  data: any;
  variables?: Record<string, any>;
};

export type WatchFragmentArgs = {
  id: string;
  fragment: string;
  variables?: Record<string, any>;
};

export function createFragments({ dependencies }: { dependencies: FragmentsDeps }) {
  const { graph, selections } = dependencies;

  // ──────────────────────────────────────────────
  // small helpers
  // ──────────────────────────────────────────────
  const assertString = (name: string, val: unknown) => {
    if (typeof val !== 'string' || val.trim() === '') {
      throw new Error(`[fragments] "${name}" must be a non-empty string`);
    }
  };

  const assertObject = (name: string, val: unknown) => {
    if (!val || typeof val !== 'object') {
      throw new Error(`[fragments] "${name}" must be an object`);
    }
  };

  const parseSingleFragment = (source: string): FragmentDefinitionNode => {
    assertString('fragment', source);
    const doc = parse(source);
    const frag = doc.definitions.find(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );
    if (!frag) throw new Error('[fragments] Expected a single fragment definition');
    return frag;
  };

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
        const o: Record<string, any> = {};
        for (const f of node.fields) o[f.name.value] = valueNodeToJS(f.value, vars);
        return o;
      }
      case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
      default: return undefined;
    }
  };

  const argsToObject = (field: FieldNode, vars?: Record<string, any>): Record<string, any> | undefined => {
    if (!field.arguments || field.arguments.length === 0) return undefined;
    const out: Record<string, any> = {};
    for (const a of field.arguments) out[a.name.value] = valueNodeToJS(a.value, vars);
    return out;
  };

  const fieldOutputKey = (node: FieldNode) => node.alias?.value ?? node.name.value;

  /**
   * Build a plain, non-reactive snapshot from a selection skeleton:
   * - arrays copied
   * - plain objects copied
   * - { __ref: key } resolved to the current entity snapshot (deeply).
   */
  const plainFromSkeleton = (node: any): any => {
    if (node == null || typeof node !== 'object') return node;

    if (Array.isArray(node)) {
      return node.map(plainFromSkeleton);
    }

    if ('__ref' in node && typeof node.__ref === 'string') {
      const snap = graph.getEntity(node.__ref);
      if (!snap || typeof snap !== 'object') return undefined;
      const out: Record<string, any> = {};
      for (const k of Object.keys(snap)) {
        // entity snapshots are already normalized to plain scalars/objects/skeletons
        out[k] = plainFromSkeleton((snap as any)[k]);
      }
      return out;
    }

    // plain object
    const out: Record<string, any> = {};
    for (const k of Object.keys(node)) {
      out[k] = plainFromSkeleton(node[k]);
    }
    return out;
  };

  // For watchFragment: detect if the fragment contains any fields-with-args at top level.
  const getTopLevelArgFields = (frag: FragmentDefinitionNode) =>
    frag.selectionSet.selections.filter(
      (s): s is FieldNode => s.kind === Kind.FIELD && !!(s.arguments && s.arguments.length)
    );

  // ──────────────────────────────────────────────
  // READ (always snapshot)
  // ──────────────────────────────────────────────
  function readFragment({ id, fragment, variables }: ReadFragmentArgs): any {
    assertString('id', id);
    const frag = parseSingleFragment(fragment);

    // root entity snapshot (plain)
    const rootSnap = graph.getEntity(id);
    if (!rootSnap) return undefined;

    const out: Record<string, any> = {};
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;
      const k = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (!hasArgs) {
        // Copy the requested root field from the entity snapshot
        out[k] = plainFromSkeleton((rootSnap as any)[k]);
      } else {
        // Selection snapshot: denormalize skeleton at this key
        const argObj = argsToObject(sel, variables) || {};
        const selKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        const skeleton = graph.getSelection(selKey);
        out[k] = skeleton ? plainFromSkeleton(skeleton) : undefined;
      }
    }

    // Ensure top-level typename is present when available
    const typename = (rootSnap as any)?.__typename;
    if (typename && !('__typename' in out)) {
      out.__typename = typename;
    }

    return out;
  }

  // ──────────────────────────────────────────────
  // WRITE
  // ──────────────────────────────────────────────
  function writeFragment({ id, fragment, data, variables }: WriteFragmentArgs): void {
    assertString('id', id);
    assertObject('data', data);

    const frag = parseSingleFragment(fragment);

    // Root entity write if present
    if ((data as any).__typename) {
      graph.putEntity(data);
    }

    // Each top-level field in the fragment: if it carries args, store as a selection.
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;

      const k = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        const argObj = argsToObject(sel, variables) || {};
        const selKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        const subtree = (data as any)[k];
        if (subtree !== undefined) {
          graph.putSelection(selKey, subtree);
        }
      } else {
        // Nested identifiable object written as entity (optional QoL)
        const subtree = (data as any)[k];
        if (subtree && typeof subtree === 'object' && (subtree as any).__typename && (subtree as any).id != null) {
          graph.putEntity(subtree);
        }
      }
    }
  }

  // ──────────────────────────────────────────────
  // WATCH (live projection)
  // ──────────────────────────────────────────────

  function watchFragment({ id, fragment, variables }: WatchFragmentArgs) {
    assertString('id', id);
    const frag = parseSingleFragment(fragment);

    const argFields = getTopLevelArgFields(frag);

    // No arg fields → live entity proxy
    if (argFields.length === 0) {
      return { value: graph.materializeEntity(id) };
    }

    // Single arg field → live selection wrapper nested in a reactive root
    if (argFields.length === 1) {
      const sel = argFields[0]!;
      const alias = fieldOutputKey(sel);                       // e.g. "posts"
      const argObj = argsToObject(sel, variables) || {};
      const selKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);

      // Build a synthetic reactive root so root and nested "posts" are both reactive.
      const root = shallowReactive({} as Record<string, any>);

      // Preserve a helpful __typename if the entity exists (not required by tests, but nice to have)
      const snap = graph.getEntity(id);
      if (snap && typeof snap === 'object' && (snap as any).__typename) {
        (root as any).__typename = (snap as any).__typename;
      }

      // Mount the live selection wrapper
      (root as any)[alias] = graph.materializeSelection(selKey);

      return { value: root };
    }

    // Multiple arg fields (optional): mount each selection wrapper under its alias in a reactive root
    const multi = shallowReactive({} as Record<string, any>);
    for (const f of argFields) {
      const alias = fieldOutputKey(f);
      const argObj = argsToObject(f, variables) || {};
      const key = selections.buildFieldSelectionKey(id, f.name.value, argObj);
      (multi as any)[alias] = graph.materializeSelection(key);
    }
    return { value: multi };
  }

  return { readFragment, writeFragment, watchFragment };
}
