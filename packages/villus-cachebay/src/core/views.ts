import { shallowReactive } from "vue";
import { buildConnectionKey, buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";

export type ViewsInstance = ReturnType<typeof createViews>;
export type ViewsDependencies = { graph: GraphInstance };

/**
 * View layer: Creates reactive proxies for entities, edges, and connections.
 *
 * Key behaviors:
 * - Entities are wrapped in Proxy objects that follow refs and apply selections
 * - Connections maintain stable, reactive edge arrays via shallowReactive
 * - Views are cached per (proxy, selection, canonical-flag) for identity stability
 * - All views are read-only (set returns false)
 */
export const createViews = ({ graph }: ViewsDependencies) => {
  /**
   * Global view cache structure:
   * WeakMap<entityProxy|edgeProxy|pageProxy, ViewBucket>
   *
   * ViewBucket types:
   * - entity: { kind: "entity", bySelection: Map<selectionKey, Map<canonical, view>> }
   * - edge: { kind: "edge", view: Proxy }
   * - page: { kind: "page", view: Proxy, edgesCache?: { refs, array, sourceArray } }
   */
  const viewCache = new WeakMap<object, any>();

  /**
   * Creates a reactive entity view with selection awareness.
   *
   * @param entityProxy - Reactive record from graph.materializeRecord()
   * @param fields - Selection set from compiler (can be null for no selection)
   * @param fieldsMap - Selection map from compiler for O(1) field lookups
   * @param variables - Variables for connection keys
   * @param canonical - If true, nested connections read from canonical keys
   * @returns Proxy that follows refs, applies selections, and wraps child entities
   */
  const getEntityView = (
    entityProxy: any,
    fields: PlanField[] | null,
    fieldsMap: Map<string, PlanField> | undefined,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
    if (!entityProxy || typeof entityProxy !== "object") return entityProxy;

    // Get or create entity bucket
    let bucket = viewCache.get(entityProxy);
    if (!bucket || bucket.kind !== "entity") {
      bucket = { kind: "entity", bySelection: new Map<any, Map<number, any>>() };
      viewCache.set(entityProxy, bucket);
    }

    // Selection key: use fieldsMap (from compiler) or fields array
    const selectionKey = fieldsMap ?? fields ?? null;

    // Get or create canonical bucket
    let byCanonical = bucket.bySelection.get(selectionKey);
    if (!byCanonical) {
      byCanonical = new Map<number, any>();
      bucket.bySelection.set(selectionKey, byCanonical);
    } else {
      const hit = byCanonical.get(canonical ? 1 : 0);
      if (hit) return hit;
    }

    // Helper to recursively dereference inline objects containing __ref
    const derefInlineObject = (value: any): any => {
      // Null/undefined/primitives pass through
      if (value == null || typeof value !== "object") return value;

      // Direct __ref → dereference to entity view (or undefined if missing)
      if ((value as any).__ref) {
        const childProxy = graph.materializeRecord((value as any).__ref);
        if (!childProxy) return undefined;
        return getEntityView(childProxy, null, undefined, variables, canonical);
      }

      // { __refs: [...] } format → map to entity views
      if ((value as any).__refs && Array.isArray((value as any).__refs)) {
        const refs = (value as any).__refs as string[];
        return refs.map((ref) => {
          const childProxy = graph.materializeRecord(ref);
          if (!childProxy) return undefined;
          return getEntityView(childProxy, null, undefined, variables, canonical);
        });
      }

      // Array → recursively deref each item
      if (Array.isArray(value)) {
        return value.map((item) => derefInlineObject(item));
      }

      // Plain object → recursively deref each property
      const result: any = {};
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        result[key] = derefInlineObject(value[key]);
      }
      return result;
    };

    // Create entity view proxy
    const view = new Proxy(entityProxy, {
      get(target, prop, receiver) {
        // Field lookup from selection
        const planField =
          fields && typeof prop === "string"
            ? fieldsMap?.get(prop as string)
            : undefined;

        // Connection field → lazy connection view
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

        // Get raw value
        const value = Reflect.get(target, prop, receiver);

        // Dereference { __ref } → child entity view
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

        // Array → handle refs via derefInlineObject
        if (Array.isArray(value)) {
          return derefInlineObject(value);
        }

        // Plain object (inline) → recursively dereference any nested __ref
        if (value && typeof value === "object") {
          return derefInlineObject(value);
        }

        // Return value as-is
        return value;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() { return false; },
    });

    // Cache view
    byCanonical.set(canonical ? 1 : 0, view);
    return view;
  };

  /**
   * Creates a reactive edge view.
   *
   * @param edgeKey - Key for edge record in graph
   * @param nodeField - PlanField for the node (contains selection)
   * @param variables - Variables for connection keys
   * @param canonical - Passed to child entity views
   * @returns Proxy that wraps edge.node as an entity view
   */
  const getEdgeView = (
    edgeKey: string,
    nodeField: PlanField | undefined,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
    const edgeProxy = graph.materializeRecord(edgeKey);
    if (!edgeProxy) return undefined;

    // Check cache
    let bucket = viewCache.get(edgeProxy);
    if (bucket?.kind === "edge" && bucket.view) return bucket.view;

    // Create edge view proxy
    const view = new Proxy(edgeProxy, {
      get(target, prop, receiver) {
        // node → entity view
        if (prop === "node" && (target as any).node?.__ref) {
          const nodeProxy = graph.materializeRecord((target as any).node.__ref);
          return nodeProxy
            ? getEntityView(nodeProxy, nodeField?.selectionSet || null, nodeField?.selectionMap, variables, canonical)
            : undefined;
        }

        // Get raw value
        const value = Reflect.get(target, prop, receiver);

        // Dereference { __ref } → entity view
        if (value && typeof value === "object" && (value as any).__ref) {
          const rec = graph.materializeRecord((value as any).__ref);
          return rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
        }

        // Array of refs → map to entity views
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

    // Cache view
    if (!bucket || bucket.kind !== "edge") {
      bucket = { kind: "edge", view };
      viewCache.set(edgeProxy, bucket);
    } else {
      bucket.view = view;
    }

    return view;
  };

  /**
   * Creates a reactive connection view with stable edges array.
   *
   * Key behavior:
   * - connection.edges returns a STABLE shallowReactive array
   * - Array identity is preserved across reads
   * - Array is mutated in-place when refs change
   * - Edge views are cached per edge ref
   * - When canonical=true, container refs pointing to page records are relinked
   *   to the canonical connection (e.g., aggregations: { __ref: "page.aggregations" }
   *   becomes aggregations from canonical connection)
   *
   * @param pageKey - Connection key (page or canonical)
   * @param field - PlanField for the connection (contains selection)
   * @param variables - Variables for nested connection keys
   * @param canonical - If true, relink container refs to canonical connection
   * @returns Proxy with stable, reactive edges array
   */
  const getConnectionView = (
    pageKey: string,
    field: PlanField,
    variables: Record<string, any>,
    canonical: boolean,
  ): any => {
    const pageProxy = graph.materializeRecord(pageKey);
    if (!pageProxy) return undefined;

    // Check cache
    let bucket = viewCache.get(pageProxy);
    if (bucket?.kind === "page" && bucket.view) return bucket.view;

    // Extract node field for edge views
    const edgesField = field.selectionMap?.get("edges");
    const nodeField = edgesField ? edgesField.selectionMap?.get("node") : undefined;

    // Create connection view proxy
    const view = new Proxy(pageProxy, {
      get(target, prop, receiver) {
        // edges → stable, reactive array
        if (prop === "edges") {
          const list = (target as any).edges;
          if (!Array.isArray(list)) return list;

          // Extract refs from current list
          const refs = list.map((r: any) => (r && r.__ref) || "");
          const cached = bucket?.edgesCache;

          // First read: create stable shallowReactive array
          if (!cached) {
            const arr: any[] = shallowReactive([]);
            for (let i = 0; i < refs.length; i++) {
              const ek = refs[i];
              arr.push(ek ? getEdgeView(ek, nodeField, variables, canonical) : undefined);
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

          // Subsequent reads: check if refs changed
          const identityChanged = cached.sourceArray !== list;
          const refsChanged =
            cached.refs.length !== refs.length ||
            !cached.refs.every((v: string, i: number) => v === refs[i]);

          // Mutate stable array in-place if refs changed
          if (identityChanged || refsChanged) {
            const arr = cached.array as any[];

            // Shrink array if needed
            if (arr.length > refs.length) arr.splice(refs.length);

            // Grow array if needed
            for (let i = arr.length; i < refs.length; i++) arr.splice(i, 0, undefined);

            // Refresh edge views
            for (let i = 0; i < refs.length; i++) {
              const ek = refs[i];
              arr[i] = ek ? getEdgeView(ek, nodeField, variables, canonical) : undefined;
            }

            // Update cache
            cached.refs = refs;
            cached.sourceArray = list;
          }

          // Return stable array
          return cached.array;
        }

        // Get raw value
        const value = Reflect.get(target, prop, receiver);

        // Dereference { __ref } → relink to canonical if needed
        if (value && typeof value === "object" && (value as any).__ref) {
          const refKey = (value as any).__ref as string;

          // If canonical=true and this ref points to a page-scoped container,
          // try to read from canonical connection instead
          let actualRef = refKey;
          if (canonical && refKey.includes("@.")) {
            // Extract the field name from the ref (e.g., "@.posts({}).aggregations" → "aggregations")
            const parts = refKey.split(".");
            const fieldName = parts[parts.length - 1];

            // Build canonical key for this container
            const canonicalContainerKey = `${pageKey}.${fieldName}`;

            // If canonical container exists, use it; otherwise fall back to original
            if (graph.getRecord(canonicalContainerKey)) {
              actualRef = canonicalContainerKey;
            }
          }

          const rec = graph.materializeRecord(actualRef);
          return rec ? getEntityView(rec, null, undefined, variables, canonical) : undefined;
        }

        // Array of refs → map to entity views
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

    // Cache view
    if (!bucket || bucket.kind !== "page") {
      bucket = { kind: "page", view, edgesCache: undefined };
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
