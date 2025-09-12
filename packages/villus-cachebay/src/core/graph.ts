// graph.ts - raw cache

import {
  reactive,
  shallowReactive,
  ref,
} from "vue";

import type { EntityKey, ConnectionState } from "./types";
import { parseEntityKey, unwrapShallow, getEntityParentKey } from "./utils";
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
    set?.delete(key);
    if (set && set.size === 0) typeIndex.delete(typename);
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

  const registerWatcher = (run: () => void): WatcherId => {
    const id = nextWatcherId++;
    watchers.set(id, { seen: new Map(), run });
    return id;
  };

  const unregisterWatcher = (id: WatcherId) => {
    watchers.delete(id);
    for (const set of depIndex.values()) set.delete(id);
  };

  const trackEntityDependency = (watcherId: WatcherId, key: EntityKey) => {
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
  const ensureReactiveConnection = (key: string): ConnectionState => {
    let state = connectionStore.get(key);
    if (!state) {
      state = {
        list: shallowReactive([]),
        pageInfo: shallowReactive({}),
        meta: shallowReactive({}),
        views: new Set(),
        keySet: new Set(),
        initialized: false,
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
    if (!src) return;
    const kk = Object.keys(src);
    for (let i = 0; i < kk.length; i++) {
      const k = kk[i];
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

    // build or reuse proxy
    const proxy = getOrCreateProxy(resolved);

    // 1) overlay current snapshot fields (if any)
    overlaySnapshotIntoProxy(proxy, resolved);

    // 2) ensure identity is always present on the proxy
    const { typename, id } = parseEntityKey(resolved);
    if (typename && proxy[TYPENAME_FIELD] !== typename) proxy[TYPENAME_FIELD] = typename;
    if (id != null) {
      const sid = String(id);
      if (proxy.id !== sid) proxy.id = sid;
    } else {
      // no id → make sure we *don’t* leave a stale id behind
      if ('id' in proxy) delete proxy.id;
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
  // Entity write
  //   - entityStore keeps ONLY fields (no __typename/id/_id).
  //   - "replace" => delete keys not present in payload.
  //   - "merge"   => shallow-assign payload fields.
  //   - On first put, add to typeIndex.
  //   - Overlay any existing materialized proxy to keep it up to date.
  // ────────────────────────────────────────────────────────────────────────────
  const putEntity = (obj: any, override?: "replace" | "merge"): EntityKey | null => {
    const key = identify(obj);
    if (!key) return null;

    const wasExisting = entityStore.has(key);
    const mode = override || writePolicy;

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

    // Mark changed (granular watchers)
    markEntityChanged(key);
    return key;
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
    ensureReactiveConnection,

    // entity helpers
    identify,
    getEntityParentKey,
    getEntity,
    putEntity,
    resolveEntityKey,
    areEntityKeysEqual,

    // materialization
    materializeEntity,
    materializeEntities,

    // operation cache
    getOperation,
    putOperation,

    // fast queries
    getEntityKeys,
    getEntities,

    // watchers (granular)
    registerWatcher,
    unregisterWatcher,
    trackEntityDependency,
  };
};
