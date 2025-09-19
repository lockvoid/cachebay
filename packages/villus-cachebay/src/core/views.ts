import { buildConnectionKey, buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "@/src/compiler";

export type ViewsInstance = ReturnType<typeof createViews>;
export type ViewsDependencies = { graph: GraphInstance };

/**
 * View helpers: reactive wrappers for entities, edges and (page/canonical) connections.
 * Caching is explicit per (entityProxy, selectionKey, canonicalFlag).
 */
export const createViews = ({ graph }: ViewsDependencies) => {
  // ONE cache for all views we produce
  const viewCache = new WeakMap<object, any>();

  /**
   * Entity view memoized per (entityProxy, selectionKey, canonicalFlag).
   * - fieldsMap MUST come from the compiler (rootSelectionMap or field.selectionMap)
   * - canonical=true makes nested connection fields read from the canonical connection
   *   (false → concrete page key)
   */
  const getEntityView = (
    entityProxy: any,
    fields: PlanField[] | null,
    fieldsMap: Map<string, PlanField> | undefined,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
    if (!entityProxy || typeof entityProxy !== "object") return entityProxy;

    // Bucket per entity proxy. Inside, cache by selectionKey → (canonicalFlag → view)
    let bucket = viewCache.get(entityProxy);
    if (!bucket || bucket.kind !== "entity") {
      bucket = { kind: "entity", bySelection: new Map<any, Map<number, any>>() };
      viewCache.set(entityProxy, bucket);
    }

    const selectionKey = fieldsMap ?? fields ?? null;
    let byCanonical = bucket.bySelection.get(selectionKey);
    if (!byCanonical) {
      byCanonical = new Map<number, any>();
      bucket.bySelection.set(selectionKey, byCanonical);
    } else {
      const hit = byCanonical.get(canonical ? 1 : 0);
      if (hit) return hit;
    }

    const view = new Proxy(entityProxy, {
      get(target, prop, receiver) {
        // PlanField lookup (when we have a selection)
        const planField =
          fields && typeof prop === "string"
            ? fieldsMap?.get(prop as string)
            : undefined;

        // Connection field → lazy connection view (canonical or page)
        if (planField?.isConnection) {
          const typename = (target as any).__typename;
          const id = (target as any).id;
          const parentId =
            typename && id != null
              ? `${typename}:${id}`
              : (graph.identify({ __typename: typename, id }) || "");

          const connKey = canonical
            ? buildConnectionCanonicalKey(planField, parentId, variables)
            : buildConnectionKey(planField, parentId, variables);

          return getConnectionView(connKey, planField, variables, canonical);
        }

        // Plain property
        const value = Reflect.get(target, prop, receiver);

        // Deref { __ref } → child entity view (keeps same canonical mode)
        if (value && typeof value === "object" && (value as any).__ref) {
          const childProxy = graph.materializeRecord((value as any).__ref);
          const sub =
            fields && typeof prop === "string"
              ? fieldsMap?.get(prop as string)
              : undefined;
          const subFields = sub ? sub.selectionSet || null : null;
          const subMap = sub ? sub.selectionMap : undefined;
          return childProxy
            ? getEntityView(childProxy, subFields, subMap, variables, canonical)
            : undefined;
        }

        // Arrays of refs → map with child entity views when we know a sub-selection
        if (Array.isArray(value)) {
          const sub =
            fields && typeof prop === "string"
              ? fieldsMap?.get(prop as string)
              : undefined;

          if (!sub?.selectionSet || sub.selectionSet.length === 0) {
            return value.slice();
          }

          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec
                ? getEntityView(rec, sub.selectionSet || null, sub.selectionMap, variables, canonical)
                : undefined;
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

    byCanonical.set(canonical ? 1 : 0, view);
    return view;
  };

  /** Edge view (memoized by edge record proxy). Node is an entity view. */
  const getEdgeView = (
    edgeKey: string,
    nodeField: PlanField | undefined,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
    const edgeProxy = graph.materializeRecord(edgeKey);
    if (!edgeProxy) return undefined;

    let bucket = viewCache.get(edgeProxy);
    if (bucket?.kind === "edge" && bucket.view) return bucket.view;

    const view = new Proxy(edgeProxy, {
      get(target, prop, receiver) {
        if (prop === "node" && (target as any).node?.__ref) {
          const nodeProxy = graph.materializeRecord((target as any).node.__ref);
          return nodeProxy
            ? getEntityView(nodeProxy, nodeField?.selectionSet || null, nodeField?.selectionMap, variables, canonical)
            : undefined;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
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

  /** Connection (page or canonical) view (memoized) + stable edges array per key */
  const getConnectionView = (
    pageKey: string,
    field: PlanField,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
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

          // Invalidate if the source edges array identity changed, or the ref list changed
          const identityChanged = !cached || cached.sourceArray !== list;
          const refsChanged =
            !cached ||
            cached.refs.length !== refs.length ||
            !cached.refs.every((v: string, i: number) => v === refs[i]);

          if (identityChanged || refsChanged) {
            const arr = new Array(refs.length);
            for (let i = 0; i < refs.length; i++) {
              const ek = refs[i];
              arr[i] = ek ? getEdgeView(ek, nodeField, variables, canonical) : undefined;
            }

            if (!bucket || bucket.kind !== "page") {
              bucket = { kind: "page", view, edgesCache: { refs, array: arr, sourceArray: list } };
              viewCache.set(pageProxy, bucket);
            } else {
              bucket.view = view;
              bucket.edgesCache = { refs, array: arr, sourceArray: list };
            }

            return arr;
          }

          return cached.array;
        }

        const value = Reflect.get(target, prop, receiver);

        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
        }

        if (Array.isArray(value)) {
          const out = new Array(value.length);
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === "object" && (item as any).__ref) {
              const rec = graph.materializeRecord((item as any).__ref);
              out[i] = rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
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
      bucket = { kind: "page", view, edgesCache: { refs: [], array: [], sourceArray: null as any } };
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
