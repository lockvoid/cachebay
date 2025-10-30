import { buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey } from "../compiler";
import {
  ROOT_ID,
  TYPENAME_FIELD,
  CONNECTION_EDGES_FIELD,
  CONNECTION_PAGE_INFO_FIELD,
  CONNECTION_NODE_FIELD,
} from "./constants";
import { __DEV__ } from "./instrumentation";
import { fingerprintNodes } from "./utils";
import type { CachePlan, PlanField } from "../compiler";
import type { CanonicalInstance } from "./canonical";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentNode } from "graphql";

/**
 * Dependencies required by documents instance
 */
export type DocumentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  canonical: CanonicalInstance;
};

export const ENTITY_MISSING = "entity-missing";
export const ROOT_LINK_MISSING = "root-link-missing";
export const FIELD_LINK_MISSING = "field-link-missing";
export const CONNECTION_MISSING = "connection-missing";
export const PAGE_INFO_MISSING = "pageinfo-missing";
export const EDGE_NODE_MISSING = "edge-node-missing";
export const SCALAR_MISSING = "scalar-missing";
export const FINGERPRINT_KEY = "__version";

/**
 * Represents a cache miss during materialization
 * Used for debugging incomplete reads in development mode
 */
export type Miss =
  | { kind: typeof ENTITY_MISSING; at: string; id: string }
  | { kind: typeof ROOT_LINK_MISSING; at: string; fieldKey: string }
  | { kind: typeof FIELD_LINK_MISSING; at: string; parentId: string; fieldKey: string }
  | { kind: typeof CONNECTION_MISSING; at: string; mode: "strict" | "canonical"; parentId: string; canonicalKey: string; strictKey: string; hasCanonical: boolean; hasStrict: boolean; }
  | { kind: typeof PAGE_INFO_MISSING; at: string; pageId: string }
  | { kind: typeof EDGE_NODE_MISSING; at: string; edgeId: string }
  | { kind: typeof SCALAR_MISSING; at: string; parentId: string; fieldKey: string };

/**
 * Options for normalizing a document into cache
 */
export type normalizeOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  data: any;
  rootId?: string;
};

/**
 * Result of normalizing a document (void for now, may add stats later)
 */
export type normalizeResult = void;

/**
 * Options for materializing a document from cache
 */
export type materializeOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  canonical?: boolean;
  rootId?: string;
  fingerprint?: boolean;
  /** If true, try to read from cache first, fallback to full materialization. Default: true (prefer cache) */
  preferCache?: boolean;
  /** If true, update the materialize cache with the result. Default: false (don't pollute cache) */
  updateCache?: boolean;
};

/**
 * Result of materializing a document from cache
 */
export type materializeResult = {
  data: any;
  fingerprints: any; // Mirrors data structure, contains only __version values
  dependencies: Set<string>;
  source: "canonical" | "strict" | "none";
  ok: {
    strict: boolean;
    canonical: boolean;
    miss?: Miss[];
    strictSignature?: string;      // Strict signature for this materialization
    canonicalSignature?: string;   // Canonical signature for this materialization
  };
  hot: boolean; // true if result came from materializeCache, false if computed
};

/**
 * Options for invalidating a materialized document from cache
 */
export type invalidateOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  canonical?: boolean;
  rootId?: string;
  fingerprint?: boolean;
};

/**
 * Documents instance type
 */
export type DocumentsInstance = ReturnType<typeof createDocuments>;


/**
 * Create documents instance for normalization and materialization
 * Handles writing GraphQL responses to cache and reading them back
 */
