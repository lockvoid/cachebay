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
   * RETURNS the set of touched ids (records/pages) for targeted re-emits.
   */
  const normalizeDocument = ({
    document,
    variables = {},
    data,
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    data: any;
  }): { touched: Set<string> } => {
    const touched = new Set<string>();
    const put = (id: string, patch: Record<string, any>) => {
      touched.add(id);
      graph.putRecord(id, patch);
    };

    const plan = planner.getPlan(document);
    const isQuery = plan.operation === "query";

    put(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

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
        // Connection edges
        if (frame.insideConnection && responseKey === "edges") {
          const pageKey = frame.pageKey as string;
          const rawEdges: any[] = Array.isArray(valueNode) ? valueNode : [];
          const edgeRefs: string[] = new Array(rawEdges.length);
          for (let i = 0; i < rawEdges.length; i++) {
            edgeRefs[i] = `${pageKey}.edges.${i}`;
          }
          put(pageKey, { edges: { __refs: edgeRefs } });

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

        // Plain array scalar/object values without selection → store raw array
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
          const out = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) out[i] = arr[i];
          put(parentId, { [fieldKey]: out });
          return TRAVERSE_SKIP;
        }

        // Arrays of objects WITH a selection
        if (planField && planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = Array.isArray(valueNode) ? (valueNode as any[]) : [];
          const baseKey = `${parentId}.${fieldKey}`;

          const refs: string[] = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            const entKey = isObject(item) ? graph.identify(item) : null;
            const itemKey = entKey ?? `${baseKey}.${i}`;
            if (isObject(item)) {
              if ((item as any).__typename) put(itemKey, { __typename: (item as any).__typename });
              else put(itemKey, {});
            }
            refs[i] = itemKey;
          }

          put(parentId, { [fieldKey]: { __refs: refs } });

          return {
            parentId,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: false,
            pageKey: baseKey,
            inEdges: true,
          } as Frame;
        }

        return frame;
      }

      /* ====== OBJECTS ====== */
      if (kind === TRAVERSE_OBJECT) {
        // Plain object field with no selection
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          put(parentId, { [fieldKey]: valueNode });
          return TRAVERSE_SKIP;
        }

        // Generic array item objects (not connection edges)
        if (!frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const item = valueNode as any;
          const entKey = isObject(item) ? graph.identify(item) : null;
          const itemKey = entKey ?? `${frame.pageKey}.${responseKey}`;

          if (isObject(item)) {
            if (item.__typename) put(itemKey, { __typename: item.__typename });
            else put(itemKey, {});
          }

          return {
            parentId: itemKey,
            fields: frame.fields,
            fieldsMap: frame.fieldsMap,
            insideConnection: false,
            pageKey: frame.pageKey,
            inEdges: false,
          } as Frame;
        }

        // Connection edges[i]
        if (frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const edgeKey = `${frame.pageKey}.edges.${responseKey}`;

          if (valueNode && (valueNode as any).__typename) put(edgeKey, { __typename: (valueNode as any).__typename });
          else put(edgeKey, {});

          const nodeObj = (valueNode as any).node;
          if (nodeObj) {
            const nodeKey = graph.identify(nodeObj);
            if (nodeKey) put(edgeKey, { node: { __ref: nodeKey } });
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

          put(pageKey, pageRecord);

          if ((valueNode as any)?.pageInfo) {
            const pageInfoKey = `${pageKey}.pageInfo`;
            put(pageKey, { pageInfo: { __ref: pageInfoKey } });
            const piTypename = (valueNode as any)?.pageInfo?.__typename;
            put(pageInfoKey, piTypename ? { __typename: piTypename } : {});
          }

          if (isQuery) {
            put(parentId, { [parentFieldKey]: { __ref: pageKey } });
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
            if (valueNode && (valueNode as any).__typename) put(entityKey, { __typename: (valueNode as any).__typename });
            else put(entityKey, {});

            if (isQuery && planField && !(frame.insideConnection && planField.responseKey === "node")) {
              const parentFieldKey = buildFieldKey(planField, variables);
              put(parentId, { [parentFieldKey]: { __ref: entityKey } });
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

        // Inline container
        if (planField) {
          const containerFieldKey = buildFieldKey(planField, variables);
          const containerKey = `${parentId}.${containerFieldKey}`;

          if (valueNode && (valueNode as any).__typename) put(containerKey, { __typename: (valueNode as any).__typename });
          else put(containerKey, {});

          if (isQuery) {
            put(parentId, { [containerFieldKey]: { __ref: containerKey } });
          }

          if (frame.insideConnection && containerFieldKey === "pageInfo" && frame.pageKey) {
            put(frame.pageKey, { pageInfo: { __ref: containerKey } });
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
            put(frame.parentId, { [fieldKey]: valueNode });
          }
        }
        return frame;
      }

      return frame;
    };

    traverseFast(data, initialFrame, visit);

    // Update canonical connections (queries only) and mark canonical key as touched
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

        const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
        touched.add(canonicalKey);
      }
    }

    return { touched };
  };

  /* MATERIALIZE DOCUMENT START */

  type MaterializeArgs = {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  };

  // bump as needed
  const MATERIALIZE_LRU_CAP = 512;

  class LRU<K, V> {
    constructor(private cap = MATERIALIZE_LRU_CAP) { }
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

  const stableStringify = (v: any): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  };

  type MaterializeResult = { data?: any; status: "FULFILLED" | "MISSING"; deps?: string[] };
  type CacheEntry = { data: any; stamp: string };

  const lruByPlan = new WeakMap<CachePlan, LRU<string, CacheEntry>>();
  const getLRU = (plan: CachePlan) => {
    let lru = lruByPlan.get(plan);
    if (!lru) {
      lru = new LRU<string, CacheEntry>();
      lruByPlan.set(plan, lru);
    }
    return lru;
  };

  type Task =
    | { t: "ROOT_FIELD"; parentId: string; field: PlanField; out: any; outKey: string }
    | { t: "ENTITY"; id: string; field: PlanField; out: any }
    | { t: "CONNECTION"; parentId: string; field: PlanField; out: any; outKey: string }
    | { t: "PAGE_INFO"; id: string; field: PlanField; out: any }
    | { t: "EDGE"; id: string; idx: number; field: PlanField; outArr: any[] };

  const materializeDocument = ({
    document,
    variables = {},
    decisionMode = "canonical",
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    decisionMode?: "strict" | "canonical";
  }): MaterializeResult => {
    const plan = planner.getPlan(document);
    const lru = getLRU(plan);
    const vkey = `${decisionMode}|${stableStringify(variables)}`;

    const deps = new Set<string>();
    const touch = (id?: string | null) => { if (id) deps.add(id); };

    const data: Record<string, any> = {};
    let allOk = true;

    const root = graph.getRecord(ROOT_ID) || {};
    touch(ROOT_ID);

    const tasks: Task[] = [];
    for (let i = plan.root.length - 1; i >= 0; i--) {
      const f = plan.root[i];
      tasks.push({ t: "ROOT_FIELD", parentId: ROOT_ID, field: f, out: data, outKey: f.responseKey });
    }

    const isConnectionField = (f: PlanField): boolean => Boolean((f as any).isConnection);

    // type-conditions (inline fragments)
    const intfMap = (graph as any).interfaces as Record<string, string[]> | undefined;
    const isSubtype = (actual?: string, expected?: string): boolean => {
      if (!expected || !actual) return true;
      if (actual === expected) return true;
      const impls = intfMap?.[expected];
      return Array.isArray(impls) ? impls.includes(actual) : false;
    };
    const fieldAppliesToType = (pf: any, actualType?: string): boolean => {
      const one = pf?.typeCondition ?? pf?.onType ?? pf?.typeName ?? undefined;
      const many = pf?.typeConditions ?? pf?.onTypes ?? pf?.typeNames ?? undefined;
      if (!one && !many) return true;
      if (one) return isSubtype(actualType, one);
      if (Array.isArray(many)) return many.some((t: string) => isSubtype(actualType, t));
      return true;
    };

    while (tasks.length) {
      const task = tasks.pop() as Task;

      if (task.t === "ROOT_FIELD") {
        const { parentId, field, out, outKey } = task;

        if (isConnectionField(field)) {
          tasks.push({ t: "CONNECTION", parentId, field, out, outKey });
          continue;
        }

        if (field.selectionSet && field.selectionSet.length) {
          const snap = graph.getRecord(parentId) || {};
          const link = (snap as any)[buildFieldKey(field, variables)];
          if (!link || !link.__ref) {
            out[outKey] = link === null ? null : undefined;
            allOk = false;
            continue;
          }
          const childId = link.__ref as string;
          const childOut: any = {};
          out[outKey] = childOut;
          tasks.push({ t: "ENTITY", id: childId, field, out: childOut });
          continue;
        }

        if (field.fieldName === "__typename") {
          out[outKey] = (root as any).__typename;
        } else {
          const sk = buildFieldKey(field, variables);
          out[outKey] = (root as any)[sk];
        }
        continue;
      }

      if (task.t === "ENTITY") {
        const { id, field, out } = task;
        const rec = graph.getRecord(id);
        touch(id);

        if (!rec) {
          allOk = false;
        }

        const snap = rec || {};

        if ((snap as any).__typename !== undefined) {
          out.__typename = (snap as any).__typename;
        }

        const actualType = (snap as any).__typename as string | undefined;
        const sel = field.selectionSet || [];
        for (let i = sel.length - 1; i >= 0; i--) {
          const f = sel[i];

          if (!fieldAppliesToType(f, actualType)) {
            continue;
          }

          if (isConnectionField(f)) {
            tasks.push({ t: "CONNECTION", parentId: id, field: f, out, outKey: f.responseKey });
            continue;
          }

          if (f.selectionSet && f.selectionSet.length) {
            const link = (snap as any)[buildFieldKey(f, variables)];

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

            if (!link || !link.__ref) {
              out[f.responseKey] = link === null ? null : undefined;
              allOk = false;
              continue;
            }

            const childId = link.__ref as string;
            const childOut: any = {};
            out[f.responseKey] = childOut;
            tasks.push({ t: "ENTITY", id: childId, field: f, out: childOut });
            continue;
          }

          if (f.fieldName === "__typename") {
            out[f.responseKey] = (snap as any).__typename;
          } else {
            const sk = buildFieldKey(f, variables);
            out[f.responseKey] = (snap as any)[sk];
          }
        }

        // scalar fallback for interface-gated fields
        if (Array.isArray(field.selectionSet) && field.selectionSet.length) {
          for (let i = 0; i < field.selectionSet.length; i++) {
            const pf = field.selectionSet[i];
            if (pf.selectionSet) continue;
            if (out[pf.responseKey] !== undefined) continue;
            const sk = buildFieldKey(pf, variables);
            if (sk in (snap as any)) {
              out[pf.responseKey] = (snap as any)[sk];
            }
          }
        }

        continue;
      }

      if (task.t === "CONNECTION") {
        const { parentId, field, out, outKey } = task;

        const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
        touch(canonicalKey);
        const pageCanonical = graph.getRecord(canonicalKey);

        let ok = !!pageCanonical;
        if (ok && decisionMode === "strict") {
          const strictKey = buildConnectionKey(field, parentId, variables);
          const pageStrict = graph.getRecord(strictKey);
          ok = !!pageStrict;
        }

        const conn: any = { edges: [], pageInfo: {} };
        out[outKey] = conn;

        if (!ok) {
          allOk = false;
          continue;
        }

        const page = pageCanonical!;
        const selMap = (field as any).selectionMap as Map<string, PlanField> | undefined;

        if (selMap && selMap.size) {
          for (const [rk, pf] of selMap) {
            if (rk === "pageInfo") {
              const piLink = (page as any).pageInfo;
              if (piLink && piLink.__ref) {
                tasks.push({ t: "PAGE_INFO", id: piLink.__ref as string, field: pf, out: conn });
              } else {
                conn.pageInfo = {};
              }
              continue;
            }

            if (rk === "edges") {
              const edgesRaw = (page as any).edges;
              let refs: string[] = [];
              if (edgesRaw && typeof edgesRaw === "object" && Array.isArray(edgesRaw.__refs)) {
                refs = edgesRaw.__refs.slice();
              } else if (Array.isArray(edgesRaw)) {
                refs = edgesRaw.map((_: any, i: number) => `${canonicalKey}.edges.${i}`);
              }

              const arr: any[] = new Array(refs.length);
              conn.edges = arr;

              for (let i = refs.length - 1; i >= 0; i--) {
                const eid = refs[i];
                tasks.push({ t: "EDGE", id: eid, idx: i, field: pf, outArr: arr });
              }
              continue;
            }

            if (!pf.selectionSet) {
              if (pf.fieldName === "__typename") {
                conn[pf.responseKey] = (page as any).__typename;
              } else {
                const sk = buildFieldKey(pf, variables);
                conn[pf.responseKey] = (page as any)[sk];
              }
              continue;
            }

            if (isConnectionField(pf)) {
              tasks.push({ t: "CONNECTION", parentId: canonicalKey, field: pf, out: conn, outKey: pf.responseKey });
              continue;
            }

            const link = (page as any)[buildFieldKey(pf, variables)];

            if (link && typeof link === "object" && Array.isArray(link.__refs)) {
              const refs: string[] = link.__refs.slice();
              const arrOut: any[] = new Array(refs.length);
              conn[pf.responseKey] = arrOut;

              for (let j = refs.length - 1; j >= 0; j--) {
                const childOut: any = {};
                arrOut[j] = childOut;
                tasks.push({ t: "ENTITY", id: refs[j], field: pf, out: childOut });
              }
              continue;
            }

            if (!link || !link.__ref) {
              conn[pf.responseKey] = link === null ? null : undefined;
              allOk = false;
              continue;
            }

            const childId = link.__ref as string;
            const childOut: any = {};
            conn[pf.responseKey] = childOut;
            tasks.push({ t: "ENTITY", id: childId, field: pf, out: childOut });
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
            } else {
              const nid = nlink.__ref as string;
              const nOut: any = {};
              edgeOut.node = nOut;
              tasks.push({ t: "ENTITY", id: nid, field: nodePlan as PlanField, out: nOut });
            }
          } else if (!pf.selectionSet) {
            if (pf.fieldName === "__typename") {
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

    if (!allOk) {
      return { status: "MISSING", data: undefined, deps: Array.from(deps) as any };
    }

    // Fast stamp: versions only
    const ids = Array.from(deps).sort();
    let stamp = "";
    const getVersion = (graph as any).getVersion as (id: string) => number;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      stamp += id + "#" + (getVersion(id) || 0) + ";";
    }

    const cached = lru.get(vkey);
    if (cached && cached.stamp === stamp) {
      return { data: cached.data, status: "FULFILLED", deps: ids as any };
    }

    lru.set(vkey, { data, stamp });
    return { data, status: "FULFILLED", deps: ids as any };
  };
  /* MATERIALIZE DOCUMENT END */

  return {
    normalizeDocument,
    materializeDocument,
  };
};
