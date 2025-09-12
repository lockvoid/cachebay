/* src/features/optimistic.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Transactional optimistic updates:
 * - Graph-first: mutate entity snapshots & connection lists/pageInfo.
 * - Batch view resync once per transaction (and once after revert()).
 * - Uses the same connection key format as views/session (string-based, filtered vars).
 */

type EntityKey = string;

/** Shallow clone helpers (keep array/object identity where required) */
function cloneList(list: any[]): any[] {
  return list.map(e => ({ ...e, edge: e.edge ? { ...e.edge } : undefined }));
}
function shallowClone(obj: any): any {
  return obj ? { ...obj } : null;
}

/** Insert or replace an entry by entity key. */
function upsertEntry(
  state: any,
  entry: { key: string; cursor: string | null; edge?: any },
  position: "start" | "end"
) {
  const idx = state.list.findIndex((e: any) => e.key === entry.key);
  if (idx >= 0) {
    state.list[idx] = { ...entry };
  } else {
    if (position === "start") state.list.unshift({ ...entry });
    else state.list.push({ ...entry });
    state.keySet.add(entry.key);
  }
}

/** Only support __typename + id (no _id in the new system). */
function identifyNodeKey(obj: any): EntityKey | null {
  if (!obj || typeof obj !== "object") return null;
  const typename = obj.__typename;
  const id = obj.id;
  return typename && id != null ? `${typename}:${String(id)}` : null;
}

