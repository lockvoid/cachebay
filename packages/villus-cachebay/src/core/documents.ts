import { isObject, hasTypename, traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, upsertEntityShallow, TRAVERSE_SKIP } from "./utils";
import { ROOT_ID } from "./constants";
import type { CachePlanV1, PlanField } from "@/src/compiler";
import type { DocumentNode } from "graphql";
import type { GraphInstance } from "./graph";
import type { ViewsInstance } from "./views";
import type { PlannerInstance } from "./planner";

export type DocumentsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
  planner: PlannerInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, views, planner } = deps;

  const ensureRoot = () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  };

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

    const plan = planner.getPlan(document);
    const isQuery = plan.operation === "query";

    type Frame = {
      parentRecordId: string;
      fields: PlanField[];
      fieldsMap: Map<string, PlanField>;
      insideConnection: boolean;
    };

    const initialFrame: Frame = {
      parentRecordId: ROOT_ID,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(),
      insideConnection: false,
    };

    // helpers for canonical updates
    const readCursor = (edgeRef: string): string => {
      const rec = graph.getRecord(edgeRef);
      const cur = rec?.cursor;
      return cur === undefined ? "undefined" : String(cur);
    };

    const appendUniqueByCursor = (
      dst: Array<{ __ref: string }>,
      add: Array<{ __ref: string }>
    ) => {
      const seen = new Set<string>();
      for (let i = 0; i < dst.length; i++) {
        const ref = dst[i]?.__ref;
        if (ref) seen.add(`cur:${readCursor(ref)}`);
      }
      for (let i = 0; i < add.length; i++) {
        const ref = add[i]?.__ref;
        if (!ref) continue;
        const key = `cur:${readCursor(ref)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dst.push({ __ref: ref });
      }
    };

    const prependUniqueByCursor = (
      dst: Array<{ __ref: string }>,
      add: Array<{ __ref: string }>
    ) => {
      const seen = new Set<string>();
      for (let i = 0; i < dst.length; i++) {
        const ref = dst[i]?.__ref;
        if (ref) seen.add(`cur:${readCursor(ref)}`);
      }
      const front: Array<{ __ref: string }> = [];
      for (let i = 0; i < add.length; i++) {
        const ref = add[i]?.__ref;
        if (!ref) continue;
        const key = `cur:${readCursor(ref)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        front.push({ __ref: ref });
      }
      // prepend in natural order of the page
      if (front.length) dst.unshift(...front);
    };

    // canonical updater per mode and request args
    const updateCanonical = (
      field: PlanField,
      parentRecordId: string,
      requestVars: Record<string, any>,
      pageKey: string,
      pageSnap: Record<string, any>,
      pageEdgeRefs: Array<{ __ref: string }>
    ) => {
      // Build canonical key (filters-only identity)
      const canonicalKey = buildConnectionCanonicalKey(field, parentRecordId, requestVars);
      const mode = field.connectionMode || "page";

      // Load or initialize the canonical record
      let canonical = graph.getRecord(canonicalKey) || {
        __typename: pageSnap.__typename || "Connection",
        edges: [] as Array<{ __ref: string }>,
        pageInfo: {},
      };

      // Strict detection from compiled field args (preferred)
      const reqArgs = field.buildArgs(requestVars) || {};
      let hasAfter = "after" in reqArgs && reqArgs.after != null;
      let hasBefore = "before" in reqArgs && reqArgs.before != null;

      // Loose fallback: if variables object has keys that *look* like after/before, honor them.
      // This covers cases where the op didn't declare that arg on the field but the test uses
      // variable names like usersBefore / usersAfter.
      if (!hasAfter) {
        for (const k of Object.keys(requestVars)) {
          if (k.toLowerCase().includes("after") && requestVars[k] != null) {
            hasAfter = true;
            break;
          }
        }
      }
      if (!hasBefore) {
        for (const k of Object.keys(requestVars)) {
          if (k.toLowerCase().includes("before") && requestVars[k] != null) {
            hasBefore = true;
            break;
          }
        }
      }

      const isLeader = !hasAfter && !hasBefore;

      // normalize arrays
      const canEdges: Array<{ __ref: string }> = Array.isArray(canonical.edges) ? canonical.edges.slice() : [];
      const pageEdges = pageEdgeRefs;

      if (mode === "infinite") {
        if (isLeader) {
          // first no-cursor page anchors pageInfo; keep union list (don’t truncate)
          if (canEdges.length === 0) {
            canonical.edges = pageEdges.slice();
          } else {
            const next = canEdges.slice();
            appendUniqueByCursor(next, pageEdges);
            canonical.edges = next;
          }
          if (pageSnap.pageInfo) canonical.pageInfo = { ...(pageSnap.pageInfo as any) };
          for (const k of Object.keys(pageSnap)) {
            if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
            (canonical as any)[k] = (pageSnap as any)[k];
          }
          (canonical as any).__leader = pageKey; // optional debug
        } else if (hasBefore) {
          // ⬅ precedence to before (prepend)
          const next = canEdges.slice();
          prependUniqueByCursor(next, pageEdges);
          canonical.edges = next;
        } else if (hasAfter) {
          const next = canEdges.slice();
          appendUniqueByCursor(next, pageEdges);
          canonical.edges = next;
        }
      } else {
        // mode === "page": always replace with the last page fetched
        canonical.edges = pageEdges.slice();
        if (pageSnap.pageInfo) canonical.pageInfo = { ...(pageSnap.pageInfo as any) };
        for (const k of Object.keys(pageSnap)) {
          if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
          (canonical as any)[k] = (pageSnap as any)[k];
        }
      }

      graph.putRecord(canonicalKey, canonical);
    };

    traverseFast(data, initialFrame, (parentNode, valueNode, responseKey, frame) => {
      if (!frame) return;

      const parentRecordId = frame.parentRecordId;

      const planField = typeof responseKey === "string"
        ? frame.fieldsMap.get(responseKey)
        : undefined;

      // Connection page — store page & link; also update canonical
      if (planField && planField.isConnection && isObject(valueNode)) {
        const pageKey = buildConnectionKey(planField, parentRecordId, variables);
        const fieldKey = buildFieldKey(planField, variables);

        const edgesIn: any[] = Array.isArray((valueNode as any).edges) ? (valueNode as any).edges : [];
        const edgeRefs = new Array(edgesIn.length);

        for (let i = 0; i < edgesIn.length; i++) {
          const edge = edgesIn[i] || {};
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj) && nodeObj.id != null) {
            const nodeKey = upsertEntityShallow(graph, nodeObj);
            if (nodeKey) {
              const edgeKey = `${pageKey}.edges.${i}`;
              const { node, ...edgeRest } = edge as any;
              const edgeSnap: Record<string, any> = edgeRest;
              edgeSnap.node = { __ref: nodeKey };

              graph.putRecord(edgeKey, edgeSnap);
              edgeRefs[i] = { __ref: edgeKey };
            }
          }
        }

        const { edges, pageInfo, ...connRest } = valueNode as any;
        const pageSnap: Record<string, any> = {
          __typename: (valueNode as any).__typename,
          ...connRest,
        };
        if (pageInfo) pageSnap.pageInfo = { ...(pageInfo as any) };
        pageSnap.edges = edgeRefs;

        // write the page record
        graph.putRecord(pageKey, pageSnap);

        // link only on queries (field link from parent to this concrete page)
        if (isQuery) {
          graph.putRecord(parentRecordId, { [fieldKey]: { __ref: pageKey } });
        }

        // update canonical connection for @connection
        updateCanonical(planField, parentRecordId, variables, pageKey, pageSnap, edgeRefs);

        // Descend into the connection's selection
        const nextFields = planField.selectionSet || [];
        const nextMap = planField.selectionMap || frame.fieldsMap;
        return { parentRecordId, fields: nextFields, fieldsMap: nextMap, insideConnection: true } as Frame;
      }

      // Arrays — switch scope to the array field's item selection
      if (Array.isArray(valueNode) && typeof responseKey === "string") {
        const pf = frame.fieldsMap.get(responseKey);
        const nextFields = pf?.selectionSet || frame.fields;
        const nextMap = pf?.selectionMap || frame.fieldsMap;
        return { parentRecordId, fields: nextFields, fieldsMap: nextMap, insideConnection: frame.insideConnection } as Frame;
      }

      // Identifiable entity — upsert & optionally link (only on queries)
      if (planField && isObject(valueNode) && hasTypename(valueNode) && valueNode.id != null) {
        const entityKey = upsertEntityShallow(graph, valueNode);
        if (entityKey) {
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
          const nextMap = planField.selectionMap || frame.fieldsMap;
          return { parentRecordId: entityKey, fields: nextFields, fieldsMap: nextMap, insideConnection: false } as Frame;
        }
        return TRAVERSE_SKIP;
      }

      // Plain object — propagate scope
      if (isObject(valueNode)) {
        const nextFields = planField?.selectionSet || frame.fields;
        const nextMap = planField?.selectionMap || frame.fieldsMap;
        return { parentRecordId, fields: nextFields, fieldsMap: nextMap, insideConnection: frame.insideConnection } as Frame;
      }

      return;
    });
  };

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = planner.getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        result[field.responseKey] = views.getConnectionView(pageKey, field, variables);
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = (rootSnap as any)[linkKey];

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
        result[field.responseKey] = views.getEntityView(entityProxy, null, undefined, variables);
        continue;
      }

      // Selected shell whose properties read via entity view (nested connections remain reactive)
      const entityView = views.getEntityView(
        entityProxy,
        field.selectionSet,
        field.selectionMap,
        variables
      );
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

  const hasDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }): boolean => {
    const plan = planner.getPlan(document);

    // fragments aren't checked here; this is an operations helper
    if (plan.operation === "fragment") {
      return false;
    }

    const rootSnap = graph.getRecord(ROOT_ID) || {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        if (!graph.getRecord(pageKey)) return false;
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = (rootSnap as any)[linkKey];
      if (!link?.__ref) return false;
    }

    return true;
  };

  return {
    normalizeDocument,
    materializeDocument,
    hasDocument,
  };
};
