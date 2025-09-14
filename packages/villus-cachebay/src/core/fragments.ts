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
  id: string;                 // canonical entity key, e.g. "User:1" or "Post:42"
  fragment: string;           // GraphQL fragment source (string)
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  id: string;                 // canonical entity key to write to (root entity)
  fragment: string;           // GraphQL fragment source (string)
  data: any;                  // payload for the fragment (root + any nested fields-with-args)
  variables?: Record<string, any>;
};

export function createFragments({ dependencies }: CreateFragmentsArgs) {
  const { graph, selections } = dependencies;

  function parseSingleFragment(source: string): FragmentDefinitionNode {
    const doc = parse(source);
    const frag = doc.definitions.find(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );
    if (!frag) {
      throw new Error(`fragments.read/write: expected a single fragment definition`);
    }
    return frag;
  }

  function fieldOutputKey(node: FieldNode): string {
    return node.alias?.value ?? node.name.value;
  }

  function valueNodeToJS(node: ValueNode, vars?: Record<string, any>): any {
    switch (node.kind) {
      case Kind.NULL:
        return null;
      case Kind.INT:
        return Number(node.value);
      case Kind.FLOAT:
        return Number(node.value);
      case Kind.STRING:
        return node.value;
      case Kind.BOOLEAN:
        return node.value;
      case Kind.ENUM:
        return node.value;
      case Kind.LIST:
        return node.values.map(v => valueNodeToJS(v, vars));
      case Kind.OBJECT: {
        const o: Record<string, any> = {};
        for (const f of node.fields) {
          o[f.name.value] = valueNodeToJS(f.value, vars);
        }
        return o;
      }
      case Kind.VARIABLE: {
        return vars ? vars[node.name.value] : undefined;
      }
      default:
        return undefined;
    }
  }

  function argsToObject(field: FieldNode, vars?: Record<string, any>): Record<string, any> | undefined {
    if (!field.arguments || field.arguments.length === 0) return undefined;
    const out: Record<string, any> = {};
    for (const arg of field.arguments) {
      out[arg.name.value] = valueNodeToJS(arg.value, vars);
    }
    return out;
  }

  /** READ **/
  function readFragment({ id, fragment, variables }: ReadFragmentArgs): any {
    const frag = parseSingleFragment(fragment);

    // Root proxy (reactive, includes latest implementor typename)
    const proxy = graph.materializeEntity(id);

    // Build the shape requested by the fragment
    const out: Record<string, any> = {};

    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;

      const key = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        // This is a field with arguments → a selection (e.g., posts(first: 10))
        const argObj = argsToObject(sel, variables);
        const fieldKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj || {});
        // materialize the selection tree from selections store
        out[key] = selections.materializeSelection(fieldKey);
      } else {
        // Plain entity field → read from the reactive proxy
        // (this includes nested objects; graph.materializeEntity already materializes refs)
        out[key] = (proxy as any)[key];
      }
    }

    // Always ensure __typename is present on the returned object
    if (proxy && typeof proxy === 'object' && (proxy as any).__typename && !('__typename' in out)) {
      out.__typename = (proxy as any).__typename;
    }

    return out;
  }

  /** WRITE **/
  function writeFragment({ id, fragment, data, variables }: WriteFragmentArgs): void {
    const frag = parseSingleFragment(fragment);

    // First, ensure implementor mapping + merge entity fields at the root.
    // If caller provided a full root object under `data`, use it directly;
    // otherwise, synthesize a minimal identity payload to ensure the entity exists.
    const rootData = data && data.__typename ? data : { __typename: inferTypenameFromFragment(frag), id: id.split(':')[1] };
    if (rootData && rootData.__typename) {
      graph.putEntity(rootData);
    }

    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) continue;

      const outKey = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        // Nested field with arguments → selection write
        const argObj = argsToObject(sel, variables) || {};
        const fieldKey = selections.buildFieldSelectionKey(id, sel.name.value, argObj);
        const subtree = data ? (data as any)[outKey] : undefined;
        if (subtree !== undefined) {
          selections.writeSelection(fieldKey, subtree);
        }
      } else {
        // Plain entity field.
        // If the fragment provides a subset object for the root, merge via putEntity.
        // We reuse `data` here since callers typically pass root fields + any nested selections.
        if (data && data.__typename) {
          graph.putEntity(data);
        }
      }
    }
  }

  // Helper: if user didn’t include __typename in `data`, try using fragment type condition
  function inferTypenameFromFragment(frag: FragmentDefinitionNode): string | undefined {
    return frag.typeCondition?.name?.value;
  }

  return {
    readFragment,
    writeFragment,
  };
}
