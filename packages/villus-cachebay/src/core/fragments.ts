// src/core/fragments.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DocumentNode } from "graphql";
import {
  type CachePlanV1,
  isCachePlanV1,
} from "@/src/compiler";
import type { PlannerInstance } from "./planner";
import type { ViewsInstance } from "./views";
import type { GraphInstance } from "./graph";
import { isObject, hasTypename, upsertEntityShallow, buildConnectionKey, buildConnectionCanonicalKey } from "./utils";

export type FragmentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  views: ViewsInstance; // createViews({ graph })
};

export type ReadFragmentArgs = {
  id: string;                       // canonical record id, e.g. "User:u1"
  fragment: DocumentNode | CachePlanV1;
  fragmentName?: string;
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  id: string;                       // canonical record id, e.g. "User:u1"
  fragment: DocumentNode | CachePlanV1;
  data: any;                        // page-shaped or entity-shaped subtree
  variables?: Record<string, any>;
};

export const createFragments = (
  deps: FragmentsDependencies
) => {
  const { graph, planner, views } = deps;

  /** Reactive read of a fragment selection over an entity. */
  const readFragment = ({ id, fragment, fragmentName, variables = {} }: ReadFragmentArgs): any => {
    const plan = planner.getPlan(fragment, { fragmentName });
    const proxy = graph.materializeRecord(id);
    if (!proxy) return undefined; // if your graph returns a reactive empty proxy, this will be truthy
    // pass selectionSet AND selectionMap per views signature
    return views.getEntityView(proxy, plan.root, plan.rootSelectionMap, variables, false);
  };

  /** Targeted write of entity/connection fields covered by the fragment selection. */
  const writeFragment = ({ id, fragment, fragmentName, data, variables = {} }: WriteFragmentArgs): void => {
    if (!data || typeof data !== "object") return;

    const plan = planner.getPlan(fragment, { fragmentName });

    // Ensure the parent record exists (entity id or any arbitrary record id)
    const parentProxy = graph.materializeRecord(id);
    if (!parentProxy) {
      if (hasTypename(data) && (data as any).id != null) {
        upsertEntityShallow(graph, data);
      } else {
        graph.putRecord(id, {});
      }
    }

    // Partial patch for non-connection fields
    const patch: Record<string, any> = {};
    if ((data as any).__typename) patch.__typename = (data as any).__typename;
    if ((data as any).id != null) patch.id = String((data as any).id);

    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];
      const respKey = field.responseKey;

      // Connection subtree — write a concrete page (edge records + page record)
      if (field.isConnection) {
        const subtree = (data as any)[respKey];
        if (!isObject(subtree)) continue;

        const pageKey = buildConnectionKey(field, id, variables);

        const inputEdges: any[] = Array.isArray((subtree as any).edges) ? (subtree as any).edges : [];
        const edgeRefs = new Array(inputEdges.length);

        for (let j = 0; j < inputEdges.length; j++) {
          const edge = inputEdges[j] || {};
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj) && nodeObj.id != null) {
            const nodeKey = upsertEntityShallow(graph, nodeObj);
            if (nodeKey) {
              const edgeKey = `${pageKey}.edges.${j}`;
              const { node, ...edgeRest } = edge as any;
              const edgeSnap: Record<string, any> = edgeRest;
              edgeSnap.node = { __ref: nodeKey };
              graph.putRecord(edgeKey, edgeSnap);
              edgeRefs[j] = { __ref: edgeKey };
            }
          }
        }

        const { edges, pageInfo, ...connRest } = subtree as any;
        const pageSnapshot: Record<string, any> = {
          __typename: (subtree as any).__typename || "Connection",
          ...connRest, // e.g. totalCount
          edges: edgeRefs,
        };
        if (pageInfo) pageSnapshot.pageInfo = { ...(pageInfo as any) };

        graph.putRecord(pageKey, pageSnapshot);
        continue;
      }

      // Non-connection fields: shallow write with entity deref
      const value = (data as any)[respKey];
      if (value === undefined) continue;

      if (isObject(value) && hasTypename(value) && (value as any).id != null) {
        const key = upsertEntityShallow(graph, value);
        if (key) patch[field.fieldName] = { __ref: key };
        continue;
      }

      if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let k = 0; k < value.length; k++) {
          const item = value[k];
          if (isObject(item) && hasTypename(item) && (item as any).id != null) {
            const key = upsertEntityShallow(graph, item);
            out[k] = key ? { __ref: key } : undefined;
          } else {
            out[k] = item;
          }
        }
        patch[field.fieldName] = out;
        continue;
      }

      patch[field.fieldName] = value;
    }

    if (Object.keys(patch).length > 0) {
      graph.putRecord(id, patch);
    }
  };

  return {
    readFragment,
    writeFragment,
  };
};