export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, planner, canonical } = deps;

  /**
   * WeakMap cache for materialized documents
   * Key: DocumentNode or CachePlan object
   * Value: Map of signature -> materializeResult
   */
  const materializeCache = new Map();

  /**
   * Helper to build materialize cache key
   * For regular queries: use precomputed signature + fingerprint flag
   * For rootId queries: prefix with rootId to ensure separate cache entries
   */
  const getMaterializeCacheKey = (options: {
    signature: string;
    fingerprint: boolean;
    rootId?: string;
  }): string => {
    const { signature, fingerprint, rootId } = options;
    const fpFlag = fingerprint ? "f" : "n";

    return rootId
      ? `entity:${rootId}|${fpFlag}|${signature}`
      : `${fpFlag}|${signature}`;
  };

  /**
   * Normalize a GraphQL response into the cache
   * Writes entities, connections, and links to the graph store
   */
  const normalize = (options: normalizeOptions) => {
    const { document, variables = {}, data, rootId } = options;

    const put = (id: string, patch: Record<string, any>) => {
      graph.putRecord(id, patch);
    };

    const plan = planner.getPlan(document);
    const startId = rootId ?? ROOT_ID;
    const shouldLink = (startId !== ROOT_ID) || (plan.operation === "query");

    // Create root record metadata only for root IDs (@ or @mutation.X or @subscription.X)
    // Don't create for entity IDs (User:123) used in fragment normalization
    const isRootId = startId === ROOT_ID || startId.startsWith("@mutation.") || startId.startsWith("@subscription.");
    if (isRootId) {
      put(startId, { id: startId, __typename: startId });
    }

    type Frame = {
      parentId: string;
      fields?: readonly PlanField[];
      fieldsMap?: Map<string, PlanField>;
      insideConnection: boolean;
      pageKey: string | null;
    };

    const connectionPages = [];

    const initialFrame = {
      parentId: startId,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map(),
      insideConnection: false,
      pageKey: null,
    };

    const writeScalar = (parentId: string, field: PlanField, value: any) => {
      const fieldKey = buildFieldKey(field, variables);
      put(parentId, { [fieldKey]: value });
    };

    const linkTo = (parentId: string, field: PlanField, targetId: string) => {
      if (!shouldLink) {
        return;
      }
      const fieldKey = buildFieldKey(field, variables);
      put(parentId, { [fieldKey]: { __ref: targetId } });
    };

    const normalizeObjectFields = (obj: any, frame: Frame) => {
      const keys = Object.keys(obj);

      for (let i = 0; i < keys.length; i++) {
        const responseKey = keys[i];
        const value = obj[responseKey];
        const field = frame.fieldsMap?.get(responseKey);

        normalizeValue(value, responseKey, field, frame);
      }
    };

    const normalizeEdgesArray = (pageKey: string, edges: any[], edgesField: PlanField | undefined) => {
      const refs = new Array(edges.length);

      for (let i = 0; i < edges.length; i++) {
        refs[i] = `${pageKey}.edges.${i}`;
      }

      put(pageKey, { edges: { __refs: refs } });

      if (!edgesField?.selectionSet) {
        return;
      }

      const edgesSel = edgesField.selectionSet;
      const edgesSelMap = edgesField.selectionMap;

      for (let idx = 0; idx < edges.length; idx++) {
        const edgeKey = `${pageKey}.edges.${idx}`;
        const edgeObj = edges[idx];
        const edgePatch = {};

        if (edgeObj && edgeObj.__typename) {
          edgePatch.__typename = edgeObj.__typename;
        }

        const nodeObj = edgeObj?.node;

        if (nodeObj && typeof nodeObj === "object") {
          const nodeId = graph.identify(nodeObj);

          if (nodeId) {
            edgePatch.node = { __ref: nodeId };
          }
        }

        put(edgeKey, edgePatch);

        const edgeFrame = {
          parentId: edgeKey,
          fields: edgesSel,
          fieldsMap: edgesSelMap,
          insideConnection: true,
          pageKey,
        };

        if (edgeObj && typeof edgeObj === "object") {
          normalizeObjectFields(edgeObj, edgeFrame);
        }
      }
    };

    const normalizeConnection = (value: any, field: PlanField, frame: Frame) => {
      const pageKey = buildConnectionKey(field, frame.parentId, variables);
      const fieldKey = buildFieldKey(field, variables);
      const pageRecord = {};

      if (value?.__typename) {
        pageRecord.__typename = value.__typename;
      }

      if (value && typeof value === "object") {
        const keys = Object.keys(value);

        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];

          if (key === TYPENAME_FIELD || key === CONNECTION_EDGES_FIELD || key === CONNECTION_PAGE_INFO_FIELD) {
            continue;
          }

          const fieldValue = value[key];
          const isScalarLike = fieldValue === null || typeof fieldValue !== "object";
          const isInlineObject = fieldValue && typeof fieldValue === "object" && !fieldValue.__typename;

          if (isScalarLike || Array.isArray(fieldValue) || isInlineObject) {
            pageRecord[key] = fieldValue;
          }
        }
      }

      put(pageKey, pageRecord);

      if (shouldLink) {
        put(frame.parentId, { [fieldKey]: { __ref: pageKey } });
        connectionPages.push({ field, parentId: frame.parentId, pageKey });
      }

      const pageInfoObj = value?.pageInfo;

      if (pageInfoObj && typeof pageInfoObj === "object") {
        const pageInfoKey = `${pageKey}.pageInfo`;

        put(pageKey, { pageInfo: { __ref: pageInfoKey } });

        if (pageInfoObj.__typename) {
          put(pageInfoKey, { __typename: pageInfoObj.__typename });
        } else {
          put(pageInfoKey, {});
        }
      }

      const nextFrame = {
        parentId: pageKey,
        fields: field.selectionSet,
        fieldsMap: field.selectionMap,
        insideConnection: true,
        pageKey,
      };

      if (value && typeof value === "object") {
        normalizeObjectFields(value, nextFrame);
      }
    };

    const normalizeArrayOfObjectsWithSelection = (arr: any[], field: PlanField, frame: Frame) => {
      const fieldKey = buildFieldKey(field, variables);
      const baseKey = `${frame.parentId}.${fieldKey}`;
      const refs = new Array(arr.length);

      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        const rootId = (item && typeof item === "object") ? graph.identify(item) : null;
        const itemKey = rootId ?? `${baseKey}.${i}`;

        if (item && typeof item === "object") {
          if (item.__typename) {
            put(itemKey, { __typename: item.__typename });
          } else {
            put(itemKey, {});
          }
        }

        refs[i] = itemKey;
      }

      put(frame.parentId, { [fieldKey]: { __refs: refs } });

      if (!field.selectionSet) {
        return;
      }

      for (let i = 0; i < arr.length; i++) {
        const val = arr[i];

        if (!val || typeof val !== "object") {
          continue;
        }

        const rootId = graph.identify(val);
        const itemKey = rootId ?? `${baseKey}.${i}`;

        const itemFrame = {
          parentId: itemKey,
          fields: field.selectionSet,
          fieldsMap: field.selectionMap,
          insideConnection: false,
          pageKey: baseKey,
        };

        normalizeObjectFields(val, itemFrame);
      }
    };

    const normalizeArray = (arr: any[], responseKey: string | number, field: PlanField | undefined, frame: Frame) => {
      if (frame.insideConnection && responseKey === CONNECTION_EDGES_FIELD && typeof frame.pageKey === "string") {
        normalizeEdgesArray(frame.pageKey, arr, field, frame);
        return;
      }

      if (field && field.selectionSet) {
        normalizeArrayOfObjectsWithSelection(arr, field, frame);
        return;
      }

      if (field && !field.selectionSet) {
        const fieldKey = buildFieldKey(field, variables);
        const out = new Array(arr.length);

        for (let i = 0; i < arr.length; i++) {
          out[i] = arr[i];
        }

        put(frame.parentId, { [fieldKey]: out });
      }
    };

    const normalizeInlineContainer = (obj: any, field: PlanField, frame: Frame) => {
      const containerFieldKey = buildFieldKey(field, variables);
      const containerKey = `${frame.parentId}.${containerFieldKey}`;

      if (obj?.__typename) {
        put(containerKey, { __typename: obj.__typename });
      } else {
        put(containerKey, {});
      }

      if (shouldLink) {
        put(frame.parentId, { [containerFieldKey]: { __ref: containerKey } });
      }

      if (frame.insideConnection && containerFieldKey === CONNECTION_PAGE_INFO_FIELD && frame.pageKey) {
        put(frame.pageKey, { [CONNECTION_PAGE_INFO_FIELD]: { __ref: containerKey } });
      }

      const nextFrame = {
        parentId: containerKey,
        fields: field.selectionSet,
        fieldsMap: field.selectionMap,
        insideConnection: frame.insideConnection,
        pageKey: frame.pageKey,
      };

      normalizeObjectFields(obj, nextFrame);
    };

    const normalizeEntityObject = (obj: any, field: PlanField | undefined, frame: Frame) => {
      const rootId = graph.identify(obj);

      if (!rootId) {
        return false;
      }

      if (obj.__typename) {
        put(rootId, { __typename: obj.__typename });
      } else {
        put(rootId, {});
      }

      if (field && !(frame.insideConnection && field.responseKey === CONNECTION_NODE_FIELD)) {
        linkTo(frame.parentId, field, rootId);
      }

      const fromNode = !!field && field.responseKey === CONNECTION_NODE_FIELD;
      const nextFrame = {
        parentId: rootId,
        fields: field?.selectionSet,
        fieldsMap: field?.selectionMap,
        insideConnection: fromNode ? false : frame.insideConnection,
        pageKey: fromNode ? null : frame.pageKey,
      };

      normalizeObjectFields(obj, nextFrame);

      return true;
    };

    const normalizeValue = (value: any, responseKey: string | number, field: PlanField | undefined, frame: Frame) => {
      if (Array.isArray(value)) {
        normalizeArray(value, responseKey, field, frame);
        return;
      }

      // Handle null values for fields with selectionSet (e.g., errors: null)
      if (value === null && field && field.selectionSet) {
        // Store null as a link so materialization knows it's a valid null, not missing
        const fieldKey = buildFieldKey(field, variables);
        put(frame.parentId, { [fieldKey]: null });
        return;
      }

      if (value && typeof value === "object") {
        if (field && !field.selectionSet) {
          writeScalar(frame.parentId, field, value);
          return;
        }

        if (field && (field as any).isConnection) {
          normalizeConnection(value, field, frame);
          return;
        }

        if (normalizeEntityObject(value, field, frame)) {
          return;
        }

        if (field && field.selectionSet) {
          normalizeInlineContainer(value, field, frame);
          return;
        }

        return;
      }

      if (typeof responseKey === "string" && field && !field.selectionSet) {
        writeScalar(frame.parentId, field, value);
      }
    };

    if (data && typeof data === "object") {
      normalizeObjectFields(data, initialFrame);
    }

    if (connectionPages.length > 0) {
      for (let i = 0; i < connectionPages.length; i++) {
        const { field, parentId, pageKey } = connectionPages[i];
        const normalizedPage = graph.getRecord(pageKey);

        if (!normalizedPage) {
          continue;
        }

        canonical.updateConnection({
          field,
          parentId,
          variables,
          pageKey,
          normalizedPage,
        });
      }
    }
  };

  /**
   * Materialize a document from cache
   * Reads normalized data and reconstructs the GraphQL response shape
   *
   * @param options.preferCache - If true, try to read from cache first, fallback to full materialization. Default: true
   * @param options.updateCache - If true, update the materialize cache with the result. Default: false
   */
  const materialize = (options: materializeOptions): materializeResult => {
    const { document, variables = {}, canonical = true, rootId, fingerprint = true, preferCache = true, updateCache = false } = options;

    // Get plan once at the start
    const plan = planner.getPlan(document);

    const strictSignature = plan.makeSignature(false, variables);
    const canonicalSignature = canonical ? plan.makeSignature(true, variables) : undefined;
    const cacheKey = getMaterializeCacheKey({ signature: canonical ? canonicalSignature! : strictSignature, fingerprint, rootId });

    // Try to read from cache if preferCache is true
    if (preferCache) {
      const cached = materializeCache.get(cacheKey);

      if (cached) {
        cached.hot = true;

        return cached;
      }
    }

    graph.flush();

    const dependencies = new Set();

    const touch = (id: string) => {
      dependencies.add(id);
    };

    let strictOK = true;
    let canonicalOK = true;

    const misses = [];
    const miss = __DEV__ ? (m: Miss) => { misses.push(m); } : (_: Miss) => { };
    const addPath = __DEV__
      ? (base: string, seg: string) => (base ? base + "." + seg : seg)
      : (_base: string, _seg: string) => "";

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

    // Helper to set fingerprint on the fingerprint object
    const setFingerprint = (fpOut: any, fp: number) => {
      if (!fingerprint || !fpOut) {
        return;
      }
      fpOut[FINGERPRINT_KEY] = fp;
    };

    const readScalar = (record: any, field: PlanField, out: any, outKey: string, parentId: string, path: string) => {
      if (field.fieldName === TYPENAME_FIELD) {
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

    const readPageInfo = (pageInfoId: string, field: PlanField, outConn: any, fpPageInfo: any, path: string) => {
      touch(pageInfoId);

      const record = graph.getRecord(pageInfoId) || {};
      const selection = field.selectionSet;
      const outPageInfo: any = {};

      if (selection) {
        for (let i = 0; i < selection.length; i++) {
          const f = selection[i];

          if (f.selectionSet) {
            continue;
          }

          readScalar(record, f, outPageInfo, f.responseKey, pageInfoId, addPath(path, f.responseKey));
        }
      }

      outConn.pageInfo = outPageInfo;

      const pageInfoVersion = graph.getVersion(pageInfoId);

      setFingerprint(fpPageInfo, pageInfoVersion);

      return pageInfoVersion;
    };

    const readEntity = (id: string, field: PlanField, out: any, fpOut: any, path: string) => {
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
      const selection = field.selectionSet;
      const childFingerprints = [];

      if (selection) {
        for (let i = 0; i < selection.length; i++) {
          const childField = selection[i];
          const outKey = childField.responseKey;

          if (!selectionAppliesToRuntime(childField, runtimeType)) {
            continue;
          }

          if ((childField as any).isConnection) {
            const childFp = {};
            if (fingerprint) fpOut[outKey] = childFp;
            readConnection(id, childField, out, outKey, childFp, addPath(path, outKey));
            if (childFp[FINGERPRINT_KEY] !== undefined) {
              childFingerprints.push(childFp[FINGERPRINT_KEY]);
            }
            continue;
          }

          if (childField.selectionSet?.length) {
            const storeKey = buildFieldKey(childField, variables);
            const link = (snapshot as any)[storeKey];

            if (link != null && Array.isArray(link.__refs)) {
              const refs = link.__refs;
              const outArray = new Array(refs.length);

              out[outKey] = outArray;

              if (fingerprint) {
                const arrayFingerprints = [];
                const fpArray: any[] = [];
                fpOut[outKey] = fpArray;

                for (let j = 0; j < refs.length; j++) {
                  const childOut: any = {};
                  const childFp: any = {};
                  outArray[j] = childOut;
                  fpArray[j] = childFp;
                  readEntity(refs[j], childField, childOut, childFp, addPath(path, outKey + "[" + j + "]"));

                  if (childFp[FINGERPRINT_KEY] !== undefined) {
                    arrayFingerprints.push(childFp[FINGERPRINT_KEY]);
                  }
                }

                if (arrayFingerprints.length > 0) {
                  const arrayFp = fingerprintNodes(0, arrayFingerprints);
                  setFingerprint(fpArray, arrayFp);
                  childFingerprints.push(arrayFp);
                }
              } else {
                for (let j = 0; j < refs.length; j++) {
                  const childOut: any = {};
                  outArray[j] = childOut;
                  readEntity(refs[j], childField, childOut, {}, addPath(path, outKey + "[" + j + "]"));
                }
              }

              continue;
            }

            if (!link || !link.__ref) {
              // null is a valid value, not a cache miss
              if (link === null) {
                out[outKey] = null;
                continue;
              }
              // undefined means the field is missing from cache
              out[outKey] = undefined;
              strictOK = false;
              canonicalOK = false;
              miss({ kind: FIELD_LINK_MISSING, at: addPath(path, outKey), parentId: id, fieldKey: storeKey });
              continue;
            }

            const childId = link.__ref as string;
            const childOut: any = {};
            const childFp: any = {};
            out[outKey] = childOut;
            if (fingerprint) fpOut[outKey] = childFp;
            readEntity(childId, childField, childOut, childFp, addPath(path, outKey));
            if (childFp[FINGERPRINT_KEY] !== undefined) {
              childFingerprints.push(childFp[FINGERPRINT_KEY]);
            }
            continue;
          }

          readScalar(snapshot, childField, out, outKey, id, addPath(path, outKey));
        }
      }

      if (field.selectionSet?.length) {
        for (let i = 0; i < field.selectionSet.length; i++) {
          const pf = field.selectionSet[i];

          if (pf.selectionSet) {
            continue;
          }
          if (out[pf.responseKey] !== undefined) {
            continue;
          }

          const storeKey = buildFieldKey(pf, variables);

          if (snapshot && storeKey in (snapshot as any)) {
            out[pf.responseKey] = (snapshot as any)[storeKey];
          }
        }
      }

      const entityVersion = graph.getVersion(id);

      const finalFingerprint = childFingerprints.length > 0 ? fingerprintNodes(entityVersion, childFingerprints) : entityVersion;

      setFingerprint(fpOut, finalFingerprint);
    };

    const readEdge = (edgeId: string, field: PlanField, outArray: any[], fpArray: any[], index: number, path: string) => {
      const record = graph.getRecord(edgeId) || {};
      const outEdge: any = {};
      const fpEdge: any = {};
      outArray[index] = outEdge;
      if (fingerprint) fpArray[index] = fpEdge;

      if ((record as any).__typename !== undefined) {
        outEdge.__typename = (record as any).__typename;
      }

      const selection = field.selectionSet;
      const nodePlan = (field as any).selectionMap ? (field as any).selectionMap.get(CONNECTION_NODE_FIELD) : undefined;

      let nodeFingerprint;

      if (selection) {
        for (let i = 0; i < selection.length; i++) {
          const f = selection[i];
          const outKey = f.responseKey;

          if (outKey === CONNECTION_NODE_FIELD) {
            const nlink = (record as any).node;

            if (!nlink || !nlink.__ref) {
              // null is a valid value, not a cache miss
              if (nlink === null) {
                outEdge.node = null;
                continue;
              }
              // undefined means the field is missing from cache
              outEdge.node = undefined;
              strictOK = false;
              canonicalOK = false;
              miss({ kind: EDGE_NODE_MISSING, at: addPath(path, CONNECTION_NODE_FIELD), edgeId });
              continue;
            }

            const nodeId = nlink.__ref as string;
            const nodeOut: any = {};
            const nodeFp: any = {};
            outEdge.node = nodeOut;
            if (fingerprint) fpEdge.node = nodeFp;
            readEntity(nodeId, nodePlan as PlanField, nodeOut, nodeFp, addPath(path, CONNECTION_NODE_FIELD));
            nodeFingerprint = nodeFp[FINGERPRINT_KEY];
          } else if (!f.selectionSet) {
            readScalar(record, f, outEdge, outKey, edgeId, addPath(path, outKey));
          }
        }
      }

      const edgeVersion = graph.getVersion(edgeId);

      const finalFingerprint = nodeFingerprint !== undefined ? fingerprintNodes(edgeVersion, [nodeFingerprint]) : edgeVersion;

      setFingerprint(fpEdge, finalFingerprint);
    };

    const readConnection = (parentId: string, field: PlanField, out: any, outKey: string, fpOut: any, path: string) => {
      // Optimization: only build and fetch the key we need
      const baseIsCanonical = canonical === true;
      const baseKey = baseIsCanonical 
        ? buildConnectionCanonicalKey(field, parentId, variables)
        : buildConnectionKey(field, parentId, variables);

      touch(baseKey);

      const page = graph.getRecord(baseKey);

      // Update OK flags - we need to check both for correctness
      if (baseIsCanonical) {
        canonicalOK &&= !!page;
        // Also check if strict exists for the OK tracking
        const strictKey = buildConnectionKey(field, parentId, variables);
        const pageStrict = graph.getRecord(strictKey);
        strictOK &&= !!pageStrict;
      } else {
        strictOK &&= !!page;
        // Also check if canonical exists for the OK tracking
        const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
        const pageCanonical = graph.getRecord(canonicalKey);
        canonicalOK &&= !!pageCanonical;
      }

      const conn: any = { edges: [], pageInfo: {} };
      out[outKey] = conn;

      if (!page) {
        // For miss reporting, we need both keys
        const canonicalKey = baseIsCanonical ? baseKey : buildConnectionCanonicalKey(field, parentId, variables);
        const strictKey = baseIsCanonical ? buildConnectionKey(field, parentId, variables) : baseKey;
        const pageCanonical = baseIsCanonical ? page : graph.getRecord(canonicalKey);
        const pageStrict = baseIsCanonical ? graph.getRecord(strictKey) : page;
        
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

      const selMap = (field as any).selectionMap;

      if (!selMap || selMap.size === 0) {
        return;
      }

      let pageInfoFingerprint;
      const edgeFingerprints = [];

      for (const [responseKey, childField] of selMap) {
        if (responseKey === CONNECTION_PAGE_INFO_FIELD) {
          const pageInfoLink = page.pageInfo;

          if (pageInfoLink && pageInfoLink.__ref) {
            const fpPageInfo: any = {};
            if (fingerprint) fpOut.pageInfo = fpPageInfo;
            pageInfoFingerprint = readPageInfo(pageInfoLink.__ref as string, childField, conn, fpPageInfo, addPath(path, CONNECTION_PAGE_INFO_FIELD));
          } else {
            conn.pageInfo = {};
            strictOK = false;
            canonicalOK = false;
            miss({ kind: PAGE_INFO_MISSING, at: addPath(path, CONNECTION_PAGE_INFO_FIELD), pageId: baseKey + "." + CONNECTION_PAGE_INFO_FIELD });
          }
          continue;
        }

        if (responseKey === CONNECTION_EDGES_FIELD) {
          const refs = page.edges.__refs;
          const outArr = new Array(refs.length);
          const fpArr: any[] = [];
          conn.edges = outArr;
          if (fingerprint) fpOut.edges = fpArr;

          for (let i = 0; i < refs.length; i++) {
            readEdge(refs[i], childField, outArr, fpArr, i, addPath(path, "edges[" + i + "]"));

            if (fpArr[i] && fpArr[i][FINGERPRINT_KEY] !== undefined) {
              edgeFingerprints.push(fpArr[i][FINGERPRINT_KEY]);
            }
          }

          if (edgeFingerprints.length > 0) {
            const edgesArrayFp = fingerprintNodes(0, edgeFingerprints);
            setFingerprint(fpArr, edgesArrayFp);
          }

          continue;
        }

        if (!childField.selectionSet) {
          readScalar(page, childField, conn, childField.responseKey, baseKey, addPath(path, childField.responseKey));
          continue;
        }

        if ((childField as any).isConnection) {
          const childFp = {};
          if (fingerprint) fpOut[childField.responseKey] = childFp;
          readConnection(baseKey, childField, conn, childField.responseKey, childFp, addPath(path, childField.responseKey));
          continue;
        }

        const link = page[buildFieldKey(childField, variables)];

        if (link != null && Array.isArray(link.__refs)) {
          const refs = link.__refs;
          const outArray = new Array(refs.length);
          conn[childField.responseKey] = outArray;

          if (fingerprint) {
            const fpArray: any[] = [];
            fpOut[childField.responseKey] = fpArray;

            for (let j = 0; j < refs.length; j++) {
              const childOut: any = {};
              const childFp: any = {};
              outArray[j] = childOut;
              fpArray[j] = childFp;
              readEntity(refs[j], childField, childOut, childFp, addPath(path, childField.responseKey + "[" + j + "]"));
            }
          } else {
            for (let j = 0; j < refs.length; j++) {
              const childOut: any = {};
              outArray[j] = childOut;
              readEntity(refs[j], childField, childOut, {}, addPath(path, childField.responseKey + "[" + j + "]"));
            }
          }

          continue;
        }

        if (!link || !link.__ref) {
          // null is a valid value, not a cache miss
          if (link === null) {
            conn[childField.responseKey] = null;
            continue;
          }
          // undefined means the field is missing from cache
          conn[childField.responseKey] = undefined;
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
        const childFp: any = {};
        conn[childField.responseKey] = childOut;
        if (fingerprint) fpOut[childField.responseKey] = childFp;
        readEntity(childId, childField, childOut, childFp, addPath(path, childField.responseKey));
      }

      const pageVersion = graph.getVersion(baseKey);

      const connChildren = [];
      if (pageInfoFingerprint !== undefined) {
        connChildren.push(pageInfoFingerprint);
      }
      if (edgeFingerprints.length > 0) {
        connChildren.push(fingerprintNodes(0, edgeFingerprints));
      }

      const connFingerprint = connChildren.length > 0
        ? fingerprintNodes(pageVersion, connChildren)
        : pageVersion;
      setFingerprint(fpOut, connFingerprint);
    };

    const data = {};
    const fingerprints = fingerprint ? {} : undefined;

    // Determine if rootId is actually a root ID (@ or @mutation.X or @subscription.X)
    const isRootId = rootId && (rootId === ROOT_ID || rootId.startsWith('@mutation.') || rootId.startsWith('@subscription.'));
    
    if (rootId && !isRootId) {
      // Fragment materialization - read from entity
      const synthetic = { selectionSet: plan.root, selectionMap: plan.rootSelectionMap } as unknown as PlanField;
      readEntity(rootId, synthetic, data, fingerprints, rootId);
    } else {
      // Query/Mutation/Subscription - read from root record
      const actualRootId = rootId || ROOT_ID;
      const rootRecord = graph.getRecord(actualRootId) || {};
      const rootSelection = plan.root;

      for (let i = 0; i < rootSelection.length; i++) {
        const field = rootSelection[i];
        const path = addPath(actualRootId, field.responseKey);

        if ((field as any).isConnection) {
          const fieldFp = {};
          if (fingerprint) fingerprints[field.responseKey] = fieldFp;
          readConnection(actualRootId, field, data, field.responseKey, fieldFp, path);
          continue;
        }

        if (field.selectionSet?.length) {
          const fieldKey = buildFieldKey(field, variables);
          touch(actualRootId + "." + fieldKey);

          const link = (rootRecord as any)[fieldKey];

          if (!link || !link.__ref) {
            // null is a valid value, not a cache miss
            if (link === null) {
              data[field.responseKey] = null;
              continue;
            }
            // undefined means the field is missing from cache
            data[field.responseKey] = undefined;
            strictOK = false;
            canonicalOK = false;
            miss({ kind: ROOT_LINK_MISSING, at: path, fieldKey });
          } else {
            const childId = link.__ref as string;
            const childOut: any = {};
            const childFp: any = {};
            data[field.responseKey] = childOut;
            if (fingerprint) fingerprints[field.responseKey] = childFp;
            readEntity(childId, field, childOut, childFp, addPath(path, childId));
          }
        } else {
          readScalar(rootRecord, field, data, field.responseKey, actualRootId, path);
        }
      }
    }

    const requestedOK = canonical ? canonicalOK : strictOK;
    
    // Compute and set root fingerprint
    if (requestedOK && fingerprint) {
      const rootFingerprints = [];
      if (rootId && !isRootId) {
        // Fragment - single entity fingerprint
        const fp = fingerprints[FINGERPRINT_KEY];
        if (fp !== undefined) rootFingerprints.push(fp);
      } else {
        // Query/Mutation/Subscription - collect fingerprints from root fields
        for (let i = 0; i < plan.root.length; i++) {
          const field = plan.root[i];
          const fieldFp = fingerprints[field.responseKey];
          if (fieldFp && fieldFp[FINGERPRINT_KEY] !== undefined) {
            rootFingerprints.push(fieldFp[FINGERPRINT_KEY]);
          }
        }
      }

      if (rootFingerprints.length > 0) {
        const rootFingerprint = fingerprintNodes(0, rootFingerprints);
        fingerprints[FINGERPRINT_KEY] = rootFingerprint;
      }
    }

    // Create result object (either "none" or with data)
    const result: materializeResult = !requestedOK
      ? {
        data: undefined,
        fingerprints: undefined,
        dependencies,
        source: "none",
        ok: {
          strict: strictOK,
          canonical: canonicalOK,
          miss: __DEV__ ? misses : undefined,
          strictSignature,
          canonicalSignature,
        },
        hot: false,
      }
      : {
        data,
        fingerprints,
        dependencies,
        source: canonical ? "canonical" : "strict",
        ok: {
          strict: strictOK,
          canonical: canonicalOK,
          miss: __DEV__ ? misses : undefined,
          strictSignature,
          canonicalSignature,
        },
        hot: false,
      };

    // Only update cache if updateCache is true
    if (updateCache) {
      materializeCache.set(cacheKey, result);
    }

    return result;
  };

  /**
   * Invalidate a materialized document from cache
   * Removes the cached result for the given document/variables combination
   *
   * @param options - Options matching the materialization parameters
   */
  const invalidate = (options: invalidateOptions): void => {
    const { document, variables = {}, canonical = true, rootId, fingerprint = true } = options;

    // Get plan and build cache key the same way as materialize
    const plan = planner.getPlan(document);
    const signature = canonical ? plan.makeSignature(true, variables) : plan.makeSignature(false, variables);
    const cacheKey = getMaterializeCacheKey({ signature, fingerprint, rootId });

    materializeCache.delete(cacheKey);
  };

  return {
    normalize,
    materialize,
    invalidate,
  };
};
