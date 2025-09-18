// src/core/documents.ts
import type { DocumentNode } from "graphql";
import type { GraphInstance } from "./graph";
import { isObject, hasTypename, traverseFast, TRAVERSE_SKIP } from "./utils";
import { IDENTITY_FIELDS } from "./constants";

import {
  compileToPlan,
  isCachePlanV1,
  type CachePlanV1,
  type PlanField,
} from "@/src/compiler";

export type DocumentsOptions = {
  connections: Record<string, Record<string, { mode?: "infinite" | "page"; args?: string[] }>>;
};

export type DocumentsDependencies = {
  graph: GraphInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

const ROOT_ID = "@";

/** Build parent field key from compiler plan (full args). */
const buildFieldKey = (field: PlanField, variables: Record<string, any>): string => {
  return `${field.fieldName}(${field.stringifyArgs(variables)})`;
};

/** Build connection page key from compiler plan (full args). */
const buildConnectionKey = (
  field: PlanField,
  parentRecordId: string,
  variables: Record<string, any>
): string => {
  const prefix = parentRecordId === ROOT_ID ? "@." : `@.${parentRecordId}.`;
  return `${prefix}${field.fieldName}(${field.stringifyArgs(variables)})`;
};

/** Find a field by responseKey in current selection scope (simple linear scan). */
const findField = (fields: PlanField[] | null, responseKey: string): PlanField | undefined => {
  if (!fields) return undefined;
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].responseKey === responseKey) return fields[i];
  }
  return undefined;
};

/** Shallow upsert of an entity; immediate child entities → { __ref }; skip connection-like fields. */
const upsertEntityShallow = (graph: GraphInstance, node: any) => {
  const entityKey = graph.identify(node);
  if (!entityKey) return null;

  const snapshot: Record<string, any> = {
    __typename: node.__typename,
    id: String(node.id),
  };

  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    const field = keys[i];
    if (IDENTITY_FIELDS.has(field)) continue;

    const value = node[field];

    // Skip embedding connection-like objects (typename ends with Connection & has edges)
    if (
      isObject(value) &&
      typeof (value as any).__typename === "string" &&
      (value as any).__typename.endsWith("Connection") &&
      Array.isArray((value as any).edges)
    ) {
      continue;
    }

    // Linked entity object
    if (isObject(value) && hasTypename(value) && value.id != null) {
      const childKey = graph.identify(value);
      if (childKey) {
        graph.putRecord(childKey, { __typename: value.__typename, id: String(value.id) });
        snapshot[field] = { __ref: childKey };
        continue;
      }
    }

    // Arrays of possible entities
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

    // Plain object or scalar
    snapshot[field] = value;
  }

  graph.putRecord(entityKey, snapshot);
  return entityKey;
};

