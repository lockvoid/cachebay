import type { DocumentNode } from "graphql";
import type { GraphInstance } from "./graph";
import {
  isObject,
  hasTypename,
  traverseFast,
  TRAVERSE_SKIP,
} from "./utils";
import { IDENTITY_FIELDS } from "./constants";

import {
  compileToPlan,
  isCachePlanV1,
  type CachePlanV1,
  type PlanField,
} from "@/src/compiler";

/**
 * What we expect FROM THE COMPILER:
 *
 * - CachePlanV1 {
 *     kind: 'CachePlanV1';
 *     rootTypename: string;           // usually '@'
 *     root: PlanField[];              // root selections
 *   }
 *
 * - PlanField {
 *     fieldName: string;              // schema field name
 *     responseKey: string;            // key in response (alias or fieldName)
 *     isConnection?: boolean;         // connection flag
 *     selectionSet?: PlanField[]|null;// nested selections
 *
 *     // Argument & key builders that ALREADY produce canonical/stable keys
 *     buildArgs(variables: Record<string, any>): Record<string, any>;
 *     buildFieldKey(variables: Record<string, any>): string;
 *     // Required when isConnection === true:
 *     buildConnectionKey(parentRecordId: string, variables: Record<string, any>): string;
 *   }
 */

export type ConnectionOptions = {
  mode?: "infinite" | "page";
  args?: string[];
};

export type DocumentsOptions = {
  connections: Record<string, Record<string, ConnectionOptions>>;
};

export type DocumentsDependencies = {
  graph: GraphInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

const ROOT_RECORD_ID = "@";

// ─────────────────────────────────────────────────────────────────────────────
// Shallow entity upsert; linked immediate objects/arrays become { __ref }
// ─────────────────────────────────────────────────────────────────────────────

const upsertEntityShallow = (graph: GraphInstance, node: any) => {
  const entityKey = graph.identify(node);
  if (!entityKey) return null;

  const snapshot: Record<string, any> = {
    __typename: node.__typename,
    id: String(node.id),
  };

  const fields = Object.keys(node);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (IDENTITY_FIELDS.has(field)) continue;

    const value = node[field];

    if (isObject(value) && hasTypename(value) && value.id != null) {
      const childKey = graph.identify(value);
      if (childKey) {
        graph.putRecord(childKey, { __typename: value.__typename, id: String(value.id) });
        snapshot[field] = { __ref: childKey };
        continue;
      }
    }

    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let j = 0; j < value.length; j++) {
        const item = value[j];
        if (isObject(item) && hasTypename(item) && item.id != null) {
          const childKey = graph.identify(item);
          if (childKey) {
            graph.putRecord(childKey, { __typename: item.__typename, id: String(item.id) });
            out[j] = { __ref: childKey };
          } else {
            out[j] = item;
          }
        } else {
          out[j] = item;
        }
      }
      snapshot[field] = out;
      continue;
    }

    snapshot[field] = value;
  }

  graph.putRecord(entityKey, snapshot);
  return entityKey;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reactive view wrappers for materializeDocument (lazy deref)
// ─────────────────────────────────────────────────────────────────────────────

const entityViewCache = new WeakMap<object, any>();
const arrayViewCache = new WeakMap<any[], any[]>();

function wrapArrayValue(graph: GraphInstance, arrayValue: any[]): any[] {
  const cached = arrayViewCache.get(arrayValue);
  if (cached) return cached;

  const mapped = new Array(arrayValue.length);
  for (let i = 0; i < arrayValue.length; i++) {
    const item = arrayValue[i];
    if (item && item.__ref) {
      const childProxy = graph.materializeRecord(item.__ref);
      mapped[i] = childProxy ? wrapEntityProxy(graph, childProxy) : undefined;
    } else {
      mapped[i] = item;
    }
  }
  arrayViewCache.set(arrayValue, mapped);
  return mapped;
}

