import { ROOT_ID } from "./constants";
import { isObject, hasTypename, traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, upsertEntityShallow, TRAVERSE_SKIP } from "./utils";
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

  const ensureRoot = () => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });
  };

  const normalizeDocument = ({
    document,
    variables = {},
    data,
  }: {
    document: DocumentNode | CachePlan;
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
      const planField =
        typeof responseKey === "string" ? frame.fieldsMap.get(responseKey) : undefined;

      // ─────────────────────────────────────────────────────────────────────────
      // 1) Connection page — write concrete page + edges; then update canonical
      // ─────────────────────────────────────────────────────────────────────────
      if (planField && planField.isConnection && isObject(valueNode)) {
        const pageKey = buildConnectionKey(planField, parentId, variables);
        const fieldKey = buildFieldKey(planField, variables);

        const edgesIn: any[] = Array.isArray((valueNode as any).edges)
          ? (valueNode as any).edges
          : [];
        const edgeRefs = new Array(edgesIn.length);

        for (let i = 0; i < edgesIn.length; i++) {
          const edge = edgesIn[i] || {};
          const nodeObj = edge.node;

          // Identify via graph.identify (custom keys supported); store node shallowly
          if (isObject(nodeObj) && hasTypename(nodeObj)) {
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
        const pageSnapshot: Record<string, any> = {
          __typename: (valueNode as any).__typename,
          ...connRest,
        };
        if (pageInfo) pageSnapshot.pageInfo = { ...(pageInfo as any) };
        pageSnapshot.edges = edgeRefs;

        // write the concrete page record
        graph.putRecord(pageKey, pageSnapshot);

        // link only on queries (field link from parent to this concrete page)
        if (isQuery) {
          graph.putRecord(parentId, { [fieldKey]: { __ref: pageKey } });
        }

        // update canonical connection (@connection)
        canonical.updateConnection({
          field: planField,
          parentId,
          variables,
          pageKey,
          pageSnapshot,
          pageEdgeRefs: edgeRefs,
        });

        // Descend into the connection's selection (pageInfo/extras/edges.node)
        const nextFields = planField.selectionSet || [];
        const nextMap = planField.selectionMap || frame.fieldsMap;
        return {
          parentId,
          fields: nextFields,
          fieldsMap: nextMap,
          insideConnection: true,
        } as Frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 2) Arrays — switch scope to item selection (keep parent the same)
      // ─────────────────────────────────────────────────────────────────────────
      if (Array.isArray(valueNode) && typeof responseKey === "string") {
        const pf = frame.fieldsMap.get(responseKey);
        const nextFields = pf?.selectionSet || frame.fields;
        const nextMap = pf?.selectionMap || frame.fieldsMap;
        return {
          parentId,
          fields: nextFields,
          fieldsMap: nextMap,
          insideConnection: frame.insideConnection,
        } as Frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 3) Identifiable entity — upsert; optionally link (only on queries)
      //    NEW RULE: link any object field (no args requirement),
      //    except the synthetic `edges.node` hop inside a connection.
      // ─────────────────────────────────────────────────────────────────────────
      if (isObject(valueNode) && hasTypename(valueNode)) {
        const entityKey = upsertEntityShallow(graph, valueNode);

        if (entityKey) {
          const shouldLink =
            isQuery &&
            !!planField &&
            !(frame.insideConnection && planField.responseKey === "node");

          if (shouldLink) {
            const parentFieldKey = buildFieldKey(planField!, variables);
            graph.putRecord(parentId, { [parentFieldKey]: { __ref: entityKey } });
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

        // Not identifiable (e.g., edge-only objects) — treat as plain object and keep walking
        const nextFields = planField?.selectionSet || frame.fields;
        const nextMap = planField?.selectionMap || frame.fieldsMap;
        return {
          parentId,
          fields: nextFields,
          fieldsMap: nextMap,
          insideConnection: frame.insideConnection,
        } as Frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 4) Plain object — propagate scope
      // ─────────────────────────────────────────────────────────────────────────
      if (isObject(valueNode)) {
        const nextFields = planField?.selectionSet || frame.fields;
        const nextMap = planField?.selectionMap || frame.fieldsMap;
        return {
          parentId,
          fields: nextFields,
          fieldsMap: nextMap,
          insideConnection: frame.insideConnection,
        } as Frame;
      }

      // primitives: nothing to do
      return;
    });
  };

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }) => {
    const plan = planner.getPlan(document);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const result: Record<string, any> = {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      // Root-level @connection → always read the CANONICAL connection
      if (field.isConnection) {
        const canKey = buildConnectionCanonicalKey(field, ROOT_ID, variables);
        result[field.responseKey] = views.getConnectionView(
          canKey,
          field,
          variables,
          /* canonical */ true,
        );
        continue;
      }

      // Plain field linked off the root record
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

      // If no sub-selection, return a live entity view (reactive proxy)
      if (!field.selectionSet || field.selectionSet.length === 0) {
        result[field.responseKey] = views.getEntityView(
          entityProxy,
          null,
          undefined,
          variables,
          true,
        );
        continue;
      }

      // With a sub-selection, selection-aware live entity view
      result[field.responseKey] = views.getEntityView(
        entityProxy,
        field.selectionSet,
        field.selectionMap,
        variables,
        true,
      );
    }

    return result;
  };

  // documents.ts (add alongside your existing hasDocument)
  const hasDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }): boolean => {
    const plan = planner.getPlan(document);
    if (plan.operation === "fragment") return false;

    // ---------- Phase 1: shallow preflight (fast negatives) ----------
    const rootSnap = graph.getRecord(ROOT_ID) || {};

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];

      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, ROOT_ID, variables);
        if (!graph.getRecord(pageKey)) {
          return false;
        }
        continue;
      }

      // Object field (has sub-selection): must have a link at the root
      if (field.selectionSet && field.selectionSet.length > 0) {
        const linkKey = buildFieldKey(field, variables);
        const link = (rootSnap as any)[linkKey];
        if (!link?.__ref) {
          return false;
        }
        continue;
      }

      // Scalar leaf at root
      const propName =
        (field.responseKey && field.responseKey !== field.fieldName
          ? field.responseKey
          : field.fieldName) || field.responseKey;
      if (!(propName in rootSnap)) {
        return false;
      }
    }

    // ---------- Phase 2: deep verification (exact) ----------
    const visited = new Set<string>();

    const keyOf = (f: PlanField) =>
      (f.responseKey && f.responseKey !== f.fieldName ? f.responseKey : f.fieldName) || f.responseKey;

    const checkInlineScalars = (obj: any, selSet: PlanField[] | null | undefined, ctx: any): boolean => {
      if (!selSet || selSet.length === 0) return true;
      for (let i = 0; i < selSet.length; i++) {
        const f = selSet[i];
        const k = keyOf(f);

        if (f.selectionSet && f.selectionSet.length > 0) {
          // nested inline object
          const childObj = obj ? (obj as any)[k] : undefined;
          if (!childObj || typeof childObj !== "object") {
            return false;
          }
          if (!checkInlineScalars(childObj, f.selectionSet, ctx)) return false;
        } else {
          // leaf scalar
          if (!(k in (obj || {}))) {
            return false;
          }
        }
      }
      return true;
    };

    const checkSelection = (parentId: string, field: PlanField): boolean => {
      // 1) @connection
      if (field.isConnection) {
        const pageKey = buildConnectionKey(field, parentId, variables);
        const page = graph.getRecord(pageKey);
        if (!page) {
          return false;
        }

        const selMap = field.selectionMap;
        if (selMap && selMap.size) {
          // pageInfo
          const piField = selMap.get("pageInfo");
          if (piField) {
            const pageInfo = (page as any).pageInfo;
            if (!pageInfo || typeof pageInfo !== "object") {
              return false;
            }
            if (!checkInlineScalars(pageInfo, piField.selectionSet, { pageKey, branch: "pageInfo" })) return false;
          }

          // extras on the connection (e.g., totalCount)
          for (const [rk, f] of selMap) {
            if (rk === "edges" || rk === "pageInfo") continue;
            const k = keyOf(f);
            if (f.selectionSet && f.selectionSet.length > 0) {
              const child = (page as any)[k];
              if (!child || typeof child !== "object") {
                return false;
              }
              if (!checkInlineScalars(child, f.selectionSet, { pageKey, branch: k })) return false;
            } else {
              if (!(k in (page as any))) {
                return false;
              }
            }
          }

          // edges → node recursion (only if node has its own selection)
          const edgesField = selMap.get("edges");
          const nodeField = edgesField?.selectionMap?.get("node");
          if (nodeField?.selectionSet?.length && Array.isArray((page as any).edges)) {
            const childMap = nodeField.selectionMap!;
            const edgesArr = (page as any).edges as Array<{ __ref?: string }>;

            for (let i = 0; i < edgesArr.length; i++) {
              const edgeRef = edgesArr[i]?.__ref;
              if (!edgeRef) continue;
              const edgeRec = graph.getRecord(edgeRef);
              const nodeRef: string | undefined = edgeRec?.node?.__ref;
              if (!nodeRef) {
                // edge without node — acceptable for empty slots
                continue;
              }

              const guardKey = `${field.responseKey}:${nodeRef}`;
              if (visited.has(guardKey)) continue;
              visited.add(guardKey);

              for (const [, child] of childMap) {
                if (!checkSelection(nodeRef, child)) return false;
              }
            }
          }
        }

        return true;
      }

      // 2) Non-connection field
      const parentSnap = graph.getRecord(parentId) || {};

      // Object child → must be linked via field key
      if (field.selectionSet && field.selectionSet.length > 0) {
        const linkKey = buildFieldKey(field, variables);
        const link = (parentSnap as any)[linkKey];
        if (!link?.__ref) {
          return false;
        }

        const childId = link.__ref as string;
        const guardKey = `${field.responseKey}:${childId}`;
        if (visited.has(guardKey)) return true;
        visited.add(guardKey);

        const childMap = field.selectionMap!;
        for (const [, child] of childMap) {
          if (!checkSelection(childId, child)) return false;
        }
        return true;
      }

      // Scalar leaf on this parent entity
      const propName = keyOf(field);
      if (!(propName in (parentSnap as any))) {
        return false;
      }

      return true;
    };

    // Deep walk from root
    for (let i = 0; i < plan.root.length; i++) {
      if (!checkSelection(ROOT_ID, plan.root[i])) return false;
    }
    return true;
  };

  const prewarmDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }) => {
    const plan = planner.getPlan(document);

    // Helper: if the concrete page exists, forward it to canonical WITHOUT leader reset.
    const tryForwardConcretePage = (field: PlanField, parentId: string) => {
      const pageKey = buildConnectionKey(field, parentId, variables);
      const page = graph.getRecord(pageKey);
      if (!page || !Array.isArray(page.edges)) return;

      // Rebuild edge refs as { __ref } list
      const pageEdgeRefs = page.edges
        .map((e: any) => (e && e.__ref ? { __ref: e.__ref } : null))
        .filter(Boolean) as Array<{ __ref: string }>;

      // Shallow snapshot without edges (includes __typename, pageInfo, extras)
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

      // Nested child connections under node
      const edgesField = field.selectionMap?.get("edges");
      const nodeField = edgesField?.selectionMap?.get("node");
      if (nodeField?.selectionMap) {
        for (let i = 0; i < page.edges.length; i++) {
          const edgeRef = page.edges[i]?.__ref;
          if (!edgeRef) continue;
          const edgeRec = graph.getRecord(edgeRef);
          const childParentRef: string | undefined = edgeRec?.node?.__ref;
          if (!childParentRef) continue;

          for (const [, childField] of nodeField.selectionMap) {
            if (!childField.isConnection) continue;
            tryForwardConcretePage(childField, childParentRef);
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
