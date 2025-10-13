import { shallowReactive } from "vue";
import { buildConnectionKey, buildConnectionCanonicalKey, isObject } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";

// Type declarations
export type ViewsInstance = ReturnType<typeof createViews>;
export type ViewsDependencies = { graph: GraphInstance };

type StableArrayCache = {
  refs: string[];
  array: any[];
  sourceArray: string[] | null;
};

type ViewCacheEntry = {
  view: any;
  edgeCache?: StableArrayCache;
};

type CacheBucket = Map<boolean, ViewCacheEntry>;
type SelectionCache = Map<any, CacheBucket>;
type ProxyCache = { bySelection: SelectionCache };

/**
 * Creates a view system that provides stable, reactive proxies over graph records.
 * Views are cached by (proxy, selection, canonical) to ensure identity stability.
 *
 * @param dependencies - Object containing the graph instance
 * @returns Object with getView function for creating/retrieving views
 */
export const createViews = ({ graph }: ViewsDependencies) => {
  const cache = new WeakMap<object, ProxyCache>();
  const inlineCache = new WeakMap<object, Map<any, Map<boolean, any>>>();
  const refsArrayCache = new WeakMap<
    object,
    Map<string | symbol, Map<any, Map<boolean, StableArrayCache>>>
  >();

  const EMPTY_MAP: ReadonlyMap<string, PlanField> = new Map();

  const selectionKeyOf = (field?: PlanField | null) => (field ?? null) as const;

  const READONLY_HANDLERS = {
    has: Reflect.has,
    ownKeys: Reflect.ownKeys,
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    set() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    defineProperty() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
  } as const;

  /**
   * Gets or creates a cache bucket for a given proxy and selection key.
   * Three-level cache structure: proxy -> selection -> canonical -> entry
   */
  const getOrCreateBucket = (proxy: object, selectionKey: any): CacheBucket => {
    let bucket = cache.get(proxy);
    if (!bucket) {
      bucket = { bySelection: new Map() };
      cache.set(proxy, bucket);
    }

    let byCanonical = bucket.bySelection.get(selectionKey);
    if (!byCanonical) {
      byCanonical = new Map();
      bucket.bySelection.set(selectionKey, byCanonical);
    }

    return byCanonical;
  };

  /**
   * Synchronizes a stable reactive array with a new refs array.
   * Uses pointer check (fast path) then content check (fallback).
   * Updates array in-place to preserve identity.
   *
   * @returns true if array was modified, false otherwise
   */
  const syncStableArray = (
    cache: StableArrayCache,
    refs: string[],
    mapRef: (ref: string) => any,
  ): boolean => {
    const identityChanged = cache.sourceArray !== refs;
    let contentChanged = false;

    if (!identityChanged) {
      if (cache.refs.length !== refs.length) {
        contentChanged = true;
      } else {
        for (let i = 0; i < refs.length; i++) {
          if (cache.refs[i] !== refs[i]) {
            contentChanged = true;
            break;
          }
        }
      }
    }

    if (identityChanged || contentChanged) {
      const arr = cache.array;

      if (arr.length > refs.length) {
        arr.splice(refs.length);
      }

      for (let i = arr.length; i < refs.length; i++) {
        arr.splice(i, 0, undefined);
      }

      for (let i = 0; i < refs.length; i++) {
        arr[i] = mapRef(refs[i]);
      }

      cache.refs = refs.slice();
      cache.sourceArray = refs;
      return true;
    }

    return false;
  };

  /**
   * Ensures connection skeleton exists in graph with proper structure.
   * Creates pageInfo and connection container if missing.
   */
  const ensureConnectionSkeleton = (pageKeyStr: string, typename: string) => {
    const pageInfoKey = `${pageKeyStr}.pageInfo`;

    if (!graph.getRecord(pageInfoKey)) {
      graph.putRecord(pageInfoKey, {
        __typename: "PageInfo",
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      });
    }

    if (!graph.getRecord(pageKeyStr)) {
      graph.putRecord(pageKeyStr, {
        __typename: typename,
        edges: null,
        pageInfo: { __ref: pageInfoKey },
      });
    }

    return graph.materializeRecord(pageKeyStr);
  };

  /**
   * Creates a stable, reactive array from { __refs } that updates in-place.
   * Keyed by (holder, prop, plan, canonical) to ensure proper identity.
   *
   * @param holder - Parent object containing the refs
   * @param prop - Property name on the holder
   * @param refs - Array of reference keys
   * @param plan - Selection plan for child items
   * @param variables - Query variables
   * @param canonical - Whether to use canonical keys
   * @returns Stable reactive array that updates in-place
   */
  const getStableRefsArray = (
    holder: object,
    prop: string | symbol,
    refs: string[],
    plan: PlanField | null | undefined,
    variables: Record<string, any>,
    canonical: boolean,
  ): any[] => {
    const selectionKey = plan ?? null;

    let byProp = refsArrayCache.get(holder);
    if (!byProp) {
      byProp = new Map();
      refsArrayCache.set(holder, byProp);
    }

    let bySelection = byProp.get(prop);
    if (!bySelection) {
      bySelection = new Map();
      byProp.set(prop, bySelection);
    }

    let byCanonical = bySelection.get(selectionKey);
    if (!byCanonical) {
      byCanonical = new Map<boolean, StableArrayCache>();
      bySelection.set(selectionKey, byCanonical);
    }

    let stable = byCanonical.get(canonical);

    const viewOf = (src: string | object, field?: PlanField | null) =>
      getView({ source: src, field: field ?? null, variables, canonical });

    if (!stable) {
      const arr: any[] = shallowReactive(
        refs.map(ref => viewOf(graph.materializeRecord(ref), plan)),
      );
      stable = { refs: refs.slice(), array: arr, sourceArray: refs };
      byCanonical.set(canonical, stable);
      return arr;
    }

    syncStableArray(stable, refs, (ref) => viewOf(graph.materializeRecord(ref), plan));
    return stable.array;
  };

  /**
   * Creates lazy, plan-guided inline view for objects/arrays with __ref/__refs.
   * Only materializes what's accessed, guided by the PlanField selection.
   *
   * @param obj - Raw object or array to wrap
   * @param plan - Selection plan to guide lazy materialization
   * @param variables - Query variables
   * @param canonical - Whether to use canonical keys
   * @param holder - Parent object (for stable __refs arrays)
   * @param prop - Property name (for stable __refs arrays)
   */
  const wrapInline = (
    obj: any,
    plan: PlanField | null | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    holder?: object,
    prop?: string | symbol,
  ): any => {
    if (!isObject(obj)) {
      return obj;
    }

    if ((obj as any).__ref) {
      const child = graph.materializeRecord((obj as any).__ref);
      return getView({ source: child, field: plan ?? null, variables, canonical });
    }

    if ((obj as any).__refs && Array.isArray((obj as any).__refs)) {
      const refs = (obj as any).__refs as string[];
      if (holder !== undefined && prop !== undefined) {
        return getStableRefsArray(holder, prop, refs, plan ?? null, variables, canonical);
      }

      return refs.map(ref =>
        getView({ source: graph.materializeRecord(ref), field: plan ?? null, variables, canonical }),
      );
    }

    if (Array.isArray(obj)) {
      return obj.map(v => wrapInline(v, plan ?? null, variables, canonical));
    }

    let byPlan = inlineCache.get(obj);
    if (!byPlan) {
      byPlan = new Map();
      inlineCache.set(obj, byPlan);
    }

    const planKey = plan ?? null;
    let byCanonical = byPlan.get(planKey);
    if (!byCanonical) {
      byCanonical = new Map();
      byPlan.set(planKey, byCanonical);
    }

    const existing = byCanonical.get(canonical);
    if (existing) {
      return existing;
    }

    const selectionMap = plan?.selectionMap ?? EMPTY_MAP;

    const inlineView = new Proxy(obj, {
      get(target, p, receiver) {
        const raw = Reflect.get(target, p, receiver);
        const subPlan = typeof p === "string" ? selectionMap.get(p) : undefined;

        if (subPlan?.isConnection && isObject(raw) && (raw as any).__ref) {
          const refKey = (raw as any).__ref as string;
          return getView({ source: refKey, field: subPlan, variables, canonical });
        }

        if (isObject(raw)) {
          return wrapInline(raw, subPlan ?? null, variables, canonical, target, p);
        }

        return raw;
      },
      has: READONLY_HANDLERS.has,
      ownKeys: READONLY_HANDLERS.ownKeys,
      getOwnPropertyDescriptor: READONLY_HANDLERS.getOwnPropertyDescriptor,
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, inlineView);
    return inlineView;
  };

  /**
   * Creates a connection view with stable edges array and container relinking.
   * Handles pageInfo via __ref and ensures connection skeleton exists.
   *
   * @param proxy - Materialized connection proxy
   * @param pageKeyStr - Connection page key for canonical relinking
   * @param field - PlanField describing the connection
   * @param variables - Query variables
   * @param canonical - Whether to use canonical container keys
   * @param selectionKey - Cache key for this selection
   */
  const getConnectionView = (
    proxy: any,
    pageKeyStr: string | undefined,
    field: PlanField | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    selectionKey: any,
  ) => {
    if (pageKeyStr && isObject(proxy) && Object.keys(proxy).length === 0) {
      const typename = field?.fieldName
        ? `${field.fieldName.charAt(0).toUpperCase()}${field.fieldName.slice(1)}Connection`
        : "Connection";
      proxy = ensureConnectionSkeleton(pageKeyStr, typename);
    }

    const byCanonical = getOrCreateBucket(proxy, selectionKey);
    const cached = byCanonical.get(canonical);
    if (cached?.view) {
      return cached.view;
    }

    const edgesFieldPlan = field?.selectionMap?.get("edges");
    const selectionMap = field?.selectionMap ?? EMPTY_MAP;

    const state: { edgeCache?: StableArrayCache } =
      cached?.edgeCache ? { edgeCache: cached.edgeCache } : {};

    const view = new Proxy(proxy, {
      get(target, p, receiver) {
        if (p === "edges") {
          const refs: string[] | undefined = (target as any)?.edges?.__refs;

          if (!Array.isArray(refs)) {
            let edgeCache = state.edgeCache;
            if (!edgeCache) {
              const arr: any[] = shallowReactive([]);
              state.edgeCache = edgeCache = { refs: [], array: arr, sourceArray: null };
            }
            return edgeCache.array;
          }

          let edgeCache = state.edgeCache;

          if (!edgeCache) {
            const arr: any[] = shallowReactive([]);
            for (let i = 0; i < refs.length; i++) {
              const edgeProxy = graph.materializeRecord(refs[i]);
              arr.push(
                getView({ source: edgeProxy, field: edgesFieldPlan ?? null, variables, canonical }),
              );
            }
            state.edgeCache = edgeCache = { refs: refs.slice(), array: arr, sourceArray: refs };
            return arr;
          }

          syncStableArray(edgeCache, refs, (ref) =>
            getView({
              source: graph.materializeRecord(ref),
              field: edgesFieldPlan ?? null,
              variables,
              canonical,
            }),
          );

          return edgeCache.array;
        }

        const raw = Reflect.get(target, p, receiver);

        if (isObject(raw) && (raw as any).__ref) {
          let refKey = (raw as any).__ref as string;
          const subPlan = typeof p === "string" ? selectionMap.get(p) : undefined;

          if (canonical && pageKeyStr && subPlan) {
            const canonicalContainerKey = `${pageKeyStr}.${String(p)}`;
            if (graph.getRecord(canonicalContainerKey)) {
              refKey = canonicalContainerKey;
            }
          }

          return getView({ source: refKey, field: subPlan ?? null, variables, canonical });
        }

        const subPlan = typeof p === "string" ? selectionMap.get(p) : undefined;
        if (Array.isArray(raw)) {
          return raw.map((v) => wrapInline(v, subPlan ?? null, variables, canonical));
        }

        if (isObject(raw)) {
          return wrapInline(raw, subPlan ?? null, variables, canonical, target, p);
        }

        return raw;
      },
      has: READONLY_HANDLERS.has,
      ownKeys: READONLY_HANDLERS.ownKeys,
      getOwnPropertyDescriptor: READONLY_HANDLERS.getOwnPropertyDescriptor,
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, { view, edgeCache: state.edgeCache });
    return view;
  };

  /**
   * Creates an entity or container view with plan-guided selection.
   * Follows __ref/__refs, routes connection fields to connection branch.
   *
   * @param proxy - Materialized entity or container proxy
   * @param field - PlanField describing the selection
   * @param variables - Query variables
   * @param canonical - Whether to use canonical keys for nested connections
   * @param selectionKey - Cache key for this selection
   */
  const getEntityView = (
    proxy: any,
    field: PlanField | null | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    selectionKey: any,
  ) => {
    const byCanonical = getOrCreateBucket(proxy, selectionKey);
    const cached = byCanonical.get(canonical);
    if (cached?.view) {
      return cached.view;
    }

    const entityId = graph.identify(proxy);
    const isContainer = !entityId;

    const selectionMap = field?.selectionMap ?? EMPTY_MAP;

    if (isContainer) {
      const wrapped = wrapInline(proxy, field, variables, canonical);
      byCanonical.set(canonical, { view: wrapped });
      return wrapped;
    }

    const view = new Proxy(proxy, {
      get(target, p, receiver) {
        const planField = typeof p === "string" ? selectionMap.get(p) : undefined;

        if (planField?.isConnection) {
          const parentId = entityId || "";
          const pageKeyStr = canonical
            ? buildConnectionCanonicalKey(planField, parentId, variables)
            : buildConnectionKey(planField, parentId, variables);

          const pageProxy = graph.materializeRecord(pageKeyStr);

          if (!pageProxy || (isObject(pageProxy) && Object.keys(pageProxy).length === 0)) {
            const typename = planField.fieldName
              ? `${planField.fieldName.charAt(0).toUpperCase()}${planField.fieldName.slice(1)}Connection`
              : "Connection";

            const materializedProxy = ensureConnectionSkeleton(pageKeyStr, typename);

            return getConnectionView(
              materializedProxy,
              pageKeyStr,
              planField,
              variables,
              canonical,
              selectionKeyOf(planField),
            );
          }

          return getConnectionView(
            pageProxy,
            pageKeyStr,
            planField,
            variables,
            canonical,
            selectionKeyOf(planField),
          );
        }

        const raw = Reflect.get(target, p, receiver);

        if (isObject(raw) && (raw as any).__ref) {
          const child = graph.materializeRecord((raw as any).__ref);
          const subPlan = typeof p === "string" ? selectionMap.get(p) : undefined;

          return getView({ source: child, field: subPlan ?? null, variables, canonical });
        }

        const subPlan = typeof p === "string" ? selectionMap.get(p) : undefined;
        if (Array.isArray(raw)) {
          return raw.map((v) => wrapInline(v, subPlan ?? null, variables, canonical));
        }

        if (isObject(raw)) {
          return wrapInline(raw, subPlan ?? null, variables, canonical, target, p);
        }

        return raw;
      },
      has: READONLY_HANDLERS.has,
      ownKeys: READONLY_HANDLERS.ownKeys,
      getOwnPropertyDescriptor: READONLY_HANDLERS.getOwnPropertyDescriptor,
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, { view });
    return view;
  };

  /**
   * Gets or creates a stable, reactive view over a graph record.
   * Views are cached by (source, selection, canonical) to ensure identity stability.
   *
   * @param source - Record key string, materialized proxy, or null
   * @param field - PlanField describing the current selection
   * @param variables - Query variables for connection key building
   * @param canonical - Whether nested connections use canonical keys
   * @returns Stable reactive proxy view
   */
  const getView = ({
    source,
    field = null,
    variables,
    canonical,
  }: {
    source: string | object | null;
    field?: PlanField | null;
    variables: Record<string, any>;
    canonical: boolean;
  }): any => {
    if (source == null) {
      return source;
    }

    const proxy = typeof source === "string" ? graph.materializeRecord(source) : source;

    if (!isObject(proxy)) {
      return proxy;
    }

    const selectionKey = selectionKeyOf(field);

    if (field?.isConnection) {
      const pageKeyStr = typeof source === "string" ? source : undefined;

      return getConnectionView(proxy, pageKeyStr, field ?? undefined, variables, canonical, selectionKey);
    }

    return getEntityView(proxy, field, variables, canonical, selectionKey);
  };

  return { getView };
};
