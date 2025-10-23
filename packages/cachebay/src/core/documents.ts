import { ROOT_ID } from "./constants";
import { isObject, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, fingerprintNodes } from "./utils";
import { __DEV__ } from "./instrumentation";
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

const ENTITY_MISSING = "entity-missing" as const;
const ROOT_LINK_MISSING = "root-link-missing" as const;
const FIELD_LINK_MISSING = "field-link-missing" as const;
const CONNECTION_MISSING = "connection-missing" as const;
const PAGE_INFO_MISSING = "pageinfo-missing" as const;
const EDGE_NODE_MISSING = "edge-node-missing" as const;
const SCALAR_MISSING = "scalar-missing" as const;

/** Symbol for storing fingerprints on materialized objects (non-enumerable) */
const FINGERPRINT_KEY = "__fp" as const;

export type Miss =
  | { kind: typeof ENTITY_MISSING; at: string; id: string }
  | { kind: typeof ROOT_LINK_MISSING; at: string; fieldKey: string }
  | { kind: typeof FIELD_LINK_MISSING; at: string; parentId: string; fieldKey: string }
  | { kind: typeof CONNECTION_MISSING; at: string; mode: "strict" | "canonical"; parentId: string; canonicalKey: string; strictKey: string; hasCanonical: boolean; hasStrict: boolean; }
  | { kind: typeof PAGE_INFO_MISSING; at: string; pageId: string }
  | { kind: typeof EDGE_NODE_MISSING; at: string; edgeId: string }
  | { kind: typeof SCALAR_MISSING; at: string; parentId: string; fieldKey: string };

export type MaterializeDocumentOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  canonical?: boolean;
  entityId?: string;
  fingerprint?: boolean;
};

