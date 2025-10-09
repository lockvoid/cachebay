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

/**
 * Seeds a concrete connection page following new normalization rules:
 * - Concrete pages store edges as { __refs: string[] }
 * - Individual edge records are created separately
 * - pageInfo is stored inline or as a separate record
 */
export const seedConnectionPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection",
) => {
  const edgeKeys: string[] = [];
  const edgeRefs: Array<{ __ref: string }> = [];

  // Create individual edge records
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges:${i}`;

    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });

    edgeKeys.push(edgeKey);
    edgeRefs.push({ __ref: edgeKey });
  }

  // Create concrete page record with edges as { __refs: [...] }
  const pageRecord: Record<string, any> = {
    __typename: connectionTypename,
    edges: {
      __refs: edgeKeys,
    },
  };

  // Add pageInfo (inline or as reference)
  if (pageInfo) {
    if (pageInfo.__ref) {
      // PageInfo stored as separate record
      pageRecord.pageInfo = { __ref: pageInfo.__ref as string };
    } else {
      // PageInfo stored inline
      pageRecord.pageInfo = { ...pageInfo };
    }
  }

  // Add extra fields (e.g., totalCount, aggregations)
  if (extra) {
    Object.assign(pageRecord, extra);
  }

  graph.putRecord(pageKey, pageRecord);

  // Return both the snapshot (for canonical API) and the concrete structure
  return {
    pageSnapshot: {
      __typename: connectionTypename,
      edges: edgeRefs,
      pageInfo: pageInfo ? { ...pageInfo } : {},
      ...(extra || {}),
    },
    edgeRefs,
    edgeKeys,
  };
};

/**
 * Generic helper to write a connection page snapshot following new normalization rules:
 * - Creates entity records
 * - Creates edge records
 * - Creates concrete page record with { __refs: [...] }
 * - Returns snapshot for canonical API
 *
 * @param graph - Graph instance
 * @param pageKey - Concrete page key (e.g., '@.posts({"after":null,"first":3})')
 * @param nodeIds - Array of node IDs to create
 * @param options - Configuration options
 * @returns Page snapshot, edge refs, and edge keys
 *
 * @example
 * // Posts
 * const { page, edgeRefs } = writePageSnapshot(graph, pageKey, [1, 2, 3], {
 *   typename: "Post",
 *   edgeTypename: "PostEdge",
 *   connectionTypename: "PostConnection",
 *   createNode: (id) => ({ id: String(id), title: `Post ${id}` }),
 *   createCursor: (id) => `p${id}`,
 * });
 *
 * // Users
 * const { page, edgeRefs } = writePageSnapshot(graph, pageKey, ["u1", "u2"], {
 *   typename: "User",
 *   edgeTypename: "UserEdge",
 *   connectionTypename: "UserConnection",
 *   createNode: (id) => ({ id, name: `User ${id}` }),
 *   createCursor: (id) => id,
 * });
 */
export const writePageSnapshot = <TNodeId extends string | number>(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: TNodeId[],
  options: {
    typename: string;
    edgeTypename?: string;
    connectionTypename?: string;
    createNode: (id: TNodeId) => Record<string, any>;
    createCursor?: (id: TNodeId) => string;
    pageInfo?: {
      start?: string;
      end?: string;
      hasNext?: boolean;
      hasPrev?: boolean;
    };
  },
) => {
  const {
    typename,
    edgeTypename = `${typename}Edge`,
    connectionTypename = `${typename}Connection`,
    createNode,
    createCursor = (id) => String(id),
    pageInfo,
  } = options;

  const edgeKeys: string[] = [];
  const edgeRefs: Array<{ __ref: string }> = [];

  // Create entity and edge records
  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    const edgeKey = `${pageKey}.edges:${i}`;
    const cursor = createCursor(nodeId);

    // Create entity record
    const nodeData = createNode(nodeId);
    graph.putRecord(`${typename}:${nodeId}`, {
      __typename: typename,
      ...nodeData,
    });

    // Create edge record
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor,
      node: { __ref: `${typename}:${nodeId}` },
    });

    edgeKeys.push(edgeKey);
    edgeRefs.push({ __ref: edgeKey });
  }

  // Determine pageInfo cursors
  const startCursor = pageInfo?.start || (nodeIds.length > 0 ? createCursor(nodeIds[0]) : null);
  const endCursor = pageInfo?.end || (nodeIds.length > 0 ? createCursor(nodeIds[nodeIds.length - 1]) : null);

  const pageInfoRecord = {
    __typename: "PageInfo",
    startCursor,
    endCursor,
    hasNextPage: pageInfo?.hasNext ?? false,
    hasPreviousPage: pageInfo?.hasPrev ?? false,
  };

  // Create concrete page record with { __refs: [...] }
  graph.putRecord(pageKey, {
    __typename: connectionTypename,
    edges: {
      __refs: edgeKeys,
    },
    pageInfo: pageInfoRecord,
  });

  // Return snapshot for canonical API (edges as array of refs)
  const pageSnapshot = {
    __typename: connectionTypename,
    edges: edgeRefs,
    pageInfo: pageInfoRecord,
  };

  return {
    page: pageSnapshot,
    edgeRefs,
    edgeKeys,
  };
};

/**
 * Creates a pageInfo record separately (for reference-based pageInfo storage)
 */
export const createPageInfo = (
  graph: ReturnType<typeof createGraph>,
  pageInfoKey: string,
  options: {
    startCursor?: string | null;
    endCursor?: string | null;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  },
) => {
  const pageInfo = {
    __typename: "PageInfo",
    startCursor: options.startCursor ?? null,
    endCursor: options.endCursor ?? null,
    hasNextPage: options.hasNextPage ?? false,
    hasPreviousPage: options.hasPreviousPage ?? false,
  };

  graph.putRecord(pageInfoKey, pageInfo);

  return { __ref: pageInfoKey };
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
