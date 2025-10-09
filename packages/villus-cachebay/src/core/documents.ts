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
    const DEBUG = true;

    const plan = planner.getPlan(document);
    const isQuery = plan.operation === "query";

    // Root is required by spec/tests.
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    if (DEBUG) {
      console.log("[norm] op=%s vars=%s", plan.operation, JSON.stringify(variables));
      console.log("usersPostsData %s", JSON.stringify(data, null, 2));
    }

    // ———————————————————————————————————————————————————————————————
    // helpers (tight + allocation-aware)
    // ———————————————————————————————————————————————————————————————
    const isObj = (v: any): v is Record<string, any> => v != null && typeof v === "object" && !Array.isArray(v);

    const isScalarArray = (arr: any[]) => {
      for (let i = 0; i < arr.length; i++) {
        if (isObj(arr[i])) {
          return false;
        }
      }
      return true;
    };

    // Shallow scalar snapshot; skips nested objects and arrays-of-objects.
    const pickScalars = (src: Record<string, any>) => {
      const out: Record<string, any> = {};
      const ks = Object.keys(src);

      for (let i = 0; i < ks.length; i++) {
        const k = ks[i];

        // Connection internals handled explicitly.
        if (k === "edges" || k === "pageInfo") {
          continue;
        }

        const v = src[k];
        if (v == null) {
          out[k] = v;
          continue;
        }

        if (Array.isArray(v)) {
          if (isScalarArray(v)) {
            const arr = new Array(v.length);
            for (let j = 0; j < v.length; j++) {
              arr[j] = v[j];
            }
            out[k] = arr;
          }
          continue;
        }

        if (!isObj(v)) {
          out[k] = v;
        }
      }

      return out;
    };

    type Frame = {
      parentId: string;
      fields: PlanField[] | undefined | null;
      fieldsMap: Map<string, PlanField> | undefined | null;
      insideConnection: boolean;
    };

    // Worklist of node subtrees to normalize (avoids descending edges[]).
    const deferredNodes: Array<{ value: any; frame: Frame }> = [];

    const initialFrame: Frame = {
      parentId: ROOT_ID,
      fields: plan.root,
      fieldsMap: plan.rootSelectionMap ?? new Map<string, PlanField>(),
      insideConnection: false,
    };

    const visit = (parentNode: any, valueNode: any, responseKey: string | number | symbol, frame?: Frame) => {
      if (!frame) {
        return;
      }

      // Arrays: skip traversing connection edges[], otherwise keep walking.
      if (Array.isArray(valueNode)) {
        if (frame.insideConnection && responseKey === "edges") {
          if (DEBUG) {
            console.log("[norm] skip traversal of edges[] for parent=%s", frame.parentId);
          }
          return TRAVERSE_SKIP;
        }
        return frame;
      }

      // Scalars: nothing to do.
      if (!isObj(valueNode)) {
        return;
      }

      const parentId = frame.parentId;
      const fieldsMap = frame.fieldsMap as Map<string, PlanField> | undefined;
      const hasResponseKey = typeof responseKey === "string";
      const rk = hasResponseKey ? (responseKey as string) : null;
      const planField = hasResponseKey && fieldsMap ? fieldsMap.get(rk as string) : undefined;

      // IMPORTANT: when we start a deferred node subtree, traverseFast calls us once
      // with responseKey == null and valueNode == the node object.
      // We MUST NOT upsert & drop selection here; just keep walking with the same frame.
      if (!hasResponseKey && fieldsMap) {
        if (DEBUG) {
          console.log("[norm] top-of-subtree tick (no field) parent=%s — keep frame & continue", parentId);
        }
        return frame;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 1) Connection page (concrete server page under "@.")
      // ─────────────────────────────────────────────────────────────────────────
      if (planField && planField.isConnection) {
        const pageKey = buildConnectionKey(planField, parentId, variables);
        const parentFieldKey = buildFieldKey(planField, variables);

        if (DEBUG) {
          console.log(
            "[norm] CONNECTION field=%s parent=%s pageKey=%s",
            planField.responseKey,
            parentId,
            pageKey,
          );
        }

        // Edge records
        const inEdges: any[] = Array.isArray((valueNode as any).edges) ? (valueNode as any).edges : [];
        const edgeKeys: string[] = new Array(inEdges.length);

        // Pre-read node selection (if any) to queue node subtrees later.
        const edgesSel = planField.selectionMap?.get("edges");
        const nodeSel = edgesSel?.selectionMap?.get("node");
        const nodeSelectionSet = nodeSel?.selectionSet || null;
        const nodeSelectionMap = nodeSel?.selectionMap || null;

        if (DEBUG) {
          console.log(
            "[norm]   edges=%d nodeSel?=%s",
            inEdges.length,
            nodeSelectionMap ? "yes" : "no",
          );
        }

        for (let i = 0; i < inEdges.length; i++) {
          const edgeIn = inEdges[i] || {};
          const nodeObj = edgeIn.node;

          // Upsert node entity (shallow scalars) if identifiable.
          if (isObj(nodeObj)) {
            const nodeKey = graph.identify(nodeObj);
            if (nodeKey) {
              const nodePatch = pickScalars(nodeObj);
              graph.putRecord(nodeKey, nodePatch);
              if (DEBUG) {
                console.log("[norm]   entity upsert %s (from edge[%d])", nodeKey, i);
              }

              // Queue node subtree to normalize nested selections (e.g., node.posts).
              if (nodeSelectionSet && nodeSelectionMap) {
                deferredNodes.push({
                  value: nodeObj,
                  frame: {
                    parentId: nodeKey,
                    fields: nodeSelectionSet,
                    fieldsMap: nodeSelectionMap,
                    insideConnection: false, // reset: we’re normalizing an entity subtree now
                  },
                });
                if (DEBUG) {
                  const keys = Array.from(nodeSelectionMap.keys());
                  console.log("[norm]   queue node subtree %s with fields=%s", nodeKey, JSON.stringify(keys));
                }
              } else if (DEBUG) {
                console.log("[norm]   node subtree NOT queued (no nodeSelectionMap)");
              }
            } else if (DEBUG) {
              console.log("[norm]   WARN: node not identifiable at edge[%d] under page=%s", i, pageKey);
            }
          }

          // Edge record (concrete)
          const edgeKey = `${pageKey}.edges:${i}`;
          const edgePatch = pickScalars(edgeIn);

          if (isObj(edgeIn.node)) {
            const nodeKey = graph.identify(edgeIn.node);
            if (nodeKey) {
              edgePatch.node = { __ref: nodeKey };
            }
          }

          graph.putRecord(edgeKey, edgePatch);
          edgeKeys[i] = edgeKey;
          if (DEBUG) {
            console.log("[norm]   put edge %s", edgeKey);
          }
        }

        // PageInfo record
        let pageInfoKey: string | null = null;
        const pi = (valueNode as any).pageInfo;
        if (isObj(pi)) {
          pageInfoKey = `${pageKey}.pageInfo`;
          const pageInfoPatch = pickScalars(pi);
          graph.putRecord(pageInfoKey, pageInfoPatch);
          if (DEBUG) {
            console.log("[norm]   put pageInfo %s", pageInfoKey);
          }
        }

        // Page snapshot (scalars only) + refs to edges/pageInfo
        const pagePatch = pickScalars(valueNode);
        pagePatch.edges = { __refs: edgeKeys };
        if (pageInfoKey) {
          pagePatch.pageInfo = { __ref: pageInfoKey };
        }

        graph.putRecord(pageKey, pagePatch);
        if (DEBUG) {
          console.log("[norm]   put page %s", pageKey);
        }

        // Link page under parent (for queries).
        if (isQuery) {
          graph.putRecord(parentId, { [parentFieldKey]: { __ref: pageKey } });
          if (DEBUG) {
            console.log("[norm]   link %s.%s -> %s", parentId, parentFieldKey, pageKey);
          }
        }

        // Descend into the page for nested containers (e.g., aggregations).
        return {
          parentId: pageKey,
          fields: planField.selectionSet,
          fieldsMap: planField.selectionMap,
          insideConnection: true,
        } as Frame;
      }

      // Skip pageInfo object materialized above.
      if (frame.insideConnection && rk === "pageInfo") {
        if (DEBUG) {
          console.log("[norm] skip pageInfo traversal parent=%s", parentId);
        }
        return TRAVERSE_SKIP;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 2) Entity (identifiable via graph.identify)
      // ─────────────────────────────────────────────────────────────────────────
      {
        const entityKey = graph.identify(valueNode);
        if (entityKey) {
          const entityPatch = pickScalars(valueNode);
          graph.putRecord(entityKey, entityPatch);
          if (DEBUG) {
            console.log("[norm] entity upsert %s (field=%s, parent=%s)", entityKey, rk, parentId);
          }

          // Link from parent (queries only), except edges.node (linked on edge).
          if (isQuery && planField && !(frame.insideConnection && planField.responseKey === "node")) {
            const parentFieldKey = buildFieldKey(planField, variables);
            graph.putRecord(parentId, { [parentFieldKey]: { __ref: entityKey } });
            if (DEBUG) {
              console.log("[norm] link %s.%s -> %s", parentId, parentFieldKey, entityKey);
            }
          }

          return {
            parentId: entityKey,
            fields: planField?.selectionSet,
            fieldsMap: planField?.selectionMap,
            insideConnection: frame.insideConnection,
          } as Frame;
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 3) Generic container (non-identifiable object)
      // ─────────────────────────────────────────────────────────────────────────
      if (planField) {
        const containerFieldKey = buildFieldKey(planField, variables);
        const containerKey = `${parentId}.${containerFieldKey}`;
        const containerPatch = pickScalars(valueNode);

        graph.putRecord(containerKey, containerPatch);
        if (DEBUG) {
          console.log("[norm] container put %s (field=%s parent=%s)", containerKey, planField.responseKey, parentId);
        }

        if (isQuery) {
          graph.putRecord(parentId, { [containerFieldKey]: { __ref: containerKey } });
          if (DEBUG) {
            console.log("[norm] link %s.%s -> %s", parentId, containerFieldKey, containerKey);
          }
        }

        return {
          parentId: containerKey,
          fields: planField.selectionSet,
          fieldsMap: planField.selectionMap,
          insideConnection: frame.insideConnection,
        } as Frame;
      }

      // Default: keep walking with the current frame.
      return frame;
    };

    // Primary pass.
    if (DEBUG) {
      console.log("[norm] >>> primary traverse start");
    }
    traverseFast(data, initialFrame, visit);
    if (DEBUG) {
      console.log("[norm] <<< primary traverse done; deferred=%d", deferredNodes.length);
    }

    // Drain deferred node subtrees (covers nested per-node connections of any depth).
    while (deferredNodes.length > 0) {
      const { value, frame } = deferredNodes.pop()!;
      if (DEBUG) {
        console.log("[norm] >>> drain node subtree parent=%s", frame.parentId);
      }
      traverseFast(value, frame, visit);
      if (DEBUG) {
        console.log("[norm] <<< drain done parent=%s", frame.parentId);
      }
    }

    if (DEBUG) {
      console.log("[norm] complete");
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