/** Shallow copy of user-provided edge meta (ignore cursor/node). */
function edgeMetaShallow(meta: any): any {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor") continue;
    out[k] = meta[k];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Build a connection key that ignores cursor args (must match views/session). */
function buildConnKey(parentKey: string, field: string, vars: Record<string, any> | undefined) {
  const filtered: Record<string, any> = { ...(vars || {}) };
  delete filtered.after; delete filtered.before; delete filtered.first; delete filtered.last;
  const id = Object.keys(filtered)
    .sort()
    .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
    .join("|");
  return `${parentKey}.${field}(${id})`;
}

/** Deps from environment */
type Deps = {
  graph: {
    entityStore: Map<string, any>;
    connectionStore: Map<string, any>;
    identify: (obj: any) => string | null;
    putEntity: (obj: any, policy: "merge" | "replace") => string | null;
    getEntityParentKey: (typename: string, id?: any) => string | null;
    ensureConnection: (key: string) => any;
  };
  views?: {
    /** Immediate rebuild of per-instance connection views (edges/pageInfo) */
    synchronizeConnectionViews?: (state: any) => void;
  };
};

type EntityOp =
  | { type: "entityWrite"; obj: any; policy: "merge" | "replace" }
  | { type: "entityDelete"; key: string };

type ConnOp =
  | { type: "connAdd"; key: string; entry: { key: string; cursor: string | null; edge?: any }; position: "start" | "end" }
  | { type: "connRemove"; key: string; entryKey: string }
  | { type: "connPageInfo"; key: string; patch: Record<string, any> };

type Layer = {
  id: number;
  entityOps: EntityOp[];
  connOps: ConnOp[];
};

type ConnectionsArgs = {
  parent: "Query" | { __typename: string; id?: any } | string;
  field: string;
  variables?: Record<string, any>;
};

export function createModifyOptimistic(deps: Deps) {
  const { graph, views } = deps;

  // Committed layers (in order) + currently pending (not yet committed)
  const committed: Layer[] = [];
  const pending = new Set<Layer>();
  const revertedCommitted = new Set<number>();
  let nextId = 1;

  // Base snapshots captured lazily (first touch across all layers)
  const baseEntitySnap = new Map<string, Record<string, any> | null>(); // null => didn't exist
  const baseConnSnap = new Map<string, { list: any[]; pageInfo: any; meta: any; initialized: boolean }>();

  function captureEntityBase(key: string) {
    if (baseEntitySnap.has(key)) return;
    const existed = graph.entityStore.has(key);
    baseEntitySnap.set(key, existed ? { ...(graph.entityStore.get(key) as any) } : null);
  }

  function captureConnBase(key: string) {
    if (baseConnSnap.has(key)) return;
    const st = graph.ensureConnection(key);
    baseConnSnap.set(key, {
      list: cloneList(st.list),
      pageInfo: shallowClone(st.pageInfo) || {},
      meta: shallowClone(st.meta) || {},
      initialized: !!st.initialized,
    });
  }

  function applyEntityWrite(obj: any, policy: "merge" | "replace") {
    const ek = graph.identify(obj);
    if (!ek) return;
    captureEntityBase(ek);
    graph.putEntity(obj, policy);
  }

  function applyEntityDelete(key: string) {
    captureEntityBase(key);
    if (!graph.entityStore.has(key)) return;

    // Optional bump: identity-only replace (so entity watchers see a change)
    const idx = key.indexOf(':');
    const typename = idx === -1 ? key : key.slice(0, idx);
    const id = idx === -1 ? null : key.slice(idx + 1);
    if (typename && id != null) {
      graph.putEntity({ __typename: typename, id }, "replace");
    }
    // Then actually remove the snapshot
    graph.entityStore.delete(key);
  }

  /** QoL batching: record which connections were touched; sync once per txn. */
  const touchedConnections = new Set<any>();
  const noteTouched = (state: any) => { touchedConnections.add(state); };
  const flushTouched = () => {
    if (!views?.synchronizeConnectionViews) { touchedConnections.clear(); return; }
    for (const st of touchedConnections) views.synchronizeConnectionViews(st);
    touchedConnections.clear();
  };

  /** Ensure attached views reveal all items after optimistic changes. */
  function expandViewLimits(state: any) {
    if (!state || !state.views) return;
    const size = state.list.length | 0;
    for (const v of state.views) {
      if (v && typeof v === "object") {
        if ((v as any).limit == null || (v as any).limit < size) {
          (v as any).limit = size;
        }
      }
    }
  }

  function bumpVersion(state: any) {
    state._version = ((state._version | 0) + 1);
  }

  function applyConnOp(op: ConnOp) {
    const state = graph.ensureConnection(op.key);
    captureConnBase(op.key);

    if (op.type === "connAdd") {
      upsertEntry(state, op.entry, op.position);
      bumpVersion(state);
    } else if (op.type === "connRemove") {
      const idx = state.list.findIndex((e: any) => e.key === op.entryKey);
      if (idx >= 0) {
        state.list.splice(idx, 1);
        state.keySet.delete(op.entryKey);
        bumpVersion(state);
      }
    } else if (op.type === "connPageInfo") {
      const pi = state.pageInfo as any;
      let changed = false;
      for (const k of Object.keys(op.patch)) {
        const nv = op.patch[k];
        if (pi[k] !== nv) { pi[k] = nv; changed = true; }
      }
      if (changed) bumpVersion(state);
    }

    // Reveal all items in all attached views after optimistic ops
    expandViewLimits(state);

    // Batch view sync at the end of the transaction
    noteTouched(state);
  }

  /** Reset graph stores to base snapshots. */
  function resetToBase() {
    // Entities
    for (const [key, snap] of baseEntitySnap) {
      if (snap === null) {
        if (graph.entityStore.has(key)) graph.entityStore.delete(key);
      } else {
        graph.entityStore.set(key, { ...snap });
      }
    }

    // Connections (preserve array identity)
    for (const [key, snap] of baseConnSnap) {
      const st = graph.ensureConnection(key);

      // list contents
      st.list.splice(0, st.list.length, ...cloneList(snap.list));

      // pageInfo
      const curPI = st.pageInfo;
      for (const k of Object.keys(curPI)) delete curPI[k];
      for (const k of Object.keys(snap.pageInfo)) (curPI as any)[k] = snap.pageInfo[k];

      // meta
      const curMeta = st.meta;
      for (const k of Object.keys(curMeta)) delete curMeta[k];
      for (const k of Object.keys(snap.meta)) (curMeta as any)[k] = snap.meta[k];

      st.keySet = new Set<string>(st.list.map((e: any) => e.key));
      st.initialized = !!snap.initialized;

      // bump version so views will sync even if no ops are re-applied
      bumpVersion(st);
      noteTouched(st);
    }
  }

  /** Reapply layers (committed non-reverted, then pending by id). */
  function reapplyLayers() {
    for (const L of committed) {
      if (revertedCommitted.has(L.id)) continue;
      for (const w of L.entityOps) {
        if (w.type === "entityWrite") applyEntityWrite(w.obj, w.policy);
        else applyEntityDelete(w.key);
      }
      for (const c of L.connOps) applyConnOp(c);
    }

    const pendingSorted = Array.from(pending).sort((a, b) => a.id - b.id);
    for (const L of pendingSorted) {
      for (const w of L.entityOps) {
        if (w.type === "entityWrite") applyEntityWrite(w.obj, w.policy);
        else applyEntityDelete(w.key);
      }
      for (const c of L.connOps) applyConnOp(c);
    }
  }

  function maybeCleanupSnapshots() {
    if (committed.length === 0 && pending.size === 0) {
      baseEntitySnap.clear();
      baseConnSnap.clear();
      revertedCommitted.clear();
    }
  }

  return function modifyOptimistic(build: (c: {
    patch: (entity: any, policy?: "merge" | "replace") => void;
    delete: (key: string) => void;
    connections: (args: ConnectionsArgs) => Readonly<[{
      addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
      removeNode: (ref: { __typename: string; id?: any }) => void;
      patch: (pi: Record<string, any>) => void;
      key: string;
    }]>;
  }) => void) {
    const layer: Layer = { id: nextId++, entityOps: [], connOps: [] };

    const apiForBuilder = {
      patch(entity: any, policy: "merge" | "replace" = "merge") {
        const key = graph.identify(entity);
        if (!key) return;
        layer.entityOps.push({ type: "entityWrite", obj: entity, policy });
        applyEntityWrite(entity, policy);
      },

      delete(key: string) {
        layer.entityOps.push({ type: "entityDelete", key });
        applyEntityDelete(key);
      },

      connections(args: ConnectionsArgs) {
        const parentTypename =
          typeof args.parent === "string" ? args.parent : ((args.parent as any)?.__typename || null);
        const parentId = (args.parent as any)?.id;
        const parentKey = graph.getEntityParentKey(parentTypename!, parentId) || "Query";

        const connKey = buildConnKey(parentKey, args.field, args.variables || {});

        const handle = {
          addNode: (node: any, opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}) => {
            const nodeKey = identifyNodeKey(node);
            if (!nodeKey) return;

            // ensure entity snapshot exists
            layer.entityOps.push({ type: "entityWrite", obj: node, policy: "merge" });
            applyEntityWrite(node, "merge");

            const entry = {
              key: nodeKey,
              cursor: opts.cursor ?? null,
              edge: edgeMetaShallow(opts.edge),
            };
            const op: ConnOp = {
              type: "connAdd",
              key: connKey,
              entry,
              position: opts.position === "start" ? "start" : "end",
            };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename: string; id?: any }) => {
            const nodeKey = identifyNodeKey(ref);
            if (!nodeKey) return;
            const op: ConnOp = { type: "connRemove", key: connKey, entryKey: nodeKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          patch: (pi: Record<string, any>) => {
            if (!pi || typeof pi !== "object") return;
            const op: ConnOp = { type: "connPageInfo", key: connKey, patch: { ...pi } };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          key: connKey,
        } as const;

        return [handle] as const;
      },
    };

    // Build + apply immediately
    pending.add(layer);
    build(apiForBuilder);

    // QoL: perform one sync per touched connection for this transaction
    flushTouched();

    return {
      commit() {
        if (pending.has(layer)) {
          pending.delete(layer);
          committed.push(layer);
        }
      },

      revert() {
        // If pending, drop it; if committed, mark as reverted
        if (pending.has(layer)) pending.delete(layer);
        const idx = committed.findIndex(L => L.id === layer.id);
        if (idx >= 0) revertedCommitted.add(layer.id);

        // Rebuild: base → committed non-reverted → pending
        touchedConnections.clear();   // collect touches from reset/reapply
        resetToBase();
        reapplyLayers();
        flushTouched();

        maybeCleanupSnapshots();
      },
    };
  };
}
