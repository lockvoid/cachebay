// src/core/internals.ts

import {
  reactive,
  shallowReactive,
  isReactive,
  isRef,
  toRaw,
  ref,
  type App,
} from "vue";
import type { ClientPlugin } from "villus";

import { relay } from "../resolvers/relay";
import { buildCachebayPlugin, provideCachebay } from "./plugin";
import { createModifyOptimistic } from "../features/optimistic";
import { createSSRFeatures } from "../features/ssr";
import { createInspect } from "../features/debug";

import type {
  CachebayOptions,
  KeysConfig,
  ResolversFactory,
  ResolversDict,
  FieldResolver,
} from "../types";
import type {
  CachebayInternals,
  EntityKey,
  ConnectionState,
  RelayOptions,
} from "./types";

import {
  stableIdentityExcluding,
  readPathValue,
  parseEntityKey,
  buildConnectionKey,
} from "./utils";

/* ─────────────────────────────────────────────────────────────────────────────
 * Public instance type
 * ──────────────────────────────────────────────────────────────────────────── */
export type CachebayInstance = ClientPlugin & {
  dehydrate: () => any;
  hydrate: (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => void;

  identify: (obj: any) => string | null;

  readFragment: (
    refOrKey: string | { __typename: string; id?: any; _id?: any },
    materialized?: boolean
  ) => any;
  hasFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }) => boolean;
  writeFragment: (obj: any) => { commit(): void; revert(): void };

  modifyOptimistic: (build: (cache: any) => void) => { commit(): void; revert(): void };

  inspect: {
    entities: (typename?: string) => string[];
    get: (key: string) => any;
    connections: () => string[];
    connection: (
      parent: "Query" | { __typename: string; id?: any; _id?: any },
      field: string,
      variables?: Record<string, any>,
    ) => any;
    // NOTE: your debug module can expose operations() if desired
  };

  listEntityKeys: (selector: string | string[]) => string[];
  listEntities: (selector: string | string[], materialized?: boolean) => any[];
  __entitiesTick: ReturnType<typeof ref<number>>;

  gc?: { connections: (predicate?: (key: string, state: ConnectionState) => boolean) => void };

  install: (app: App) => void;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */
