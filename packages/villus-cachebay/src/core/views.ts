// views.ts - everything related to view

import {
  reactive,
  shallowReactive,
  isReactive,
} from "vue";

import type { EntityKey, ConnectionState } from "./types";
import { readPathValue } from "./utils";

/**
 * View-layer utilities that sit on top of the raw graph (stores + entity helpers).
 * This module does NOT own the stores; it receives them from graph.ts via `createViews`.
 */

export type ViewsAPI = ReturnType<typeof createViews>;

export function createViews(args: {
  // from graph.ts
  entityStore: Map<EntityKey, any>;
  connectionStore: Map<string, ConnectionState>;
  ensureConnectionState: (key: string) => ConnectionState;

  // entity helpers
  materializeEntity: (key: EntityKey) => any;
  makeEntityProxy: (base: any) => any;

  // for id + proxies
  idOf: (o: any) => EntityKey | null;

}) {
  const {
    entityStore,
    connectionStore,
    ensureConnectionState,
    materializeEntity,
    makeEntityProxy,
    idOf,
  } = args;

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity views: registration & synchronization
   * ────────────────────────────────────────────────────────────────────────── */
  const entityViews = new Map<EntityKey, Set<any>>();

  function isValidEntityView(obj: any) {
    return !!(obj && typeof obj === "object");
  }

  function registerEntityView(key: EntityKey, obj: any) {
    if (!isValidEntityView(obj)) return;
    let set = entityViews.get(key);
    if (!set) {
      set = new Set<any>();
      entityViews.set(key, set);
    }
    const proxy = isReactive(obj) ? obj : makeEntityProxy(obj);
    set.add(proxy);
  }

  function synchronizeEntityViews(key: EntityKey) {
    const snap = entityStore.get(key);
    if (!snap) return;

    const views = entityViews.get(key);
    if (!views || views.size === 0) return;

    const fields = Object.keys(snap);
    views.forEach((obj) => {
      for (let i = 0; i < fields.length; i++) {
        const k = fields[i];
        if ((obj as any)[k] !== (snap as any)[k]) {
          (obj as any)[k] = (snap as any)[k];
        }
      }
    });
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

  /* ───────────────────────────────────────────────────────────────────────────
   * Connection <-> Entity back-links; dirty queues
   * ────────────────────────────────────────────────────────────────────────── */
  const entityToConnectionStates = new Map<EntityKey, Set<ConnectionState>>();
  const dirtyConnectionStates = new Set<ConnectionState>();
  let isConnFlushScheduled = false;

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

  function touchConnectionsForEntityKey(key: EntityKey) {
    const set = entityToConnectionStates.get(key);
    if (!set) return;
    set.forEach((state) => markConnectionDirty(state));
  }

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

  function resetRuntime() {
    entityToConnectionStates.clear();
    dirtyConnectionStates.clear();
    dirtyEntityKeys.clear();
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Connection views: helpers & synchronization
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

  function addStrongView(state: ConnectionState, view: any) {
    pruneInvalidViews(state);
    if (!isValidView(view)) return;

    for (const existing of state.views) {
      if (!isValidView(existing)) {
        state.views.delete(existing);
        continue;
      }
      if (existing.edges === view.edges) {
        if (view.limit != null) {
          const prev = (existing as any).limit ?? 0;
          if (view.limit > prev) (existing as any).limit = view.limit;
        }
        if ((view as any).pinned) (existing as any).pinned = true;
        return;
      }
    }

    state.views.add(view);

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

          const prevNode = edgeObject.node;
          const prevKey = prevNode ? `${prevNode.__typename}:${prevNode.id ?? prevNode._id}` : null;
          if (prevKey !== entry.key) {
            edgeObject.node = proxyForEntityKey(entry.key);
            linkEntityToConnection(entry.key, state);
          } else {
            const snap = entityStore.get(entry.key);
            if (snap) {
              const sk = Object.keys(snap);
              for (let j = 0; j < sk.length; j++) {
                const k = sk[j];
                if ((prevNode as any)[k] !== (snap as any)[k]) (prevNode as any)[k] = (snap as any)[k];
              }
            }
          }
        }

        view._lastLen = desiredLength;

        const srcPI = state.pageInfo;
        const dstPI = view.pageInfo as any;
        const pik = Object.keys(srcPI);
        for (let i = 0; i < pik.length; i++) {
          const k = pik[i];
          if (dstPI[k] !== (srcPI as any)[k]) dstPI[k] = (srcPI as any)[k];
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

  /* ───────────────────────────────────────────────────────────────────────────
   * Proxies for entity keys (registers as entity views)
   * ────────────────────────────────────────────────────────────────────────── */
  function proxyForEntityKey(key: EntityKey) {
    // Always base off the materialized object to keep identity for sync
    const base = materializeEntity(key);
    const proxy = isReactive(base) ? base : makeEntityProxy(base);
    registerEntityView(key, proxy);
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
          if (key) cur.node = proxyForEntityKey(key);
        }
      }
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * GC of connection states
   * ────────────────────────────────────────────────────────────────────────── */
  function gcConnections(predicate?: (key: string, state: ConnectionState) => boolean) {
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
  }

  return {
    // entity views
    registerEntityView,
    synchronizeEntityViews,
    markEntityDirty,

    // entity<->connection links
    linkEntityToConnection,
    unlinkEntityFromConnection,
    touchConnectionsForEntityKey,

    // connection views
    addStrongView,
    synchronizeConnectionViews,
    markConnectionDirty,

    // runtime
    resetRuntime,

    // proxies & result stitching
    proxyForEntityKey,
    materializeResult,

    // gc
    gcConnections,
  };
}
