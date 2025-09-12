// graph.ts - raw cache

import {
  reactive,
  shallowReactive,
} from "vue";

import type { EntityKey, ConnectionState } from "./types";
import { parseEntityKey, unwrapShallow, getEntityParentKey, getOperationKey, cleanVars } from "./utils";
import { TYPENAME_FIELD, OPERATION_CACHE_LIMIT } from "./constants";

/**
 * Graph-layer: owns the raw stores and entity helpers.
 * This module is intentionally "dumb" about resolvers and views.
 */

export type GraphConfig = {
  writePolicy: "replace" | "merge";
  reactiveMode: "shallow" | "deep";
  keys: Record<string, (obj: any) => string | null>;
  /**
   * interfaces: map of InterfaceName -> array of concrete type names that implement it.
   * Example: { Node: ["User", "Post"] }
   */
  interfaces: Record<string, string[]>;
};

export type GraphAPI = ReturnType<typeof createGraph>;

export const createGraph = (config: GraphConfig) => {
  const { writePolicy, reactiveMode, keys, interfaces } = config;

  // ────────────────────────────────────────────────────────────────────────────
  // Stores
  // ────────────────────────────────────────────────────────────────────────────
  // entityStore keeps ONLY snapshot fields (no __typename/id).
  const entityStore = new Map<EntityKey, Record<string, any>>();
  const connectionStore = new Map<string, ConnectionState>();
  const operationStore = new Map<string, { data: any; variables: Record<string, any> }>();

  // Fast read index: typename -> Set(keys)
  const typeIndex = new Map<string, Set<EntityKey>>();

  const addToTypeIndex = (key: EntityKey) => {
    const { typename } = parseEntityKey(key);
    if (!typename) return;
    let set = typeIndex.get(typename);
    if (!set) typeIndex.set(typename, (set = new Set()));
    set.add(key);
  };
  const removeFromTypeIndex = (key: EntityKey) => {
    const { typename } = parseEntityKey(key);
    if (!typename) return;
    const set = typeIndex.get(typename);
    if (set) set.delete(key);
  };

  // Materialized entity proxies (modern browsers assumed)
  const MATERIALIZED = new Map<EntityKey, WeakRef<any>>();

  // ────────────────────────────────────────────────────────────────────────────
  // Reverse dep-index + versions (granular watchers)
  // ────────────────────────────────────────────────────────────────────────────
  type WatcherId = number;
  const entityVersion = new Map<EntityKey, number>();
  const depIndex = new Map<EntityKey, Set<WatcherId>>();
  const watchers = new Map<
    WatcherId,
    { seen: Map<EntityKey, number>; run: () => void }
  >();
  const changedEntities = new Set<EntityKey>();
  let tickScheduled = false;
  let nextWatcherId = 1;

  const scheduleFlush = () => {
    if (tickScheduled) return;
    tickScheduled = true;
    queueMicrotask(flushEntityChanges);
  };

  const flushEntityChanges = () => {
    tickScheduled = false;
    if (changedEntities.size === 0) return;

    const toNotify = new Set<WatcherId>();
    for (const key of changedEntities) {
      const deps = depIndex.get(key);
      if (!deps) continue;
      const v = entityVersion.get(key) ?? 0;
      for (const wid of deps) {
        const w = watchers.get(wid);
        if (!w) continue;
        const prev = w.seen.get(key) ?? -1;
        if (prev !== v) {
          w.seen.set(key, v);
          toNotify.add(wid);
        }
      }
    }
    changedEntities.clear();

    for (const wid of toNotify) {
      try { watchers.get(wid)?.run(); } catch { /* noop */ }
    }
  };

  const registerEntityWatcher = (run: () => void): WatcherId => {
    const id = nextWatcherId++;
    watchers.set(id, { seen: new Map(), run });
    return id;
  };

  const unregisterEntityWatcher = (id: WatcherId) => {
    watchers.delete(id);
    for (const set of depIndex.values()) set.delete(id);
  };

  const trackEntity = (watcherId: WatcherId, key: EntityKey) => {
    let s = depIndex.get(key);
    if (!s) depIndex.set(key, (s = new Set()));
    s.add(watcherId);
    const v = entityVersion.get(key) ?? 0;
    watchers.get(watcherId)?.seen.set(key, v);
  };

  const markEntityChanged = (key: EntityKey) => {
    entityVersion.set(key, (entityVersion.get(key) ?? 0) + 1);
    changedEntities.add(key);
    scheduleFlush();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Type-level watchers (wildcard/membership)
  // ────────────────────────────────────────────────────────────────────────────
  const typeWatchers = new Map<string, Set<number>>();
  const watcherFns = new Map<number, () => void>(); // reuse ids namespace or separate
  let nextTypeWatcherId = 100000; // separate id range

  const notifyTypeChanged = (typename: string) => {
    const set = typeWatchers.get(typename);
    if (!set) return;
    for (const wid of set) watcherFns.get(wid)?.();
  };

  const registerTypeWatcher = (typename: string, run: () => void): number => {
    const wid = nextTypeWatcherId++;
    let set = typeWatchers.get(typename);
    if (!set) typeWatchers.set(typename, (set = new Set()));
    set.add(wid);
    watcherFns.set(wid, run);
    return wid;
  };

  const unregisterTypeWatcher = (typename: string, wid: number) => {
    typeWatchers.get(typename)?.delete(wid);
    watcherFns.delete(wid);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Interface helpers (precompute sets for speed)
  // ────────────────────────────────────────────────────────────────────────────
  const interfaceImpls = new Map<string, Set<string>>();
  Object.keys(interfaces).forEach((iname) => {
    interfaceImpls.set(iname, new Set(interfaces[iname] || []));
  });

  const isInterfaceType = (t: string | null) => !!(t && interfaceImpls.has(t));
  const getInterfaceTypes = (t: string) => interfaces[t] || [];

  // Given an abstract key "Node:123", find a concrete key if present.
  const resolveEntityKey = (abstractKey: EntityKey): EntityKey | null => {
    const { typename, id } = parseEntityKey(abstractKey);
    if (!typename || !id || !isInterfaceType(typename)) return abstractKey;
    const impls = interfaceImpls.get(typename)!;
    for (const impl of impls) {
      const candidate = (impl + ":" + id) as EntityKey;
      if (entityStore.has(candidate)) return candidate;
    }
    return null;
  };

  const areEntityKeysEqual = (maybeAbstract: EntityKey, candidate: EntityKey) => {
    if (maybeAbstract === candidate) return true;
    const a = parseEntityKey(maybeAbstract);
    const b = parseEntityKey(candidate);
    if (!a.typename || !a.id || !b.typename || !b.id) return false;
    if (a.id !== b.id) return false;
    if (a.typename === b.typename) return true;
    const impls = interfaceImpls.get(a.typename);
    return !!(impls && impls.has(b.typename));
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Entity id helpers
  // ────────────────────────────────────────────────────────────────────────────
  const identify = (object: any): EntityKey | null => {
    if (!object || typeof object !== "object") return null;
    const typename: string | undefined = (object as any)[TYPENAME_FIELD];
    if (!typename) return null;

    // Custom per-type keyer has priority
    const customKeyer = keys[typename];
    if (customKeyer) {
      const idVal = customKeyer(object);
      return idVal == null
        ? null
        : (typename + ":" + String(idVal)) as EntityKey;
    }

    // Default: ONLY `id` (no `_id` support)
    const id = (object as any)?.id;
    return id != null ? (typename + ":" + String(id)) as EntityKey : null;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Connection state management
  // ────────────────────────────────────────────────────────────────────────────
  const ensureConnection = (key: string): ConnectionState => {
    let state = connectionStore.get(key);
    if (!state) {
      state = {
        list: shallowReactive([] as any[]), // list is shallow-reactive
        pageInfo: shallowReactive({}),
        meta: shallowReactive({}),
        views: new Set(),
        keySet: new Set(),
        initialized: false,
        window: 0,
      } as ConnectionState;

      (state as any).__key = key;
      connectionStore.set(key, state);
    }
    return state;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Materialization (one proxy per entity; includes __typename/id)
  // ────────────────────────────────────────────────────────────────────────────
  const makeReactive = (base: any) =>
    reactiveMode === "shallow" ? shallowReactive(base) : reactive(base);

  const overlaySnapshotIntoProxy = (proxy: any, key: EntityKey) => {
    const src = entityStore.get(key);
    if (!src) {
      for (const k of Object.keys(proxy)) {
        if (k !== TYPENAME_FIELD && k !== 'id') delete proxy[k];
      }
      return;
    }
    const srcKeys = Object.keys(src);
    // remove stale fields
    for (const k of Object.keys(proxy)) {
      if (k === TYPENAME_FIELD || k === 'id') continue;
      if (!(k in (src as any))) delete proxy[k];
    }
    // overlay current fields
    for (let i = 0; i < srcKeys.length; i++) {
      const k = srcKeys[i];
      if (proxy[k] !== (src as any)[k]) proxy[k] = (src as any)[k];
    }
  };

  const getOrCreateProxy = (key: EntityKey) => {
    const wr = MATERIALIZED.get(key);
    const hit = wr?.deref?.();
    if (hit) return hit;

    // Build materialized object: identity + snapshot fields
    const { typename, id } = parseEntityKey(key);
    const raw: any = Object.create(null);
    if (typename) raw[TYPENAME_FIELD] = typename;
    if (id != null) raw.id = String(id);

    // Seed identity from the key (works for id-less keys like 'Query')
    const snap = entityStore.get(key);
    if (snap) {
      const kk = Object.keys(snap);
      for (let i = 0; i < kk.length; i++) raw[kk[i]] = (snap as any)[kk[i]];
    }

    const proxy = makeReactive(raw);
    MATERIALIZED.set(key, new WeakRef(proxy));
    return proxy;
  };

  const materializeEntity = (key: EntityKey) => {
    const resolved = resolveEntityKey(key) || key;
    const proxy = getOrCreateProxy(resolved);

    // Reflect latest snapshot
    overlaySnapshotIntoProxy(proxy, resolved);

    // Ensure identity is always present on the proxy (fixes 'Query' case)
    const { typename, id } = parseEntityKey(resolved);

    if (typename && proxy[TYPENAME_FIELD] !== typename) proxy[TYPENAME_FIELD] = typename;
    if (id != null) {
      const sid = String(id);
      if (proxy.id !== sid) proxy.id = sid;
    } else if ("id" in proxy) {
      delete proxy.id;
    }

    return proxy;
  };

  // Returns only the stored fields as a reactive object (no identity)
  const getEntity = (key: EntityKey): any | undefined => {
    const resolved = resolveEntityKey(key) || key;
    const src = entityStore.get(resolved);
    if (!src) return undefined;
    return reactiveMode === "shallow" ? shallowReactive(src) : reactive(src);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Entity write (snapshots exclude identity)
  // ────────────────────────────────────────────────────────────────────────────
  const putEntity = (obj: any, writeMode?: "replace" | "merge"): EntityKey | null => {
    const key = identify(obj);
    if (!key) return null;

    const wasExisting = entityStore.has(key);
    const mode = writeMode || writePolicy;

    if (mode === "replace") {
      const snapshot: any = Object.create(null);
      const kk = Object.keys(obj);
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        if (k === TYPENAME_FIELD || k === "id") continue;
        snapshot[k] = (obj as any)[k];
      }
      entityStore.set(key, snapshot);
      if (!wasExisting) addToTypeIndex(key);
    } else {
      const dest = entityStore.get(key) || Object.create(null);
      const kk = Object.keys(obj);
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        if (k === TYPENAME_FIELD || k === "id") continue;
        (dest as any)[k] = (obj as any)[k];
      }
      entityStore.set(key, dest);
      if (!wasExisting) addToTypeIndex(key);
    }

    // Overlay into cached proxy if any
    const wr = MATERIALIZED.get(key);
    const hit = wr?.deref?.();
    if (hit) overlaySnapshotIntoProxy(hit, key);

    // Notify entity watchers
    markEntityChanged(key);

    // Notify type watchers on first add
    if (!wasExisting) {
      const { typename } = parseEntityKey(key);
      if (typename) notifyTypeChanged(typename);
    }

    return key;
  };

  /** Remove an entity snapshot and notify both entity- and type-level watchers. */
  const removeEntity = (key: EntityKey): boolean => {
    const existed = entityStore.has(key);
    if (!existed) return false;

    // purge store snapshot
    entityStore.delete(key);
    removeFromTypeIndex(key);

    // purge proxy fields if a proxy exists
    const wr = MATERIALIZED.get(key);
    const proxy = wr?.deref?.();
    if (proxy) overlaySnapshotIntoProxy(proxy, key);

    // Notify entity watchers for this key
    markEntityChanged(key);

    // Notify type watchers for wildcard lists
    const { typename } = parseEntityKey(key);
    if (typename) notifyTypeChanged(typename);

    return true;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Op-cache writer (fast, proxy-safe)
  // ────────────────────────────────────────────────────────────────────────────
  const sanitizeForOpCache = <T = any>(data: any): T => {
    const root = unwrapShallow(data);
    if (!root || typeof root !== "object") return root as T;
    if (Array.isArray(root)) {
      const out = new Array(root.length);
      for (let i = 0; i < root.length; i++) out[i] = unwrapShallow(root[i]);
      return out as any;
    }
    const out: any = {};
    const keys = Object.keys(root);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = unwrapShallow((root as any)[keys[i]]);
    return out;
  };

  const putOperation = (opKey: string, payload: { data: any; variables: Record<string, any> }) => {
    const plainData = sanitizeForOpCache(payload.data);
    const plainVars = sanitizeForOpCache(payload.variables || {});
    operationStore.set(opKey, { data: plainData, variables: plainVars });
    if (operationStore.size > OPERATION_CACHE_LIMIT) {
      const oldest = operationStore.keys().next().value as string | undefined;
      if (oldest) operationStore.delete(oldest);
    }
  };

  const getOperation = (opKey: string): { data: any; variables: Record<string, any> } | undefined => {
    return operationStore.get(opKey);
  };

  // src/core/graph.ts (inside createGraph)
  function lookupOperation(operation: {
    type: string;
    query: any;
    variables?: Record<string, any>;
    context?: any;
  }) {
    console.dir('DATADATA')
    console.dir(operationStore.values(), { depth: 5 });
    // Exact key first.
    const exactKey = getOperationKey(operation as any);
    const exact = operationStore.get(exactKey);
    if (exact) {
      // Guard: if the request is cursor’d, stored entry must match cursor exactly.
      const v = operation.variables || {};
      if (v.after != null && exact.variables?.after !== v.after) return null;
      if (v.before != null && exact.variables?.before !== v.before) return null;
      return { key: exactKey, entry: exact };
    }

    // If request is cursor’d: never fall back to baseline.
    const v = operation.variables || {};
    if (
      v.after != null ||
      v.before != null ||
      v.first != null ||
      v.last != null
    ) {
      return null;
    }

    // Fallback only for non-cursor ops with undefined-stripped shapes.
    const cleaned = cleanVars(v);
    const sameShape =
      operation.variables &&
      Object.keys(operation.variables!).every((k) => operation.variables![k] !== undefined);
    if (sameShape) return null;

    const altKey = getOperationKey({ ...operation, variables: cleaned } as any);
    const alt = operationStore.get(altKey);

    return alt ? { key: altKey, entry: alt } : null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Fast entity queries (using typeIndex)
  // ────────────────────────────────────────────────────────────────────────────
  const getEntityKeys = (selector: string | string[]): string[] => {
    const patterns = Array.isArray(selector) ? selector : [selector];
    const out = new Set<string>();

    for (const pattern of patterns) {
      // pattern may be "User", "User:", or "User:123"
      const colon = pattern.indexOf(":");
      const typename = colon === -1 ? pattern : pattern.slice(0, colon);
      const prefix = pattern; // full prefix to match (startsWith)

      const set = typeIndex.get(typename);
      if (!set) continue;

      // Fast path: "User" or "User:" — take all
      if (prefix === typename || prefix === typename + ":") {
        for (const key of set) out.add(key);
      } else {
        // Filter within the typename bucket
        for (const key of set) {
          if (key.startsWith(prefix)) out.add(key);
        }
      }
    }

    return Array.from(out);
  };

  const getEntities = (selector: string | string[]): any[] => {
    const keys = getEntityKeys(selector);
    const out: any[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      out[i] = entityStore.get(keys[i])!;
    }
    return out;
  };

  const materializeEntities = (selector: string | string[]): any[] => {
    const keys = getEntityKeys(selector);
    const out: any[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      out[i] = materializeEntity(keys[i] as EntityKey);
    }
    return out;
  };

  return {
    // interface helpers
    isInterfaceType,
    getInterfaceTypes,

    // stores
    entityStore,
    connectionStore,
    operationStore,

    // connection management
    ensureConnection,

    // entity helpers
    identify,
    getEntityParentKey,
    getEntity,
    putEntity,
    removeEntity,             // NEW
    resolveEntityKey,
    areEntityKeysEqual,

    // materialization
    materializeEntity,
    materializeEntities,

    // operation cache
    getOperation,
    putOperation,
    lookupOperation,

    // fast queries
    getEntityKeys,
    getEntities,

    // watchers (granular)
    registerEntityWatcher,
    unregisterEntityWatcher,
    trackEntity,

    // type watchers (wildcards)
    registerTypeWatcher,      // NEW
    unregisterTypeWatcher,    // NEW
    notifyTypeChanged,        // (exported for advanced uses/tests)
  };
};
