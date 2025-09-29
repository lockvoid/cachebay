import {
  isObject,
  hasTypename,
  traverseFast,
  buildFieldKey,
  buildConnectionKey,
  buildConnectionCanonicalKey,
  upsertEntityShallow,
  TRAVERSE_SKIP,
} from "./utils";
import { ROOT_ID } from "./constants";
import type { CachePlanV1, PlanField } from "../compiler";
import type { DocumentNode } from "graphql";
import type { GraphInstance } from "./graph";
import type { ViewsInstance } from "./views";
import type { PlannerInstance } from "./planner";
import type { CanonicalInstance } from "./canonical";

export type DocumentsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
  planner: PlannerInstance;
  canonical: CanonicalInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, views, planner, canonical } = deps;

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
      parentId: string;
      fields: PlanField[];
      fieldsMap: Map<string, PlanField>;
      insideConnection: boolean;
    };

    const initialFrame: Frame = {
      parentId: ROOT_ID,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(),
      insideConnection: false,
    };

    traverseFast(data, initialFrame, (_parentNode, valueNode, responseKey, frame) => {
      if (!frame) return;

      const parentId = frame.parentId;
      const planField = typeof responseKey === "string" ? frame.fieldsMap.get(responseKey) : undefined;

      // Connection page — store page & link; then update canonical (network path)
      if (planField && planField.isConnection && isObject(valueNode)) {
        const pageKey = buildConnectionKey(planField, parentId, variables);
        const fieldKey = buildFieldKey(planField, variables);

        const edgesIn: any[] = Array.isArray((valueNode as any).edges) ? (valueNode as any).edges : [];
        const edgeRefs = new Array(edgesIn.length);

        for (let i = 0; i < edgesIn.length; i++) {
          const edge = edgesIn[i] || {};
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj)) {
            const nodeKey = graph.identify(nodeObj);
            if (nodeKey) {
              upsertEntityShallow(graph, nodeObj);
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
        const pageSnapshot: Record<string, any> = {
          __typename: (valueNode as any).__typename,
          ...connRest,
        };
        if (pageInfo) pageSnapshot.pageInfo = { ...(pageInfo as any) };
        pageSnapshot.edges = edgeRefs;

        graph.putRecord(pageKey, pageSnapshot);

        if (isQuery) {
          graph.putRecord(parentId, { [fieldKey]: { __ref: pageKey } });
        }

        canonical.updateConnection({
          field: planField,
          parentId,
          variables: variables,
          pageKey,
          pageSnapshot,
          pageEdgeRefs: edgeRefs,
        });

        const nextFields = planField.selectionSet || [];
        const nextMap = planField.selectionMap || frame.fieldsMap;
        return { parentId, fields: nextFields, fieldsMap: nextMap, insideConnection: true } as Frame;
      }

      // Arrays — switch scope to the array field's item selection
      if (Array.isArray(valueNode) && typeof responseKey === "string") {
        const pf = frame.fieldsMap.get(responseKey);
        const nextFields = pf?.selectionSet || frame.fields;
        const nextMap = pf?.selectionMap || frame.fieldsMap;
        return { parentId, fields: nextFields, fieldsMap: nextMap, insideConnection: frame.insideConnection } as Frame;
      }

      // Identifiable entity — upsert & optionally link (queries only).
      // NOTE: do this even if there is no 'planField' (e.g., subscription payloads),
      //       as long as identify() returns a concrete entity key.
      if (isObject(valueNode) && hasTypename(valueNode)) {
        const entityKey = graph.identify(valueNode);
        if (entityKey) {
          upsertEntityShallow(graph, valueNode);

          // Only link for queries (and not the 'node' inside a connection)
          if (
            isQuery &&
            planField &&
            !(frame.insideConnection && planField.responseKey === "node")
          ) {
            const argObj = planField.buildArgs(variables);
            const hasArgs = argObj && Object.keys(argObj).length > 0;
            const shouldLink = parentId === ROOT_ID ? true : hasArgs;

            if (shouldLink) {
              const parentFieldKey = buildFieldKey(planField, variables);
              graph.putRecord(parentId, { [parentFieldKey]: { __ref: entityKey } });
            }
          }

          const nextFields = planField?.selectionSet || [];
          const nextMap = planField?.selectionMap || frame.fieldsMap;
          return {
            parentId: entityKey,
            fields: nextFields,
            fieldsMap: nextMap,
            insideConnection: false,
          } as Frame;
        }
      }

      // Plain object — propagate scope
      if (isObject(valueNode)) {
        const nextFields = planField?.selectionSet || frame.fields;
        const nextMap = planField?.selectionMap || frame.fieldsMap;
        return { parentId, fields: nextFields, fieldsMap: nextMap, insideConnection: frame.insideConnection } as Frame;
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
        const canKey = buildConnectionCanonicalKey(field, ROOT_ID, variables);
        result[field.responseKey] = views.getConnectionView(canKey, field, variables, /* canonical */ true);
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
        result[field.responseKey] = views.getEntityView(
          entityProxy,
          null,
          undefined,
          variables,
          true
        );
        continue;
      }

      result[field.responseKey] = views.getEntityView(
        entityProxy,
        field.selectionSet,
        field.selectionMap,
        variables,
        true
      );
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

  const prewarmDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlanV1;
    variables?: Record<string, any>;
  }) => {
    const plan = planner.getPlan(document);

    const tryForwardConcretePage = (field: PlanField, parentId: string) => {
      const pageKey = buildConnectionKey(field, parentId, variables);
      const page = graph.getRecord(pageKey);
      if (!page || !Array.isArray(page.edges)) return;

      const pageEdgeRefs = page.edges
        .map((e: any) => (e && e.__ref ? { __ref: e.__ref } : null))
        .filter(Boolean) as Array<{ __ref: string }>;

      const { edges, ...rest } = page;
      const pageSnapshot: Record<string, any> = { ...rest };

      canonical.mergeFromCache({
        field,
        parentId,
        variables: variables,
        pageKey,
        pageSnapshot,
        pageEdgeRefs,
      });

      const edgesField = field.selectionMap?.get("edges");
      const nodeField = edgesField?.selectionMap?.get("node");
      if (nodeField?.selectionMap) {
        for (let i = 0; i < page.edges.length; i++) {
          const edgeRef = page.edges[i]?.__ref;
          if (!edgeRef) continue;
          const edgeRec = graph.getRecord(edgeRef);
          const parentRef: string | undefined = edgeRec?.node?.__ref;
          if (!parentRef) continue;

          for (const [, childField] of nodeField.selectionMap) {
            if (!childField.isConnection) continue;
            tryForwardConcretePage(childField, parentRef);
          }
        }
      }
    };

    // 1) Root connections
    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];
      if (!field.isConnection) continue;
      tryForwardConcretePage(field, ROOT_ID);
    }

    // 2) Nested connections
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    for (let i = 0; i < plan.root.length; i++) {
      const parentField = plan.root[i];
      if (parentField.isConnection) continue;

      const childMap = parentField.selectionMap;
      if (!childMap) continue;

      const linkKey = buildFieldKey(parentField, variables);
      const parentRef: string | undefined = (rootSnap as any)[linkKey]?.__ref;
      if (!parentRef) continue;

      for (const [, childField] of childMap) {
        if (!childField.isConnection) continue;
        tryForwardConcretePage(childField, parentRef);
      }
    }
  };

  return {
    normalizeDocument,
    materializeDocument,
    prewarmDocument,
    hasDocument,
  };
};