function wrapEntityProxy(graph: GraphInstance, entityProxy: any): any {
  if (!entityProxy || typeof entityProxy !== "object") return entityProxy;

  const cached = entityViewCache.get(entityProxy);
  if (cached) return cached;

  const view = new Proxy(entityProxy, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (value && typeof value === "object" && (value as any).__ref) {
        const childProxy = graph.materializeRecord((value as any).__ref);
        return childProxy ? wrapEntityProxy(graph, childProxy) : undefined;
      }

      if (Array.isArray(value)) {
        return wrapArrayValue(graph, value);
      }

      return value;
    },
    has(target, prop) {
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set() {
      return false; // read-only view
    },
  });

  entityViewCache.set(entityProxy, view);
  return view;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const mapPlanFields = (fields: PlanField[] | null): Map<string, PlanField> => {
  const map = new Map<string, PlanField>();
  if (!fields) return map;
  for (let i = 0; i < fields.length; i++) {
    map.set(fields[i].responseKey, fields[i]);
  }
  return map;
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export const createDocuments = (options: DocumentsOptions, dependencies: DocumentsDependencies) => {
  const { graph } = dependencies;

  const ensureRoot = () => {
    graph.putRecord(ROOT_RECORD_ID, { id: ROOT_RECORD_ID, __typename: ROOT_RECORD_ID });
  };

  const planCache = new WeakMap<DocumentNode, CachePlanV1>();
  const getPlan = (docOrPlan: DocumentNode | CachePlanV1): CachePlanV1 => {
    if (isCachePlanV1(docOrPlan)) return docOrPlan;
    const cached = planCache.get(docOrPlan);
    if (cached) return cached;
    const plan = compileToPlan(docOrPlan, { connections: options.connections || {} });
    planCache.set(docOrPlan, plan);
    return plan;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // normalizeDocument — single pass; store EXACT page; NO merges on write
  // ───────────────────────────────────────────────────────────────────────────

  const normalizeDocument = ({
    document,
    variables = {},
    data,
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
    data: any;
  }) => {
    ensureRoot();

    const plan = getPlan(document);

    type NormalizeFrame = {
      parentRecordId: string;
      parentTypename: string;
      fieldsByResponseKey: Map<string, PlanField>;
    };

    const initialContext: NormalizeFrame = {
      parentRecordId: ROOT_RECORD_ID,
      parentTypename: plan.rootTypename,
      fieldsByResponseKey: mapPlanFields(plan.root),
    };

    traverseFast(data, initialContext, (parentNode, valueNode, fieldKey, frame) => {
      if (!frame || typeof frame !== "object") return;

      // Identify the current plan field
      let planField: PlanField | undefined;
      if (typeof fieldKey === "string") {
        planField = frame.fieldsByResponseKey.get(fieldKey);
      }

      // Connection page
      if (planField && planField.isConnection && isObject(valueNode)) {
        // Compiler builds the canonical page key and field key
        const pageKey = planField.buildConnectionKey(frame.parentRecordId, variables);
        const parentFieldKey = planField.buildFieldKey(variables);

        // edges
        const edgesIn: any[] = Array.isArray((valueNode as any).edges) ? (valueNode as any).edges : [];
        const edgeRefs = new Array(edgesIn.length);

        for (let i = 0; i < edgesIn.length; i++) {
          const edge = edgesIn[i] || {};
          const cursor = edge.cursor;
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj) && nodeObj.id != null) {
            const nodeKey = upsertEntityShallow(graph, nodeObj);
            if (nodeKey) {
              const edgeKey = `${pageKey}.edges.${i}`;
              graph.putRecord(edgeKey, { cursor, node: { __ref: nodeKey } });
              edgeRefs[i] = { __ref: edgeKey };
            }
          }
        }

        // pageInfo shallow copy
        const pageInfo = isObject((valueNode as any).pageInfo) ? { ...(valueNode as any).pageInfo } : undefined;

        // store page
        graph.putRecord(pageKey, {
          __typename: (valueNode as any).__typename,
          edges: edgeRefs,
          pageInfo,
        });

        // link parent field(args) → pageKey
        graph.putRecord(frame.parentRecordId, { [parentFieldKey]: { __ref: pageKey } });

        // Continue descent using the selection set of the connection for nested connections
        const nextFields = mapPlanFields(planField.selectionSet || null);
        return { context: { ...frame, fieldsByResponseKey: nextFields } as NormalizeFrame };
      }

      // Arrays (e.g., edges, lists) — update scope if selection exists
      if (Array.isArray(valueNode) && typeof fieldKey === "string" && planField) {
        const nextFields = mapPlanFields(planField.selectionSet || null);
        return { context: { ...frame, fieldsByResponseKey: nextFields } as NormalizeFrame };
      }

      // Regular entity
      if (planField && !planField.isConnection && isObject(valueNode) && hasTypename(valueNode) && valueNode.id != null) {
        const entityKey = upsertEntityShallow(graph, valueNode);
        if (entityKey) {
          // link parent field(args) → entity
          const parentFieldKey = planField.buildFieldKey(variables);
          graph.putRecord(frame.parentRecordId, { [parentFieldKey]: { __ref: entityKey } });

          const nextFields = mapPlanFields(planField.selectionSet || null);
          return {
            context: {
              parentRecordId: entityKey,
              parentTypename: valueNode.__typename,
              fieldsByResponseKey: nextFields,
            } as NormalizeFrame,
          };
        }
        return TRAVERSE_SKIP;
      }

      // Plain object: carry forward selection scope if present
      if (isObject(valueNode)) {
        const nextFields = typeof fieldKey === "string" && planField
          ? mapPlanFields(planField.selectionSet || null)
          : frame.fieldsByResponseKey;

        return { context: { ...frame, fieldsByResponseKey: nextFields } as NormalizeFrame };
      }

      return;
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // denormalizeDocument — exact page read (plain objects)
  // ───────────────────────────────────────────────────────────────────────────

  const denormalizeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = getPlan(document);

    const readEntityPlain = (recordId: string, selection: PlanField[] | null, _parentTypename: string): any => {
      const snapshot = graph.getRecord(recordId);
      if (!snapshot) return undefined;
      if (!selection) return { __typename: snapshot.__typename, id: snapshot.id };

      const out: Record<string, any> = {};
      for (let i = 0; i < selection.length; i++) {
        const field = selection[i];

        if (field.isConnection) {
          const pageKey = field.buildConnectionKey(recordId, variables);
          const conn = graph.getRecord(pageKey);
          if (!conn) { out[field.responseKey] = undefined; continue; }

          const edgesField = field.selectionSet?.find(f => f.responseKey === "edges") || null;
          const nodeField = edgesField?.selectionSet?.find(f => f.responseKey === "node") || null;
          const pageInfoField = field.selectionSet?.find(f => f.responseKey === "pageInfo") || null;

          const edges = Array.isArray(conn.edges)
            ? conn.edges.map((ref: any) => {
              const edgeRec = graph.getRecord(ref?.__ref || "");
              if (!edgeRec) return null;
              const edgeOut: any = {};
              if (edgesField?.selectionSet?.some(s => s.responseKey === "cursor")) {
                edgeOut.cursor = edgeRec.cursor;
              }
              if (nodeField && edgeRec.node?.__ref) {
                edgeOut.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null, snapshot.__typename);
              }
              return edgeOut;
            }).filter(Boolean)
            : [];

          const connOut: any = { __typename: conn.__typename };
          if (pageInfoField && conn.pageInfo) connOut.pageInfo = { ...conn.pageInfo };
          if (edgesField) connOut.edges = edges;

          out[field.responseKey] = connOut;
          continue;
        }

        // Non-connection field
        const fieldKey = field.buildFieldKey(variables);
        const stored = snapshot[fieldKey] ?? snapshot[field.responseKey] ?? snapshot[field.fieldName];

        if (stored?.__ref) {
          out[field.responseKey] = readEntityPlain(stored.__ref, field.selectionSet || null, snapshot.__typename);
        } else if (Array.isArray(stored)) {
          out[field.responseKey] = stored.slice();
        } else if (isObject(stored)) {
          out[field.responseKey] = { ...stored };
        } else {
          out[field.responseKey] = stored;
        }
      }

      return out;
    };

    const result: Record<string, any> = {};
    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = field.buildConnectionKey(ROOT_RECORD_ID, variables);
        const conn = graph.getRecord(pageKey);
        if (!conn) { result[field.responseKey] = undefined; continue; }

        const edgesField = field.selectionSet?.find(f => f.responseKey === "edges") || null;
        const nodeField = edgesField?.selectionSet?.find(f => f.responseKey === "node") || null;
        const pageInfoField = field.selectionSet?.find(f => f.responseKey === "pageInfo") || null;

        const edges = Array.isArray(conn.edges)
          ? conn.edges.map((ref: any) => {
            const edgeRec = graph.getRecord(ref?.__ref || "");
            if (!edgeRec) return null;
            const edgeOut: any = {};
            if (edgesField?.selectionSet?.some(s => s.responseKey === "cursor")) {
              edgeOut.cursor = edgeRec.cursor;
            }
            if (nodeField && edgeRec.node?.__ref) {
              edgeOut.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null, plan.rootTypename);
            }
            return edgeOut;
          }).filter(Boolean)
          : [];

        const connOut: any = { __typename: conn.__typename };
        if (pageInfoField && conn.pageInfo) connOut.pageInfo = { ...conn.pageInfo };
        if (edgesField) connOut.edges = edges;

        result[field.responseKey] = connOut;
        continue;
      }

      // top-level entity link from root
      const rootSnap = graph.getRecord(ROOT_RECORD_ID) || {};
      const linkKey = field.buildFieldKey(variables);
      const link = rootSnap[linkKey];

      if (link?.__ref) {
        result[field.responseKey] = readEntityPlain(link.__ref, field.selectionSet || null, plan.rootTypename);
      } else {
        result[field.responseKey] = undefined;
      }
    }

    return result;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // materializeDocument — exact page read, entity nodes as reactive view proxies
  // ───────────────────────────────────────────────────────────────────────────

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = getPlan(document);

    const readEntityReactive = (recordId: string, selection: PlanField[] | null, _parentTypename: string): any => {
      const proxy = graph.materializeRecord(recordId);
      if (!proxy) return undefined;
      if (!selection) return wrapEntityProxy(graph, proxy);

      const out: Record<string, any> = {};
      for (let i = 0; i < selection.length; i++) {
        const field = selection[i];

        if (field.isConnection) {
          const pageKey = field.buildConnectionKey(recordId, variables);
          const conn = graph.getRecord(pageKey);
          if (!conn) { out[field.responseKey] = undefined; continue; }

          const edgesField = field.selectionSet?.find(f => f.responseKey === "edges") || null;
          const nodeField = edgesField?.selectionSet?.find(f => f.responseKey === "node") || null;
          const pageInfoField = field.selectionSet?.find(f => f.responseKey === "pageInfo") || null;

          const edges = Array.isArray(conn.edges)
            ? conn.edges.map((ref: any) => {
              const edgeRec = graph.getRecord(ref?.__ref || "");
              if (!edgeRec) return null;
              const edgeOut: any = {};
              if (edgesField?.selectionSet?.some(s => s.responseKey === "cursor")) {
                edgeOut.cursor = edgeRec.cursor;
              }
              if (nodeField && edgeRec.node?.__ref) {
                const nodeProxy = graph.materializeRecord(edgeRec.node.__ref);
                edgeOut.node = nodeProxy ? wrapEntityProxy(graph, nodeProxy) : undefined;
              }
              return edgeOut;
            }).filter(Boolean)
            : [];

          const connOut: any = { __typename: conn.__typename };
          if (pageInfoField && conn.pageInfo) connOut.pageInfo = { ...conn.pageInfo };
          if (edgesField) connOut.edges = edges;

          out[field.responseKey] = connOut;
          continue;
        }

        // non-connection
        const fieldKey = field.buildFieldKey(variables);
        const value = proxy[fieldKey] ?? proxy[field.responseKey] ?? proxy[field.fieldName];

        if (value?.__ref) {
          const childProxy = graph.materializeRecord(value.__ref);
          out[field.responseKey] = childProxy ? wrapEntityProxy(graph, childProxy) : undefined;
        } else if (Array.isArray(value)) {
          out[field.responseKey] = wrapArrayValue(graph, value);
        } else if (isObject(value)) {
          out[field.responseKey] = { ...value };
        } else {
          out[field.responseKey] = value;
        }
      }

      return out;
    };

    const result: Record<string, any> = {};
    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = field.buildConnectionKey(ROOT_RECORD_ID, variables);
        const conn = graph.getRecord(pageKey);
        if (!conn) { result[field.responseKey] = undefined; continue; }

        const edgesField = field.selectionSet?.find(f => f.responseKey === "edges") || null;
        const nodeField = edgesField?.selectionSet?.find(f => f.responseKey === "node") || null;
        const pageInfoField = field.selectionSet?.find(f => f.responseKey === "pageInfo") || null;

        const edges = Array.isArray(conn.edges)
          ? conn.edges.map((ref: any) => {
            const edgeRec = graph.getRecord(ref?.__ref || "");
            if (!edgeRec) return null;
            const edgeOut: any = {};
            if (edgesField?.selectionSet?.some(s => s.responseKey === "cursor")) {
              edgeOut.cursor = edgeRec.cursor;
            }
            if (nodeField && edgeRec.node?.__ref) {
              const nodeProxy = graph.materializeRecord(edgeRec.node.__ref);
              edgeOut.node = nodeProxy ? wrapEntityProxy(graph, nodeProxy) : undefined;
            }
            return edgeOut;
          }).filter(Boolean)
          : [];

        const connOut: any = { __typename: conn.__typename };
        if (pageInfoField && conn.pageInfo) connOut.pageInfo = { ...conn.pageInfo };
        if (edgesField) connOut.edges = edges;

        result[field.responseKey] = connOut;
        continue;
      }

      const rootSnap = graph.getRecord(ROOT_RECORD_ID) || {};
      const linkKey = field.buildFieldKey(variables);
      const link = rootSnap[linkKey];

      if (link?.__ref) {
        result[field.responseKey] = readEntityReactive(link.__ref, field.selectionSet || null, plan.rootTypename);
      } else {
        result[field.responseKey] = undefined;
      }
    }

    return result;
  };

  return {
    normalizeDocument,
    denormalizeDocument,
    materializeDocument,
  };
};
