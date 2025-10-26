import { buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, fingerprintNodes } from "./utils";
import { ROOT_ID } from "./constants";
import { __DEV__ } from "./instrumentation";
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
export type NormalizeDocumentOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  data: any;
  rootId?: string;
};

/**
 * Result of normalizing a document (void for now, may add stats later)
 */
export type NormalizeDocumentResult = void;

/**
 * Options for materializing a document from cache
 */
export type MaterializeDocumentOptions = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
  canonical?: boolean;
  entityId?: string;
  fingerprint?: boolean;
  force?: boolean;
};

/**
 * Result of materializing a document from cache
 */
export type MaterializeDocumentResult = {
  data: any;
  dependencies: Set<string>;
  source: "canonical" | "strict" | "none";
  ok: { strict: boolean; canonical: boolean; miss?: Miss[] };
  hot: boolean; // true if result came from materializeCache, false if computed
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
   * Value: Map of signature -> MaterializeDocumentResult
   */
  const materializeCache = new WeakMap<DocumentNode | CachePlan, Map<string, MaterializeDocumentResult>>();

  /**
   * Create a cache signature from materialization options
   */
  const makeMaterializeSignature = (
    variables: Record<string, any>,
    canonical: boolean,
    fingerprint: boolean,
    entityId?: string
  ): string => {
    const parts = [
      JSON.stringify(variables),
      canonical ? 'c' : 's',
      fingerprint ? 'f' : 'n'
    ];
    if (entityId) parts.push(entityId);
    return parts.join('|');
  };

  /**
   * Normalize a GraphQL response into the cache
   * Writes entities, connections, and links to the graph store
   */
  const normalizeDocument = (options: NormalizeDocumentOptions) => {
    const { document, variables = {}, data, rootId } = options;

    const put = (id: string, patch: Record<string, any>) => {
      graph.putRecord(id, patch);
    };

    const plan = planner.getPlan(document);
    const startId = rootId ?? ROOT_ID;
    const shouldLink = (startId !== ROOT_ID) || (plan.operation === "query");

    if (startId === ROOT_ID) {
      put(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
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

    const normalizeEdgesArray = (pageKey: string, edges: any[], edgesField: PlanField | undefined, parentFrame: Frame) => {
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

          if (key === "__typename" || key === "edges" || key === "pageInfo") {
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
        const entityId = (item && typeof item === "object") ? graph.identify(item) : null;
        const itemKey = entityId ?? `${baseKey}.${i}`;

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

        const entityId = graph.identify(val);
        const itemKey = entityId ?? `${baseKey}.${i}`;

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
      if (frame.insideConnection && responseKey === "edges" && typeof frame.pageKey === "string") {
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

      if (frame.insideConnection && containerFieldKey === "pageInfo" && frame.pageKey) {
        put(frame.pageKey, { pageInfo: { __ref: containerKey } });
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
      const entityId = graph.identify(obj);

      if (!entityId) {
        return false;
      }

      if (obj.__typename) {
        put(entityId, { __typename: obj.__typename });
      } else {
        put(entityId, {});
      }

      if (field && !(frame.insideConnection && field.responseKey === "node")) {
        linkTo(frame.parentId, field, entityId);
      }

      const fromNode = !!field && field.responseKey === "node";
      const nextFrame = {
        parentId: entityId,
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
   * @param options.force - If false (default), returns cached result if available. If true, always re-materializes.
   */
  const materializeDocument = (options: MaterializeDocumentOptions): MaterializeDocumentResult => {
    const { document, variables = {}, canonical = true, entityId, fingerprint = true, force = false } = options;

    // Check cache if not forcing re-materialization
    if (!force) {
      const plan = planner.getPlan(document);
      const signature = makeMaterializeSignature(variables, canonical, fingerprint, entityId);
      
      let docCache = materializeCache.get(plan);
      if (docCache) {
        const cached = docCache.get(signature);
        if (cached) {
          // Mark as hot and return the cached object
          cached.hot = true;
          return cached;
        }
      }
    }

    graph.flush();

    const plan = planner.getPlan(document);
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

    const setFingerprint = (obj: any, fp: number) => {
      if (!fingerprint) {
        return;
      }

      if (Array.isArray(obj)) {
        Object.defineProperty(obj, FINGERPRINT_KEY, {
          value: fp,
          writable: true,
          enumerable: false,
          configurable: true,
        });
      } else {
        obj[FINGERPRINT_KEY] = fp;
      }
    };

    const getFingerprint = (obj: any) => {
      if (!fingerprint) {
        return undefined;
      }
      return obj[FINGERPRINT_KEY];
    };

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

    const readPageInfo = (pageInfoId: string, field: PlanField, outConn: any, path: string) => {
      touch(pageInfoId);

      const record = graph.getRecord(pageInfoId) || {};
      const selection = field.selectionSet || [];
      const outPageInfo: any = {};

      for (let i = 0; i < selection.length; i++) {
        const f = selection[i];

        if (f.selectionSet) {
          continue;
        }

        readScalar(record, f, outPageInfo, f.responseKey, pageInfoId, addPath(path, f.responseKey));
      }

      outConn.pageInfo = outPageInfo;

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
      const childFingerprints = [];

      for (let i = 0; i < selection.length; i++) {
        const childField = selection[i];
        const outKey = childField.responseKey;

        if (!selectionAppliesToRuntime(childField, runtimeType)) {
          continue;
        }

        if ((childField as any).isConnection) {
          readConnection(id, childField, out, outKey, addPath(path, outKey));
          const connObj = out[outKey];
          if (connObj && typeof connObj === "object") {
            const fp = getFingerprint(connObj);
            if (fp !== undefined) childFingerprints.push(fp);
          }
          continue;
        }

        if (childField.selectionSet && childField.selectionSet.length) {
          const storeKey = buildFieldKey(childField, variables);
          const link = (snapshot as any)[storeKey];

          if (link != null && Array.isArray(link.__refs)) {
            const refs = link.__refs;
            const outArray = new Array(refs.length);

            out[outKey] = outArray;

            const arrayFingerprints = [];

            for (let j = 0; j < refs.length; j++) {
              const childOut: any = {};
              outArray[j] = childOut;
              readEntity(refs[j], childField, childOut, addPath(path, outKey + "[" + j + "]"));
              const fp = getFingerprint(childOut);

              if (fp !== undefined) {
                arrayFingerprints.push(fp);
              }
            }

            if (arrayFingerprints.length > 0) {
              const arrayFp = fingerprintNodes(0, arrayFingerprints);
              setFingerprint(outArray, arrayFp);
              childFingerprints.push(arrayFp);
            }

            continue;
          }

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
          const fp = getFingerprint(childOut);
          if (fp !== undefined) childFingerprints.push(fp);
          continue;
        }

        readScalar(snapshot, childField, out, outKey, id, addPath(path, outKey));
      }

      if (Array.isArray(field.selectionSet) && field.selectionSet.length) {
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

      setFingerprint(out, finalFingerprint);
    };

    const readEdge = (edgeId: string, field: PlanField, outArray: any[], index: number, path: string) => {
      const record = graph.getRecord(edgeId) || {};
      const outEdge: any = {};
      outArray[index] = outEdge;

      if ((record as any).__typename !== undefined) {
        outEdge.__typename = (record as any).__typename;
      }

      const selection = field.selectionSet || [];
      const nodePlan = (field as any).selectionMap ? (field as any).selectionMap.get("node") : undefined;

      let nodeFingerprint;

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
            nodeFingerprint = getFingerprint(nodeOut);
          }
        } else if (!f.selectionSet) {
          readScalar(record, f, outEdge, outKey, edgeId, addPath(path, outKey));
        }
      }

      const edgeVersion = graph.getVersion(edgeId);

      const finalFingerprint = nodeFingerprint !== undefined ? fingerprintNodes(edgeVersion, [nodeFingerprint]) : edgeVersion;

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

      const selMap = (field as any).selectionMap;

      if (!selMap || selMap.size === 0) {
        return;
      }

      let pageInfoFingerprint;
      const edgeFingerprints = [];

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
          const refs = page.edges.__refs;
          const outArr = new Array(refs.length);
          conn.edges = outArr;

          for (let i = 0; i < refs.length; i++) {
            readEdge(refs[i], childField, outArr, i, addPath(path, "edges[" + i + "]"));

            const edge = outArr[i];

            if (edge) {
              const fp = getFingerprint(edge);
              if (fp !== undefined) edgeFingerprints.push(fp);
            }
          }

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
          const refs = link.__refs;
          const outArray = new Array(refs.length);
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
      setFingerprint(conn, connFingerprint);
    };

    const data = {};

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
    const rootFingerprints = [];
    if (entityId) {
      const fp = getFingerprint(data);
      if (fp !== undefined) rootFingerprints.push(fp);
    } else {
      for (let i = 0; i < plan.root.length; i++) {
        const field = plan.root[i];
        const value = data[field.responseKey];
        if (value && typeof value === "object") {
          const fp = getFingerprint(value);
          if (fp !== undefined) rootFingerprints.push(fp);
        }
      }
    }

    if (requestedOK && rootFingerprints.length > 0) {
      const rootFingerprint = fingerprintNodes(0, rootFingerprints);
      setFingerprint(data, rootFingerprint);
    }

    // Create result object (either "none" or with data)
    const result: MaterializeDocumentResult = !requestedOK
      ? {
          data: undefined,
          dependencies,
          source: "none",
          ok: { strict: strictOK, canonical: canonicalOK, miss: __DEV__ ? misses : undefined },
          hot: false,
        }
      : {
          data,
          dependencies,
          source: canonical ? "canonical" : "strict",
          ok: { strict: strictOK, canonical: canonicalOK, miss: __DEV__ ? misses : undefined },
          hot: false,
        };

    // Cache the result (including "none" results)
    const signature = makeMaterializeSignature(variables, canonical, fingerprint, entityId);
    let docCache = materializeCache.get(plan);
    if (!docCache) {
      docCache = new Map();
      materializeCache.set(plan, docCache);
    }
    docCache.set(signature, result);

    return result;
  };

  return {
    normalizeDocument,
    materializeDocument,
  };
};