export const createDocuments = (options: DocumentsOptions, deps: DocumentsDependencies) => {
  const { graph } = deps;

  const ensureRoot = () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  };

  // Plan cache per DocumentNode
  const planCache = new WeakMap<DocumentNode, CachePlanV1>();
  const getPlan = (docOrPlan: DocumentNode | CachePlanV1): CachePlanV1 => {
    if (isCachePlanV1(docOrPlan)) return docOrPlan;
    const hit = planCache.get(docOrPlan);
    if (hit) return hit;
    const plan = compileToPlan(docOrPlan, { connections: options.connections || {} });
    planCache.set(docOrPlan, plan);
    return plan;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // normalizeDocument — single pass; store EXACT page (no merge)
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

    const isQuery = (plan as any).operation ? (plan as any).operation === "query" : (plan as any).opKind === "query";

    type Frame = {
      parentRecordId: string;
      fields: PlanField[];       // current scope fields
      insideConnection: boolean; // to avoid linking edge.node to parent
    };

    const initialFrame: Frame = {
      parentRecordId: ROOT_ID,
      fields: plan.root,
      insideConnection: false,
    };

    console.log(plan)
    traverseFast(data, initialFrame, (parentNode, valueNode, responseKey, frame) => {
      if (!frame) return;

      const parentRecordId = frame.parentRecordId;
      const planField = typeof responseKey === "string"
        ? findField(frame.fields, responseKey)
        : undefined;

      // Connection page — store page & (only for queries) link parent field(full args)
      if (planField && planField.isConnection && isObject(valueNode)) {
        const pageKey = buildConnectionKey(planField, parentRecordId, variables);
        const fieldKey = buildFieldKey(planField, variables);

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
              const { node, ...edgeRest } = edge as any;
              const edgeSnap: Record<string, any> = edgeRest;

              edgeSnap.node = { __ref: nodeKey };

              // 4) write edge record + push ref
              graph.putRecord(edgeKey, edgeSnap);
              edgeRefs[i] = { __ref: edgeKey };
            }
          }
        }

        const { edges, pageInfo, ...connRest } = valueNode as any;

        const pageSnap: Record<string, any> = {
          __typename: (valueNode as any).__typename,
          ...connRest,                // e.g., totalCount, cost, etc. (scalars/arrays)
        };

        if (pageInfo) pageSnap.pageInfo = { ...(pageInfo as any) }; // shallow copy
        pageSnap.edges = edgeRefs;

        graph.putRecord(pageKey, pageSnap);

        // link only on queries
        if (isQuery) {
          graph.putRecord(parentRecordId, { [fieldKey]: { __ref: pageKey } });
        }

        // descend into the connection’s selection (edges/pageInfo)
        const nextFields = planField.selectionSet || [];
        return { parentRecordId, fields: nextFields, insideConnection: true } as Frame;
      }

      // Arrays — switch scope to the array field’s *item* selection (edges → cursor/node)
      if (Array.isArray(valueNode) && typeof responseKey === "string") {
        const pf = findField(frame.fields, responseKey);
        const nextFields = pf?.selectionSet || frame.fields; // <- critical
        return { parentRecordId, fields: nextFields, insideConnection: frame.insideConnection } as Frame;
      }

      // Identifiable entity — upsert & optionally link (only on queries)
      if (planField && isObject(valueNode) && hasTypename(valueNode) && valueNode.id != null) {
        const entityKey = upsertEntityShallow(graph, valueNode);
        if (entityKey) {
          // Only link on queries:
          //  - at root for root fields
          //  - or non-root when the field actually has args (avoid author({}))
          const argObj = planField.buildArgs(variables);
          const hasArgs = argObj && Object.keys(argObj).length > 0;
          const shouldLink = isQuery &&
            !(frame.insideConnection && planField.responseKey === "node") &&
            (parentRecordId === ROOT_ID ? true : hasArgs);

          if (shouldLink) {
            const parentFieldKey = buildFieldKey(planField, variables);
            graph.putRecord(parentRecordId, { [parentFieldKey]: { __ref: entityKey } });
          }

          const nextFields = planField.selectionSet || [];
          return { parentRecordId: entityKey, fields: nextFields, insideConnection: false } as Frame;
        }
        return TRAVERSE_SKIP;
      }

      // Plain object — propagate scope
      if (isObject(valueNode)) {
        const nextFields = planField?.selectionSet || frame.fields;
        return { parentRecordId, fields: nextFields, insideConnection: frame.insideConnection } as Frame;
      }

      return;
    });
  };

  // ───────────────────────────────────────────────────────────────────────────
  // denormalizeDocument — plain objects; exact page
  // ───────────────────────────────────────────────────────────────────────────

  const denormalizeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    const readEntityPlain = (recordId: string, fields: PlanField[] | null): any => {
      const snap = graph.getRecord(recordId);
      if (!snap) return undefined;
      if (!fields) return { __typename: snap.__typename, id: snap.id };

      const out: Record<string, any> = {};
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];

        if (field.isConnection) {
          const pageKey = buildConnectionKey(field, recordId, variables);
          const page = graph.getRecord(pageKey);
          if (!page) { out[field.responseKey] = undefined; continue; }

          const edgesField = findField(field.selectionSet, "edges");
          const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;
          const pageInfoField = findField(field.selectionSet, "pageInfo");

          const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

          const edges = Array.isArray(page.edges)
            ? page.edges.map((ref: any) => {
              const edgeRec = graph.getRecord(ref?.__ref || "");
              if (!edgeRec) return null;
              const e: any = {};
              if (wantCursor) e.cursor = edgeRec.cursor;
              if (nodeField && edgeRec.node?.__ref) {
                e.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null);
              }
              return e;
            }).filter(Boolean)
            : [];

          const connOut: any = { __typename: page.__typename };
          if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...page.pageInfo };
          if (edgesField) connOut.edges = edges;

          out[field.responseKey] = connOut;
          continue;
        }

        const linkKey = buildFieldKey(field, variables);
        const stored = snap[linkKey] ?? snap[field.responseKey] ?? snap[field.fieldName];

        if (stored?.__ref) {
          out[field.responseKey] = readEntityPlain(stored.__ref, field.selectionSet || null);
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

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        const page = graph.getRecord(pageKey);
        if (!page) { result[field.responseKey] = undefined; continue; }

        const edgesField = findField(field.selectionSet, "edges");
        const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;
        const pageInfoField = findField(field.selectionSet, "pageInfo");

        const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

        const edges = Array.isArray(page.edges)
          ? page.edges.map((ref: any) => {
            const edgeRec = graph.getRecord(ref?.__ref || "");
            if (!edgeRec) return null;
            const e: any = {};
            if (wantCursor) e.cursor = edgeRec.cursor;
            if (nodeField && edgeRec.node?.__ref) {
              e.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null);
            }
            return e;
          }).filter(Boolean)
          : [];

        const connOut: any = { __typename: page.__typename };
        if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...page.pageInfo };
        if (edgesField) connOut.edges = edges;

        result[field.responseKey] = connOut;
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = rootSnap[linkKey];

      if (link?.__ref) {
        result[field.responseKey] = readEntityPlain(link.__ref, field.selectionSet || null);
      } else {
        result[field.responseKey] = undefined;
      }
    }

    return result;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // materializeDocument — reactive, exact page; ONE per-instance view cache
  // ───────────────────────────────────────────────────────────────────────────

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    // unified per-instance cache
    const viewCache = new WeakMap<object, any>();

    const wrapArrayValue = (arrayValue: any[]): any[] => {
      const cached = viewCache.get(arrayValue);
      if (cached) return cached;

      const mapped = new Array(arrayValue.length);
      for (let i = 0; i < arrayValue.length; i++) {
        const item = arrayValue[i];
        if (item && item.__ref) {
          const childProxy = graph.materializeRecord(item.__ref);
          mapped[i] = childProxy ? wrapEntityProxy(childProxy) : undefined;
        } else {
          mapped[i] = item;
        }
      }
      viewCache.set(arrayValue, mapped);
      return mapped;
    };

    const wrapEntityProxy = (entityProxy: any): any => {
      if (!entityProxy || typeof entityProxy !== "object") return entityProxy;
      const cached = viewCache.get(entityProxy);
      if (cached) return cached;

      const view = new Proxy(entityProxy, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);

          if (value && typeof value === "object" && (value as any).__ref) {
            const childProxy = graph.materializeRecord((value as any).__ref);
            return childProxy ? wrapEntityProxy(childProxy) : undefined;
          }

          if (Array.isArray(value)) {
            return wrapArrayValue(value);
          }

          return value;
        },
        has(target, prop) { return Reflect.has(target, prop); },
        ownKeys(target) { return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
        set() { return false; },
      });

      viewCache.set(entityProxy, view);
      return view;
    };

    const readEntityReactive = (recordId: string, fields: PlanField[] | null): any => {
      const proxy = graph.materializeRecord(recordId);
      if (!proxy) return undefined;
      if (!fields) return wrapEntityProxy(proxy);

      const out: Record<string, any> = {};
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];

        if (field.isConnection) {
          const pageKey = buildConnectionKey(field, recordId, variables);
          const page = graph.getRecord(pageKey);
          if (!page) { out[field.responseKey] = undefined; continue; }

          const edgesField = findField(field.selectionSet, "edges");
          const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;
          const pageInfoField = findField(field.selectionSet, "pageInfo");

          const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

          const edges = Array.isArray(page.edges) ? page.edges.map((ref: any) => {
            const edgeRec = graph.getRecord(ref?.__ref || "");
            if (!edgeRec) return null;
            const e: any = {};
            if (wantCursor) e.cursor = edgeRec.cursor;
            if (nodeField && edgeRec.node?.__ref) {
              const nodeProxy = graph.materializeRecord(edgeRec.node.__ref);
              e.node = nodeProxy ? wrapEntityProxy(nodeProxy) : undefined;
            }
            return e;
          }).filter(Boolean) : [];

          const connOut: any = { __typename: page.__typename };
          if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...page.pageInfo };
          if (edgesField) connOut.edges = edges;

          out[field.responseKey] = connOut;
          continue;
        }

        const linkKey = buildFieldKey(field, variables);
        const value = proxy[linkKey] ?? proxy[field.responseKey] ?? proxy[field.fieldName];

        if (value?.__ref) {
          out[field.responseKey] = readEntityReactive(value.__ref, field.selectionSet || null);
        } else if (Array.isArray(value)) {
          out[field.responseKey] = wrapArrayValue(value);
        } else if (isObject(value)) {
          out[field.responseKey] = { ...value };
        } else {
          out[field.responseKey] = value;
        }
      }

      return out;
    };

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        const page = graph.getRecord(pageKey);
        if (!page) { result[field.responseKey] = undefined; continue; }

        const edgesField = findField(field.selectionSet, "edges");
        const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;
        const pageInfoField = findField(field.selectionSet, "pageInfo");

        const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

        const edges = Array.isArray(page.edges) ? page.edges.map((ref: any) => {
          const edgeRec = graph.getRecord(ref?.__ref || "");
          if (!edgeRec) return null;
          const e: any = {};
          if (wantCursor) e.cursor = edgeRec.cursor;
          if (nodeField && edgeRec.node?.__ref) {
            const nodeProxy = graph.materializeRecord(edgeRec.node.__ref);
            e.node = nodeProxy ? wrapEntityProxy(nodeProxy) : undefined;
          }
          return e;
        }).filter(Boolean) : [];

        const connOut: any = { __typename: page.__typename };
        if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...page.pageInfo };
        if (edgesField) connOut.edges = edges;

        result[field.responseKey] = connOut;
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = rootSnap[linkKey];

      if (link?.__ref) {
        result[field.responseKey] = readEntityReactive(link.__ref, field.selectionSet || null);
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