export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Config
  const TYPENAME_KEY = options.typenameKey || "__typename";
  const DEFAULT_WRITE_POLICY = options.writePolicy || "replace";
  const typeKeyFactories =
    typeof options.keys === "function" ? options.keys() : options.keys ? options.keys : ({} as NonNullable<KeysConfig>);
  const customIdFromObject = options.idFromObject || null;
  const shouldAddTypename = options.addTypename !== false;

  const interfaceMap: Record<string, string[]> =
    typeof options.interfaces === "function"
      ? options.interfaces()
      : options.interfaces
        ? (options.interfaces as Record<string, string[]>)
        : {};

  const useShallowEntities = options.entityShallow === true;
  const trackNonRelayResults = options.trackNonRelayResults !== false;
  const OP_CACHE_MAX =
    typeof options.lruOperationCacheSize === "number" ? Math.max(1, options.lruOperationCacheSize) : 200;

  // Stores
  const entityStore = new Map<EntityKey, any>();
  const connectionStore = new Map<string, ConnectionState>();

  const relayResolverIndex = new Map<string, RelayOptions>();
  const relayResolverIndexByType = new Map<string, Map<string, RelayOptions>>();

  function setRelayOptionsByType(parentTypename: string, field: string, opts: RelayOptions) {
    let fm = relayResolverIndexByType.get(parentTypename);
    if (!fm) {
      fm = new Map<string, RelayOptions>();
      relayResolverIndexByType.set(parentTypename, fm);
    }
    fm.set(field, opts);
    relayResolverIndex.set(parentTypename + "." + field, opts);
  }

  function getRelayOptionsByType(parentTypename: string | null, field: string): RelayOptions | undefined {
    if (!parentTypename) return undefined;
    const fm = relayResolverIndexByType.get(parentTypename);
    return fm ? fm.get(field) : undefined;
  }

  const operationCache = new Map<string, { data: any; variables: Record<string, any> }>();

  const entityViews = new Map<EntityKey, Set<any>>();
  const entityToConnectionStates = new Map<EntityKey, Set<ConnectionState>>();

  // Dirty queues
  const dirtyConnectionStates = new Set<ConnectionState>();
  let isConnFlushScheduled = false;

  function scheduleConnectionFlush() {
    if (isConnFlushScheduled) return;
    isConnFlushScheduled = true;
    queueMicrotask(() => {
      for (const state of dirtyConnectionStates) synchronizeConnectionViews(state);
      dirtyConnectionStates.clear();
      isConnFlushScheduled = false;
    });
  }

  function markConnectionDirty(state: ConnectionState) {
    dirtyConnectionStates.add(state);
    scheduleConnectionFlush();
  }

  const dirtyEntityKeys = new Set<EntityKey>();
  let isEntityFlushScheduled = false;

  function scheduleEntityFlush() {
    if (isEntityFlushScheduled) return;
    isEntityFlushScheduled = true;
    queueMicrotask(() => {
      dirtyEntityKeys.forEach((k) => synchronizeEntityViews(k));
      dirtyEntityKeys.clear();
      isEntityFlushScheduled = false;
    });
  }

  function markEntityDirty(key: EntityKey) {
    dirtyEntityKeys.add(key);
    scheduleEntityFlush();
  }

  function resetRuntime() {
    entityToConnectionStates.clear();
    dirtyConnectionStates.clear();
    dirtyEntityKeys.clear();
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity id & parent helpers (hoisted)
   * ────────────────────────────────────────────────────────────────────────── */
  function idOf(o: any): EntityKey | null {
    if (customIdFromObject) return customIdFromObject(o);
    const t = o && (o as any)[TYPENAME_KEY];
    if (!t) return null;
    const perType = (typeKeyFactories as Record<string, (obj: any) => string | null>)[t];
    if (perType) {
      const idp = perType(o);
      return idp == null ? null : t + ":" + String(idp);
    }
    const id = (o as any)?.id;
    if (id != null) return t + ":" + String(id);
    const _id = (o as any)?._id;
    return _id != null ? t + ":" + String(_id) : null;
  }

  function parentEntityKeyFor(typename: string, id?: any) {
    return typename === "Query" ? "Query" : id == null ? null : typename + ":" + String(id);
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Connection state (hoisted)
   * ────────────────────────────────────────────────────────────────────────── */
  function ensureConnectionState(key: string): ConnectionState {
    let state = connectionStore.get(key);
    if (!state) {
      state = {
        list: [],
        pageInfo: shallowReactive({}),
        meta: shallowReactive({}),
        views: new Set(),
        keySet: new Set(),
        initialized: false,
      };
      (state as any).__key = key;
      connectionStore.set(key, state);
    }
    return state;
  }

  function linkEntityToConnection(key: EntityKey, state: ConnectionState) {
    let set = entityToConnectionStates.get(key);
    if (!set) {
      set = new Set();
      entityToConnectionStates.set(key, set);
    }
    set.add(state);
  }

  function unlinkEntityFromConnection(key: EntityKey, state: ConnectionState) {
    const set = entityToConnectionStates.get(key);
    if (!set) return;
    set.delete(state);
    if (!set.size) entityToConnectionStates.delete(key);
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Views helpers
   * ────────────────────────────────────────────────────────────────────────── */
  const MAX_STRONG_VIEWS = 8;

  function isValidView(v: any) {
    return !!(v && typeof v === "object" && Array.isArray((v as any).edges) && (v as any).pageInfo);
  }

  function pruneInvalidViews(state: ConnectionState) {
    if (!state || !state.views || state.views.size === 0) return;
    const toRemove: any[] = [];
    state.views.forEach((v: any) => { if (!isValidView(v)) toRemove.push(v as any); });
    for (let i = 0; i < toRemove.length; i++) state.views.delete(toRemove[i]);
  }

  /**
   * Strong view registry with window control:
   * - if `resetLimit` true → hard reset limit to the requested window (baseline)
   * - else → only extend limit (cursor pages)
   */
  function addStrongView(
    state: ConnectionState,
    view: {
      edges: any[];
      pageInfo: any;
      root: any;
      edgesKey: string;
      pageInfoKey: string;
      pinned?: boolean;
      limit?: number;
      resetLimit?: boolean;
    }
  ) {
    pruneInvalidViews(state);
    if (!isValidView(view)) return;

    for (const existing of state.views) {
      if (!isValidView(existing)) {
        state.views.delete(existing);
        continue;
      }
      if ((existing as any).edges === view.edges) {
        if (typeof view.limit === "number") {
          if (view.resetLimit === true) {
            (existing as any).limit = view.limit; // baseline: shrink back to requested
          } else {
            const prev = (existing as any).limit ?? 0; // cursor: extend only
            if (view.limit > prev) (existing as any).limit = view.limit;
          }
        }
        if (view.pinned) (existing as any).pinned = true;
        return;
      }
    }

    // new view entry
    state.views.add(view);

    // cap number of strong views
    if (state.views.size > MAX_STRONG_VIEWS) {
      let toDrop: any | null = null;
      for (const v of state.views.values()) {
        if (!isValidView(v)) { toDrop = v; break; }
        if (!(v as any).pinned) { toDrop = v; break; }
      }
      if (!toDrop) toDrop = state.views.values().next().value || null;
      if (toDrop) state.views.delete(toDrop);
    }
  }

  function forEachView(state: ConnectionState, run: (v: any) => void) {
    pruneInvalidViews(state);
    state.views.forEach((v) => { if (isValidView(v)) run(v); });
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity write/read (hoisted)
   * ────────────────────────────────────────────────────────────────────────── */
  function putEntity(obj: any, override?: "replace" | "merge"): EntityKey | null {
    const key = idOf(obj);
    if (!key) return null;
    const wasExisting = entityStore.has(key);
    const mode = override || DEFAULT_WRITE_POLICY;

    if (mode === "replace") {
      const snapshot: any = Object.create(null);
      const kk = Object.keys(obj);
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        if (k === TYPENAME_KEY || k === "id" || k === "_id") continue;
        snapshot[k] = (obj as any)[k];
      }
      entityStore.set(key, snapshot);
    } else {
      const destination = entityStore.get(key) || Object.create(null);
      const kk = Object.keys(obj);
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        if (k === TYPENAME_KEY || k === "id" || k === "_id") continue;
        (destination as any)[k] = (obj as any)[k];
      }
      entityStore.set(key, destination);
    }

    if (!wasExisting) bumpEntitiesTick();
    return key;
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Proxies & materialization
   * ────────────────────────────────────────────────────────────────────────── */
  const HAS_WEAKREF = typeof (globalThis as any).WeakRef !== "undefined";
  const PROXY_CACHE = HAS_WEAKREF ? new Map<EntityKey, WeakRef<any>>() : new Map<EntityKey, any>();
  const MATERIALIZED_CACHE_REF: Map<EntityKey, any> | null =
    HAS_WEAKREF ? new Map<EntityKey, WeakRef<any>>() : null;

  function isInterfaceTypename(t: string | null) { return !!(t && interfaceMap[t]); }
  function getImplementationsFor(t: string) { return interfaceMap[t] || []; }

  function resolveConcreteEntityKey(abstractKey: EntityKey): EntityKey | null {
    const { typename, id } = parseEntityKey(abstractKey);
    if (!typename || !id || !isInterfaceTypename(typename)) return abstractKey;
    const impls = interfaceMap[typename];
    for (let i = 0; i < impls.length; i++) {
      const candidate = impls[i] + ":" + id;
      if (entityStore.has(candidate)) return candidate;
    }
    return null;
  }

  function doesEntityKeyMatch(maybeAbstract: EntityKey, candidate: EntityKey) {
    if (maybeAbstract === candidate) return true;
    const a = parseEntityKey(maybeAbstract);
    const b = parseEntityKey(candidate);
    if (!a.typename || !a.id || !b.typename || !b.id) return false;
    if (a.id !== b.id) return false;
    if (a.typename === b.typename) return true;
    if (isInterfaceTypename(a.typename) && getImplementationsFor(a.typename).includes(b.typename!)) return true;
    return false;
  }

  function makeEntityProxy(base: any) {
    return useShallowEntities ? shallowReactive(base) : reactive(base);
  }

  function registerEntityView(key: EntityKey, obj: any) {
    if (!obj || typeof obj !== "object") return;
    let set = entityViews.get(key);
    if (!set) {
      set = new Set<any>();
      entityViews.set(key, set);
    }
    const proxy = isReactive(obj) ? obj : (useShallowEntities ? shallowReactive(obj) : reactive(obj));
    set.add(proxy);
  }

  function materializeEntity(key: EntityKey) {
    if (HAS_WEAKREF && MATERIALIZED_CACHE_REF) {
      const wr = MATERIALIZED_CACHE_REF.get(key) as WeakRef<any> | undefined;
      const cached = (wr && (wr as any).deref) ? (wr as any).deref() : undefined;
      if (cached) {
        const src = entityStore.get(key);
        if (src) {
          const kk = Object.keys(src);
          for (let i = 0; i < kk.length; i++) {
            const k = kk[i];
            if ((cached as any)[k] !== (src as any)[k]) (cached as any)[k] = (src as any)[k];
          }
        }
        return cached;
      }
      const idx = key.indexOf(":");
      const typename = idx === -1 ? key : key.slice(0, idx);
      const id = idx === -1 ? undefined : key.slice(idx + 1);
      const src = entityStore.get(key);
      const out: any = { [TYPENAME_KEY]: typename };
      if (id != null) out.id = id;
      if (src) {
        const kk = Object.keys(src);
        for (let i = 0; i < kk.length; i++) out[kk[i]] = (src as any)[kk[i]];
      }
      MATERIALIZED_CACHE_REF.set(key, new (globalThis as any).WeakRef(out));
      return out;
    }

    const idx = key.indexOf(":");
    const typename = idx === -1 ? key : key.slice(0, idx);
    const id = idx === -1 ? undefined : key.slice(idx + 1);
    const src = entityStore.get(key);
    const out: any = { [TYPENAME_KEY]: typename };
    if (id != null) out.id = id;
    if (src) {
      const kk = Object.keys(src);
      for (let i = 0; i < kk.length; i++) out[kk[i]] = (src as any)[kk[i]];
    }
    return out;
  }

  function proxyForEntityKey(key: EntityKey) {
    const resolvedKey = resolveConcreteEntityKey(key) || key;

    if (HAS_WEAKREF) {
      const wr = PROXY_CACHE.get(resolvedKey) as WeakRef<any> | undefined;
      const cached = (wr && (wr as any).deref) ? (wr as any).deref() : undefined;
      if (cached) return cached;
      const base = materializeEntity(resolvedKey);
      const proxy = isReactive(base) ? base : makeEntityProxy(base);
      PROXY_CACHE.set(resolvedKey, new (globalThis as any).WeakRef(proxy));
      registerEntityView(resolvedKey, proxy);
      return proxy;
    }

    const cached = PROXY_CACHE.get(resolvedKey);
    if (cached) return cached;
    const base = materializeEntity(resolvedKey);
    const proxy = isReactive(base) ? base : makeEntityProxy(base);
    PROXY_CACHE.set(resolvedKey, proxy);
    registerEntityView(resolvedKey, proxy);
    return proxy;
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Stitch a result tree so edges[].node become live proxies
   * ────────────────────────────────────────────────────────────────────────── */
  function materializeResult(root: any) {
    if (!root || typeof root !== "object") return;
    const stack = [root];
    while (stack.length) {
      const cur: any = stack.pop();
      if (!cur || typeof cur !== "object") continue;

      if (Object.prototype.hasOwnProperty.call(cur, "node")) {
        const n = cur.node;
        if (n && typeof n === "object") {
          const key = idOf(n);
          if (key) {
            const resolved = resolveConcreteEntityKey(key) || key;
            cur.node = proxyForEntityKey(resolved);
          }
        }
      }
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Sync connection & entity views
   * ────────────────────────────────────────────────────────────────────────── */
  function synchronizeConnectionViews(state: ConnectionState) {
    pruneInvalidViews(state);
    if (!state.views.size) return;

    forEachView(state, (view) => {
      try {
        if (view.edgesKey && view.root && (view.root as any)[view.edgesKey] && (view.root as any)[view.edgesKey] !== view.edges) {
          let nextEdges = (view.root as any)[view.edgesKey];
          if (!isReactive(nextEdges)) nextEdges = reactive(Array.isArray(nextEdges) ? nextEdges : []);
          view.edges = nextEdges;
        }

        if (view.pageInfoKey && view.root && (view.root as any)[view.pageInfoKey] && (view.root as any)[view.pageInfoKey] !== view.pageInfo) {
          let nextPI = (view.root as any)[view.pageInfoKey];
          if (!isReactive(nextPI)) nextPI = shallowReactive(nextPI || {});
          view.pageInfo = nextPI;
        }

        const cap = view.limit != null ? view.limit : state.list.length;
        const desiredLength = Math.min(state.list.length, cap);
        const edgesArray = view.edges as any[];
        const oldLen = view._lastLen ?? 0;

        if (edgesArray.length > desiredLength) edgesArray.splice(desiredLength);

        for (let i = oldLen; i < desiredLength; i++) {
          const entry = state.list[i];
          let edgeObject = edgesArray[i] as any;
          if (!edgeObject || typeof edgeObject !== "object" || !isReactive(edgeObject)) {
            edgeObject = shallowReactive({});
            edgesArray[i] = edgeObject;
          }
          if (edgeObject.cursor !== entry.cursor) edgeObject.cursor = entry.cursor;

          const meta = entry.edge;
          if (meta) {
            const mk = Object.keys(meta);
            for (let j = 0; j < mk.length; j++) {
              const k = mk[j];
              if (edgeObject[k] !== (meta as any)[k]) edgeObject[k] = (meta as any)[k];
            }
            const ek = Object.keys(edgeObject);
            for (let j = 0; j < ek.length; j++) {
              const k = ek[j];
              if (k !== "cursor" && k !== "node" && !(k in (meta as any))) delete edgeObject[k];
            }
          } else {
            const ek = Object.keys(edgeObject);
            for (let j = 0; j < ek.length; j++) {
              const k = ek[j];
              if (k !== "cursor" && k !== "node") delete edgeObject[k];
            }
          }

          const previousNode = edgeObject.node;
          const previousKey = previousNode ? previousNode.__typename + ":" + (previousNode.id ?? previousNode._id) : null;
          const entryKey = entry.key;
          const resolvedKey = resolveConcreteEntityKey(entryKey) || entryKey;

          if (!previousNode || !previousKey || !doesEntityKeyMatch(entryKey, previousKey)) {
            edgeObject.node = proxyForEntityKey(resolvedKey);
            linkEntityToConnection(resolvedKey, state);
          } else {
            const concreteForPrev = resolveConcreteEntityKey(previousKey) || previousKey;
            const snap = entityStore.get(concreteForPrev);
            if (snap) {
              const sk = Object.keys(snap);
              for (let j = 0; j < sk.length; j++) {
                const k = sk[j];
                if ((previousNode as any)[k] !== (snap as any)[k]) (previousNode as any)[k] = (snap as any)[k];
              }
            }
          }
        }

        view._lastLen = desiredLength;

        const sourcePI = state.pageInfo;
        const targetPI = view.pageInfo as any;
        const pik = Object.keys(sourcePI);
        for (let i = 0; i < pik.length; i++) {
          const k = pik[i];
          if (targetPI[k] !== (sourcePI as any)[k]) targetPI[k] = (sourcePI as any)[k];
        }

        const mk = Object.keys(state.meta);
        for (let i = 0; i < mk.length; i++) {
          const k = mk[i];
          if ((view.root as any)[k] !== (state.meta as any)[k]) (view.root as any)[k] = (state.meta as any)[k];
        }
      } catch {
        state.views.delete(view);
      }
    });
  }

  function synchronizeEntityViews(key: EntityKey) {
    const snap = entityStore.get(key);
    if (!snap) return;
    const views = entityViews.get(key);
    if (!views) return;
    views.forEach((obj) => {
      const sk = Object.keys(snap);
      for (let i = 0; i < sk.length; i++) {
        const k = sk[i];
        if ((obj as any)[k] !== (snap as any)[k]) (obj as any)[k] = (snap as any)[k];
      }
    });
  }

  function touchConnectionsForEntityKey(key: EntityKey) {
    const set = entityToConnectionStates.get(key);
    if (!set) return;
    set.forEach((state) => markConnectionDirty(state));
  }

  // Entities tick
  const entityAddedRemovedTick = ref(0);
  function bumpEntitiesTick() {
    entityAddedRemovedTick.value++;
  }

  // Selection helpers
  function isInterfaceTypenameLocal(t: string | null) { return !!(t && interfaceMap[t]); }

  function concreteTypesFor(selector: string | string[]) {
    const inArr = Array.isArray(selector) ? selector : [selector];
    const out = new Set<string>();
    for (const t of inArr) {
      if (isInterfaceTypenameLocal(t)) {
        const impls = interfaceMap[t] || [];
        for (let i = 0; i < impls.length; i++) out.add(impls[i]);
      } else {
        out.add(t);
      }
    }
    return out;
  }

  function listEntityKeysMatching(selector: string | string[]) {
    const types = concreteTypesFor(selector);
    const keys: string[] = [];
    entityStore.forEach((_v, k) => {
      const { typename } = parseEntityKey(k);
      if (typename && types.has(typename)) keys.push(k);
    });
    return keys;
  }

  function listEntitiesMatching(selector: string | string[], materialized = true) {
    const keys = listEntityKeysMatching(selector);
    if (!materialized) {
      return keys.map((k) => {
        const resolved = resolveConcreteEntityKey(k) || k;
        return entityStore.get(resolved);
      });
    }
    return keys.map((k) => proxyForEntityKey(k));
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Graph walker for resolvers
   * ────────────────────────────────────────────────────────────────────────── */
  function walkGraph(
    obj: any,
    parentTypename: string | null,
    visitNode: (
      pt: string | null,
      parentObj: any,
      field: string,
      v: any,
      set: (nv: any) => void
    ) => void,
  ) {
    if (!obj || typeof obj !== "object") return;
    const pt = (obj && (obj as any)[TYPENAME_KEY]) || parentTypename;
    const kk = Object.keys(obj);
    for (let i = 0; i < kk.length; i++) {
      const k = kk[i];
      const v = (obj as any)[k];
      visitNode(pt || null, obj, k, v, (nv) => { (obj as any)[k] = nv; });

      if (Array.isArray(v)) {
        for (let j = 0; j < (v as any[]).length; j++) walkGraph((v as any[])[j], pt || null, visitNode);
      } else if (v && typeof v === "object") {
        walkGraph(v, pt || null, visitNode);
      }
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Op-cache writer (plain, proxy-safe, LRU)
   * ────────────────────────────────────────────────────────────────────────── */
  function unwrapShallow<T = any>(v: any): T {
    const base = isRef(v) ? v.value : v;
    return (isReactive(base) ? toRaw(base) : base) as T;
  }

  /** Make payload plain: unwrap root & first-level props/array items */
  function sanitizeForOpCache<T = any>(data: any): T {
    const root = unwrapShallow(data);
    if (!root || typeof root !== "object") return root as T;

    if (Array.isArray(root)) {
      const out = new Array(root.length);
      for (let i = 0; i < root.length; i++) out[i] = unwrapShallow(root[i]);
      return out as any;
    }

    const out: any = {};
    const keys = Object.keys(root);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out[k] = unwrapShallow((root as any)[k]);
    }
    return out;
  }

  /** Public writer so plugin can store RAW results efficiently */
  function writeOpCache(opKey: string, payload: { data: any; variables: Record<string, any> }) {
    const plainData = sanitizeForOpCache(payload.data);
    const plainVars = sanitizeForOpCache(payload.variables || {});
    operationCache.set(opKey, { data: plainData, variables: plainVars });

    if (operationCache.size > OP_CACHE_MAX) {
      const oldest = operationCache.keys().next().value as string | undefined;
      if (oldest) operationCache.delete(oldest);
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Resolvers binding
   * ────────────────────────────────────────────────────────────────────────── */
  let FIELD_RESOLVERS: Record<string, Record<string, FieldResolver>> = {};
  const RESOLVE_SIG = Symbol("cb_resolve_sig");

  const internals: CachebayInternals = {
    TYPENAME_KEY,
    DEFAULT_WRITE_POLICY,
    entityStore,
    connectionStore,
    relayResolverIndex,
    relayResolverIndexByType,
    getRelayOptionsByType,
    setRelayOptionsByType,
    operationCache,
    putEntity,
    materializeEntity,
    ensureConnectionState,
    synchronizeConnectionViews,
    parentEntityKeyFor,
    buildConnectionKey,
    readPathValue,
    markConnectionDirty,
    linkEntityToConnection,
    unlinkEntityFromConnection,
    addStrongView,
    isReactive,
    reactive,
    shallowReactive,
    writeOpCache, // 👈 moved here for the plugin

    applyFieldResolvers: (typename, obj, vars, hint) => {
      const map = FIELD_RESOLVERS[typename];
      if (!map) return;
      const sig = (hint?.stale ? "S|" : "F|") + stableIdentityExcluding(vars || {}, []);
      if ((obj as any)[RESOLVE_SIG] === sig) return;
      for (const field in map) {
        const resolver = map[field];
        if (!resolver) continue;
        const val = (obj as any)[field];
        resolver({
          parentTypename: typename,
          field,
          parent: obj,
          value: val,
          variables: vars,
          hint,
          set: (nv) => { (obj as any)[field] = nv; },
        });
      }
      (obj as any)[RESOLVE_SIG] = sig;
    },
  };

  function bindResolversTree(tree: ResolversDict | undefined, inst: CachebayInternals) {
    const out: Record<string, Record<string, FieldResolver>> = {};
    if (!tree) return out;
    for (const type in tree) {
      out[type] = {};
      for (const field in tree[type]) {
        const spec = (tree[type] as any)[field];
        out[type][field] = spec && (spec as any).__cb_resolver__ ? (spec as any).bind(inst) : (spec as FieldResolver);
      }
    }
    return out;
  }

  const resolverSource = options.resolvers;
  const resolverSpecs: ResolversDict | undefined =
    typeof resolverSource === "function"
      ? (resolverSource as ResolversFactory)({ relay })
      : (resolverSource as ResolversDict | undefined);

  FIELD_RESOLVERS = bindResolversTree(resolverSpecs, internals);

  function applyResolversOnGraph(root: any, vars: Record<string, any>, hint: { stale?: boolean }) {
    walkGraph(root, "Query", (pt, pObj, field, value, set) => {
      if (!pt) return;
      const resolver = FIELD_RESOLVERS[pt]?.[field];
      if (!resolver) return;
      resolver({ parentTypename: pt, field, parent: pObj, value, variables: vars, set, hint });
    });
  }

  // Register views from result (Relay connections)
  const registerViewsFromResult = (root: any, variables: Record<string, any>) => {
    walkGraph(root, "Query", (parentTypename, parentObj, field, value) => {
      if (!parentTypename) return;

      const relayOptions = getRelayOptionsByType(parentTypename, field);
      if (!relayOptions) return;

      // connection key
      const parentId = (parentObj as any)?.id ?? (parentObj as any)?._id;
      const parentKey = parentEntityKeyFor(parentTypename, parentId) || "Query";
      const key = buildConnectionKey(parentKey!, field, relayOptions as any, variables);
      const state = ensureConnectionState(key);

      // extract pieces
      const edgesArr = readPathValue(value, relayOptions.segs.edges);
      const pageInfoObj = readPathValue(value, relayOptions.segs.pageInfo);
      if (!edgesArr || !pageInfoObj) return;

      const edgesField = relayOptions.names.edges;
      const pageInfoField = relayOptions.names.pageInfo;

      // Fresh view container (never reuse incoming arrays)
      let viewObj: any = (parentObj as any)[field];
      const needNew =
        !viewObj ||
        typeof viewObj !== "object" ||
        !Array.isArray((viewObj as any)[edgesField]) ||
        !(viewObj as any)[pageInfoField];

      if (needNew) {
        viewObj = Object.create(null);
        viewObj.__typename = (value as any)?.__typename ?? "Connection";
        viewObj[edgesField] = reactive([] as any[]);
        viewObj[pageInfoField] = shallowReactive({});
        (parentObj as any)[field] = viewObj;
      }

      // Merge connection-level meta (exclude edges/pageInfo/__typename)
      const exclude = new Set([edgesField, relayOptions.paths.pageInfo, "__typename"]);
      if (value && typeof value === "object") {
        const vk = Object.keys(value);
        for (let i = 0; i < vk.length; i++) {
          const k = vk[i];
          if (!exclude.has(k)) (state.meta as any)[k] = (value as any)[k];
        }
      }

      // Decide visible window
      const requested =
        typeof (variables as any)?.first === "number"
          ? (variables as any).first
          : (Array.isArray(edgesArr) ? edgesArr.length : 0);

      const isCursorPage =
        (variables as any)?.after != null || (variables as any)?.before != null;

      let currentLimit = 0;
      if (state.views && state.views.size) {
        state.views.forEach((v: any) => {
          if (v && typeof v.limit === "number" && v.limit > currentLimit) currentLimit = v.limit;
        });
      }

      let nextLimit: number;
      if (!state.initialized) {
        nextLimit = requested;
      } else if (isCursorPage) {
        nextLimit = Math.min(state.list.length, currentLimit + requested); // extend
      } else {
        nextLimit = requested; // baseline reset
      }

      // Register/update strong view using the view's reactive refs
      addStrongView(state, {
        edges: viewObj[edgesField],
        pageInfo: viewObj[pageInfoField],
        root: viewObj,
        edgesKey: edgesField,
        pageInfoKey: pageInfoField,
        pinned: false,
        limit: nextLimit,
        resetLimit: !isCursorPage, // baseline should shrink back to requested
      });

      // sync immediately so viewObj shows correct window
      synchronizeConnectionViews(state);

      if (!state.initialized) state.initialized = true;
    });
  };

  // Collect non-Relay entities
  function collectEntities(root: any) {
    const touchedKeys = new Set<EntityKey>();
    const visited = new WeakSet<object>();
    const stack = [root];

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      if (visited.has(current as object)) continue;
      visited.add(current as object);

      const typename = (current as any)[TYPENAME_KEY];
      if (typename) {
        const ek = idOf(current);
        if (ek) {
          putEntity(current);
          if (trackNonRelayResults) registerEntityView(ek, current);
          touchedKeys.add(ek);
        }
      }

      const keys = Object.keys(current as any);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const value = (current as any)[k];

        if (!value || typeof value !== "object") continue;

        const opts = getRelayOptionsByType(typename || null, k);
        if (opts) {
          const edges = readPathValue(value, opts.segs.edges);
          if (Array.isArray(edges)) {
            const hasPath = opts.hasNodePath;
            const nodeField = opts.names.nodeField;

            for (let j = 0; j < edges.length; j++) {
              const edge = edges[j];
              if (!edge || typeof edge !== "object") continue;

              const node = hasPath ? readPathValue(edge, opts.segs.node) : (edge as any)[nodeField];
              if (!node || typeof node !== "object") continue;

              const key = idOf(node);
              if (!key) continue;

              putEntity(node);
              touchedKeys.add(key);
            }
          }
          continue;
        }

        stack.push(value);
      }
    }

    touchedKeys.forEach((key) => {
      markEntityDirty(key);
      touchConnectionsForEntityKey(key);
    });
  }

  // SSR feature
  const ssr = createSSRFeatures({
    entityStore,
    connectionStore,
    operationCache,
    ensureConnectionState,
    linkEntityToConnection,
    shallowReactive,
    registerViewsFromResult,
    resetRuntime,
    applyResolversOnGraph,
    collectEntities,
    materializeResult,
  });

  // Cache plugin
  const plugin = buildCachebayPlugin(internals, {
    shouldAddTypename,
    opCacheMax: OP_CACHE_MAX,
    isHydrating: ssr.isHydrating,
    hydrateOperationTicket: ssr.hydrateOperationTicket,
    applyResolversOnGraph,
    registerViewsFromResult,
    collectEntities,
  });

  // Fragments API
  const identify = (obj: any): EntityKey | null => idOf(obj);

  function keyFromRefOrKey(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }): EntityKey | null {
    if (typeof refOrKey === "string") return refOrKey;
    const t = (refOrKey as any) && (refOrKey as any)[TYPENAME_KEY];
    const id = (refOrKey as any)?.id ?? (refOrKey as any)?._id;
    return t && id != null ? String(t) + ":" + String(id) : null;
  }

  function hasFragment(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }) {
    const raw = keyFromRefOrKey(refOrKey);
    if (!raw) return false;
    const { typename, id } = parseEntityKey(raw);
    if (!typename) return false;
    if (isInterfaceTypenameLocal(typename) && id != null) {
      const impls = (interfaceMap as Record<string, string[]>)[typename] || [];
      for (let i = 0; i < impls.length; i++) {
        const k = impls[i] + ":" + id;
        if (entityStore.has(k)) return true;
      }
      return false;
    }
    return entityStore.has(raw);
  }

  function readFragment(
    refOrKey: EntityKey | { __typename: string; id?: any; _id?: any },
    materialized = true
  ) {
    const key = keyFromRefOrKey(refOrKey);
    if (!key) return undefined;
    if (!materialized) {
      const { typename, id } = parseEntityKey(key);
      if (isInterfaceTypenameLocal(typename) && id != null) {
        const impls = interfaceMap[typename] || [];
        for (let i = 0; i < impls.length; i++) {
          const k = impls[i] + ":" + id;
          if (entityStore.has(k)) return entityStore.get(k);
        }
        return undefined;
      }
      const k = resolveConcreteEntityKey(key) || key;
      return entityStore.get(k);
    }
    return proxyForEntityKey(key);
  }

  function writeFragment(obj: any) {
    let key = idOf(obj);
    if (key) {
      const { typename } = parseEntityKey(key);
      if (isInterfaceTypenameLocal(typename)) {
        const resolved = resolveConcreteEntityKey(key);
        if (!resolved) return { commit() { }, revert() { } };
        key = resolved;
      }
    }
    if (!key) return { commit() { }, revert() { } };

    const previous = entityStore.get(key);

    putEntity({ ...obj, [TYPENAME_KEY]: parseEntityKey(key).typename || (obj as any)[TYPENAME_KEY] });
    touchConnectionsForEntityKey(key);
    markEntityDirty(key);

    return {
      commit() { },
      revert() {
        if (previous === undefined) {
          const existed = entityStore.has(key!);
          entityStore.delete(key!);
          if (existed) bumpEntitiesTick();
        } else {
          entityStore.set(key!, previous);
        }
        touchConnectionsForEntityKey(key!);
        markEntityDirty(key!);
      },
    };
  }

  // Optimistic feature
  const modifyOptimistic = createModifyOptimistic(
    {
      entityStore,
      connectionStore,

      ensureConnectionState,
      buildConnectionKey,
      parentEntityKeyFor,
      getRelayOptionsByType,

      parseEntityKey,
      resolveConcreteEntityKey,
      doesEntityKeyMatch,
      linkEntityToConnection,
      unlinkEntityFromConnection,
      putEntity,
      idOf,

      markConnectionDirty,
      touchConnectionsForEntityKey,
      markEntityDirty,
      bumpEntitiesTick,

      isInterfaceTypename: isInterfaceTypenameLocal,
      getImplementationsFor,
      stableIdentityExcluding,
    },
    { identify, readFragment, hasFragment, writeFragment },
  );

  // Instance
  const instance = (plugin as unknown) as CachebayInstance;

  (instance as any).dehydrate = ssr.dehydrate;
  (instance as any).hydrate = ssr.hydrate;

  (instance as any).identify = identify;

  (instance as any).readFragment = readFragment;
  (instance as any).hasFragment = hasFragment;
  (instance as any).writeFragment = writeFragment;

  (instance as any).modifyOptimistic = modifyOptimistic;

  (instance as any).inspect = createInspect({
    entityStore,
    connectionStore,
    stableIdentityExcluding,
    operationCache, // if your debug UI wants it
  });

  (instance as any).listEntityKeys = listEntityKeysMatching;
  (instance as any).listEntities = listEntitiesMatching;

  (instance as any).__entitiesTick = entityAddedRemovedTick;

  (instance as any).install = (app: App) => {
    provideCachebay(app, instance);
  };

  (instance as any).gc = {
    connections(predicate?: (key: string, state: ConnectionState) => boolean) {
      connectionStore.forEach((state, key) => {
        const shouldDelete = predicate ? predicate(key, state) : state.list.length === 0 && state.views.size === 0;
        if (shouldDelete) {
          for (const entry of state.list) {
            const set = entityToConnectionStates.get(entry.key);
            if (set) {
              set.delete(state);
              if (!set.size) entityToConnectionStates.delete(entry.key);
            }
          }
          connectionStore.delete(key);
        }
      });
    },
  };

  return instance;
}
