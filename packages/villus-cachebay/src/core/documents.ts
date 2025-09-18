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

          // Selection helpers for this connection branch
          const edgesField = findField(field.selectionSet, "edges");
          const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;
          const pageInfoField = findField(field.selectionSet, "pageInfo");

          // Conn-level scalar leaves (e.g., totalCount)
          const connExtras: string[] = [];
          if (field.selectionSet) {
            for (let j = 0; j < field.selectionSet.length; j++) {
              const f = field.selectionSet[j];
              if (f.responseKey === "edges" || f.responseKey === "pageInfo") continue;
              if (!f.selectionSet || f.selectionSet.length === 0) connExtras.push(f.responseKey);
            }
          }

          // Edge-level scalar leaves (e.g., score) & whether __typename was requested
          const edgeExtras: string[] = [];
          const wantEdgeTypename = !!(edgesField && findField(edgesField.selectionSet, "__typename"));
          const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

          if (edgesField?.selectionSet) {
            for (let j = 0; j < edgesField.selectionSet.length; j++) {
              const ef = edgesField.selectionSet[j];
              if (ef.responseKey === "node" || ef.responseKey === "__typename" || ef.responseKey === "cursor") continue;
              if (!ef.selectionSet || ef.selectionSet.length === 0) edgeExtras.push(ef.responseKey);
            }
          }

          // Build edges array
          const edges = Array.isArray(page.edges)
            ? page.edges.map((ref: any) => {
              const edgeRec = graph.getRecord(ref?.__ref || "");
              if (!edgeRec) return null;

              const e: Record<string, any> = {};
              if (wantEdgeTypename && edgeRec.__typename) e.__typename = edgeRec.__typename;
              if (wantCursor) e.cursor = edgeRec.cursor;

              // selected extras (e.g., score)
              for (let k = 0; k < edgeExtras.length; k++) {
                const name = edgeExtras[k];
                if (name in edgeRec) e[name] = edgeRec[name];
              }

              // node
              if (nodeField && edgeRec.node?.__ref) {
                e.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null);
              } else if (nodeField) {
                e.node = undefined;
              }
              return e;
            }).filter(Boolean)
            : [];

          // Build connection object
          const connOut: Record<string, any> = { __typename: page.__typename };
          // selected conn-level extras (e.g., totalCount)
          for (let k = 0; k < connExtras.length; k++) {
            const name = connExtras[k];
            if (name in page) connOut[name] = page[name];
          }
          if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...(page.pageInfo as any) };
          if (edgesField) connOut.edges = edges;

          out[field.responseKey] = connOut;
          continue;
        }

        // Non-connection field
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

        const connExtras: string[] = [];
        if (field.selectionSet) {
          for (let j = 0; j < field.selectionSet.length; j++) {
            const f = field.selectionSet[j];
            if (f.responseKey === "edges" || f.responseKey === "pageInfo") continue;
            if (!f.selectionSet || f.selectionSet.length === 0) connExtras.push(f.responseKey);
          }
        }

        const edgeExtras: string[] = [];
        const wantEdgeTypename = !!(edgesField && findField(edgesField.selectionSet, "__typename"));
        const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));

        if (edgesField?.selectionSet) {
          for (let j = 0; j < edgesField.selectionSet.length; j++) {
            const ef = edgesField.selectionSet[j];
            if (ef.responseKey === "node" || ef.responseKey === "__typename" || ef.responseKey === "cursor") continue;
            if (!ef.selectionSet || ef.selectionSet.length === 0) edgeExtras.push(ef.responseKey);
          }
        }

        const edges = Array.isArray(page.edges)
          ? page.edges.map((ref: any) => {
            const edgeRec = graph.getRecord(ref?.__ref || "");
            if (!edgeRec) return null;

            const e: Record<string, any> = {};
            if (wantEdgeTypename && edgeRec.__typename) e.__typename = edgeRec.__typename;
            if (wantCursor) e.cursor = edgeRec.cursor;
            for (let k = 0; k < edgeExtras.length; k++) {
              const name = edgeExtras[k];
              if (name in edgeRec) e[name] = edgeRec[name];
            }
            if (nodeField && edgeRec.node?.__ref) {
              e.node = readEntityPlain(edgeRec.node.__ref, nodeField.selectionSet || null);
            } else if (nodeField) {
              e.node = undefined;
            }
            return e;
          }).filter(Boolean)
          : [];

        const connOut: Record<string, any> = { __typename: page.__typename };
        for (let k = 0; k < connExtras.length; k++) {
          const name = connExtras[k];
          if (name in page) connOut[name] = page[name];
        }
        if (pageInfoField && page.pageInfo) connOut.pageInfo = { ...(page.pageInfo as any) };
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

    // unified, per-call caches
    const viewCache = new WeakMap<object, any>();
    const entityViewByFields = new WeakMap<object, Map<PlanField[] | null, any>>();

    // Build connection container (plain) from a page snapshot, guided by selection
    const buildConnectionContainer = (
      parentId: string,
      field: PlanField,               // the connection field plan
      nodeField: PlanField | undefined, // edges.node field plan (if selected)
      page: any,                      // page snapshot from graph
      edgesField: PlanField | undefined // edges field plan (if selected)
    ) => {
      // Which conn-level extras (leaf scalars) were selected? (e.g., totalCount)
      const connExtras: string[] = [];
      if (field.selectionSet) {
        for (let j = 0; j < field.selectionSet.length; j++) {
          const f = field.selectionSet[j];
          if (f.responseKey === "edges" || f.responseKey === "pageInfo") continue;
          if (!f.selectionSet || f.selectionSet.length === 0) connExtras.push(f.responseKey);
        }
      }

      // Which edge-level extras were selected? (e.g., score)
      const edgeExtras: string[] = [];
      const wantCursor = !!(edgesField && findField(edgesField.selectionSet, "cursor"));
      if (edgesField?.selectionSet) {
        for (let j = 0; j < edgesField.selectionSet.length; j++) {
          const ef = edgesField.selectionSet[j];
          if (ef.responseKey === "node" || ef.responseKey === "__typename" || ef.responseKey === "cursor") continue;
          if (!ef.selectionSet || ef.selectionSet.length === 0) edgeExtras.push(ef.responseKey);
        }
      }

      // Build edges (plain objects), but entity nodes are reactive views
      const edges = Array.isArray(page.edges)
        ? page.edges.map((ref: any) => {
          const edgeRec = graph.getRecord(ref?.__ref || "");
          if (!edgeRec) return null;

          const e: Record<string, any> = {};
          if (wantCursor) e.cursor = edgeRec.cursor;

          // copy selected extras (score, etc.)
          for (let k = 0; k < edgeExtras.length; k++) {
            const name = edgeExtras[k];
            if (name in edgeRec) e[name] = edgeRec[name];
          }

          // node: reactive entity view honoring node selection
          if (nodeField && edgeRec.node?.__ref) {
            e.node = createEntityView(edgeRec.node.__ref, nodeField.selectionSet || null);
          } else if (nodeField) {
            e.node = undefined;
          }

          return e;
        }).filter(Boolean)
        : [];

      // Build connection container (plain)
      const pageInfoField = findField(field.selectionSet, "pageInfo");
      const out: Record<string, any> = { __typename: page.__typename };

      // conn-level extras (totalCount, etc.)
      for (let k = 0; k < connExtras.length; k++) {
        const name = connExtras[k];
        if (name in page) out[name] = page[name];
      }

      if (pageInfoField && page.pageInfo) out.pageInfo = { ...(page.pageInfo as any) };
      if (edgesField) out.edges = edges;

      return out;
    };

    // Create a reactive entity view that lazily materializes connection fields from selection
    const createEntityView = (recordId: string, fields: PlanField[] | null): any => {
      const entityProxy = graph.materializeRecord(recordId);
      if (!entityProxy) return undefined;

      // Fast path: if no selection given, wrap raw entity proxy
      if (!fields || fields.length === 0) {
        return wrapEntityProxy(entityProxy);
      }

      // memoize per (entityProxy, fields) pair
      let byFields = entityViewByFields.get(entityProxy);
      if (!byFields) {
        byFields = new Map();
        entityViewByFields.set(entityProxy, byFields);
      }
      const cached = byFields.get(fields);
      if (cached) return cached;

      const view = new Proxy(entityProxy, {
        get(target, prop, receiver) {
          // If the selection includes a connection with this responseKey, materialize it on demand
          const field =
            typeof prop === "string" ? findField(fields, prop as string) : undefined;

          if (field && field.isConnection) {
            const pageKey = buildConnectionKey(field, recordId, variables);
            const page = graph.getRecord(pageKey);
            if (!page) return undefined;

            const edgesField = findField(field.selectionSet, "edges");
            const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;

            return buildConnectionContainer(recordId, field, nodeField, page, edgesField);
          }

          // Otherwise, deref __ref values and arrays as usual
          const value = Reflect.get(target, prop, receiver);

          if (value && typeof value === "object" && (value as any).__ref) {
            // If the selection had a sub-selection for this field, honor it; otherwise plain entity view
            const sub = typeof prop === "string" ? findField(fields, prop as string) : undefined;
            const subFields = sub ? sub.selectionSet || null : null;
            return createEntityView((value as any).__ref, subFields);
          }

          if (Array.isArray(value)) {
            // map array of refs → entity views (or raw values)
            const cachedArr = viewCache.get(value);
            if (cachedArr) return cachedArr;

            const mapped = new Array(value.length);
            for (let i = 0; i < value.length; i++) {
              const item = value[i];
              if (item && item.__ref) {
                mapped[i] = createEntityView(item.__ref, null);
              } else {
                mapped[i] = item;
              }
            }
            viewCache.set(value, mapped);
            return mapped;
          }

          return value;
        },
        has(target, prop) { return Reflect.has(target, prop); },
        ownKeys(target) { return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
        set() { return false; },
      });

      byFields.set(fields, view);
      return view;
    };

    // Fallback entity proxy wrapper (no selection-aware connections)
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
            const cachedArr = viewCache.get(value);
            if (cachedArr) return cachedArr;
            const mapped = new Array(value.length);
            for (let i = 0; i < value.length; i++) {
              const item = value[i];
              if (item && item.__ref) {
                const childProxy = graph.materializeRecord(item.__ref);
                mapped[i] = childProxy ? wrapEntityProxy(childProxy) : undefined;
              } else {
                mapped[i] = item;
              }
            }
            viewCache.set(value, mapped);
            return mapped;
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

    // Build plain connection container at root
    const readConnectionAtRoot = (field: PlanField) => {
      const pageKey = buildConnectionKey(field, ROOT_ID, variables);
      const page = graph.getRecord(pageKey);
      if (!page) return undefined;

      const edgesField = findField(field.selectionSet, "edges");
      const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;

      return buildConnectionContainer(ROOT_ID, field, nodeField, page, edgesField);
    };

    // Build plain entity object at root (usually query root field like user)
    const readEntityAtRoot = (field: PlanField) => {
      const linkKey = buildFieldKey(field, variables);
      const link = rootSnap[linkKey];
      if (!link?.__ref) return undefined;
      // For root entities, return a plain object assembled from selection (not a proxy)
      // but nested entity nodes inside connections will be reactive via createEntityView
      const assemble = (recordId: string, fields: PlanField[] | null): any => {
        const snap = graph.getRecord(recordId);
        if (!snap) return undefined;
        if (!fields) return { __typename: snap.__typename, id: snap.id };

        const out: Record<string, any> = {};
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];

          if (f.isConnection) {
            const pageKey = buildConnectionKey(f, recordId, variables);
            const page = graph.getRecord(pageKey);
            if (!page) { out[f.responseKey] = undefined; continue; }

            const edgesField = findField(f.selectionSet, "edges");
            const nodeField = edgesField ? findField(edgesField.selectionSet, "node") : undefined;

            out[f.responseKey] = buildConnectionContainer(recordId, f, nodeField, page, edgesField);
            continue;
          }

          // non-connection: follow ref if present
          const linkKey = buildFieldKey(f, variables);
          const stored = snap[linkKey] ?? snap[f.responseKey] ?? snap[f.fieldName];
          if (stored?.__ref) {
            // entities under non-connection fields at root: return plain (not reactive)
            out[f.responseKey] = assemble(stored.__ref, f.selectionSet || null);
          } else {
            out[f.responseKey] = stored;
          }
        }
        return out;
      };

      return assemble(link.__ref, field.selectionSet || null);
    };

    // Root
    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        result[field.responseKey] = readConnectionAtRoot(field);
        continue;
      }

      // non-connection root field: entity object assembled (plain)
      result[field.responseKey] = readEntityAtRoot(field);
    }

    return result;
  };

  return {
    normalizeDocument,
    denormalizeDocument,
    materializeDocument,
  };
};
