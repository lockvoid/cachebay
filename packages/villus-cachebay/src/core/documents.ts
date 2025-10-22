import { ROOT_ID } from "./constants";
import {
  isObject,
  buildFieldKey,
  buildConnectionKey,
  buildConnectionCanonicalKey,
  LRU,
  stableStringify,
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

export type MaterializeResult<T = any> = {
  data?: T;                                 // only when source !== "none"
  deps: string[];                           // dependency ids/keys
  source: "strict" | "canonical" | "none";  // which path produced data
  ok: { strict: boolean; canonical: boolean }; // what is possible from cache
};


export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, planner, canonical } = deps;

  // -------------------------
  // normalizeDocument (using traverseFast)
  // -------------------------

  const normalizeDocument = ({
    document,
    variables = {},
    data,
    rootId,
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    data: any;
    /** When provided, treat this entity id as the "root" parent (used by fragments) */
    rootId?: string;
  }): { touched: Set<string> } => {
    const touched = new Set<string>();
    const put = (id: string, patch: Record<string, any>) => {
      if (id !== ROOT_ID) {
        touched.add(id);
      } else {
        // But DO track field-level changes on root (e.g., @.user({"id":"1"}))
        const keys = Object.keys(patch);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = patch[key];
          // Skip metadata fields (id/typename that equal ROOT_ID) but track actual query fields
          if (value === ROOT_ID) continue;
          touched.add(`${id}.${key}`);
        }
      }
      graph.putRecord(id, patch);
    };

    const plan = planner.getPlan(document);
    const startId = rootId ?? ROOT_ID;
    const shouldLink = (startId !== ROOT_ID) || (plan.operation === "query");

    if (startId === ROOT_ID) {
      put(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
    }

    const connectionPages: ConnectionPage[] = [];

    const initialFrame: Frame = {
      parentId: startId,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(),
      insideConnection: false,
      pageKey: null,
      inEdges: false,
    };

    // Inline traversal (eliminates visit callback overhead)
    const stack = [null, data, null, initialFrame];

    while (stack.length > 0) {
      const frame = stack.pop() as Frame | undefined;
      const responseKey = stack.pop() as string | number | null;
      const valueNode = stack.pop();
      const _parentNode = stack.pop();

      if (!frame) continue;

      // Handle root-level traversal
      if (responseKey == null) {
        if (Array.isArray(valueNode)) {
          for (let i = valueNode.length - 1; i >= 0; i--) {
            const childValue = valueNode[i];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, i, frame);
            }
          }
          continue;
        } else if (isObject(valueNode)) {
          for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
            const key = fieldKeys[i];
            const childValue = valueNode[key];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, key, frame);
            } else {
              // Scalar at root
              const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
              if (fieldsMap) {
                const f = fieldsMap.get(key);
                if (f && !f.selectionSet) {
                  const fieldKey = buildFieldKey(f, variables);
                  put(frame.parentId, { [fieldKey]: childValue });
                }
              }
            }
          }
          continue;
        }
        continue;
      }

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const planField = typeof responseKey === "string" && fieldsMap ? fieldsMap.get(responseKey) : undefined;

      /* ====== ARRAYS ====== */
      if (Array.isArray(valueNode)) {
        // Connection edges
        if (frame.insideConnection && responseKey === "edges") {
          const pageKey = frame.pageKey as string;
          const rawEdges: any[] = valueNode;
          const edgeRefs: string[] = new Array(rawEdges.length);
          for (let i = 0; i < rawEdges.length; i++) {
            edgeRefs[i] = `${pageKey}.edges.${i}`;
          }
          put(pageKey, { edges: { __refs: edgeRefs } });

          const edgesField = fieldsMap?.get("edges");
          const nextFrame: Frame = {
            parentId: frame.parentId,
            fields: edgesField?.selectionSet,
            fieldsMap: edgesField?.selectionMap,
            insideConnection: true,
            pageKey,
            inEdges: true,
          };

          // Push children onto stack
          for (let i = rawEdges.length - 1; i >= 0; i--) {
            const childValue = rawEdges[i];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, i, nextFrame);
            }
          }
          continue;
        }

        // Plain array scalar/object values without selection → store raw array
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
          const out = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) out[i] = arr[i];
          put(parentId, { [fieldKey]: out });
          continue; // SKIP
        }

        // Arrays of objects WITH a selection
        if (planField && planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
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

          const nextFrame: Frame = {
            parentId,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: false,
            pageKey: baseKey,
            inEdges: true,
          };

          // Push children onto stack
          for (let i = arr.length - 1; i >= 0; i--) {
            const childValue = arr[i];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, i, nextFrame);
            }
          }
          continue;
        }

        continue;
      }

      /* ====== OBJECTS ====== */
      if (isObject(valueNode)) {
        // Plain object field with no selection
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          put(parentId, { [fieldKey]: valueNode });
          continue; // SKIP
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

          const nextFrame: Frame = {
            parentId: itemKey,
            fields: frame.fields,
            fieldsMap: frame.fieldsMap,
            insideConnection: false,
            pageKey: frame.pageKey,
            inEdges: false,
          };

          // Push children onto stack
          for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
            const key = fieldKeys[i];
            const childValue = valueNode[key];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, key, nextFrame);
            } else {
              // Scalar
              const f = nextFrame.fieldsMap?.get(key);
              if (f && !f.selectionSet) {
                const fieldKey = buildFieldKey(f, variables);
                put(nextFrame.parentId, { [fieldKey]: childValue });
              }
            }
          }
          continue;
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

          const nextFrame: Frame = {
            parentId: edgeKey,
            fields: frame.fields,
            fieldsMap: frame.fieldsMap,
            insideConnection: true,
            pageKey: frame.pageKey,
            inEdges: true,
          };

          // Push children onto stack
          for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
            const key = fieldKeys[i];
            const childValue = valueNode[key];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, key, nextFrame);
            } else {
              // Scalar
              const f = nextFrame.fieldsMap?.get(key);
              if (f && !f.selectionSet) {
                const fieldKey = buildFieldKey(f, variables);
                put(nextFrame.parentId, { [fieldKey]: childValue });
              }
            }
          }
          continue;
        }

        // Connection container
        if (planField && (planField as any).isConnection) {
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

          if (shouldLink) {
            put(parentId, { [parentFieldKey]: { __ref: pageKey } });
            connectionPages.push({ field: planField, parentId, pageKey });
          }

          const nextFrame: Frame = {
            parentId: pageKey,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: true,
            pageKey,
            inEdges: false,
          };

          // Push children onto stack
          for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
            const key = fieldKeys[i];
            const childValue = valueNode[key];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, key, nextFrame);
            } else {
              // Scalar
              const f = nextFrame.fieldsMap?.get(key);
              if (f && !f.selectionSet) {
                const fieldKey = buildFieldKey(f, variables);
                put(nextFrame.parentId, { [fieldKey]: childValue });
              }
            }
          }
          continue;
        }

        // Entity object
        {
          const entityKey = graph.identify(valueNode);
          if (entityKey) {
            if (valueNode && (valueNode as any).__typename) put(entityKey, { __typename: (valueNode as any).__typename });
            else put(entityKey, {});

            if (shouldLink && planField && !(frame.insideConnection && planField.responseKey === "node")) {
              const parentFieldKey = buildFieldKey(planField, variables);
              put(parentId, { [parentFieldKey]: { __ref: entityKey } });
            }

            const fromNode = !!planField && planField.responseKey === "node";

            const nextFrame: Frame = {
              parentId: entityKey,
              fields: planField?.selectionSet,
              fieldsMap: planField?.selectionMap,
              insideConnection: fromNode ? false : frame.insideConnection,
              pageKey: fromNode ? null : frame.pageKey,
              inEdges: fromNode ? false : frame.inEdges,
            };

            // Push children onto stack
            for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
              const key = fieldKeys[i];
              const childValue = valueNode[key];
              if (isObject(childValue)) {
                stack.push(valueNode, childValue, key, nextFrame);
              } else {
                // Scalar
                const f = nextFrame.fieldsMap?.get(key);
                if (f && !f.selectionSet) {
                  const fieldKey = buildFieldKey(f, variables);
                  put(nextFrame.parentId, { [fieldKey]: childValue });
                }
              }
            }
            continue;
          }
        }

        // Inline container
        if (planField) {
          const containerFieldKey = buildFieldKey(planField, variables);
          const containerKey = `${parentId}.${containerFieldKey}`;

          if (valueNode && (valueNode as any).__typename) put(containerKey, { __typename: (valueNode as any).__typename });
          else put(containerKey, {});

          if (shouldLink) {
            put(parentId, { [containerFieldKey]: { __ref: containerKey } });
          }

          if (frame.insideConnection && containerFieldKey === "pageInfo" && frame.pageKey) {
            put(frame.pageKey, { pageInfo: { __ref: containerKey } });
          }

          const nextFrame: Frame = {
            parentId: containerKey,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: frame.insideConnection,
            pageKey: frame.pageKey,
            inEdges: false,
          };

          // Push children onto stack
          for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
            const key = fieldKeys[i];
            const childValue = valueNode[key];
            if (isObject(childValue)) {
              stack.push(valueNode, childValue, key, nextFrame);
            } else {
              // Scalar
              const f = nextFrame.fieldsMap?.get(key);
              if (f && !f.selectionSet) {
                const fieldKey = buildFieldKey(f, variables);
                put(nextFrame.parentId, { [fieldKey]: childValue });
              }
            }
          }
          continue;
        }

        continue;
      }

      /* ====== SCALARS ====== */
      // Handle scalars that were pushed onto the stack
      if (typeof responseKey === "string" && fieldsMap) {
        const f = fieldsMap.get(responseKey);
        if (f && !f.selectionSet) {
          const fieldKey = buildFieldKey(f, variables);
          put(frame.parentId, { [fieldKey]: valueNode });
        }
      }
    }

    // Update canonical connections (queries only) and mark canonical key as touched
    if (connectionPages.length > 0) {
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

    // Note: We don't call markResultsDirtyForTouched here anymore.
    // The graph's onChange callback (set up in client.ts) will call
    // documents._markDirty with only the records that actually changed.
    // This prevents false cache invalidation when data is identical.

    return { touched };
  };

  /* MATERIALIZE DOCUMENT (per-plan LRU; per-dep inverted index; no clocks) */

  type CacheEntry = { data: any; deps: string[] };

  const RESULT_LRU_CAP = 2048;

  /** Plan-scoped caches & indices */
  const lruByPlan = new WeakMap<CachePlan, LRU<string, CacheEntry>>();
  const depIndexByPlan = new WeakMap<CachePlan, Map<string, Set<string>>>();
  const dirtyByPlan = new WeakMap<CachePlan, Set<string>>();
  const allPlans = new Set<CachePlan>();

  const getDepIndex = (plan: CachePlan) => {
    let idx = depIndexByPlan.get(plan);
    if (!idx) { idx = new Map(); depIndexByPlan.set(plan, idx); }
    return idx;
  };
  const getDirtySet = (plan: CachePlan) => {
    let s = dirtyByPlan.get(plan);
    if (!s) { s = new Set(); dirtyByPlan.set(plan, s); }
    return s;
  };
  const getResultLRU = (plan: CachePlan) => {
    let lru = lruByPlan.get(plan);
    if (!lru) {
      allPlans.add(plan);
      lru = new LRU<string, CacheEntry>(RESULT_LRU_CAP, (vkey, entry) => {
        // unlink on eviction
        unlinkDepsFromVkey(plan, entry.deps, vkey);
        getDirtySet(plan).delete(vkey);
      });
      lruByPlan.set(plan, lru);
    }
    return lru;
  };

  const linkDepsToVkey = (plan: CachePlan, deps: string[], vkey: string) => {
    const idx = getDepIndex(plan);
    for (let i = 0; i < deps.length; i++) {
      const id = deps[i];
      let set = idx.get(id);
      if (!set) idx.set(id, (set = new Set()));
      set.add(vkey);
    }
  };
  const unlinkDepsFromVkey = (plan: CachePlan, deps: string[], vkey: string) => {
    const idx = getDepIndex(plan);
    for (let i = 0; i < deps.length; i++) {
      const id = deps[i];
      const set = idx.get(id);
      if (!set) continue;
      set.delete(vkey);
      if (set.size === 0) idx.delete(id);
    }
  };

  /** Call this after every normalize/write with the set of touched record ids/keys */
  const markResultsDirtyForTouched = (touched: Set<string>) => {
    for (const plan of allPlans) {
      const idx = depIndexByPlan.get(plan);
      if (!idx) continue;
      const dirty = getDirtySet(plan);
      for (const id of touched) {
        const keys = idx.get(id);
        if (!keys) continue;
        for (const vkey of keys) dirty.add(vkey);
      }
    }
  };

  /** Optional helper if you want to nuke everything (tests/dev) */
  const clearAllResultCaches = () => {
    for (const plan of allPlans) {
      lruByPlan.get(plan)?.clear();
      depIndexByPlan.get(plan)?.clear();
      dirtyByPlan.get(plan)?.clear();
    }
    allPlans.clear();
    lruByPlan.clear();
    depIndexByPlan.clear();
    dirtyByPlan.clear();
  };

  /* ---------- materializeDocument ---------- */

  const planIdByPlan = new WeakMap<CachePlan, number>();
  let planSeq = 1;
  const getPlanId = (plan: CachePlan) => {
    let id = planIdByPlan.get(plan);
    if (!id) { id = planSeq++; planIdByPlan.set(plan, id); }
    return id;
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
    canonical = true,
    entityId,
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    canonical?: boolean;          // requested mode
    /** When provided, read the plan.root selection over this entity id instead of ROOT */
    entityId?: string;
  }): MaterializeResult => {
    // Flush any pending graph changes before reading
    graph.flush();

    const plan = planner.getPlan(document);
    const lru = getResultLRU(plan);
    const dirty = getDirtySet(plan);
    const vkey = `${getPlanId(plan)}|${canonical ? 'c' : 's'}|${entityId ? `ent:${entityId}|` : ''}${stableStringify(variables)}`;

    // O(1) hot path: return if present and not dirty
    {
      const cached = lru.get(vkey);
      if (cached && !dirty.has(vkey)) {
        return {
          data: cached.data,
          deps: cached.deps.slice(),
          source: canonical ? "canonical" : "strict",
          ok: { strict: true, canonical: true }, // cached implies satisfiable in the requested mode
        };
      }
    }

    // ---- full traversal ----
    const deps = new Set<string>();
    const touch = (id?: string | null) => { if (id) deps.add(id); };

    const outData: Record<string, any> = {};
    let strictOK = true;
    let canonicalOK = true;

    const tasks: Task[] = [];
    const rootSel = plan.root;

    let root: any = undefined;
    if (entityId) {
      // Synthetic "ENTITY" root: apply fragment selection to the entity directly
      const syntheticField = { selectionSet: rootSel, selectionMap: plan.rootSelectionMap } as unknown as PlanField;
      tasks.push({ t: "ENTITY", id: entityId, field: syntheticField, out: outData });
    } else {
      root = graph.getRecord(ROOT_ID) || {};
      for (let i = rootSel.length - 1; i >= 0; i--) {
        const f = rootSel[i];
        tasks.push({ t: "ROOT_FIELD", parentId: ROOT_ID, field: f, out: outData, outKey: f.responseKey });
      }
    }

    const isConnectionField = (f: PlanField): boolean => Boolean((f as any).isConnection);

    const isSubtype = (actual?: string, expected?: string): boolean => {
      if (!expected || !actual) return true;
      if (actual === expected) return true;
      const intfMap = (graph as any)?.interfaces || (graph as any)?.__interfaces || undefined;
      const impls: string[] | undefined = intfMap?.[expected];
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
          const fieldKey = buildFieldKey(field, variables);
          // Track field-level dependency for root fields
          if (parentId === ROOT_ID) {
            touch(`${parentId}.${fieldKey}`);
          }
          const link = (snap as any)[fieldKey];

          if (!link || !link.__ref) {
            out[outKey] = link === null ? null : undefined;
            strictOK = false;
            canonicalOK = false;
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
          strictOK = false;
          canonicalOK = false;
        }

        const snap = rec || {};

        if ((snap as any).__typename !== undefined) {
          out.__typename = (snap as any).__typename;
        }

        const actualType = (snap as any).__typename as string | undefined;
        const sel = field.selectionSet || [];
        for (let i = sel.length - 1; i >= 0; i--) {
          const f = sel[i];

          if (!fieldAppliesToType(f, actualType)) continue;

          if (isConnectionField(f)) {
            tasks.push({ t: "CONNECTION", parentId: id, field: f, out, outKey: f.responseKey });
            continue;
          }

          if (f.selectionSet && f.selectionSet.length) {
            const link = (snap as any)[buildFieldKey(f, variables)];

            // array-of-refs
            if (link && typeof link === "object" && Array.isArray(link.__refs)) {
              const refs: string[] = link.__refs;
              const arrOut: any[] = new Array(refs.length);
              out[f.responseKey] = arrOut;

              for (let j = refs.length - 1; j >= 0; j--) {
                const childOut: any = {};
                arrOut[j] = childOut;
                tasks.push({ t: "ENTITY", id: refs[j], field: f, out: childOut });
              }
              continue;
            }

            // single ref or missing
            if (!link || !link.__ref) {
              out[f.responseKey] = link === null ? null : undefined;
              strictOK = false;
              canonicalOK = false;
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
            out[f.responseKey] = (snap as any)[sk];
          }
        }

        // scalar fallback for interface-gated scalars present on the record
        if (Array.isArray(field.selectionSet) && field.selectionSet.length) {
          for (let i = 0; i < field.selectionSet.length; i++) {
            const pf = field.selectionSet[i];
            if (pf.selectionSet) continue;
            if (out[pf.responseKey] !== undefined) continue;
            const sk = buildFieldKey(pf, variables);
            if (sk in (snap as any)) out[pf.responseKey] = (snap as any)[sk];
          }
        }
        continue;
      }

      if (task.t === "CONNECTION") {
        const { parentId, field, out, outKey } = task;

        // compute both keys
        const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
        const strictKey = buildConnectionKey(field, parentId, variables);

        // Only touch the dependency for the requested mode
        if (canonical) {
          touch(canonicalKey);
        } else {
          touch(strictKey);
        }

        const pageCanonical = graph.getRecord(canonicalKey);
        const pageStrict = graph.getRecord(strictKey);

        // Track overall satisfiability
        canonicalOK &&= !!pageCanonical;
        strictOK &&= !!pageStrict;

        const requestedOK = canonical ? !!pageCanonical : !!pageStrict;

        const conn: any = { edges: [], pageInfo: {} };
        out[outKey] = conn;

        // Don't fall back; strict means strict, canonical means canonical
        if (!requestedOK) {
          continue;
        }

        // Choose the page for the requested mode (also used to build edge IDs)
        const baseIsCanonical = !!canonical;
        const page = (baseIsCanonical ? pageCanonical : pageStrict)!;
        const baseKey = baseIsCanonical ? canonicalKey : strictKey;

        const selMap = (field as any).selectionMap as Map<string, PlanField> | undefined;
        if (selMap && selMap.size) {
          for (const [rk, pf] of selMap) {
            if (rk === "pageInfo") {
              const piLink = (page as any).pageInfo;
              if (piLink?.__ref) {
                tasks.push({ t: "PAGE_INFO", id: piLink.__ref as string, field: pf, out: conn });
              } else {
                conn.pageInfo = {};
                strictOK = false;
                canonicalOK = false;
              }
              continue;
            }

            if (rk === "edges") {
              const edgesRaw = (page as any).edges;
              let refs: string[] = [];
              if (edgesRaw && typeof edgesRaw === "object" && Array.isArray(edgesRaw.__refs)) {
                refs = edgesRaw.__refs;
              } else if (Array.isArray(edgesRaw)) {
                // derive edge record ids based on the *requested* mode's baseKey
                refs = edgesRaw.map((_: any, i: number) => `${baseKey}.edges.${i}`);
              }

              const arr: any[] = new Array(refs.length);
              conn.edges = arr;

              for (let i = refs.length - 1; i >= 0; i--) {
                tasks.push({ t: "EDGE", id: refs[i], idx: i, field: pf, outArr: arr });
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
              tasks.push({
                t: "CONNECTION",
                parentId: baseIsCanonical ? canonicalKey : strictKey,
                field: pf,
                out: conn,
                outKey: pf.responseKey,
              });
              continue;
            }

            const link = (page as any)[buildFieldKey(pf, variables)];
            if (link && typeof link === "object" && Array.isArray(link.__refs)) {
              const refs: string[] = link.__refs;
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
              strictOK = false;
              canonicalOK = false;
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
          } else {
            const sk = buildFieldKey(pf, variables);
            piOut[pf.responseKey] = (pi as any)[sk];
          }
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
              strictOK = false;
              canonicalOK = false;
            } else {
              const nid = nlink.__ref as string;
              const nOut: any = {};
              edgeOut.node = nOut;
              tasks.push({ t: "ENTITY", id: nid, field: nodePlan as PlanField, out: nOut });
            }
          } else if (!pf.selectionSet) {
            if (pf.fieldName === "__typename") {
              edgeOut[rk] = (edge as any).__typename;
            } else {
              const sk = buildFieldKey(pf, variables);
              edgeOut[rk] = (edge as any)[sk];
            }
          }
        }
        continue;
      }
    }

    const ids = Array.from(deps).sort();
    const requestedOK = canonical ? canonicalOK : strictOK;

    if (!requestedOK) {
      // return deps so watchers can subscribe to future hydration
      return { data: undefined, deps: ids, source: "none", ok: { strict: strictOK, canonical: canonicalOK } };
    }

    // relink deps and store fresh entry
    const prev = lru.get(vkey);
    if (prev) unlinkDepsFromVkey(plan, prev.deps, vkey);

    const entry: CacheEntry = { data: outData, deps: ids };
    lru.set(vkey, entry);
    linkDepsToVkey(plan, ids, vkey);

    // clear dirty for this key
    dirty.delete(vkey);

    return {
      data: outData,
      deps: ids,
      source: canonical ? "canonical" : "strict",
      ok: { strict: strictOK, canonical: canonicalOK },
    };
  };

  return {
    normalizeDocument,
    materializeDocument,
    // Internal: mark results dirty (called from internals.ts onChange hook)
    _markDirty: markResultsDirtyForTouched,
    // Optional: test/dev helper
    _clearAllResultCaches: clearAllResultCaches,
  };
};
