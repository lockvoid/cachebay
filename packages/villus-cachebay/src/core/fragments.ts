import type { DocumentNode } from "graphql";
import {
  compileToPlan,
  isCachePlanV1,
  type CachePlanV1,
  type PlanField,
} from "@/src/compiler";
import { ROOT_ID, IDENTITY_FIELDS } from "./constants";
import { isObject, hasTypename } from "./utils";
import type { GraphInstance } from "./graph";
import type { ViewsAPI } from "./views";

export type FragmentsOptions = {
  connections?: Record<string, Record<string, { mode?: "infinite" | "page"; args?: string[] }>>;
};

export type FragmentsDependencies = {
  graph: GraphInstance;
  views: ViewsAPI; // createViews({ graph })
};

export type ReadFragmentArgs = {
  id: string;                       // canonical record id, e.g. "User:u1"
  fragment: DocumentNode | CachePlanV1;
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  id: string;                       // canonical record id, e.g. "User:u1"
  fragment: DocumentNode | CachePlanV1;
  data: any;                        // page-shaped or entity-shaped subtree
  variables?: Record<string, any>;
};

export const createFragments = (
  options: FragmentsOptions,
  deps: FragmentsDependencies
) => {
  const { graph, views } = deps;

  // Plan cache per DocumentNode to avoid recompiling fragments
  const planCache = new WeakMap<DocumentNode, CachePlanV1>();

  const getPlan = (docOrPlan: DocumentNode | CachePlanV1): CachePlanV1 => {
    if (isCachePlanV1(docOrPlan)) return docOrPlan;
    const hit = planCache.get(docOrPlan);
    if (hit) return hit;
    const plan = compileToPlan(docOrPlan, { connections: options.connections || {} });
    planCache.set(docOrPlan, plan);
    return plan;
  };

  const buildFieldKey = (field: PlanField, variables: Record<string, any>) => {
    // stringifyArgs receives raw variables; it applies buildArgs internally
    return `${field.fieldName}(${field.stringifyArgs(variables)})`;
  };

  const buildConnectionKey = (field: PlanField, parentRecordId: string, variables: Record<string, any>) => {
    const prefix = parentRecordId === ROOT_ID ? "@." : `@.${parentRecordId}.`;
    return `${prefix}${field.fieldName}(${field.stringifyArgs(variables)})`;
  };

  // Shallow upsert for an identifiable object (writes identity + shallow normalized fields)
  const upsertEntityShallow = (node: any): string | null => {
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

      // Skip embedding connection-like objects
      if (
        isObject(value) &&
        typeof (value as any).__typename === "string" &&
        (value as any).__typename.endsWith("Connection") &&
        Array.isArray((value as any).edges)
      ) {
        continue;
      }

      // Linked identifiable
      if (isObject(value) && hasTypename(value) && value.id != null) {
        const childKey = graph.identify(value);
        if (childKey) {
          graph.putRecord(childKey, { __typename: value.__typename, id: String(value.id) });
          snapshot[field] = { __ref: childKey };
          continue;
        }
      }

      // Arrays (may contain identifiable)
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

      snapshot[field] = value;
    }

    graph.putRecord(entityKey, snapshot);
    return entityKey;
  };

  /** Reactive read of a fragment selection over an entity. */
  const readFragment = ({ id, fragment, variables = {} }: ReadFragmentArgs): any => {
    const plan = getPlan(fragment);
    const proxy = graph.materializeRecord(id);
    if (!proxy) return undefined; // in your setup this usually returns a reactive empty proxy; tests updated accordingly
    return views.getEntityView(proxy, plan.root, variables);
  };

  /** Targeted write of entity/connection fields covered by the fragment selection. */
  const writeFragment = ({ id, fragment, data, variables = {} }: WriteFragmentArgs): void => {
    if (!data || typeof data !== "object") return;

    const plan = getPlan(fragment);

    // Ensure the parent record exists
    const parentProxy = graph.materializeRecord(id);
    if (!parentProxy) {
      if (hasTypename(data) && (data as any).id != null) {
        upsertEntityShallow(data);
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

      if (field.isConnection) {
        const subtree = (data as any)[respKey];
        if (!isObject(subtree)) continue;

        const pageKey = buildConnectionKey(field, id, variables);

        // Build edge records and refs
        const inputEdges: any[] = Array.isArray((subtree as any).edges) ? (subtree as any).edges : [];
        const edgeRefs = new Array(inputEdges.length);

        for (let j = 0; j < inputEdges.length; j++) {
          const edge = inputEdges[j] || {};
          const nodeObj = edge.node;

          if (isObject(nodeObj) && hasTypename(nodeObj) && nodeObj.id != null) {
            const nodeKey = upsertEntityShallow(nodeObj);
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
        const pageSnap: Record<string, any> = {
          __typename: (subtree as any).__typename || "Connection",
          ...connRest, // extras like totalCount
          edges: edgeRefs,
        };
        if (pageInfo) pageSnap.pageInfo = { ...(pageInfo as any) };

        graph.putRecord(pageKey, pageSnap);
        continue;
      }

      // Non-connection fields
      const value = (data as any)[respKey];
      if (value === undefined) continue;

      if (isObject(value) && hasTypename(value) && (value as any).id != null) {
        const key = upsertEntityShallow(value);
        if (key) patch[field.fieldName] = { __ref: key };
        continue;
      }

      if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let k = 0; k < value.length; k++) {
          const item = value[k];
          if (isObject(item) && hasTypename(item) && (item as any).id != null) {
            const key = upsertEntityShallow(item);
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
