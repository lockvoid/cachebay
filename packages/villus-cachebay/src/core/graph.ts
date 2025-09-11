// graph.ts - raw cache

import {
  reactive,
  shallowReactive,
  isReactive,
  ref,
  toRaw,
  isRef,
} from "vue";

import type { EntityKey, ConnectionState } from "./types";
import { parseEntityKey } from "./utils";

/**
 * Graph-layer: owns the raw stores and entity helpers.
 * This module is intentionally "dumb" about resolvers and views.
 */

export type GraphAPI = ReturnType<typeof createGraph>;

export function createGraph(config: {
  TYPENAME_KEY: string;
  DEFAULT_WRITE_POLICY: "replace" | "merge";
  interfaceMap: Record<string, string[]>;
  useShallowEntities: boolean;
  // id helpers
  customIdFromObject: ((o: any) => EntityKey | null) | null;
  typeKeyFactories: Record<string, (obj: any) => string | null>;
  // op-cache capacity
  operationCacheMax: number;
}) {
  const {
    TYPENAME_KEY,
    DEFAULT_WRITE_POLICY,
    interfaceMap,
    useShallowEntities,
    customIdFromObject,
    typeKeyFactories,
    operationCacheMax,
  } = config;

  // Stores
  const entityStore = new Map<EntityKey, any>();
  const connectionStore = new Map<string, ConnectionState>();
  const operationCache = new Map<string, { data: any; variables: Record<string, any> }>();

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity id helpers
   * ────────────────────────────────────────────────────────────────────────── */
  function idOf(o: any): EntityKey | null {
    if (customIdFromObject) return customIdFromObject(o);
    const t = o && (o as any)[TYPENAME_KEY];
    if (!t) return null;
    const perType = (typeKeyFactories as Record<string, (obj: any) => string | null>)[t];
    if (perType) {
      const idp = perType(o);
      return idp == null ? null : (t + ":" + String(idp)) as EntityKey;
    }
    const id = (o as any)?.id;
    if (id != null) return (t + ":" + String(id)) as EntityKey;
    const _id = (o as any)?._id;
    return _id != null ? ((t + ":" + String(_id)) as EntityKey) : null;
  }

  function parentEntityKeyFor(typename: string, id?: any) {
    return typename === "Query" ? "Query" : id == null ? null : (typename + ":" + String(id)) as EntityKey;
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Connection state allocator
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
        window: 0,
      } as ConnectionState;
      (state as any).__key = key;
      connectionStore.set(key, state);
    }
    return state;
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity write/read
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
   * Interface helpers (for abstract keys)
   * ────────────────────────────────────────────────────────────────────────── */
  function isInterfaceTypename(t: string | null) { return !!(t && interfaceMap[t]); }
  function getImplementationsFor(t: string) { return interfaceMap[t] || []; }

  function resolveConcreteEntityKey(abstractKey: EntityKey): EntityKey | null {
    const { typename, id } = parseEntityKey(abstractKey);
    if (!typename || !id || !isInterfaceTypename(typename)) return abstractKey;
    const impls = interfaceMap[typename];
    for (let i = 0; i < impls.length; i++) {
      const candidate = (impls[i] + ":" + id) as EntityKey;
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

  /* ───────────────────────────────────────────────────────────────────────────
   * Materialization
   * ────────────────────────────────────────────────────────────────────────── */
  const HAS_WEAKREF = typeof (globalThis as any).WeakRef !== "undefined";
  const MATERIALIZED_CACHE_REF: Map<EntityKey, any> | null = HAS_WEAKREF ? new Map<EntityKey, WeakRef<any>>() : null;

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

  function makeEntityProxy(base: any) {
    return useShallowEntities ? shallowReactive(base) : reactive(base);
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Op-cache writer (fast, proxy-safe)
   * ────────────────────────────────────────────────────────────────────────── */
  function unwrapShallow<T = any>(v: any): T {
    const base = isRef(v) ? v.value : v;
    return (isReactive(base) ? toRaw(base) : base) as T;
  }

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
    for (let i = 0; i < keys.length; i++) out[keys[i]] = unwrapShallow((root as any)[keys[i]]);
    return out;
  }

  function writeOpCache(opKey: string, payload: { data: any; variables: Record<string, any> }) {
    const plainData = sanitizeForOpCache(payload.data);
    const plainVars = sanitizeForOpCache(payload.variables || {});
    operationCache.set(opKey, { data: plainData, variables: plainVars });
    if (operationCache.size > operationCacheMax) {
      const oldest = operationCache.keys().next().value as string | undefined;
      if (oldest) operationCache.delete(oldest);
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Entities tick
   * ────────────────────────────────────────────────────────────────────────── */
  const entityAddedRemovedTick = ref(0);
  function bumpEntitiesTick() {
    entityAddedRemovedTick.value++;
  }

  return {
    // config & interface info
    TYPENAME_KEY,
    DEFAULT_WRITE_POLICY,
    interfaceMap,
    isInterfaceTypename,
    getImplementationsFor,

    // stores
    entityStore,
    connectionStore,
    operationCache,

    // connection allocation
    ensureConnectionState,

    // entity helpers
    idOf,
    parentEntityKeyFor,
    putEntity,
    resolveConcreteEntityKey,
    doesEntityKeyMatch,

    // materialization & proxy factory
    materializeEntity,
    makeEntityProxy,

    // op cache helpers
    writeOpCache,

    // entities tick
    bumpEntitiesTick,
    __entitiesTick: entityAddedRemovedTick,
  };
}
