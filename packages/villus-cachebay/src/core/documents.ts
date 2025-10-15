import { ROOT_ID } from "./constants";
import {
  isObject,
  hasTypename,
  traverseFast,
  buildFieldKey,
  buildConnectionKey,
  buildConnectionCanonicalKey,
  TRAVERSE_SKIP,
  TRAVERSE_OBJECT,
  TRAVERSE_ARRAY,
  TRAVERSE_SCALAR,
} from "./utils";
import type { CachePlan, PlanField } from "../compiler";
import type { CanonicalInstance } from "./canonical";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentNode } from "graphql";

export type DocumentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  canonical: CanonicalInstance;
};

type Frame = {
  parentId: string;
  fields: PlanField[] | undefined | null;
  fieldsMap: Map<string, PlanField> | undefined | null;
  insideConnection: boolean;
  pageKey: string | null;
  inEdges: boolean;
};

type ConnectionPage = {
  field: PlanField;
  parentId: string;
  pageKey: string;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, planner, canonical } = deps;

  /**
    * Normalizes a GraphQL response into the graph store.
    * Updates canonical connection pages for queries.
    */
  const normalizeDocument = ({
    document,
    variables = {},
    data,
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    data: any;
  }): void => {
    const plan = planner.getPlan(document);
    const isQuery = plan.operation === "query";

    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    const connectionPages: ConnectionPage[] = [];

    const initialFrame: Frame = {
      parentId: ROOT_ID,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(),
      insideConnection: false,
      pageKey: null,
      inEdges: false,
    };

    const visit = (
      _parentNode: any,
      valueNode: any,
      responseKey: string | number | null,
      kind: symbol,
      frame?: Frame,
    ) => {
      if (!frame) return;
      if (responseKey == null) return frame;

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const planField = typeof responseKey === "string" && fieldsMap ? fieldsMap.get(responseKey) : undefined;

      /* ====== ARRAYS ====== */
      if (kind === TRAVERSE_ARRAY) {
        // Connection edges special-case
        if (frame.insideConnection && responseKey === "edges") {
          const pageKey = frame.pageKey as string;
          const rawEdges: any[] = Array.isArray(valueNode) ? valueNode : [];
          const edgeRefs: string[] = new Array(rawEdges.length);
          for (let i = 0; i < rawEdges.length; i++) {
            edgeRefs[i] = `${pageKey}.edges.${i}`;
          }
          graph.putRecord(pageKey, { edges: { __refs: edgeRefs } });

          const edgesField = fieldsMap?.get("edges");
          return {
            parentId: frame.parentId,
            fields: edgesField?.selectionSet,
            fieldsMap: edgesField?.selectionMap,
            insideConnection: true,
            pageKey,
            inEdges: true,
          } as Frame;
        }

        // Plain arrays (no selection) -> store raw array as-is
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
          const out = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) out[i] = arr[i];
          graph.putRecord(parentId, { [fieldKey]: out });
          return TRAVERSE_SKIP;
        }

        // Arrays of OBJECTS with a selection (e.g., post.tags)
        if (planField && planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = Array.isArray(valueNode) ? (valueNode as any[]) : [];
          const baseKey = `${parentId}.${fieldKey}`;

          // Build refs and pre-create item records
          const refs: string[] = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            const entKey = isObject(item) ? graph.identify(item) : null;
            const itemKey = entKey ?? `${baseKey}.${i}`;

            // Ensure the record exists (with typename if provided)
            if (isObject(item)) {
              if ((item as any).__typename) {
                graph.putRecord(itemKey, { __typename: (item as any).__typename });
              } else {
                graph.putRecord(itemKey, {});
              }
            }

            refs[i] = itemKey;
          }

          // Link parent -> array via __refs
          graph.putRecord(parentId, { [fieldKey]: { __refs: refs } });

          // Tell traversal we're entering array items; reuse pageKey to carry baseKey
          return {
            parentId,                                // parent stays same; items handled in next TRAVERSE_OBJECT
            fields: planField.selectionSet,          // the item's selection
            fieldsMap: planField.selectionMap,
            insideConnection: false,
            pageKey: baseKey,                        // used to derive inline container keys
            inEdges: true,                           // "edge-like" iteration over array indices
          } as Frame;
        }

        // Nothing special to do; keep current frame
        return frame;
      }

      /* ====== OBJECTS ====== */
      if (kind === TRAVERSE_OBJECT) {
        // Plain object field with no selection → store inline value
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          graph.putRecord(parentId, { [fieldKey]: valueNode });
          return TRAVERSE_SKIP;
        }

        // Array item objects (generic arrays of objects, not connections)
        if (!frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          // Compute the per-item storage key:
          // - entity objects use their identified id
          // - inline containers use "<parent>.<fieldKey>.<index>"
          const item = valueNode as any;
          const entKey = isObject(item) ? graph.identify(item) : null;

          // frame.pageKey holds "<parentId>.<fieldKey>" from the array branch
          const itemKey = entKey ?? `${frame.pageKey}.${responseKey}`;

          // Ensure record exists; set typename if present
          if (isObject(item)) {
            if (item.__typename) {
              graph.putRecord(itemKey, { __typename: item.__typename });
            } else {
              graph.putRecord(itemKey, {});
            }
          }

          // Dive into the item using the array's item selection
          return {
            parentId: itemKey,
            fields: frame.fields,       // selection for array items
            fieldsMap: frame.fieldsMap,
            insideConnection: false,
            pageKey: frame.pageKey,
            inEdges: false,
          } as Frame;
        }

        // Connection edge objects (edges[i])
        if (frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const edgeKey = `${frame.pageKey}.edges.${responseKey}`;

          if (valueNode && (valueNode as any).__typename) {
            graph.putRecord(edgeKey, { __typename: (valueNode as any).__typename });
          } else {
            graph.putRecord(edgeKey, {});
          }

          const nodeObj = (valueNode as any).node;
          if (nodeObj) {
            const nodeKey = graph.identify(nodeObj);
            if (nodeKey) {
              graph.putRecord(edgeKey, { node: { __ref: nodeKey } });
            }
          }

          return {
            parentId: edgeKey,
            fields: fieldsMap,
            fieldsMap: fieldsMap,
            insideConnection: true,
            pageKey: frame.pageKey,
            inEdges: true,
          } as Frame;
        }

        // Connection container
        if (planField && planField.isConnection) {
          const pageKey = buildConnectionKey(planField, parentId, variables);
          const parentFieldKey = buildFieldKey(planField, variables);

          const pageRecord: Record<string, any> = {};
          if (valueNode && (valueNode as any).__typename) {
            pageRecord.__typename = (valueNode as any).__typename;
          }

          if (valueNode) {
            const keys = Object.keys(valueNode);
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k === "__typename" || k === "edges" || k === "pageInfo") continue;

              const v = (valueNode as any)[k];

              if (v !== undefined && v !== null && typeof v !== "object") {
                pageRecord[k] = v;
              } else if (Array.isArray(v) || (v !== null && typeof v === "object" && !(v && (v as any).__typename))) {
                pageRecord[k] = v;
              }
            }
          }

          graph.putRecord(pageKey, pageRecord);

          if ((valueNode as any)?.pageInfo) {
            const pageInfoKey = `${pageKey}.pageInfo`;
            graph.putRecord(pageKey, { pageInfo: { __ref: pageInfoKey } });

            const piTypename = (valueNode as any)?.pageInfo?.__typename;
            graph.putRecord(pageInfoKey, piTypename ? { __typename: piTypename } : {});
          }

          if (isQuery) {
            graph.putRecord(parentId, { [parentFieldKey]: { __ref: pageKey } });
          }

          if (isQuery) {
            connectionPages.push({ field: planField, parentId, pageKey });
          }

          return {
            parentId: pageKey,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: true,
            pageKey,
            inEdges: false,
          } as Frame;
        }

        // Entity object
        {
          const entityKey = graph.identify(valueNode);
          if (entityKey) {
            if (valueNode && (valueNode as any).__typename) {
              graph.putRecord(entityKey, { __typename: (valueNode as any).__typename });
            } else {
              graph.putRecord(entityKey, {});
            }

            if (isQuery && planField && !(frame.insideConnection && planField.responseKey === "node")) {
              const parentFieldKey = buildFieldKey(planField, variables);
              graph.putRecord(parentId, { [parentFieldKey]: { __ref: entityKey } });
            }

            const fromNode = !!planField && planField.responseKey === "node";

            return {
              parentId: entityKey,
              fields: planField?.selectionSet,
              fieldsMap: planField?.selectionMap,
              insideConnection: fromNode ? false : frame.insideConnection,
              pageKey: fromNode ? null : frame.pageKey,
              inEdges: fromNode ? false : frame.inEdges,
            } as Frame;
          }
        }

        // Inline container object
        if (planField) {
          const containerFieldKey = buildFieldKey(planField, variables);
          const containerKey = `${parentId}.${containerFieldKey}`;

          if (valueNode && (valueNode as any).__typename) {
            graph.putRecord(containerKey, { __typename: (valueNode as any).__typename });
          } else {
            graph.putRecord(containerKey, {});
          }

          if (isQuery) {
            graph.putRecord(parentId, { [containerFieldKey]: { __ref: containerKey } });
          }

          if (frame.insideConnection && containerFieldKey === "pageInfo" && frame.pageKey) {
            graph.putRecord(frame.pageKey, { pageInfo: { __ref: containerKey } });
          }

          return {
            parentId: containerKey,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: frame.insideConnection,
            pageKey: frame.pageKey,
            inEdges: false,
          } as Frame;
        }

        return frame;
      }

      /* ====== SCALARS ====== */
      if (kind === TRAVERSE_SCALAR) {
        if (typeof responseKey === "string" && fieldsMap) {
          const f = fieldsMap.get(responseKey);
          if (f && !f.selectionSet) {
            const fieldKey = buildFieldKey(f, variables);
            graph.putRecord(frame.parentId, { [fieldKey]: valueNode });
          }
        }
        return frame;
      }

      return frame;
    };

    traverseFast(data, initialFrame, visit);

    // Update canonical connections (queries only)
    if (isQuery && connectionPages.length > 0) {
      for (let i = 0; i < connectionPages.length; i++) {
        const { field, parentId, pageKey } = connectionPages[i];
        const pageRecord = graph.getRecord(pageKey);
        if (!pageRecord) continue;

        canonical.updateConnection({
          field,
          parentId,
          variables,
          pageKey,
          normalizedPage: pageRecord,
        });
      }
    }
  };

  /* MATERIALIZE DOCUMENT START */


  type MaterializeArgs = {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  };

  // Tiny LRU for document results
  class LRU<K, V> {
    constructor(private cap = 64) { }
    private m = new Map<K, V>();
    get(k: K): V | undefined {
      const v = this.m.get(k);
      if (v !== undefined) {
        this.m.delete(k);
        this.m.set(k, v);
      }
      return v;
    }
    set(k: K, v: V): void {
      if (this.m.has(k)) this.m.delete(k);
      this.m.set(k, v);
      if (this.m.size > this.cap) {
        const oldest = this.m.keys().next().value as K;
        this.m.delete(oldest);
      }
    }
    delete(k: K) { this.m.delete(k); }
    clear() { this.m.clear(); }
  }

  // Stable stringify for variables → cache key
  const stableStringify = (v: any): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  };

  // Build a compact stamp for a normalized record
  const stampOfRecord = (rec: any): string => {
    if (!rec || typeof rec !== "object") return String(rec);
    const keys = Object.keys(rec).sort();
    let s = "";
    for (const k of keys) {
      const v = (rec as any)[k];
      if (v === undefined) { s += `|${k}:u`; continue; }
      if (v === null) { s += `|${k}:n`; continue; }
      if (typeof v === "object") {
        if ((v as any).__ref) s += `|${k}:r:${(v as any).__ref}`;
        else if (Array.isArray((v as any).__refs)) s += `|${k}:rs:${(v as any).__refs.join(",")}`;
        else if (Array.isArray(v)) s += `|${k}:a:${v.length}`;
        else s += `|${k}:o:${Object.keys(v).length}`;
      } else {
        s += `|${k}:p:${String(v)}`;
      }
    }
    return s;
  };

  type MaterializeResult = { data?: any; status: "FULFILLED" | "MISSING" };
  type CacheEntry = { data: any; stamp: string };

  // Per-plan LRU (bound by plan identity, then variables)
  const lruByPlan = new WeakMap<CachePlan, LRU<string, CacheEntry>>();
  const getLRU = (plan: CachePlan) => {
    let lru = lruByPlan.get(plan);
    if (!lru) {
      lru = new LRU<string, CacheEntry>(64);
      lruByPlan.set(plan, lru);
    }
    return lru;
  };

  // ---------- Iterative materializer (no recursion) ----------

  type Task =
    | { t: "ROOT_FIELD"; parentId: string; field: PlanField; out: any; outKey: string }
    | { t: "ENTITY"; id: string; field: PlanField; out: any }
    | { t: "CONNECTION"; parentId: string; field: PlanField; out: any; outKey: string }
    | { t: "PAGE_INFO"; id: string; field: PlanField; out: any } // field is the pageInfo PlanField
    | { t: "EDGE"; id: string; field: PlanField; outArr: any[] }; // field is the edges PlanField

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }): MaterializeResult => {
    const plan = planner.getPlan(document);
    const lru = getLRU(plan);
    const vkey = stableStringify(variables);

    const deps = new Set<string>();
    const touch = (id?: string | null) => { if (id) deps.add(id); };

    type Task =
      | { t: "ROOT_FIELD"; parentId: string; field: PlanField; out: any; outKey: string }
      | { t: "ENTITY"; id: string; field: PlanField; out: any }
      | { t: "CONNECTION"; parentId: string; field: PlanField; out: any; outKey: string }
      | { t: "PAGE_INFO"; id: string; field: PlanField; out: any }
      | { t: "EDGE"; id: string; idx: number; field: PlanField; outArr: any[] };

    const data: Record<string, any> = {};
    let allOk = true;

    const root = graph.getRecord(ROOT_ID) || {};
    touch(ROOT_ID);

    const tasks: Task[] = [];
    for (let i = plan.root.length - 1; i >= 0; i--) {
      const f = plan.root[i];
      tasks.push({ t: "ROOT_FIELD", parentId: ROOT_ID, field: f, out: data, outKey: f.responseKey });
    }

    // eslint-disable-next-line no-console
    console.log("[docs] materialize:start", { op: plan.operation, rootFields: plan.root.map(f => f.responseKey) });

    const isConnectionField = (f: PlanField): boolean => {
      const selMap = (f as any).selectionMap as Map<string, PlanField> | undefined;
      const looksLikeConn = !!selMap?.get?.("edges") || !!selMap?.get?.("pageInfo");
      return Boolean((f as any).isConnection || (f as any).connectionKey || looksLikeConn);
    };

    while (tasks.length) {
      const task = tasks.pop() as Task;

      if (task.t === "ROOT_FIELD") {
        const { parentId, field, out, outKey } = task;

        const treatAsConn = isConnectionField(field);
        // eslint-disable-next-line no-console
        console.log("[docs] root-field", { field: field.responseKey, treatAsConn });

        if (treatAsConn) {
          tasks.push({ t: "CONNECTION", parentId, field, out, outKey });
          continue;
        }

        if (field.selectionSet && field.selectionSet.length) {
          const snap = graph.getRecord(parentId) || {};
          const link = (snap as any)[buildFieldKey(field, variables)];
          if (!link || !link.__ref) {
            out[outKey] = link === null ? null : undefined;
            allOk = false;
            // eslint-disable-next-line no-console
            console.log("[docs] missing root link", { field: field.responseKey, parentId, link });
            continue;
          }
          const childId = link.__ref as string;
          const childOut: any = {};
          out[outKey] = childOut;
          tasks.push({ t: "ENTITY", id: childId, field, out: childOut });
          continue;
        }

        // scalar at root
        if (field.fieldName === "__typename") {
          out[outKey] = (root as any).__typename;
        } else {
          const sk = buildFieldKey(field, variables);
          out[outKey] = (root as any)[sk]; // undefined allowed
        }
        continue;
      }

      if (task.t === "ENTITY") {
        const { id, field, out } = task;
        const rec = graph.getRecord(id);
        touch(id);

        // eslint-disable-next-line no-console
        console.log("[docs] entity", { id, field: field.responseKey, treatAsConnNext: (field.selectionMap as any)?.get?.("posts") && isConnectionField((field.selectionMap as any)?.get?.("posts")) });

        if (!rec) {
          allOk = false;
          // eslint-disable-next-line no-console
          console.log("[docs] entity record MISSING", { id, field: field.responseKey });
        }

        const snap = rec || {};

        if ((snap as any).__typename !== undefined) {
          out.__typename = (snap as any).__typename;
        }

        const sel = field.selectionSet || [];
        for (let i = sel.length - 1; i >= 0; i--) {
          const f = sel[i];

          const treatAsConn = isConnectionField(f);
          if (treatAsConn) {
            tasks.push({ t: "CONNECTION", parentId: id, field: f, out, outKey: f.responseKey });
            continue;
          }

          if (f.selectionSet && f.selectionSet.length) {
            const link = (snap as any)[buildFieldKey(f, variables)];

            // NEW: array-of-refs (e.g., tags: { __refs: [...] })
            if (link && typeof link === "object" && Array.isArray(link.__refs)) {
              const refs: string[] = link.__refs.slice();
              const arrOut: any[] = new Array(refs.length);
              out[f.responseKey] = arrOut;

              for (let j = refs.length - 1; j >= 0; j--) {
                const childOut: any = {};
                arrOut[j] = childOut;
                tasks.push({ t: "ENTITY", id: refs[j], field: f, out: childOut });
              }
              continue;
            }

            // Fallback: single ref or missing
            if (!link || !link.__ref) {
              out[f.responseKey] = link === null ? null : undefined;
              allOk = false;
              // eslint-disable-next-line no-console
              console.log("[docs] missing nested link", { parentId: id, field: f.responseKey, link });
              continue;
            }

            const childId = link.__ref as string;
            const childOut: any = {};
            out[f.responseKey] = childOut;
            tasks.push({ t: "ENTITY", id: childId, field: f, out: childOut });
            continue;
          }

          // scalar
          if (f.fieldName === "__typename") {
            out[f.responseKey] = (snap as any).__typename;
          } else {
            const sk = buildFieldKey(f, variables);
            out[f.responseKey] = (snap as any)[sk]; // undefined allowed
          }
        }

        continue;
      }

      if (task.t === "CONNECTION") {
        const { parentId, field, out, outKey } = task;
        const pageKey = buildConnectionCanonicalKey(field, parentId, variables);
        touch(pageKey);
        const page = graph.getRecord(pageKey);

        // eslint-disable-next-line no-console
        console.log("[docs] connection", { parentId, field: field.responseKey, pageKey, hasPage: !!page });

        const conn: any = { edges: [], pageInfo: {} };
        out[outKey] = conn;

        if (!page) {
          allOk = false;
          // eslint-disable-next-line no-console
          console.log("[docs] missing connection page", { parentId, field: field.responseKey, pageKey });
          continue;
        }

        const selMap = (field as any).selectionMap as Map<string, PlanField> | undefined;
        const edgesPlan = selMap?.get("edges");
        const pageInfoPlan = selMap?.get("pageInfo");

        // connection-level scalars
        if (selMap) {
          for (const [rk, pf] of selMap) {
            if (rk === "edges" || rk === "pageInfo") continue;
            if (pf.fieldName === "__typename") {
              conn[pf.responseKey] = (page as any).__typename;
              continue;
            }
            if (!pf.selectionSet) {
              const sk = buildFieldKey(pf, variables);
              conn[pf.responseKey] = (page as any)[sk];
            }
          }
        }

        // pageInfo
        if (pageInfoPlan) {
          const piLink = (page as any).pageInfo;
          if (piLink && piLink.__ref) {
            tasks.push({ t: "PAGE_INFO", id: piLink.__ref as string, field: pageInfoPlan, out: conn });
          } else {
            conn.pageInfo = {};
          }
        }

        // edges
        const edgesRaw = (page as any).edges;
        let refs: string[] = [];
        if (edgesRaw && typeof edgesRaw === "object" && Array.isArray(edgesRaw.__refs)) {
          refs = edgesRaw.__refs.slice();
        } else if (Array.isArray(edgesRaw)) {
          refs = edgesRaw.map((_: any, i: number) => `${pageKey}.edges.${i}`);
        }

        const arr: any[] = new Array(refs.length);
        conn.edges = arr;

        if (edgesPlan) {
          for (let i = refs.length - 1; i >= 0; i--) {
            const eid = refs[i];
            tasks.push({ t: "EDGE", id: eid, idx: i, field: edgesPlan, outArr: arr });
          }
        }

        continue;
      }

      if (task.t === "PAGE_INFO") {
        const { id, field, out } = task;
        touch(id);
        const pi = graph.getRecord(id) || {};
        const piOut: any = {};
        const sel = field.selectionSet || [];

        for (let i = 0; i < sel.length; i++) {
          const pf = sel[i];
          if (pf.selectionSet) continue;
          if (pf.fieldName === "__typename") {
            piOut[pf.responseKey] = (pi as any).__typename;
            continue;
          }
          const sk = buildFieldKey(pf, variables);
          piOut[pf.responseKey] = (pi as any)[sk];
        }

        out.pageInfo = piOut;
        continue;
      }

      if (task.t === "EDGE") {
        const { id, idx, field, outArr } = task;
        touch(id);
        const edge = graph.getRecord(id) || {};
        const edgeOut: any = {};
        outArr[idx] = edgeOut;

        // ✅ Always include __typename for edges if present (even if not explicitly selected)
        if ((edge as any).__typename !== undefined) {
          edgeOut.__typename = (edge as any).__typename;
        }

        const sel = field.selectionSet || [];
        const nodePlan = field.selectionMap?.get("node");

        for (let i = 0; i < sel.length; i++) {
          const pf = sel[i];
          const rk = pf.responseKey;

          if (rk === "node") {
            const nlink = (edge as any).node;
            if (!nlink || !nlink.__ref) {
              edgeOut.node = nlink === null ? null : undefined;
              allOk = false;
              console.log("[docs] missing edge.node link", { edgeId: id });
            } else {
              const nid = nlink.__ref as string;
              const nOut: any = {};
              edgeOut.node = nOut;
              tasks.push({ t: "ENTITY", id: nid, field: nodePlan as PlanField, out: nOut });
            }
          } else if (!pf.selectionSet) {
            if (pf.fieldName === "__typename") {
              // (still handle explicit __typename selections too)
              edgeOut[rk] = (edge as any).__typename;
              continue;
            }
            const sk = buildFieldKey(pf, variables);
            edgeOut[rk] = (edge as any)[sk];
          }
        }

        continue;
      }
    }

    // eslint-disable-next-line no-console
    console.log("[docs] materialize:status", allOk ? "FULFILLED" : "MISSING");

    if (!allOk) {
      return { status: "MISSING", data: undefined };
    }

    const ids = Array.from(deps).sort();
    let stamp = "";
    for (const id of ids) {
      const rec = graph.getRecord(id) || {};
      stamp += id + ":" + stampOfRecord(rec) + ";";
    }

    const cached = lru.get(vkey);
    if (cached && cached.stamp === stamp) {
      return { data: cached.data, status: "FULFILLED" };
    }

    lru.set(vkey, { data, stamp });
    return { data, status: "FULFILLED" };
  };
  /* MATERIALIZE DOCUMENT END */

  return {
    normalizeDocument,
    materializeDocument,
  };
};
