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

const stableStringify = (obj: any) => {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
};

export const createPlanField = (
  name: string,
  isConnection = false,
  children: PlanField[] | null = null,
): PlanField => {
  const map = new Map<string, PlanField>();
  if (children) {
    for (let i = 0; i < children.length; i++) {
      map.set(children[i].responseKey, children[i]);
    }
  }
  return {
    responseKey: name,
    fieldName: name,
    isConnection,
    buildArgs: () => ({}),
    stringifyArgs: () => stableStringify({}),
    selectionSet: children,
    selectionMap: children ? map : undefined,
  };
};

export const createConnectionPlanField = (name: string): PlanField => {
  // connection needs edges.node at minimum
  const node = createPlanField("node", false, [createPlanField("id"), createPlanField("__typename")]);
  const edges = createPlanField("edges", false, [createPlanField("__typename"), createPlanField("cursor"), node]);
  return createPlanField(name, true, [createPlanField("__typename"), createPlanField("pageInfo"), edges]);
};

/** Seed a connection page and its edge records */
export const seedConnectionPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection",
) => {
  const edgeRefs: Array<{ __ref: string }> = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });
    edgeRefs.push({ __ref: edgeKey });
  }

  const snap: Record<string, any> = { __typename: connectionTypename, edges: edgeRefs };
  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);

  graph.putRecord(pageKey, snap);
};

export const writePageSnapshot = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: number[],
  pageInfo?: { start?: string; end?: string; hasNext?: boolean; hasPrev?: boolean },
) => {
  const edgeRefs: Array<{ __ref: string }> = [];

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    const cursor = `p${nodeId}`;

    graph.putRecord(`Post:${nodeId}`, {
      __typename: "Post",
      id: String(nodeId),
      title: `Post ${nodeId}`,
      flags: [],
    });

    graph.putRecord(edgeKey, {
      __typename: "PostEdge",
      cursor,
      node: { __ref: `Post:${nodeId}` },
    });

    edgeRefs.push({ __ref: edgeKey });
  }

  const page = {
    __typename: "PostConnection",
    pageInfo: {
      __typename: "PageInfo",
      startCursor: pageInfo?.start || `p${nodeIds[0]}`,
      endCursor: pageInfo?.end || `p${nodeIds[nodeIds.length - 1]}`,
      hasNextPage: pageInfo?.hasNext ?? false,
      hasPreviousPage: pageInfo?.hasPrev ?? false,
    },
    edges: edgeRefs,
  };

  graph.putRecord(pageKey, page);

  return { page, edgeRefs };
};

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