export type MaterializeDocumentResult = {
  data: any;
  dependencies: Set<string>;
  fingerprint: number;
  source: "canonical" | "strict" | "none";
  ok: { strict: boolean; canonical: boolean; miss?: Miss[] };
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
  }): void => {
    const put = (id: string, patch: Record<string, any>) => {
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
      }
    }

    // Note: We don't call markResultsDirtyForTouched here anymore.
    // The graph's onChange callback (set up in client.ts) will call
    // documents._markDirty with only the records that actually changed.
    // This prevents false cache invalidation when data is identical.
  };

  // Types expected to exist in your environment:
  // - DocumentNode, CachePlan, PlanField, MaterializeDocumentResult, MaterializeDocumentOptions
  // - ROOT_ID, planner.getPlan(document)
  // - graph.flush(), graph.getRecord(id), graph.getVersion(id), graph.getImplementers(iface)
  // - buildFieldKey(field, vars), buildConnectionKey(field, parentId, vars), buildConnectionCanonicalKey(field, parentId, vars)

  const ENTITY_MISSING = "entity-missing" as const;
  const ROOT_LINK_MISSING = "root-link-missing" as const;
  const FIELD_LINK_MISSING = "field-link-missing" as const;
  const CONNECTION_MISSING = "connection-missing" as const;
  const PAGE_INFO_MISSING = "pageinfo-missing" as const;
  const EDGE_NODE_MISSING = "edge-node-missing" as const;
  const SCALAR_MISSING = "scalar-missing" as const;

  type Miss =
    | { kind: typeof ENTITY_MISSING; at: string; id: string }
    | { kind: typeof ROOT_LINK_MISSING; at: string; fieldKey: string }
    | { kind: typeof FIELD_LINK_MISSING; at: string; parentId: string; fieldKey: string }
    | {
      kind: typeof CONNECTION_MISSING;
      at: string;
      mode: "strict" | "canonical";
      parentId: string;
      canonicalKey: string;
      strictKey: string;
      hasCanonical: boolean;
      hasStrict: boolean;
    }
    | { kind: typeof PAGE_INFO_MISSING; at: string; pageId: string }
    | { kind: typeof EDGE_NODE_MISSING; at: string; edgeId: string }
    | { kind: typeof SCALAR_MISSING; at: string; parentId: string; fieldKey: string };

  type MaterializeDocumentOptions = {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    canonical?: boolean;
    /** When provided, read the plan.root selection over this entity id instead of ROOT */
    entityId?: string;
  };

  type MaterializeDocumentResult = {
    data: any;
    dependencies: Set<string>;
    fingerprint: number;
    source: "canonical" | "strict" | "none";
    ok: { strict: boolean; canonical: boolean; miss?: Miss[] };
  };

  const materializeDocument = (opts: MaterializeDocumentOptions): MaterializeDocumentResult => {
    const { document, variables = {}, canonical = true, entityId, fingerprint = true } = opts;

    graph.flush();

    const misses: Miss[] = [];
    const miss = __DEV__ ? (m: Miss) => { misses.push(m); } : (_: Miss) => { };
    const addPath = __DEV__
      ? (base: string, seg: string) => (base ? base + "." + seg : seg)
      : (_base: string, _seg: string) => "";

    const plan = planner.getPlan(document);

    const dependencies = new Set<string>();
    const touch = (id: string) => {
      dependencies.add(id);
    };

    let strictOK = true;
    let canonicalOK = true;

    // Single applicability helper (merges subtype + field checks)
    const selectionAppliesToRuntime = (field: any, runtimeType: string | undefined): boolean => {
      const one = field.typeCondition || field.onType || field.typeName;
      if (one != null) {
        if (runtimeType == null) return true;
        if (runtimeType === one) return true;
        return graph.getImplementers(one).has(runtimeType);
      }

      const many = field.typeConditions || field.onTypes || field.typeNames;
      if (Array.isArray(many)) {
        if (runtimeType == null) return true;
        for (let i = 0; i < many.length; i++) {
          const expected = many[i];
          if (runtimeType === expected || graph.getImplementers(expected).has(runtimeType)) {
            return true;
          }
        }
        return false;
      }

      return true;
    };

    // ---- Fingerprinting helper ------------------------------------------------------

    /**
     * Set fingerprint on an object as a non-enumerable property.
     * Keeps fingerprints out of JSON.stringify and Object.keys.
     * Only sets if fingerprinting is enabled.
     */
    const setFingerprint = (obj: any, fp: number): void => {
      if (!fingerprint) return;
      Object.defineProperty(obj, FINGERPRINT_KEY, {
        value: fp,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    };

    // ---- Recursive readers ------------------------------------------------------

    const readScalar = (record: any, field: PlanField, out: any, outKey: string, parentId: string, path: string) => {
      if (field.fieldName === "__typename") {
        const typeName = record ? (record as any).__typename : undefined;
        out[outKey] = typeName;
        return;
      }

      const storeKey = buildFieldKey(field, variables);
      const value = record ? (record as any)[storeKey] : undefined;

      if (value === undefined && __DEV__) {
        miss({ kind: SCALAR_MISSING, at: path, parentId, fieldKey: storeKey });
      }

      out[outKey] = value;
    };

    const readPageInfo = (pageInfoId: string, field: PlanField, outConn: any, path: string): number => {
      touch(pageInfoId);

      const record = graph.getRecord(pageInfoId) || {};
      const selection = field.selectionSet || [];
      const outPageInfo: any = {};

      for (let i = 0; i < selection.length; i++) {
        const f = selection[i];
        if (f.selectionSet) continue;
        readScalar(record, f, outPageInfo, f.responseKey, pageInfoId, addPath(path, f.responseKey));
      }

      outConn.pageInfo = outPageInfo;

      // PageInfo is a simple node - use version directly as fingerprint
      const pageInfoVersion = graph.getVersion(pageInfoId);
      setFingerprint(outPageInfo, pageInfoVersion);

      return pageInfoVersion;
    };

    const readEntity = (id: string, field: PlanField, out: any, path: string) => {
      touch(id);

      const record = graph.getRecord(id);
      if (!record) {
        strictOK = false;
        canonicalOK = false;
        miss({ kind: ENTITY_MISSING, at: path, id });
      }

      const snapshot = record || {};

      if ((snapshot as any).__typename !== undefined) {
        out.__typename = (snapshot as any).__typename;
      }

      const runtimeType = (snapshot as any).__typename as string | undefined;
      const selection = field.selectionSet || [];

      // Collect child fingerprints for combining
      const childFingerprints: number[] = [];

      for (let i = 0; i < selection.length; i++) {
        const childField = selection[i];
        const outKey = childField.responseKey;

        if (!selectionAppliesToRuntime(childField, runtimeType)) {
          continue;
        }

        if ((childField as any).isConnection) {
          readConnection(id, childField, out, outKey, addPath(path, outKey));
          // Collect connection fingerprint
          const connObj = out[outKey];
          if (connObj && typeof connObj === "object" && FINGERPRINT_KEY in connObj) {
            childFingerprints.push((connObj as any)[FINGERPRINT_KEY]);
          }
          continue;
        }

        if (childField.selectionSet && childField.selectionSet.length) {
          const storeKey = buildFieldKey(childField, variables);
          const link = (snapshot as any)[storeKey];

          // array-of-refs
          if (link != null && Array.isArray(link.__refs)) {
            const refs: string[] = link.__refs;
            const outArray: any[] = new Array(refs.length);
            out[outKey] = outArray;

            const arrayFingerprints: number[] = [];
            for (let j = 0; j < refs.length; j++) {
              const childOut: any = {};
              outArray[j] = childOut;
              readEntity(refs[j], childField, childOut, addPath(path, outKey + "[" + j + "]"));
              // Collect child fingerprint
              if (FINGERPRINT_KEY in childOut) {
                arrayFingerprints.push((childOut as any)[FINGERPRINT_KEY]);
              }
            }
            // Compute array fingerprint (order-dependent)
            if (arrayFingerprints.length > 0) {
              const arrayFp = fingerprintNodes(0, arrayFingerprints);
              setFingerprint(outArray, arrayFp);
              childFingerprints.push(arrayFp);
            }
            continue;
          }

          // single ref or missing
          if (!link || !link.__ref) {
            out[outKey] = link === null ? null : undefined;
            strictOK = false;
            canonicalOK = false;
            miss({ kind: FIELD_LINK_MISSING, at: addPath(path, outKey), parentId: id, fieldKey: storeKey });
            continue;
          }

          const childId = link.__ref as string;
          const childOut: any = {};
          out[outKey] = childOut;
          readEntity(childId, childField, childOut, addPath(path, outKey));
          // Collect child fingerprint
          if (FINGERPRINT_KEY in childOut) {
            childFingerprints.push((childOut as any)[FINGERPRINT_KEY]);
          }
          continue;
        }

        // scalar
        readScalar(snapshot, childField, out, outKey, id, addPath(path, outKey));
      }

      // scalar fallback for interface-gated scalars present on the record
      if (Array.isArray(field.selectionSet) && field.selectionSet.length) {
        for (let i = 0; i < field.selectionSet.length; i++) {
          const pf = field.selectionSet[i];
          if (pf.selectionSet) continue;
          if (out[pf.responseKey] !== undefined) continue;

          const storeKey = buildFieldKey(pf, variables);
          if (snapshot && storeKey in (snapshot as any)) {
            out[pf.responseKey] = (snapshot as any)[storeKey];
          }
        }
      }

      // Compute entity fingerprint: version + childFingerprints
      const entityVersion = graph.getVersion(id);

      const finalFingerprint = childFingerprints.length > 0
        ? fingerprintNodes(entityVersion, childFingerprints)
        : entityVersion;

      setFingerprint(out, finalFingerprint);
    };

    const readEdge = (edgeId: string, field: PlanField, outArray: any[], index: number, path: string) => {
      touch(edgeId);

      const record = graph.getRecord(edgeId) || {};
      const outEdge: any = {};
      outArray[index] = outEdge;

      if ((record as any).__typename !== undefined) {
        outEdge.__typename = (record as any).__typename;
      }

      const selection = field.selectionSet || [];
      const nodePlan = (field as any).selectionMap ? (field as any).selectionMap.get("node") : undefined;

      let nodeFingerprint: number | undefined;

      for (let i = 0; i < selection.length; i++) {
        const f = selection[i];
        const outKey = f.responseKey;

        if (outKey === "node") {
          const nlink = (record as any).node;
          if (!nlink || !nlink.__ref) {
            outEdge.node = nlink === null ? null : undefined;
            strictOK = false;
            canonicalOK = false;
            miss({ kind: EDGE_NODE_MISSING, at: addPath(path, "node"), edgeId });
          } else {
            const nodeId = nlink.__ref as string;
            const nodeOut: any = {};
            outEdge.node = nodeOut;
            readEntity(nodeId, nodePlan as PlanField, nodeOut, addPath(path, "node"));
            // Collect node fingerprint
            if (FINGERPRINT_KEY in nodeOut) {
              nodeFingerprint = (nodeOut as any)[FINGERPRINT_KEY];
            }
          }
        } else if (!f.selectionSet) {
          readScalar(record, f, outEdge, outKey, edgeId, addPath(path, outKey));
        }
      }

      // Compute edge fingerprint: version + nodeFingerprint
      const edgeVersion = graph.getVersion(edgeId);

      const finalFingerprint = nodeFingerprint !== undefined
        ? fingerprintNodes(edgeVersion, [nodeFingerprint])
        : edgeVersion;

      setFingerprint(outEdge, finalFingerprint);
    };

    const readConnection = (parentId: string, field: PlanField, out: any, outKey: string, path: string) => {
      const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
      const strictKey = buildConnectionKey(field, parentId, variables);

      if (canonical) {
        touch(canonicalKey);
      } else {
        touch(strictKey);
      }

      const pageCanonical = graph.getRecord(canonicalKey);
      const pageStrict = graph.getRecord(strictKey);

      canonicalOK &&= !!pageCanonical;
      strictOK &&= !!pageStrict;

      const requestedOK = canonical ? !!pageCanonical : !!pageStrict;

      const conn: any = { edges: [], pageInfo: {} };
      out[outKey] = conn;

      if (!requestedOK) {
        miss({
          kind: CONNECTION_MISSING,
          at: path,
          mode: canonical ? "canonical" : "strict",
          parentId,
          canonicalKey,
          strictKey,
          hasCanonical: !!pageCanonical,
          hasStrict: !!pageStrict,
        });
        return;
      }

      const baseIsCanonical = canonical === true;
      const page = (baseIsCanonical ? pageCanonical : pageStrict) as any;
      const baseKey = baseIsCanonical ? canonicalKey : strictKey;

      const selMap: Map<string, PlanField> | undefined = (field as any).selectionMap;
      if (!selMap || selMap.size === 0) {
        return;
      }

      let pageInfoFingerprint: number | undefined;
      const edgeFingerprints: number[] = [];

      for (const [responseKey, childField] of selMap) {
        if (responseKey === "pageInfo") {
          const pageInfoLink = page.pageInfo;
          if (pageInfoLink && pageInfoLink.__ref) {
            pageInfoFingerprint = readPageInfo(pageInfoLink.__ref as string, childField, conn, addPath(path, "pageInfo"));
          } else {
            conn.pageInfo = {};
            strictOK = false;
            canonicalOK = false;
            miss({ kind: PAGE_INFO_MISSING, at: addPath(path, "pageInfo"), pageId: baseKey + ".pageInfo" });
          }
          continue;
        }

        if (responseKey === "edges") {
          // Assumption: edges always normalized to { __refs: string[] }
          const refs: string[] = page.edges.__refs as string[];
          const outArr: any[] = new Array(refs.length);
          conn.edges = outArr;

          for (let i = 0; i < refs.length; i++) {
            readEdge(refs[i], childField, outArr, i, addPath(path, "edges[" + i + "]"));
            // Collect edge fingerprint
            const edge = outArr[i];
            if (edge && FINGERPRINT_KEY in edge) {
              edgeFingerprints.push((edge as any)[FINGERPRINT_KEY]);
            }
          }

          // Compute edges array fingerprint (order-dependent)
          if (edgeFingerprints.length > 0) {
            const edgesArrayFp = fingerprintNodes(0, edgeFingerprints);
            setFingerprint(outArr, edgesArrayFp);
          }
          continue;
        }

        if (!childField.selectionSet) {
          readScalar(page, childField, conn, childField.responseKey, baseKey, addPath(path, childField.responseKey));
          continue;
        }

        if ((childField as any).isConnection) {
          readConnection(baseKey, childField, conn, childField.responseKey, addPath(path, childField.responseKey));
          continue;
        }

        const link = page[buildFieldKey(childField, variables)];

        if (link != null && Array.isArray(link.__refs)) {
          const refs: string[] = link.__refs;
          const outArray: any[] = new Array(refs.length);
          conn[childField.responseKey] = outArray;

          for (let j = 0; j < refs.length; j++) {
            const childOut: any = {};
            outArray[j] = childOut;
            readEntity(refs[j], childField, childOut, addPath(path, childField.responseKey + "[" + j + "]"));
          }
          continue;
        }

        if (!link || !link.__ref) {
          conn[childField.responseKey] = link === null ? null : undefined;
          strictOK = false;
          canonicalOK = false;
          miss({
            kind: FIELD_LINK_MISSING,
            at: addPath(path, childField.responseKey),
            parentId: baseKey,
            fieldKey: buildFieldKey(childField, variables),
          });
          continue;
        }

        const childId = link.__ref as string;
        const childOut: any = {};
        conn[childField.responseKey] = childOut;
        readEntity(childId, childField, childOut, addPath(path, childField.responseKey));
      }

      // Compute connection fingerprint: version + pageInfoFp + edgesFp
      const pageVersion = graph.getVersion(baseKey);

      const connChildren: number[] = [];
      if (pageInfoFingerprint !== undefined) {
        connChildren.push(pageInfoFingerprint);
      }
      if (edgeFingerprints.length > 0) {
        connChildren.push(fingerprintNodes(0, edgeFingerprints));
      }

      const connFingerprint = connChildren.length > 0
        ? fingerprintNodes(pageVersion, connChildren)
        : pageVersion;
      setFingerprint(conn, connFingerprint);
    };

    // ---- Root -------------------------------------------------------------------

    const data: Record<string, any> = {};

    if (entityId) {
      const synthetic = { selectionSet: plan.root, selectionMap: plan.rootSelectionMap } as unknown as PlanField;
      readEntity(entityId, synthetic, data, entityId);
    } else {
      const rootRecord = graph.getRecord(ROOT_ID) || {};
      const rootSelection = plan.root;

      for (let i = 0; i < rootSelection.length; i++) {
        const field = rootSelection[i];
        const path = addPath(ROOT_ID, field.responseKey);

        if ((field as any).isConnection) {
          readConnection(ROOT_ID, field, data, field.responseKey, path);
          continue;
        }

        if (field.selectionSet && field.selectionSet.length) {
          const fieldKey = buildFieldKey(field, variables);

          // Root field dependency (field-level invalidation)
          touch(ROOT_ID + "." + fieldKey);

          const link = (rootRecord as any)[fieldKey];

          if (!link || !link.__ref) {
            data[field.responseKey] = link === null ? null : undefined;
            strictOK = false;
            canonicalOK = false;
            miss({ kind: ROOT_LINK_MISSING, at: path, fieldKey });
          } else {
            const childId = link.__ref as string;
            const childOut: any = {};
            data[field.responseKey] = childOut;
            readEntity(childId, field, childOut, addPath(path, childId));
          }
        } else {
          readScalar(rootRecord, field, data, field.responseKey, ROOT_ID, path);
        }
      }
    }

    const requestedOK = canonical ? canonicalOK : strictOK;

    // Compute root fingerprint from all top-level fields
    const rootFingerprints: number[] = [];
    if (entityId) {
      // For fragment reads, use the entity's fingerprint
      if (FINGERPRINT_KEY in data) {
        rootFingerprints.push((data as any)[FINGERPRINT_KEY]);
      }
    } else {
      // For regular queries, collect fingerprints from all root fields
      for (let i = 0; i < plan.root.length; i++) {
        const field = plan.root[i];
        const value = data[field.responseKey];
        if (value && typeof value === "object" && FINGERPRINT_KEY in value) {
          rootFingerprints.push((value as any)[FINGERPRINT_KEY]);
        }
      }
    }

    const rootFingerprint = rootFingerprints.length > 0
      ? fingerprintNodes(0, rootFingerprints)
      : 0; // Default fingerprint for empty results

    if (!requestedOK) {
      return {
        data: undefined,
        dependencies,
        fingerprint: 0, // No data = no fingerprint
        source: "none",
        ok: { strict: strictOK, canonical: canonicalOK, miss: __DEV__ ? misses : undefined },
      };
    }

    return {
      data,
      dependencies,
      fingerprint: rootFingerprint,
      source: canonical ? "canonical" : "strict",
      ok: { strict: strictOK, canonical: canonicalOK, miss: __DEV__ ? misses : undefined },
    };
  };

  return {
    normalizeDocument,
    materializeDocument,
  };
};
