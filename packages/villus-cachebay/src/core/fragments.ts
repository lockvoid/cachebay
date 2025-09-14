// src/core/fragments.ts
import type { GraphAPI } from "./graph";
import type { SelectionsAPI } from "./selections";
import {
  parse,
  Kind,
  type DocumentNode,
  type FragmentDefinitionNode,
  type FieldNode,
  type ValueNode,
} from "graphql";

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
  /** Canonical entity key, e.g. "User:1" or "Post:42" */
  id: string;
  /** GraphQL fragment source as a string */
  fragment: string;
  /** When your document contains multiple fragments, pick one by name */
  fragmentName?: string;
  /** Values for $variables used in the fragment's field arguments */
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  /** Canonical entity key to write into */
  id: string;
  /** GraphQL fragment source as a string */
  fragment: string;
  /** Payload for the fragment (root + any nested fields-with-args) */
  data: any;
  /** When your document contains multiple fragments, pick one by name */
  fragmentName?: string;
  /** Values for $variables used in the fragment's field arguments */
  variables?: Record<string, any>;
};

export const createFragments = ({ dependencies }: CreateFragmentsArgs) => {
  const { graph, selections } = dependencies;

  // ────────────────────────────────────────────────────────────────────────────
  // Small helpers
  // ────────────────────────────────────────────────────────────────────────────

  const pickFragment = (doc: DocumentNode, name?: string): FragmentDefinitionNode => {
    const frags = doc.definitions.filter(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );

    if (name) {
      const found = frags.find((f) => f.name?.value === name);
      if (!found) {
        throw new Error(`fragments.read/write: fragment "${name}" not found in document`);
      }
      return found;
    }

    if (frags.length !== 1) {
      throw new Error(
        `fragments.read/write: expected a single fragment in the document (or provide fragmentName)`
      );
    }
    return frags[0];
  };

  const fieldOutputKey = (node: FieldNode): string => {
    return node.alias?.value ?? node.name.value;
  };

  const valueNodeToJS = (node: ValueNode, vars?: Record<string, any>): any => {
    switch (node.kind) {
      case Kind.NULL: {
        return null;
      }
      case Kind.INT:
      case Kind.FLOAT: {
        return Number(node.value);
      }
      case Kind.STRING:
      case Kind.ENUM: {
        return node.value;
      }
      case Kind.BOOLEAN: {
        return node.value;
      }
      case Kind.LIST: {
        return node.values.map((v) => valueNodeToJS(v, vars));
      }
      case Kind.OBJECT: {
        const out: Record<string, any> = {};
        for (const f of node.fields) {
          out[f.name.value] = valueNodeToJS(f.value, vars);
        }
        return out;
      }
      case Kind.VARIABLE: {
        return vars ? vars[node.name.value] : undefined;
      }
      default: {
        return undefined;
      }
    }
  };

  const argsToObject = (
    field: FieldNode,
    vars?: Record<string, any>
  ): Record<string, any> | undefined => {
    if (!field.arguments || field.arguments.length === 0) {
      return undefined;
    }
    const out: Record<string, any> = {};
    for (const arg of field.arguments) {
      out[arg.name.value] = valueNodeToJS(arg.value, vars);
    }
    return out;
  };

  const inferTypenameFromFragment = (frag: FragmentDefinitionNode): string | undefined => {
    return frag.typeCondition?.name?.value;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // READ
  // ────────────────────────────────────────────────────────────────────────────

  const readFragment = ({ id, fragment, fragmentName, variables }: ReadFragmentArgs): any => {
    const doc = parse(fragment);
    const frag = pickFragment(doc, fragmentName);

    // Reactive entity proxy; may reflect latest concrete implementor
    const rootProxy = graph.materializeEntity(id);

    const out: Record<string, any> = {};
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) {
        continue;
      }

      const outKey = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        // Field with arguments → look up / materialize a selection tree
        const argObject = argsToObject(sel, variables) || {};
        const selectionKey = selections.buildFieldSelectionKey(id, sel.name.value, argObject);
        out[outKey] = graph.materializeSelection(selectionKey);
      } else {
        // Plain entity field → read from the reactive root proxy
        out[outKey] = (rootProxy as any)[outKey];
      }
    }

    // Ensure __typename is present (tests expect it)
    if (
      rootProxy &&
      typeof rootProxy === "object" &&
      (rootProxy as any).__typename &&
      !("__typename" in out)
    ) {
      out.__typename = (rootProxy as any).__typename;
    }

    return out;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // WRITE
  // ────────────────────────────────────────────────────────────────────────────

  const writeFragment = ({
    id,
    fragment,
    fragmentName,
    data,
    variables,
  }: WriteFragmentArgs): void => {
    const doc = parse(fragment);
    const frag = pickFragment(doc, fragmentName);

    // 1) Ensure/merge root entity (full or partial)
    //    If caller didn't include __typename, derive from fragment condition.
    const ensuredRoot =
      data && data.__typename
        ? data
        : { __typename: inferTypenameFromFragment(frag), id: id.split(":")[1] };

    if (ensuredRoot && ensuredRoot.__typename) {
      graph.putEntity(ensuredRoot);
    }

    // 2) Apply fragment selections
    for (const sel of frag.selectionSet.selections) {
      if (sel.kind !== Kind.FIELD) {
        continue;
      }

      const outKey = fieldOutputKey(sel);
      const hasArgs = !!(sel.arguments && sel.arguments.length);

      if (hasArgs) {
        // Field with args → write selection subtree if provided
        const argObject = argsToObject(sel, variables) || {};
        const selectionKey = selections.buildFieldSelectionKey(id, sel.name.value, argObject);
        const subtree = data ? (data as any)[outKey] : undefined;
        if (subtree !== undefined) {
          graph.putSelection(selectionKey, subtree);
        }
      } else {
        // Plain entity subset merge if the caller provided root fields
        if (data && data.__typename) {
          graph.putEntity(data);
        }
      }
    }
  };

  return {
    readFragment,
    writeFragment,
  };
};
