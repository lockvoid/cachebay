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
  // materializeDocument — reactive, exact page; ONE per-instance view cache
  // ───────────────────────────────────────────────────────────────────────────

  const viewCache = new WeakMap<object, any>();

  // Current call's variables (helpers read from here)
  const variablesRef: { current: Record<string, any> } = { current: {} };

  // Selection-aware entity view (memoized per (entityProxy, selection))
  const getEntityView = (entityProxy: any, fields: PlanField[] | null): any => {
    if (!entityProxy || typeof entityProxy !== "object") return entityProxy;

    let bucket = viewCache.get(entityProxy);
    if (!bucket || bucket.kind !== "entity") {
      bucket = { kind: "entity", bySelection: new Map<PlanField[] | null, any>() };
      viewCache.set(entityProxy, bucket);
    } else {
      const hit = bucket.bySelection.get(fields || null);
      if (hit) return hit;
    }

    const view = new Proxy(entityProxy, {
      get(target, prop, receiver) {
        const field = fields && typeof prop === "string" ? findField(fields, prop) : undefined;

        // lazily materialize connection fields
        if (field?.isConnection) {
          const parentId = graph.identify(target);
          const pageKey = buildConnectionKey(field, parentId, variablesRef.current);
          return getConnectionView(pageKey, field);
        }

        const value = Reflect.get(target, prop, receiver);

        // deref { __ref } → entity view
        if (value && typeof value === "object" && (value as any).__ref) {
          const childProxy = graph.materializeRecord((value as any).__ref);
          const sub = fields && typeof prop === "string" ? findField(fields, prop) : undefined;
          const subFields = sub ? sub.selectionSet || null : null;
          return childProxy ? getEntityView(childProxy, subFields) : undefined;
        }

        // arrays (map refs if we know a sub-selection)
        if (Array.isArray(value)) {
          const sub = fields && typeof prop === "string" ? findField(fields, prop) : undefined;
          if (!sub?.selectionSet || sub.selectionSet.length === 0) {
            return value.slice();
          }
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, sub.selectionSet || null) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has(target, prop) { return Reflect.has(target, prop); },
      ownKeys(target) { return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
      set() { return false; },
    });

    bucket.bySelection.set(fields || null, view);
    return view;
  };

  // Edge view (memoized by edge record proxy)
  const getEdgeView = (edgeKey: string, nodeField: PlanField | undefined): any => {
    const edgeProxy = graph.materializeRecord(edgeKey);
    if (!edgeProxy) return undefined;

    let bucket = viewCache.get(edgeProxy);
    if (bucket?.kind === "edge" && bucket.view) return bucket.view;

    const view = new Proxy(edgeProxy, {
      get(target, prop, receiver) {
        if (prop === "node" && (target as any).node?.__ref) {
          const nodeProxy = graph.materializeRecord((target as any).node.__ref);
          return nodeProxy ? getEntityView(nodeProxy, nodeField?.selectionSet || null) : undefined;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has(target, prop) { return Reflect.has(target, prop); },
      ownKeys(target) { return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
      set() { return false; },
    });

    if (!bucket || bucket.kind !== "edge") {
      bucket = { kind: "edge", view };
      viewCache.set(edgeProxy, bucket);
    } else {
      bucket.view = view;
    }

    return view;
  };

  // Connection (page) view (memoized) + stable edges array per page
  const getConnectionView = (pageKey: string, field: PlanField): any => {
    const pageProxy = graph.materializeRecord(pageKey);
    if (!pageProxy) return undefined;

    let bucket = viewCache.get(pageProxy);
    if (bucket?.kind === "page" && bucket.view) return bucket.view;

    const edgesField = findField(field.selectionSet, "edges");
    const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;

    const view = new Proxy(pageProxy, {
      get(target, prop, receiver) {
        if (prop === "edges") {
          const list = (target as any).edges;
          if (!Array.isArray(list)) return list;

          const refs = list.map((r: any) => (r && r.__ref) || "");
          const cached = bucket?.edgesCache;
          if (
            cached &&
            cached.refs.length === refs.length &&
            cached.refs.every((v: string, i: number) => v === refs[i])
          ) {
            return cached.array;
          }

          const arr = new Array(refs.length);
          for (let i = 0; i < refs.length; i++) {
            const ek = refs[i];
            arr[i] = ek ? getEdgeView(ek, nodeField) : undefined;
          }

          if (!bucket || bucket.kind !== "page") {
            bucket = { kind: "page", view, edgesCache: { refs, array: arr } };
            viewCache.set(pageProxy, bucket);
          } else {
            bucket.view = view;
            bucket.edgesCache = { refs, array: arr };
          }

          return arr;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has(target, prop) { return Reflect.has(target, prop); },
      ownKeys(target) { return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
      set() { return false; },
    });

    if (!bucket || bucket.kind !== "page") {
      bucket = { kind: "page", view, edgesCache: { refs: [], array: [] } };
      viewCache.set(pageProxy, bucket);
    } else {
      bucket.view = view;
    }

    return view;
  };

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    // make this call's variables available to the helpers
    variablesRef.current = variables;

    const plan = getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        result[field.responseKey] = getConnectionView(pageKey, field);
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = rootSnap[linkKey];

      if (!link?.__ref) {
        result[field.responseKey] = undefined;
        continue;
      }

      const entityProxy = graph.materializeRecord(link.__ref);
      if (!entityProxy) {
        result[field.responseKey] = undefined;
        continue;
      }

      if (!field.selectionSet || field.selectionSet.length === 0) {
        result[field.responseKey] = getEntityView(entityProxy, null);
        continue;
      }

      // selected shell whose properties are read via entity view (nested connections remain reactive)
      const entityView = getEntityView(entityProxy, field.selectionSet);
      const shell: Record<string, any> = {
        __typename: entityView.__typename,
        id: entityView.id,
      };
      for (let j = 0; j < field.selectionSet.length; j++) {
        const sf = field.selectionSet[j];
        shell[sf.responseKey] = (entityView as any)[sf.responseKey];
      }
      result[field.responseKey] = shell;
    }

    return result;
  };

  return {
    normalizeDocument,
    materializeDocument,
  };
};
