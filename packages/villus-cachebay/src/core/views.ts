// views.ts - everything related to view

import {
  reactive,
  shallowReactive,
  isReactive,
} from "vue";

import type { EntityKey, ConnectionState } from "./types";
import type { GraphAPI } from "./graph";
import { getRelayOptionsByType } from "./resolvers";
import { buildConnectionKey, readPathValue } from "./utils";
import { TYPENAME_FIELD } from "./constants";

/**
 * View-layer utilities that sit on top of the raw graph (stores + entity helpers).
 * This module does NOT own the stores; it receives them from graph.ts via `createViews`.
 */

export type ViewsAPI = ReturnType<typeof createViews>;

export type ViewsDependencies = {
  graph: GraphAPI;
};

export function createViews(
  options: {
    trackNonRelayResults?: boolean;
  },
  dependencies: ViewsDependencies
) {
  const {
    trackNonRelayResults = true,
  } = options;

  const { graph } = dependencies;
  const typenameKey = TYPENAME_FIELD;

  /* ───────────────────────────────────────────────────────────────────────────
   * Entity views: registration & synchronization
   * ────────────────────────────────────────────────────────────────────────── */
  const entityViews = new Map<EntityKey, Set<any>>();

  function getOrCreateEntityViews(key: EntityKey) {
    let views = entityViews.get(key);
    if (!views) {
      views = new Set<any>();
      entityViews.set(key, views);
    }
    return views;
  }

  function isValidEntityView(obj: any) {
    return !!(obj && typeof obj === "object");
  }

  function registerEntityView(key: EntityKey, obj: any) {
    if (!isValidEntityView(obj)) {
      return;
    }
    const views = getOrCreateEntityViews(key);
    views.add(obj);
  }

  function synchronizeEntityViews(key: EntityKey) {
    const views = entityViews.get(key);
    if (!views) return;

    const entity = graph.materializeEntity(key);
    if (!entity) {
      // Entity was deleted - clear all views
      views.forEach(view => {
        for (const k of Object.keys(view)) {
          delete view[k];
        }
      });
      entityViews.delete(key);
      return;
    }

    const fields = Object.keys(entity);
    views.forEach((obj) => {
      for (let i = 0; i < fields.length; i++) {
        const k = fields[i];
        if ((obj as any)[k] !== (entity as any)[k]) {
          (obj as any)[k] = (entity as any)[k];
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
          if (view.limit > (existing as any).limit) (existing as any).limit = view.limit;
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

        // Always resync all items to handle removals and reordering correctly
        for (let i = 0; i < desiredLength; i++) {
          const lastC = state.list[state.list.length - 1]?.cursor;
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
            const snap = graph.materializeEntity(entry.key);
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
    const entity = graph.materializeEntity(key);
    if (!entity) return undefined;
    const proxy = graph.getEntity(key);
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
          const nodeKey = graph.identify(n);
          if (nodeKey) cur.node = proxyForEntityKey(nodeKey);
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
    graph.connectionStore.forEach((state: any, key: string) => {
      if (state.views.size === 0) {
        // No views = can be removed
        const shouldRemove = predicate ? predicate(key, state) : true;
        if (shouldRemove) {
          graph.connectionStore.delete(key);
        }
      }
    });
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Register views from result (Relay connections)
   * ────────────────────────────────────────────────────────────────────────── */
  const registerViewsFromResult = (root: any, variables: Record<string, any>) => {
    // Re-using the walker from resolvers implementation would create cycles,
    // so we do a light traversal here tailored for Relay connections.
    const stack: Array<{ obj: any; parentTypename: string | null }> = [{ obj: root, parentTypename: "Query" }];
    while (stack.length) {
      const { obj, parentTypename } = stack.pop()!;
      if (!obj || typeof obj !== "object") continue;

      const pt = (obj as any)[typenameKey] || parentTypename;
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const field = keys[i];
        const value = (obj as any)[field];

        // Relay connection spec present?
        const spec = getRelayOptionsByType(pt || null, field);
        if (spec && value && typeof value === "object") {
          // Resolve key/state
          const parentId = (obj as any)?.id ?? (obj as any)?._id;
          const parentKey = graph.getEntityParentKey ? graph.getEntityParentKey(pt!, parentId) : null || "Query";
          const connKey = buildConnectionKey(parentKey!, field, spec as any, variables);
          const state = graph.ensureReactiveConnection(connKey);

          // Extract parts
          const edgesArr = readPathValue(value, spec.segs.edges);
          const pageInfoObj = readPathValue(value, spec.segs.pageInfo);
          if (!edgesArr || !pageInfoObj) continue;

          const edgesField = spec.names.edges;
          const pageInfoField = spec.names.pageInfo;

          const isCursorPage =
            (variables as any)?.after != null || (variables as any)?.before != null;

          // Requested "page" size from variables (fallback to payload size once)
          const pageSize =
            typeof (variables as any)?.first === "number"
              ? (variables as any).first
              : (Array.isArray(edgesArr) ? edgesArr.length : 0);

          // Prepare/reuse parent view container
          let viewObj: any = (obj as any)[field];
          const invalid =
            !viewObj ||
            typeof viewObj !== "object" ||
            !Array.isArray((viewObj as any)[edgesField]) ||
            !(viewObj as any)[pageInfoField];

          if (invalid) {
            viewObj = Object.create(null);
            viewObj.__typename = (value as any)?.__typename ?? "Connection";
            (obj as any)[field] = viewObj;
          }
          if (!isReactive(viewObj[edgesField])) viewObj[edgesField] = reactive(viewObj[edgesField] || []);
          if (!isReactive(viewObj[pageInfoField])) viewObj[pageInfoField] = shallowReactive(viewObj[pageInfoField] || {});

          // Merge connection-level meta
          const exclude = new Set([edgesField, spec.paths.pageInfo, "__typename"]);
          if (value && typeof value === "object") {
            const vk = Object.keys(value);
            for (let vi = 0; vi < vk.length; vi++) {
              const k = vk[vi];
              if (!exclude.has(k)) (state.meta as any)[k] = (value as any)[k];
            }
          }

          // ---- CANONICAL WINDOW: update exactly once per bind ----
          if (!state.initialized) {
            state.window = pageSize;  // first bind = one page
          } else if (isCursorPage) {
            state.window = Math.min(state.list.length, (state.window || 0) + pageSize);
          } else {
            state.window = pageSize;  // baseline reset back to one page
          }

          // Keep exactly one canonical view for this connection key
          state.views.clear();

          addStrongView(state, {
            edges: viewObj[edgesField],
            pageInfo: viewObj[pageInfoField],
            root: viewObj,
            edgesKey: edgesField,
            pageInfoKey: pageInfoField,
            pinned: false,
            limit: state.window,       // <- single source of truth
          });

          // Sync so UI renders now with the right window
          synchronizeConnectionViews(state);

          if (!state.initialized) state.initialized = true;

          // DEBUG
          // eslint-disable-next-line no-console
          console.debug("sdcsc", variables);
          // eslint-disable-next-line no-console
          console.debug("Connection key:", connKey);
          // eslint-disable-next-line no-console
          console.debug("[views]", Array.from(state.views).map(v => v.limit));
        }

        // Traverse deeper
        const v = (obj as any)[field];
        if (Array.isArray(v)) {
          for (let j = 0; j < (v as any[]).length; j++) {
            const x = (v as any[])[j];
            if (x && typeof x === "object") stack.push({ obj: x, parentTypename: pt || null });
          }
        } else if (v && typeof v === "object") {
          stack.push({ obj: v, parentTypename: pt || null });
        }
      }
    }
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Collect non-Relay entities from result
   * ────────────────────────────────────────────────────────────────────────── */
  const collectEntities = (root: any) => {
    const touchedKeys = new Set<EntityKey>();
    const visited = new WeakSet<object>();
    const stack = [root];

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      if (visited.has(current as object)) continue;
      visited.add(current as object);

      const typename = (current as any)[typenameKey];

      if (typename) {
        const ek = graph.identify(current);
        if (ek && graph.putEntity) {
          graph.putEntity(current);
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

              const key = graph.identify(node);
              if (!key) continue;

              if (graph.putEntity) {
                graph.putEntity(node);
                touchedKeys.add(key);
              }
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
  };

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

    // result processing
    registerViewsFromResult,
    collectEntities,

    // runtime
    resetRuntime,

    // proxies & result stitching
    proxyForEntityKey,
    materializeResult,

    // gc
    gcConnections,
  };
}
