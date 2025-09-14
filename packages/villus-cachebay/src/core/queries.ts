// src/core/queries.ts
import type { DocumentNode, OperationDefinitionNode, FieldNode, ValueNode } from "graphql";
import { parse, visit, Kind } from "graphql";
import type { GraphAPI } from "./graph";

/** Resolve a GraphQL AST value to a plain JS value, applying variables. */
function resolveValue(node: ValueNode, vars: Record<string, any>): any {
  switch (node.kind) {
    case Kind.NULL: return null;
    case Kind.INT: return Number(node.value);
    case Kind.FLOAT: return Number(node.value);
    case Kind.STRING: return node.value;
    case Kind.BOOLEAN: return node.value;
    case Kind.ENUM: return node.value; // store as string
    case Kind.VARIABLE: return vars[node.name.value];
    case Kind.LIST: return node.values.map(v => resolveValue(v, vars));
    case Kind.OBJECT: {
      const out: Record<string, any> = {};
      for (const f of node.fields) out[f.name.value] = resolveValue(f.value, vars);
      return out;
    }
    default: return undefined;
  }
}

/** Build a path→args dictionary from the GraphQL query AST & variables. */
function buildFieldArgsMap(doc: DocumentNode, vars: Record<string, any>) {
  // We collect only the fields that carry arguments. Paths use base field name (ignore alias).
  const argsMap: Record<string, Record<string, any>> = {};

  function recordArgs(path: string, field: FieldNode) {
    if (!field.arguments || field.arguments.length === 0) return;
    const argsObj: Record<string, any> = {};
    for (const arg of field.arguments) {
      argsObj[arg.name.value] = resolveValue(arg.value, vars);
    }
    argsMap[path] = argsObj;
  }

  function walkSelection(prefix: string, fields: readonly any[]) {
    for (const sel of fields) {
      if (sel.kind !== Kind.FIELD) continue;
      const name = sel.name.value; // ignore alias for storage keys
      const path = prefix ? `${prefix}.${name}` : name;
      recordArgs(path, sel);
      if (sel.selectionSet) walkSelection(path, sel.selectionSet.selections);
    }
  }

  for (const def of doc.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      const sel = (def as OperationDefinitionNode).selectionSet;
      walkSelection("", sel.selections);
    }
    // Note: fragments don’t contribute argument maps for normalization (usually no args there).
  }

  return argsMap;
}

/** Accept both a string or a pre-parsed DocumentNode (nice DX) */
function toDoc(gql: string | DocumentNode): DocumentNode {
  return typeof gql === "string" ? parse(gql) : gql;
}

type WriteQueryOptions = {
  query: string | DocumentNode;
  variables?: Record<string, any>;
  data: any; // GraphQL response shape: { __typename?: "Query", ... }
};

/**
 * writeQuery — normalize & write a full query payload.
 * Hides fieldArgs from callers by deriving them from the query+variables.
 */
export function writeQuery(graph: GraphAPI, opts: WriteQueryOptions) {
  const doc = toDoc(opts.query);
  const vars = opts.variables ?? {};
  const fieldArgs = buildFieldArgsMap(doc, vars);
  // Delegate normalization to graph (same internal normalize used everywhere)
  graph.put({ data: opts.data, fieldArgs });
}

type WriteFragmentOptions = {
  fragment: string | DocumentNode;
  data: any; // Entity-shaped payload; must include __typename + id (or pass a keyed object).
};

/**
 * writeFragment — normalize & write an entity/subtree.
 * Aliases don’t matter here; there are (almost) never args on leaf fragments.
 */
export function writeFragment(graph: GraphAPI, opts: WriteFragmentOptions) {
  // We don’t actually need the fragment AST to normalize; graph.identify handles keys.
  // Keep the signature for API symmetry & future validation.
  toDoc(opts.fragment); // parsed once in case you want to validate later
  graph.put(opts.data);
}

/** Optional helpers if you want symmetry */
type ReadQueryOptions = {
  query: string | DocumentNode;
  variables?: Record<string, any>;
};

/**
 * readQuery — materialize from @Query (no filtering for selection;
 * the component will naturally pick what it needs reactively).
 */
export function readQuery<T = any>(graph: GraphAPI, _opts: ReadQueryOptions): T {
  return graph.materialize("@Query") as T;
}

/** readFragment — return the reactive entity record by key or by entity object */
export function readFragment<T = any>(graph: GraphAPI, keyOrEntity: string | { __typename: string; id: string }): T | undefined {
  const key = typeof keyOrEntity === "string" ? keyOrEntity : `${keyOrEntity.__typename}:${String(keyOrEntity.id)}`;
  return graph.materialize(key) as T | undefined;
}
