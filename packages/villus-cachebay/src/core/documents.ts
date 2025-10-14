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
import type { ViewsInstance } from "./views";
import type { DocumentNode } from "graphql";

export type DocumentsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
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

type MaterializeArgs = {
  document: DocumentNode | CachePlan;
  variables?: Record<string, any>;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

/**
 * Creates a documents manager for normalizing and materializing GraphQL documents.
 * Handles normalization of responses into the graph store and materialization back into JS objects.
 */
export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, views, planner, canonical } = deps;

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
      if (!frame) {
        return;
      }

      if (responseKey == null) {
        return frame;
      }

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const planField = typeof responseKey === "string" && fieldsMap ? fieldsMap.get(responseKey) : undefined;

      if (kind === TRAVERSE_ARRAY) {
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

        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
          const out = new Array(arr.length);

          for (let i = 0; i < arr.length; i++) {
            out[i] = arr[i];
          }

          graph.putRecord(parentId, { [fieldKey]: out });
          return TRAVERSE_SKIP;
        }

        return frame;
      }

      if (kind === TRAVERSE_OBJECT) {
        if (frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const edgeKey = `${frame.pageKey}.edges.${responseKey}`;

          if (valueNode && valueNode.__typename) {
            graph.putRecord(edgeKey, { __typename: valueNode.__typename });
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

        if (planField && planField.isConnection) {
          const pageKey = buildConnectionKey(planField, parentId, variables);
          const parentFieldKey = buildFieldKey(planField, variables);

          const pageRecord: Record<string, any> = {};
          if (valueNode && valueNode.__typename) {
            pageRecord.__typename = valueNode.__typename;
          }

          if (valueNode) {
            const keys = Object.keys(valueNode);
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k === "__typename" || k === "edges" || k === "pageInfo") {
                continue;
              }

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

        {
          const entityKey = graph.identify(valueNode);
          if (entityKey) {
            if (valueNode && valueNode.__typename) {
              graph.putRecord(entityKey, { __typename: valueNode.__typename });
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

        if (planField) {
          const containerFieldKey = buildFieldKey(planField, variables);
          const containerKey = `${parentId}.${containerFieldKey}`;

          if (valueNode && valueNode.__typename) {
            graph.putRecord(containerKey, { __typename: valueNode.__typename });
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

    if (isQuery && connectionPages.length > 0) {
      for (let i = 0; i < connectionPages.length; i++) {
        const { field, parentId, pageKey } = connectionPages[i];
        const pageRecord = graph.getRecord(pageKey);

        if (!pageRecord) {
          continue;
        }

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

  /**
   * Reads a materialized JS object for a document from the current graph.
   * Root @connection fields read via canonical keys.
   * Root object fields deref via stored links { __ref }.
   * Preserves null vs undefined for missing links.
   */
  const materializeDocument = ({ document, variables = {} }: MaterializeArgs) => {
    const plan = planner.getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const canKey = buildConnectionCanonicalKey(field, ROOT_ID, variables);
        result[field.responseKey] = views.getView({
          source: canKey,
          field,
          variables,
          canonical: true,
        });
        continue;
      }

      const linkKey = buildFieldKey(field, variables);
      const link = (rootSnap as any)[linkKey];

      if (!link || !link.__ref) {
        result[field.responseKey] = link === null ? null : undefined;
        continue;
      }

      result[field.responseKey] = views.getView({
        source: link.__ref,
        field,
        variables,
        canonical: true,
      });
    }

    return result;
  };

  /**
   * Returns true if all required data for a document is present in the graph.
   * Checks actual normalized pages, not canonical aggregates.
   */
  const hasDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }): boolean => {
    const plan = planner.getPlan(document);
    if (plan.operation === "fragment") {
      return false;
    }

    const visited = new Set<string>();

    const hasOwn = (obj: any, k: string): boolean => {
      return obj != null && Object.prototype.hasOwnProperty.call(obj, k);
    };

    const getTypeName = (id: string): string | undefined => {
      const rec = graph.getRecord(id);
      return rec ? (rec.__typename as string | undefined) : undefined;
    };

    const getGuard = (f: PlanField): string | undefined => {
      return (f as any).typeCondition as string | undefined;
    };

    const getSelMap = (f: PlanField): any => {
      return (f as any).selectionMap || null;
    };

    const selGet = (container: PlanField, key: string): PlanField | undefined => {
      const map = getSelMap(container);
      if (!map) {
        return undefined;
      }

      if (typeof map.get === "function") {
        return map.get(key);
      }

      return map[key];
    };

    const selForEach = (container: PlanField, cb: (rk: string, child: PlanField) => void): void => {
      const map = getSelMap(container);
      if (!map) {
        return;
      }

      if (typeof map.forEach === "function") {
        (map as Map<string, PlanField>).forEach((child, rk) => cb(rk, child));
        return;
      }

      const keys = Object.keys(map);
      for (let i = 0; i < keys.length; i++) {
        const rk = keys[i];
        cb(rk, map[rk]);
      }
    };

    const buildTypeCaseSkipSet = (field: PlanField): Set<string> | null => {
      const tc = (field as any).typeCases;
      if (!tc) {
        return null;
      }

      const skip = new Set<string>();

      if (typeof (tc as any).forEach === "function") {
        (tc as Map<string, PlanField[]>).forEach((arr: PlanField[]) => {
          if (!arr || !arr.length) {
            return;
          }

          for (let i = 0; i < arr.length; i++) {
            skip.add(buildFieldKey(arr[i], variables));
          }
        });
        return skip;
      }

      const obj = tc as Record<string, PlanField[]>;
      const tks = Object.keys(obj);
      for (let i = 0; i < tks.length; i++) {
        const arr = obj[tks[i]];
        if (!arr || !arr.length) {
          continue;
        }

        for (let j = 0; j < arr.length; j++) {
          skip.add(buildFieldKey(arr[j], variables));
        }
      }

      return skip;
    };

    const checkPolymorphicSelection = (parentId: string, field: PlanField, parentTypeName?: string): boolean => {
      const typeCaseSkip = buildTypeCaseSkipSet(field);

      const baseMap = getSelMap(field);
      if (baseMap) {
        let ok = true;

        selForEach(field, (_rk, child) => {
          if (!ok) {
            return;
          }

          const guard = getGuard(child);
          if (guard && parentTypeName && guard !== parentTypeName) {
            return;
          }

          if (typeCaseSkip && typeCaseSkip.has(buildFieldKey(child, variables))) {
            return;
          }

          if (!checkSelection(parentId, child, parentTypeName)) {
            ok = false;
          }
        });

        if (!ok) {
          return false;
        }
      }

      if (parentTypeName) {
        const tc = (field as any).typeCases;
        if (tc) {
          const list = typeof (tc as any).get === "function"
            ? (tc as Map<string, PlanField[]>).get(parentTypeName)
            : (tc as Record<string, PlanField[]>)[parentTypeName];

          if (list && list.length) {
            for (let i = 0; i < list.length; i++) {
              if (!checkSelection(parentId, list[i], parentTypeName)) {
                return false;
              }
            }
          }
        }
      }

      return true;
    };

    const checkSelection = (parentId: string, field: PlanField, parentTypeName?: string): boolean => {
      const guard = getGuard(field);
      if (guard && parentTypeName && guard !== parentTypeName) {
        return true;
      }

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, parentId, variables);
        const page = graph.getRecord(pageKey);
        if (!page) {
          return false;
        }

        const map = getSelMap(field);
        if (map) {
          const piField = selGet(field, "pageInfo");
          if (piField) {
            const piLink = (page as any).pageInfo;
            if (!piLink || !piLink.__ref) {
              return false;
            }

            const piId = piLink.__ref as string;
            if (getSelMap(piField)) {
              if (!checkPolymorphicSelection(piId, piField, getTypeName(piId))) {
                return false;
              }
            }
          }

          let ok = true;
          selForEach(field, (rk, child) => {
            if (!ok) {
              return;
            }

            if (rk === "edges" || rk === "pageInfo") {
              return;
            }

            const key = buildFieldKey(child, variables);

            if (child.selectionSet && child.selectionSet.length) {
              const link = (page as any)[key];
              if (!link || !link.__ref) {
                ok = false;
                return;
              }

              const id = link.__ref as string;
              const token = `${pageKey}:${key}:${id}`;
              if (!visited.has(token)) {
                visited.add(token);
                if (!checkPolymorphicSelection(id, child, getTypeName(id))) {
                  ok = false;
                }
              }
            } else {
              if (!hasOwn(page, key)) {
                ok = false;
              }
            }
          });

          if (!ok) {
            return false;
          }

          const edgesField = selGet(field, "edges");
          const nodeField = edgesField && selGet(edgesField, "node");
          if (edgesField && nodeField && nodeField.selectionSet && nodeField.selectionSet.length) {
            const edges = (page as any).edges;
            let refs: string[] | null = null;

            if (edges && typeof edges === "object" && Array.isArray(edges.__refs)) {
              refs = edges.__refs as string[];
            } else if (Array.isArray(edges)) {
              const len = edges.length;
              refs = new Array(len);
              for (let i = 0; i < len; i++) {
                refs[i] = `${pageKey}.edges.${i}`;
              }
            }

            if (refs && refs.length) {
              for (let i = 0; i < refs.length; i++) {
                const edgeRec = graph.getRecord(refs[i]);
                const nodeRef = edgeRec && edgeRec.node ? edgeRec.node.__ref : undefined;
                if (!nodeRef) {
                  continue;
                }

                const nodeId = nodeRef as string;
                const token = `${pageKey}:node:${nodeId}`;
                if (visited.has(token)) {
                  continue;
                }

                visited.add(token);

                if (!checkPolymorphicSelection(nodeId, nodeField, getTypeName(nodeId))) {
                  return false;
                }
              }
            }
          }
        }

        return true;
      }

      const parentSnap = graph.getRecord(parentId) || {};
      if (field.selectionSet && field.selectionSet.length) {
        const linkKey = buildFieldKey(field, variables);
        const link = (parentSnap as any)[linkKey];
        if (!link || !link.__ref) {
          return false;
        }

        const childId = link.__ref as string;
        const token = `${parentId}:${field.responseKey || field.fieldName}:${childId}`;
        if (!visited.has(token)) {
          visited.add(token);
          if (!checkPolymorphicSelection(childId, field, getTypeName(childId))) {
            return false;
          }
        }

        return true;
      }

      return hasOwn(parentSnap, buildFieldKey(field, variables));
    };

    const rootSnap = graph.getRecord(ROOT_ID) || {};
    for (let i = 0; i < plan.root.length; i++) {
      const f = plan.root[i];

      if (f.isConnection) {
        if (!checkSelection(ROOT_ID, f, getTypeName(ROOT_ID))) {
          return false;
        }
        continue;
      }

      if (f.selectionSet && f.selectionSet.length) {
        const linkKey = buildFieldKey(f, variables);
        const link = (rootSnap as any)[linkKey];
        if (!link || !link.__ref) {
          return false;
        }

        const childId = link.__ref as string;
        if (!checkPolymorphicSelection(childId, f, getTypeName(childId))) {
          return false;
        }
        continue;
      }

      if (!hasOwn(rootSnap, buildFieldKey(f, variables))) {
        return false;
      }
    }

    return true;
  };

  return {
    normalizeDocument,
    materializeDocument,
    hasDocument,
  };
};
