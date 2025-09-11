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
import { parseEntityKey, unwrapShallow, getEntityParentKey } from "./utils";
import { TYPENAME_FIELD, QUERY_ROOT, DEFAULT_OPERATION_CACHE_LIMIT } from "./constants";

/**
 * Graph-layer: owns the raw stores and entity helpers.
 * This module is intentionally "dumb" about resolvers and views.
 */

export type GraphConfig = {
  writePolicy: "replace" | "merge";
  reactiveMode: "shallow" | "deep";
  keys: Record<string, (obj: any) => string | null>;
  interfaces: Record<string, string[]>;
};

export type GraphAPI = ReturnType<typeof createGraph>;

export const createGraph = (config: GraphConfig) => {
  const {
    writePolicy,
    reactiveMode,
    keys,
    interfaces,
  } = config;

  // Stores
  const entityStore = new Map<EntityKey, any>();
  const connectionStore = new Map<string, ConnectionState>();
  const operationStore = new Map<string, { data: any; variables: Record<string, any> }>();

  /* ───────────────────────────────────────────────────────────────────────────
   * Entities tick (for reactivity tracking)
   * ────────────────────────────────────────────────────────────────────────── */
  const entitiesTick = ref(0);
  const bumpEntitiesTick = () => {
    entitiesTick.value++;
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity id helpers
   * ────────────────────────────────────────────────────────────────────────── */
  const identify = (o: any): EntityKey | null => {
    const t = o && (o as any)[TYPENAME_FIELD];
    if (!t) return null;
    const perType = keys[t];
    if (perType) {
      const idp = perType(o);
      return idp == null ? null : (t + ":" + String(idp)) as EntityKey;
    }
    const id = (o as any)?.id;
    return id != null ? (t + ":" + String(id)) as EntityKey : null;
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Connection state management
   * ────────────────────────────────────────────────────────────────────────── */
  const ensureReactiveConnection = (key: string): ConnectionState => {
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
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity write/read
   * ────────────────────────────────────────────────────────────────────────── */
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
        if (k === TYPENAME_FIELD || k === "id" || k === "_id") continue;
        snapshot[k] = (obj as any)[k];
      }
      entityStore.set(key, snapshot);
    } else {
      const destination = entityStore.get(key) || Object.create(null);
      const kk = Object.keys(obj);
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        if (k === TYPENAME_FIELD || k === "id" || k === "_id") continue;
        (destination as any)[k] = (obj as any)[k];
      }
      entityStore.set(key, destination);
    }

    if (!wasExisting) bumpEntitiesTick();
    return key;
  };

  const getReactiveEntity = (key: EntityKey): any => {
    const entity = entityStore.get(key);
    return entity ? makeReactive(entity) : undefined;
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Interface helpers (for abstract keys)
   * ────────────────────────────────────────────────────────────────────────── */
  const isInterfaceType = (t: string | null) => {
    return !!(t && interfaces[t]);
  }

  const getInterfaceTypes = (t: string) => {
    return interfaces[t] || [];
  }

  const resolveEntityKey = (abstractKey: EntityKey): EntityKey | null => {
    const { typename, id } = parseEntityKey(abstractKey);
    if (!typename || !id || !isInterfaceType(typename)) return abstractKey;
    const impls = interfaces[typename];
    for (let i = 0; i < impls.length; i++) {
      const candidate = (impls[i] + ":" + id) as EntityKey;
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
    if (isInterfaceType(a.typename) && getInterfaceTypes(a.typename).includes(b.typename!)) return true;
    return false;
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Materialization
   * ────────────────────────────────────────────────────────────────────────── */
  const HAS_WEAKREF = typeof (globalThis as any).WeakRef !== "undefined";
  const MATERIALIZED_CACHE_REF: Map<EntityKey, any> | null = HAS_WEAKREF ? new Map<EntityKey, WeakRef<any>>() : null;

  const materializeEntity = (key: EntityKey) => {
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
      const out: any = { [TYPENAME_FIELD]: typename };
      if (id != null) out.id = id;
      if (src) {
        const kk = Object.keys(src);
        for (let i = 0; i < kk.length; i++) out[kk[i]] = (src as any)[kk[i]];
      }
      MATERIALIZED_CACHE_REF.set(key, new (globalThis as any).WeakRef(out));
      return out;
    }

    const { typename, id } = parseEntityKey(key);
    const src = entityStore.get(key);
    const out: any = { [TYPENAME_FIELD]: typename };
    if (id != null) out.id = id;
    if (src) {
      const kk = Object.keys(src);
      for (let i = 0; i < kk.length; i++) out[kk[i]] = (src as any)[kk[i]];
    }
    return out;
  };

  const makeReactive = (base: any) => {
    return reactiveMode === "shallow" ? shallowReactive(base) : reactive(base);
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Op-cache writer (fast, proxy-safe)
   * ────────────────────────────────────────────────────────────────────────── */
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
    if (operationStore.size > DEFAULT_OPERATION_CACHE_LIMIT) {
      const oldest = operationStore.keys().next().value as string | undefined;
      if (oldest) operationStore.delete(oldest);
    }
  };

  const getOperation = (opKey: string): { data: any; variables: Record<string, any> } | undefined => {
    return operationStore.get(opKey);
  };

  /* ───────────────────────────────────────────────────────────────────────────────
   * Entity queries
   * ────────────────────────────────────────────────────────────────────────── */
  const getEntityKeys = (selector: string | string[]): string[] => {
    const patterns = Array.isArray(selector) ? selector : [selector];
    const keys = new Set<string>();
    for (const [key] of Array.from(entityStore)) {
      for (const pattern of patterns) {
        if (key.startsWith(pattern)) {
          keys.add(key);
          break;
        }
      }
    }
    return Array.from(keys);
  };

  const getEntities = (selector: string | string[]): any[] => {
    const keys = getEntityKeys(selector);
    return keys.map((k) => {
      const resolved = resolveEntityKey(k) || k;
      return entityStore.get(resolved);
    });
  };

  const materializeEntities = (selector: string | string[]): any[] => {
    const keys = getEntityKeys(selector);
    return keys.map((k) => materializeEntity(k));
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
    getReactiveEntity,
    putEntity,
    resolveEntityKey,
    areEntityKeysEqual,

    // materialization
    materializeEntity,

    // operation cache
    getOperation,
    putOperation,

    // entity queries
    getEntityKeys,
    getEntities,
    materializeEntities,

    // entities tick
    bumpEntitiesTick,
    entitiesTick,
  };
};
