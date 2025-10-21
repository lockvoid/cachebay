import { shallowReactive } from "vue";
import { buildConnectionKey, buildConnectionCanonicalKey, buildFieldKey, isObject } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";

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
  pageInfoView?: any;
  pageInfoStamp?: string;
};

type CacheBucket = Map<boolean, ViewCacheEntry>;
type SelectionCache = Map<any, CacheBucket>;
type ProxyCache = { bySelection: SelectionCache };

export const createViews = ({ graph }: ViewsDependencies) => {
  const cache = new WeakMap<object, ProxyCache>();
  const inlineCache = new WeakMap<object, Map<any, Map<boolean, any>>>();
  const refsArrayCache = new WeakMap<object, Map<string | symbol, Map<any, Map<boolean, StableArrayCache>>>>();

  const EMPTY_MAP: ReadonlyMap<string, PlanField> = new Map();
  const selectionKeyOf = (field?: PlanField | null) => (field ?? null) as const;

  const READONLY_HANDLERS = {
    has: Reflect.has,
    ownKeys: Reflect.ownKeys,
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    set() { return false; },
    deleteProperty() { return false; },
    defineProperty() { return false; },
    setPrototypeOf() { return false; },
  } as const;

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
    return graph.getRecord(pageKeyStr) || {};
  };

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
      const arr: any[] = shallowReactive(refs.map(ref => viewOf(graph.getRecord(ref) || {}, plan)));
      stable = { refs: refs.slice(), array: arr, sourceArray: refs };
      byCanonical.set(canonical, stable);
      return arr;
    }

    const identityChanged = stable.sourceArray !== refs;
    let contentChanged = false;

    if (!identityChanged) {
      if (stable.refs.length !== refs.length) {
        contentChanged = true;
      } else {
        for (let i = 0; i < refs.length; i++) {
          if (stable.refs[i] !== refs[i]) {
            contentChanged = true;
            break;
          }
        }
      }
    }

    if (identityChanged || contentChanged) {
      const next = refs.map(ref => viewOf(graph.getRecord(ref), plan));
      stable.array = shallowReactive(next);
      stable.refs = refs.slice();
      stable.sourceArray = refs;
    }

    return stable.array;
  };

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
      const child = graph.getRecord((obj as any).__ref);
      return getView({ source: child, field: plan ?? null, variables, canonical });
    }

    if ((obj as any).__refs && Array.isArray((obj as any).__refs)) {
      const refs = (obj as any).__refs as string[];
      if (holder !== undefined && prop !== undefined) {
        return getStableRefsArray(holder, prop, refs, plan ?? null, variables, canonical);
      }
      return refs.map(ref =>
        getView({ source: graph.getRecord(ref), field: plan ?? null, variables, canonical }),
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

        if (subPlan && !subPlan.selectionSet && typeof p === "string") {
          const storageKey = buildFieldKey(subPlan, variables);
          return (target as any)[storageKey];
        }

        if (subPlan?.isConnection && isObject(raw) && (raw as any).__ref) {
          const refKey = (raw as any).__ref as string;
          return getView({ source: refKey, field: subPlan, variables, canonical });
        }

        if (isObject(raw)) {
          return wrapInline(raw, subPlan ?? null, variables, canonical, target, p);
        }

        return raw;
      },
      ownKeys(target) {
        const visible = new Set<PropertyKey>();
        if ("__typename" in (target as any)) visible.add("__typename");
        if ("id" in (target as any)) visible.add("id");
        for (const [respKey] of selectionMap as Map<string, any>) {
          visible.add(respKey);
        }
        const plannedStorage = new Set<string>();
        for (const [, pf] of selectionMap as Map<string, any>) {
          plannedStorage.add(buildFieldKey(pf, variables));
        }
        for (const k of Reflect.ownKeys(target)) {
          if (typeof k === "string" && plannedStorage.has(k)) continue;
          visible.add(k);
        }
        return Array.from(visible);
      },
      getOwnPropertyDescriptor(target, p) {
        if (typeof p === "string") {
          const pf = (selectionMap as Map<string, any>).get(p);
          if (pf && !pf.selectionSet) {
            const storageKey = buildFieldKey(pf, variables);
            return { enumerable: true, configurable: true, value: (target as any)[storageKey] };
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, p);
      },
      has(target, p) {
        if (typeof p === "string" && (selectionMap as Map<string, any>).has(p)) return true;
        return Reflect.has(target, p);
      },
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, inlineView);
    return inlineView;
  };

  const getConnectionView = (
    proxy: any,
    pageKeyStr: string | undefined,
    field: PlanField | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    selectionKey: any,
  ) => {
    if (pageKeyStr && isObject(proxy) && Object.keys(proxy).length === 0) {
      const typename = field?.fieldName ? `${field.fieldName.charAt(0).toUpperCase()}${field.fieldName.slice(1)}Connection` : "Connection";
      proxy = ensureConnectionSkeleton(pageKeyStr, typename);
    }

    const byCanonical = getOrCreateBucket(proxy, selectionKey);
    const cached = byCanonical.get(canonical);
    if (cached?.view) {
      return cached.view;
    }

    const edgesFieldPlan = field?.selectionMap?.get("edges");
    const selectionMap = field?.selectionMap ?? EMPTY_MAP;

    const state: ViewCacheEntry = cached ? cached : {};

    const view = new Proxy(proxy, {
      get(target, p, receiver) {
        if (p === "edges") {
          const refs: string[] | undefined = (target as any)?.edges?.__refs;

          if (!Array.isArray(refs)) {
            if (!state.edgeCache) {
              state.edgeCache = { refs: [], array: shallowReactive([]), sourceArray: null };
            }
            return state.edgeCache.array;
          }

          if (!state.edgeCache) {
            const arr: any[] = shallowReactive([]);
            for (let i = 0; i < refs.length; i++) {
              const edgeProxy = graph.getRecord(refs[i]);
              arr.push(getView({ source: edgeProxy, field: edgesFieldPlan ?? null, variables, canonical }));
            }
            state.edgeCache = { refs: refs.slice(), array: arr, sourceArray: refs };
            return arr;
          }

          const identityChanged = state.edgeCache.sourceArray !== refs;
          let contentChanged = false;

          if (!identityChanged) {
            if (state.edgeCache.refs.length !== refs.length) {
              contentChanged = true;
            } else {
              for (let i = 0; i < refs.length; i++) {
                if (state.edgeCache.refs[i] !== refs[i]) {
                  contentChanged = true;
                  break;
                }
              }
            }
          }

          if (identityChanged || contentChanged) {
            const next = refs.map(ref =>
              getView({ source: graph.getRecord(ref), field: edgesFieldPlan ?? null, variables, canonical }),
            );
            state.edgeCache.array = shallowReactive(next);
            state.edgeCache.refs = refs.slice();
            state.edgeCache.sourceArray = refs;
          }

          return state.edgeCache.array;
        }

        if (p === "pageInfo") {
          const raw = (target as any)?.pageInfo;
          if (!raw || !isObject(raw) || !(raw as any).__ref) {
            if (!state.pageInfoView) state.pageInfoView = shallowReactive({});
            return state.pageInfoView;
          }

          const refKey = (raw as any).__ref as string;
          const rec = graph.getRecord(refKey) || {};
          let stamp = "";
          const keys = Reflect.ownKeys(rec) as (string | symbol)[];
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (typeof k === "string") {
              const v = (rec as any)[k];
              if (v !== undefined) {
                if (typeof v === "object") {
                  stamp += "|o:" + (v && (v as any).__ref ? (v as any).__ref : "");
                } else {
                  stamp += "|p:" + String(v);
                }
              } else {
                stamp += "|u:";
              }
            }
          }

          if (!state.pageInfoView || state.pageInfoStamp !== stamp) {
            const out: any = {};
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              if (typeof k === "string") {
                (out as any)[k] = (rec as any)[k];
              }
            }
            state.pageInfoView = shallowReactive(out);
            state.pageInfoStamp = stamp;
          }

          return state.pageInfoView;
        }

        const planField = typeof p === "string" ? selectionMap.get(p) : undefined;
        if (planField && !planField.selectionSet && typeof p === "string") {
          const storageKey = buildFieldKey(planField, variables);
          return (target as any)[storageKey];
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
      ownKeys(target) {
        const visible = new Set<PropertyKey>();
        for (const [respKey] of selectionMap as Map<string, any>) {
          visible.add(respKey);
        }
        const plannedStorage = new Set<string>();
        for (const [, pf] of selectionMap as Map<string, any>) {
          plannedStorage.add(buildFieldKey(pf, variables));
        }
        for (const k of Reflect.ownKeys(target)) {
          if (typeof k === "string" && plannedStorage.has(k)) continue;
          visible.add(k);
        }
        return Array.from(visible);
      },
      getOwnPropertyDescriptor(target, p) {
        if (typeof p === "string") {
          const pf = (selectionMap as Map<string, any>).get(p);
          if (pf && !pf.selectionSet) {
            const storageKey = buildFieldKey(pf, variables);
            return { enumerable: true, configurable: true, value: (target as any)[storageKey] };
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, p);
      },
      has(target, p) {
        if (typeof p === "string" && (selectionMap as Map<string, any>).has(p)) return true;
        return Reflect.has(target, p);
      },
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, { view, edgeCache: state.edgeCache, pageInfoView: state.pageInfoView, pageInfoStamp: state.pageInfoStamp });
    return view;
  };

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

          const pageProxy = graph.getRecord(pageKeyStr);

          if (!pageProxy || (isObject(pageProxy) && Object.keys(pageProxy).length === 0)) {
            const typename = planField.fieldName ? `${planField.fieldName.charAt(0).toUpperCase()}${planField.fieldName.slice(1)}Connection` : "Connection";
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

        if (planField && !planField.selectionSet && typeof p === "string") {
          const storageKey = buildFieldKey(planField, variables);
          return (target as any)[storageKey];
        }

        const raw = Reflect.get(target, p, receiver);

        if (isObject(raw) && (raw as any).__ref) {
          const child = graph.getRecord((raw as any).__ref);
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
      ownKeys(target) {
        const visible = new Set<PropertyKey>();
        if ("__typename" in (target as any)) visible.add("__typename");
        if ("id" in (target as any)) visible.add("id");
        for (const [respKey] of selectionMap as Map<string, any>) {
          visible.add(respKey);
        }
        const plannedStorage = new Set<string>();
        for (const [, pf] of selectionMap as Map<string, any>) {
          plannedStorage.add(buildFieldKey(pf, variables));
        }
        for (const k of Reflect.ownKeys(target)) {
          if (typeof k === "string" && plannedStorage.has(k)) continue;
          visible.add(k);
        }
        return Array.from(visible);
      },
      getOwnPropertyDescriptor(target, p) {
        if (typeof p === "string") {
          const pf = (selectionMap as Map<string, any>).get(p);
          if (pf && !pf.selectionSet) {
            const storageKey = buildFieldKey(pf, variables);
            return { enumerable: true, configurable: true, value: (target as any)[storageKey] };
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, p);
      },
      has(target, p) {
        if (typeof p === "string" && (selectionMap as Map<string, any>).has(p)) return true;
        return Reflect.has(target, p);
      },
      set: READONLY_HANDLERS.set,
      deleteProperty: READONLY_HANDLERS.deleteProperty,
      defineProperty: READONLY_HANDLERS.defineProperty,
      setPrototypeOf: READONLY_HANDLERS.setPrototypeOf,
    });

    byCanonical.set(canonical, { view });
    return view;
  };

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

    const proxy = typeof source === "string" ? graph.getRecord(source) : source;

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
