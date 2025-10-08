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

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, views, planner, canonical } = deps;

  /**
   * Normalize a GraphQL response (document + variables + data) into the graph store,
   * and update canonical connection pages for queries.
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

    // Seed root record
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    // Collect connection pages for a post-pass canonical update
    const connectionPages: Array<{
      field: PlanField;
      parentId: string;
      pageKey: string;
    }> = [];

    type Frame = {
      parentId: string;
      fields: PlanField[] | undefined | null;
      fieldsMap: Map<string, PlanField> | undefined | null;
      insideConnection: boolean;
      pageKey: string | null;
      inEdges: boolean;
    };

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

      // root tick
      if (responseKey == null) {
        return frame;
      }

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const planField =
        typeof responseKey === "string" && fieldsMap ? fieldsMap.get(responseKey) : undefined;

      // ────────────────────────────────────────────────────────────────────────
      // ARRAYS
      // ────────────────────────────────────────────────────────────────────────
      if (kind === TRAVERSE_ARRAY) {
        // Connection.edges → set edge refs on the page and dive into edge objects
        if (frame.insideConnection && responseKey === "edges") {
          const pageKey = frame.pageKey as string;
          const rawEdges: any[] = Array.isArray(valueNode) ? valueNode : [];
          const edgeRefs: string[] = new Array(rawEdges.length);
          for (let i = 0; i < rawEdges.length; i++) edgeRefs[i] = `${pageKey}.edges:${i}`;

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

        // Scalar arrays (e.g., Post.flags) → write inline on current record
        if (planField && !planField.selectionSet) {
          const fieldKey = buildFieldKey(planField, variables);
          const arr = valueNode as any[];
          const out = new Array(arr.length);
          for (let i = 0; i < arr.length; i++) out[i] = arr[i];
          graph.putRecord(parentId, { [fieldKey]: out });
          return TRAVERSE_SKIP;
        }

        return frame;
      }

      // ────────────────────────────────────────────────────────────────────────
      // OBJECTS
      // ────────────────────────────────────────────────────────────────────────
      if (kind === TRAVERSE_OBJECT) {
        // Edge object inside edges[]
        if (frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const edgeKey = `${frame.pageKey}.edges:${responseKey}`;
          if (valueNode && valueNode.__typename) {
            graph.putRecord(edgeKey, { __typename: valueNode.__typename });
          } else {
            graph.putRecord(edgeKey, {});
          }

          // Link node ref early if identifiable
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

        // Connection page object
        if (planField && planField.isConnection) {
          const pageKey = buildConnectionKey(planField, parentId, variables);
          const parentFieldKey = buildFieldKey(planField, variables);

          // Initialize page record with __typename and scalar fields
          const pageRecord: Record<string, any> = {};
          if (valueNode && valueNode.__typename) {
            pageRecord.__typename = valueNode.__typename;
          }

          // Copy scalar fields immediately (e.g., totalCount)
          if (valueNode) {
            const keys = Object.keys(valueNode);
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (k === "__typename" || k === "edges" || k === "pageInfo") continue;
              const v = (valueNode as any)[k];

              if (v !== undefined && v !== null && typeof v !== "object") {
                pageRecord[k] = v;
              } else if (
                Array.isArray(v) ||
                (v !== null && typeof v === "object" && !(v && (v as any).__typename))
              ) {
                pageRecord[k] = v;
              }
            }
          }

          graph.putRecord(pageKey, pageRecord);

          // If pageInfo child exists, link page → pageInfo
          if ((valueNode as any)?.pageInfo) {
            const pageInfoKey = `${pageKey}.pageInfo`;
            graph.putRecord(pageKey, { pageInfo: { __ref: pageInfoKey } });
            const piTypename = (valueNode as any)?.pageInfo?.__typename;
            graph.putRecord(pageInfoKey, piTypename ? { __typename: piTypename } : {});
          }

          // Link page under parent (queries only)
          if (isQuery) {
            graph.putRecord(parentId, { [parentFieldKey]: { __ref: pageKey } });
          }

          // Collect for canonical update
          if (isQuery) {
            connectionPages.push({ field: planField, parentId, pageKey });
          }

          // Descend into the page (its selection set)
          return {
            parentId: pageKey,
            fields: planField.selectionSet,
            fieldsMap: planField.selectionMap,
            insideConnection: true,
            pageKey,
            inEdges: false,
          } as Frame;
        }

        // Entity (identifiable)
        {
          const entityKey = graph.identify(valueNode);
          if (entityKey) {
            if (valueNode && valueNode.__typename) {
              graph.putRecord(entityKey, { __typename: valueNode.__typename });
            } else {
              graph.putRecord(entityKey, {});
            }

            // Link from parent (queries only), except edges.node
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

        // Generic container – non-identifiable object
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

      // ────────────────────────────────────────────────────────────────────────
      // SCALARS
      // ────────────────────────────────────────────────────────────────────────
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

    // Main traversal - normalize all data
    traverseFast(data, initialFrame, visit);

    // Post-pass → update canonical pages for queries
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

  type MaterializeArgs = {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  };

  /**
   * Read a materialized JS object for a document from the current graph.
   * - Root @connection fields read via canonical keys.
   * - Root object fields deref via stored links { __ref }.
   * - Preserves `null` vs `undefined` for missing links.
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
   * Return true if all required data for a document is present in the graph
   * (including canonical connection pages, pageInfo, connection-level scalars, and
   * deep node selections via edges).
   */
  const hasDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }): boolean => {
    const plan = planner.getPlan(document);
    if (plan.operation === "fragment") return false;

    const keyOf = (f: PlanField) =>
      (f.responseKey && f.responseKey !== f.fieldName ? f.responseKey : f.fieldName) || f.responseKey;

    const deref = (v: any) =>
      v && typeof v === "object" && "__ref" in v ? graph.getRecord((v as any).__ref) : v;

    const ensureScalars = (obj: any, sel: PlanField[] | undefined | null): boolean => {
      const rec = deref(obj);
      if (!sel || sel.length === 0) return true;
      if (!rec || typeof rec !== "object") return false;

      for (let i = 0; i < sel.length; i++) {
        const f = sel[i];
        const k = keyOf(f);

        if (f.selectionSet && f.selectionSet.length) {
          const child = (rec as any)[k];
          if (!ensureScalars(child, f.selectionSet)) return false;
        } else {
          if (!(k in (rec as any))) return false;
        }
      }
      return true;
    };

    const visited = new Set<string>();

    const checkSelection = (parentId: string, field: PlanField): boolean => {
      // @connection → verify canonical page
      if (field.isConnection) {
        const canKey = buildConnectionCanonicalKey(field, parentId, variables);
        const page = graph.getRecord(canKey);
        if (!page) return false;

        const selMap = field.selectionMap;
        if (selMap && selMap.size) {
          // pageInfo
          const piField = selMap.get("pageInfo");
          if (piField) {
            const piContainer = (page as any).pageInfo;
            if (!piContainer) return false;
            if (!ensureScalars(piContainer, piField.selectionSet)) return false;
          }

          // other connection-level fields (e.g., totalCount)
          for (const [rk, f] of selMap) {
            if (rk === "edges" || rk === "pageInfo") continue;

            if (f.selectionSet && f.selectionSet.length) {
              const child = (page as any)[keyOf(f)];
              if (!ensureScalars(child, f.selectionSet)) return false;
            } else {
              const rec = deref(page);
              if (!(keyOf(f) in (rec || {}))) return false;
            }
          }

          // edges → node selection (only if edges exist and node has selection)
          const edgesField = selMap.get("edges");
          const nodeField = edgesField?.selectionMap?.get("node");
          if (edgesField && nodeField?.selectionSet?.length) {
            const edges = (page as any).edges;
            const refs: string[] =
              edges && edges.__refs
                ? edges.__refs
                : Array.isArray(edges)
                  ? edges.map((_: any, i: number) => `${canKey}.edges:${i}`)
                  : [];

            for (let i = 0; i < refs.length; i++) {
              const edgeRec = graph.getRecord(refs[i]);
              const nodeRef = edgeRec?.node?.__ref;
              if (!nodeRef) continue;

              const guard = `${canKey}:node:${nodeRef}`;
              if (visited.has(guard)) continue;
              visited.add(guard);

              for (const [, childSel] of nodeField.selectionMap!) {
                if (!checkSelection(nodeRef, childSel)) return false;
              }
            }
          }
        }

        return true;
      }

      // Non-connection field
      const parentSnap = graph.getRecord(parentId) || {};

      if (field.selectionSet && field.selectionSet.length) {
        const linkKey = buildFieldKey(field, variables);
        const link = (parentSnap as any)[linkKey];
        if (!link?.__ref) return false;

        const childId = link.__ref as string;
        const guard = `${parentId}:${keyOf(field)}:${childId}`;
        if (visited.has(guard)) return true;
        visited.add(guard);

        const childMap = field.selectionMap!;
        for (const [, child] of childMap) {
          if (!checkSelection(childId, child)) return false;
        }
        return true;
      }

      // scalar leaf on this parent entity
      const prop = keyOf(field);
      return prop in (parentSnap as any);
    };

    // Deep walk from root
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    for (let i = 0; i < plan.root.length; i++) {
      const f = plan.root[i];

      if (f.isConnection) {
        if (!checkSelection(ROOT_ID, f)) return false;
        continue;
      }

      if (f.selectionSet && f.selectionSet.length) {
        const linkKey = buildFieldKey(f, variables);
        const link = (rootSnap as any)[linkKey];
        if (!link?.__ref) return false;

        const childId = link.__ref as string;
        for (const [, child] of f.selectionMap!) {
          if (!checkSelection(childId, child)) return false;
        }
        continue;
      }

      const prop = keyOf(f);
      if (!(prop in (rootSnap as any))) return false;
    }

    return true;
  };

  return {
    normalizeDocument,
    materializeDocument,
    hasDocument,
  };
};
