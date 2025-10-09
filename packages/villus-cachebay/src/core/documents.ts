import { ROOT_ID } from "./constants";
import { isObject, hasTypename, traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, upsertEntityShallow, TRAVERSE_SKIP, TRAVERSE_OBJECT, TRAVERSE_ARRAY, TRAVERSE_SCALAR } from "./utils";
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
    const DEBUG = true;              // keep while refactoring
    const ENABLE_CANONICAL = false;  // off for now

    const plan = planner.getPlan(document);
    const isQuery = plan.operation === "query";

    // Seed root record required by tests/spec.
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    if (DEBUG) {
      console.log("[norm] op=%s vars=%s", plan.operation, JSON.stringify(variables));
      console.log("[norm] data %s", JSON.stringify(data, null, 2));
    }

    type Frame = {
      parentId: string;                                // record we’re currently writing into
      fields: PlanField[] | undefined | null;          // selection set on this level
      fieldsMap: Map<string, PlanField> | undefined | null;
      insideConnection: boolean;                       // true while traversing a connection page or its edges
      pageKey: string | null;                          // current connection page key (if insideConnection)
      inEdges: boolean;                                // true while iterating edges[]
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
      parentNode: any,
      valueNode: any,
      responseKey: string | number | null,
      kind: symbol,
      frame?: Frame,
    ) => {
      if (!frame) return;

      // Root tick
      if (responseKey == null) {
        if (DEBUG) console.log("[norm] >>> traverse start");
        return frame;
      }

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const planField =
        typeof responseKey === "string" && fieldsMap ? fieldsMap.get(responseKey) : undefined;

      // ─────────────────────────────────────────────────────────────────────────
      // ARRAYS
      // ─────────────────────────────────────────────────────────────────────────
      if (kind === TRAVERSE_ARRAY) {
        // Connection.edges → set edge refs on the page and dive into edge objects
        if (frame.insideConnection && responseKey === "edges") {
          const pageKey = frame.pageKey as string;
          const rawEdges: any[] = Array.isArray(valueNode) ? valueNode : [];
          const edgeRefs: string[] = new Array(rawEdges.length);
          for (let i = 0; i < rawEdges.length; i++) edgeRefs[i] = `${pageKey}.edges:${i}`;

          graph.putRecord(pageKey, { edges: { __refs: edgeRefs } });
          if (DEBUG) console.log("[norm]   set page edges[%d] on %s", rawEdges.length, pageKey);

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
          if (DEBUG) console.log("[norm] array inline %s (parent=%s)", fieldKey, parentId);
          return TRAVERSE_SKIP;
        }

        // Other arrays-of-objects (rare outside edges) → just continue
        return frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // OBJECTS
      // ─────────────────────────────────────────────────────────────────────────
      if (kind === TRAVERSE_OBJECT) {
        // Edge object inside edges[]
        if (frame.insideConnection && frame.inEdges && typeof responseKey === "number") {
          const edgeKey = `${frame.pageKey}.edges:${responseKey}`;
          // create/ensure edge record exists; scalars (cursor, score, etc.) will fill via SCALAR visits
          if (valueNode && valueNode.__typename) {
            graph.putRecord(edgeKey, { __typename: valueNode.__typename });
          } else {
            graph.putRecord(edgeKey, {}); // safe upsert
          }
          if (DEBUG) console.log("[norm]   put edge %s", edgeKey);

          // Link node ref early if identifiable (entity itself will be handled when we visit its object)
          const nodeObj = (valueNode as any).node;
          if (nodeObj) {
            const nodeKey = graph.identify(nodeObj);
            if (nodeKey) {
              graph.putRecord(edgeKey, { node: { __ref: nodeKey } });
              if (DEBUG) console.log("[norm]   link edge.node -> %s", nodeKey);
            }
          }

          return {
            parentId: edgeKey,
            fields: fieldsMap, // current level is Edge selection map already
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

          if (DEBUG) {
            console.log("[norm] CONNECTION field=%s parent=%s pageKey=%s", planField.responseKey, parentId, pageKey);
          }

          // ensure page record exists (scalars will fill via SCALAR)
          if (valueNode && valueNode.__typename) {
            graph.putRecord(pageKey, { __typename: valueNode.__typename });
          } else {
            graph.putRecord(pageKey, {});
          }

          // If pageInfo child exists, link page → pageInfo (the pageInfo object itself will fill its scalars later)
          if ((valueNode as any)?.pageInfo) {
            const pageInfoKey = `${pageKey}.pageInfo`;
            graph.putRecord(pageKey, { pageInfo: { __ref: pageInfoKey } });
            // also ensure pageInfo record exists so scalar visits have a target
            const piTypename = (valueNode as any)?.pageInfo?.__typename;
            graph.putRecord(pageInfoKey, piTypename ? { __typename: piTypename } : {});
            if (DEBUG) console.log("[norm]   link %s.pageInfo -> %s", pageKey, pageInfoKey);
          }

          // Link page under parent (queries only)
          if (isQuery) {
            graph.putRecord(parentId, { [parentFieldKey]: { __ref: pageKey } });
            if (DEBUG) console.log("[norm]   link %s.%s -> %s", parentId, parentFieldKey, pageKey);
          }

          if (ENABLE_CANONICAL) {
            // canonical.updateConnection(...)
          }

          // descend into the page (its selection set)
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
            // ensure entity record exists; scalars will fill via SCALAR visits
            if (valueNode && valueNode.__typename) {
              graph.putRecord(entityKey, { __typename: valueNode.__typename });
            } else {
              graph.putRecord(entityKey, {});
            }
            if (DEBUG) console.log("[norm] entity upsert %s (field=%s, parent=%s)", entityKey, String(responseKey), parentId);

            // Link from parent (queries only), except edges.node (edge already links to node)
            if (isQuery && planField && !(frame.insideConnection && planField.responseKey === "node")) {
              const parentFieldKey = buildFieldKey(planField, variables);
              graph.putRecord(parentId, { [parentFieldKey]: { __ref: entityKey } });
              if (DEBUG) console.log("[norm] link %s.%s -> %s", parentId, parentFieldKey, entityKey);
            }

            // If this is edge.node, reset connection flags for nested connections
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

        // Generic container — non-identifiable object (e.g., pageInfo or any inline object field)
        if (planField) {
          const containerFieldKey = buildFieldKey(planField, variables);
          const containerKey = `${parentId}.${containerFieldKey}`;

          // ensure container record exists; scalars will fill via SCALAR visits
          if (valueNode && valueNode.__typename) {
            graph.putRecord(containerKey, { __typename: valueNode.__typename });
          } else {
            graph.putRecord(containerKey, {});
          }
          if (DEBUG) console.log("[norm] container put %s (field=%s parent=%s)", containerKey, planField.responseKey, parentId);

          // Link from parent (queries only)
          if (isQuery) {
            graph.putRecord(parentId, { [containerFieldKey]: { __ref: containerKey } });
            if (DEBUG) console.log("[norm] link %s.%s -> %s", parentId, containerFieldKey, containerKey);
          }

          // If this is the pageInfo under a page, make sure parent page has the link (already done above, but safe)
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

        // Default: keep walking with same frame
        return frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // SCALARS
      // ─────────────────────────────────────────────────────────────────────────
      if (kind === TRAVERSE_SCALAR) {
        // Only act when we can resolve a field from the plan at this level
        if (typeof responseKey === "string" && fieldsMap) {
          const f = fieldsMap.get(responseKey);
          if (f && !f.selectionSet) {
            const fieldKey = buildFieldKey(f, variables);
            graph.putRecord(frame.parentId, { [fieldKey]: valueNode });
            if (DEBUG) console.log("[norm] scalar %s=%s (parent=%s)", fieldKey, JSON.stringify(valueNode), frame.parentId);
          }
        }
        return frame;
      }

      return frame;
    };

    traverseFast(data, initialFrame, visit);

    if (DEBUG) {
      console.log("[norm] <<< traverse done");
    }
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
