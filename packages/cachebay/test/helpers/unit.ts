import type { Connection, ConnectionRecord, ConnectionRef } from "@/src/core/types";

/**
 * Writes a connection page to the graph following normalization rules.
 * Takes fixture data (from users.buildConnection, posts.buildConnection, etc.)
 * and normalizes it into the graph with proper references.
 */
export const writeConnectionPage = (graph: ReturnType<typeof createGraph>, pageKey: string, connectionData: Connection): { pageSnapshot: ConnectionRecord; pageSnapshotRefs: ConnectionRef } => {
  const edgeKeys: string[] = [];

  const { edges, pageInfo, ...connectionInfo } = connectionData;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    const node = edge.node;
    const nodeKey = graph.identify(node);

    if (!nodeKey) {
      throw new Error(`Cannot identify node: ${JSON.stringify(node)}`);
    }

    graph.putRecord(nodeKey, node);

    const { node: _1, ...edgeFields } = edge;

    graph.putRecord(edgeKey, {
      __typename: edge.__typename || "Edge",
      ...edgeFields,
      node: { __ref: nodeKey },
    });
    edgeKeys.push(edgeKey);
  }

  const pageInfoKey = `${pageKey}.pageInfo`;

  graph.putRecord(pageInfoKey, {
    ...pageInfo,
    __typename: "PageInfo",
  });

  graph.putRecord(pageKey, {
    ...connectionInfo,
    edges: { __refs: edgeKeys },
    pageInfo: { __ref: pageInfoKey },
  });

  return {
    ...connectionInfo,
    edges: { __refs: edgeKeys },
    pageInfo: { __ref: pageInfoKey },
  };
};

// old


import { visit, Kind, type DocumentNode, type SelectionSetNode } from "graphql";
import gql from "graphql-tag";
import type { PlanField } from "@/src/compiler";
import { compilePlan } from "@/src/compiler/compile";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";

export function readCanonicalEdges(graph: ReturnType<typeof createGraph>, canonicalKey: string) {
  const page = graph.getRecord(canonicalKey);
  if (!page) return [];

  const edgesField = page.edges;
  if (!edgesField || typeof edgesField !== "object") return [];

  const refs = Array.isArray(edgesField.__refs) ? edgesField.__refs : [];

  const out: Array<{ edgeRef: string; nodeKey: string; meta: Record<string, any> }> = [];

  for (let i = 0; i < refs.length; i++) {
    const edgeRef = refs[i];
    if (typeof edgeRef !== "string") continue;

    const edge = graph.getRecord(edgeRef);
    if (!edge) continue;

    const nodeRef = edge.node;
    if (!nodeRef || typeof nodeRef !== "object") continue;

    const nodeKey = nodeRef.__ref;
    if (typeof nodeKey !== "string") continue;

    const meta: Record<string, any> = {};
    for (const key in edge) {
      if (key !== "cursor" && key !== "node" && key !== "__typename") {
        meta[key] = edge[key];
      }
    }

    out.push({ edgeRef, nodeKey, meta });
  }

  return out;
}

export const collectConnectionDirectives = (doc: DocumentNode): string[] => {
  const hits: string[] = [];
  visit(doc, {
    Field(node) {
      const hasConn = (node.directives || []).some(d => d.name.value === "connection");
      if (hasConn) hits.push(node.name.value);
    },
  });
  return hits;
};

export const selectionSetHasTypename = (node: { selectionSet?: SelectionSetNode } | null | undefined): boolean => {
  const selectionSet = node?.selectionSet;

  if (!selectionSet || !Array.isArray(selectionSet.selections)) {
    return false;
  }

  return selectionSet.selections.some((selection: any) => {
    return selection.kind === Kind.FIELD && selection.name?.value === "__typename";
  });
};

export const hasTypenames = (doc: DocumentNode): boolean => {
  let ok = true;

  visit(doc, {
    SelectionSet: {
      enter(node, _key, parent) {
        if (parent && parent.kind === Kind.OPERATION_DEFINITION) {
          return;
        }

        if (!selectionSetHasTypename({ selectionSet: node })) {
          ok = false;
        }
      },
    },
  });

  return ok;
};

export const createTestPlan = (query: DocumentNode) => {
  return compilePlan(query);
};

// Helper to create field selection with automatic mapping
export const createSelection = (config: Record<string, any>): { fields: PlanField[], map: Map<string, PlanField> } => {
  const fields: PlanField[] = [];
  const map = new Map<string, PlanField>();

  const processField = (name: string, spec: any): PlanField => {
    if (spec === true || spec === null || spec === undefined) {
      // Simple field
      return createPlanField(name);
    } else if (spec === "connection") {
      // Connection field
      return createConnectionPlanField(name);
    } else if (Array.isArray(spec)) {
      // Field with children (array of field names)
      const children = spec.map(childName => createPlanField(childName));
      return createPlanField(name, false, children);
    } else if (typeof spec === "object") {
      // Nested object - recursively process
      const childSelection = createSelection(spec);
      return createPlanField(name, false, childSelection.fields);
    }
    return createPlanField(name);
  };

  for (const [name, spec] of Object.entries(config)) {
    const field = processField(name, spec);
    fields.push(field);
    map.set(field.responseKey, field);
  }

  return { fields, map };
};
