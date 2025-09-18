import { isObject, hasTypename, traverseFast, buildFieldKey, buildConnectionKey, TRAVERSE_SKIP } from "./utils";
import { IDENTITY_FIELDS, ROOT_ID } from "./constants";
import {
  compileToPlan,
  isCachePlanV1,
  type CachePlanV1,
  type PlanField,
} from "@/src/compiler";

import type { DocumentNode } from "graphql";
import type { GraphInstance } from "./graph";
import type { ViewsInstance } from "./views";

export type DocumentsOptions = {
  connections: Record<string, Record<string, { mode?: "infinite" | "page"; args?: string[] }>>;
};

export type DocumentsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (options: DocumentsOptions, deps: DocumentsDependencies) => {
  const { graph, views } = deps;

  const planCache = new WeakMap<DocumentNode, CachePlanV1>();

  const ensureRoot = () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  };

  // Plan cache per DocumentNode
  const getPlan = (docOrPlan: DocumentNode | CachePlanV1): CachePlanV1 => {
    if (isCachePlanV1(docOrPlan)) return docOrPlan;
    const hit = planCache.get(docOrPlan);
    if (hit) return hit;
    const plan = compileToPlan(docOrPlan, { connections: options.connections || {} });
    planCache.set(docOrPlan, plan);
    return plan;
  };

  const upsertEntityShallow = (node: any) => {
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
      fields: PlanField[];
      fieldsMap: Map<string, PlanField>;
      insideConnection: boolean;
    };

    const initialFrame: Frame = {
      parentRecordId: ROOT_ID,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(), // use compiler-provided map
      insideConnection: false,
    };

    traverseFast(data, initialFrame, (parentNode, valueNode, responseKey, frame) => {
      if (!frame) return;

      const parentRecordId = frame.parentRecordId;

      const planField = typeof responseKey === "string"
        ? frame.fieldsMap.get(responseKey)
        : undefined;

      // Connection page — store page & (only for queries) link parent field(full args)
      if (planField && planField.isConnection && isObject(valueNode)) {
        const pageKey = buildConnectionKey(planField, parentRecordId, variables);
        const fieldKey = buildFieldKey(planField, variables);

        const edgesIn: any[] = Array.isArray((valueNode as any).edges) ? (valueNode as any).edges : [];
        const edgeRefs = new Array(edgesIn.length);

        for (let i = 0; i < edgesIn.length; i++) {
          const edge = edgesIn[i] || {};
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj) && nodeObj.id != null) {
            const nodeKey = upsertEntityShallow(nodeObj);
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

        graph.putRecord(pageKey, pageSnap);

        // Link only on queries
        if (isQuery) {
          graph.putRecord(parentRecordId, { [fieldKey]: { __ref: pageKey } });
        }

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
        const entityKey = upsertEntityShallow(valueNode);
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
    const plan = getPlan(document);
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
        result[field.responseKey] = views.getEntityView(entityProxy, null, variables);
        continue;
      }

      // Selected shell whose properties read via entity view (nested connections remain reactive)
      const entityView = views.getEntityView(entityProxy, field.selectionSet, variables);
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
