import { buildFieldKey, buildConnectionKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "@/src/compiler";

export type ViewsInstance = ReturnType<typeof createViews>;

export type ViewsDependencies = {
  graph: GraphInstance;
};

const mapFrom = (fields: PlanField[] | null | undefined): Map<string, PlanField> => {
  const map = new Map<string, PlanField>();
  if (!fields) return map;
  for (let i = 0; i < fields.length; i++) {
    map.set(fields[i].responseKey, fields[i]);
  }
  return map;
};

/**
 * View helpers: shared reactive wrappers for entities, connection pages, and edges.
 * One WeakMap cache per helpers instance (usually one per createDocuments / createFragments).
 */
export const createViews = (dependencies: ViewsDependencies) => {
  const { graph } = dependencies;

  const viewCache = new WeakMap<object, any>();

  // View cache for materialized documents

  const getEntityView = (entityProxy: any, fields: PlanField[] | null, variables: Record<string, any>): any => {
    if (!entityProxy || typeof entityProxy !== "object") return entityProxy;

    let bucket = viewCache.get(entityProxy);
    if (!bucket || bucket.kind !== "entity") {
      bucket = { kind: "entity", bySelection: new Map<PlanField[] | null, any>() };
      viewCache.set(entityProxy, bucket);
    } else {
      const hit = bucket.bySelection.get(fields || null);
      if (hit) return hit;
    }

    const view = new Proxy(entityProxy, {
      get(target, prop, receiver) {
        const field = fields && typeof prop === "string"
          ? (fields as any).selectionMap?.get?.(prop as string) ?? mapFrom(fields).get(prop as string)
          : undefined;

        // Lazily materialize connection fields
        if (field?.isConnection) {
          // safer parent id (materializeRecord returns a proxy with __typename/id)
          const typename = (target as any).__typename;
          const id = (target as any).id;
          const parentId = typename && id != null ? `${typename}:${id}` : (graph.identify({ __typename: typename, id }) || "");
          const pageKey = buildConnectionKey(field, parentId, variables);
          return getConnectionView(pageKey, field, variables);
        }

        const value = Reflect.get(target, prop, receiver);

        // Deref { __ref } → entity view
        if (value && typeof value === "object" && (value as any).__ref) {
          const childProxy = graph.materializeRecord((value as any).__ref);
          const sub = fields && typeof prop === "string"
            ? ((fields as any).selectionMap?.get?.(prop as string) ?? mapFrom(fields).get(prop as string))
            : undefined;
          const subFields = sub ? sub.selectionSet || null : null;
          return childProxy ? getEntityView(childProxy, subFields, variables) : undefined;
        }

        // Arrays (map refs if we know a sub-selection)
        if (Array.isArray(value)) {
          const sub = fields && typeof prop === "string"
            ? ((fields as any).selectionMap?.get?.(prop as string) ?? mapFrom(fields).get(prop as string))
            : undefined;

          if (!sub?.selectionSet || sub.selectionSet.length === 0) {
            return value.slice();
          }

          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, sub.selectionSet || null, variables) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() { return false; },
    });

    bucket.bySelection.set(fields || null, view);
    return view;
  };

  const getEdgeView = (edgeKey: string, nodeField: PlanField | undefined, variables: Record<string, any>): any => {
    const edgeProxy = graph.materializeRecord(edgeKey);
    if (!edgeProxy) return undefined;

    let bucket = viewCache.get(edgeProxy);
    if (bucket?.kind === "edge" && bucket.view) return bucket.view;

    const view = new Proxy(edgeProxy, {
      get(target, prop, receiver) {
        if (prop === "node" && (target as any).node?.__ref) {
          const nodeProxy = graph.materializeRecord((target as any).node.__ref);
          return nodeProxy ? getEntityView(nodeProxy, nodeField?.selectionSet || null, variables) : undefined;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null, variables) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null, variables) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() { return false; },
    });

    if (!bucket || bucket.kind !== "edge") {
      bucket = { kind: "edge", view };
      viewCache.set(edgeProxy, bucket);
    } else {
      bucket.view = view;
    }

    return view;
  };

  const getConnectionView = (pageKey: string, field: PlanField, variables: Record<string, any>): any => {
    const pageProxy = graph.materializeRecord(pageKey);
    if (!pageProxy) return undefined;

    let bucket = viewCache.get(pageProxy);
    if (bucket?.kind === "page" && bucket.view) return bucket.view;

    const edgesField = field.selectionMap?.get("edges");
    const nodeField = edgesField ? edgesField.selectionMap?.get("node") : undefined;

    const view = new Proxy(pageProxy, {
      get(target, prop, receiver) {
        if (prop === "edges") {
          const list = (target as any).edges;
          if (!Array.isArray(list)) return list;

          const refs = list.map((r: any) => (r && r.__ref) || "");
          const cached = bucket?.edgesCache;
          if (
            cached &&
            cached.refs.length === refs.length &&
            cached.refs.every((v: string, i: number) => v === refs[i])
          ) {
            return cached.array;
          }

          const arr = new Array(refs.length);
          for (let i = 0; i < refs.length; i++) {
            const ek = refs[i];
            arr[i] = ek ? getEdgeView(ek, nodeField, variables) : undefined;
          }

          if (!bucket || bucket.kind !== "page") {
            bucket = { kind: "page", view, edgesCache: { refs, array: arr } };
            viewCache.set(pageProxy, bucket);
          } else {
            bucket.view = view;
            bucket.edgesCache = { refs, array: arr };
          }

          return arr;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null, variables) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null, variables) : undefined;
            } else {
              out[i] = item;
            }
          }
          return out;
        }

        return value;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() { return false; },
    });

    if (!bucket || bucket.kind !== "page") {
      bucket = { kind: "page", view, edgesCache: { refs: [], array: [] } };
      viewCache.set(pageProxy, bucket);
    } else {
      bucket.view = view;
    }

    return view;
  };

  return {
    getEntityView,
    getEdgeView,
    getConnectionView,
  };
};
