/* src/features/optimistic.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildConnectionKey, parseEntityKey, stableIdentityExcluding } from "../core/utils";

type EntityKey = string;

// Helper functions
function cloneList(list: any[]): any[] {
  return list.map(e => ({ ...e, edge: e.edge ? { ...e.edge } : undefined }));
}

function shallowClone(obj: any): any {
  return obj ? { ...obj } : null;
}

function upsertEntry(state: any, entry: { key: string; cursor: string | null; edge?: any }, position: "start" | "end") {
  const idx = state.list.findIndex((e: any) => e.key === entry.key);
  if (idx >= 0) {
    state.list[idx] = { ...entry };
  } else {
    if (position === "start") {
      state.list.unshift({ ...entry });
    } else {
      state.list.push({ ...entry });
    }
    state.keySet.add(entry.key);
  }
}

function identifyNodeKey(obj: any): EntityKey | null {
  if (!obj || typeof obj !== "object") return null;
  const typename = obj.__typename;
  const id = obj.id ?? obj._id;
  return typename && id != null ? `${typename}:${id}` : null;
}

function edgeMetaShallow(edge: any, nodeField: string): any {
  if (!edge || typeof edge !== "object") return {};
  const meta: any = {};
  for (const k of Object.keys(edge)) {
    if (k !== nodeField && k !== "cursor") {
      meta[k] = edge[k];
    }
  }
  return meta;
}

type RelayOptionsLite = {
  names: { edges: string; pageInfo: string; nodeField: string };
  paths: { pageInfo: string };
  segs: { edges: string[]; node: string[]; pageInfo: string[] };
  hasNodePath: boolean;
  cursors: { after: string; before: string; first: string; last: string };
};

type Deps = {
  graph: any;
  views: any;
  resolvers: any;
};

type PublicAPI = {
  identify: (obj: any) => string | null;
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
  parent: "Query" | { __typename: string; id?: any; _id?: any } | string;
  field: string;
  variables?: Record<string, any>;
};

export function createModifyOptimistic(deps: Deps) {
  const { graph, views, resolvers } = deps;
  const { getRelayOptionsByType } = resolvers;

  // Committed layers (in order) + currently pending (not yet committed)
  const committed: Layer[] = [];
  const pending = new Set<Layer>();
  const revertedCommitted = new Set<number>();

  let nextId = 1;

  // Base snapshots captured lazily (first touch across all layers)
  const baseEntitySnap = new Map<string, Record<string, any> | null>(); // null => didn't exist
  const baseConnSnap = new Map<string, { list: any[]; pageInfo: any; meta: any }>();

  function captureEntityBase(key: string) {
    if (baseEntitySnap.has(key)) {
      return;
    }
    const existed = graph.entityStore.has(key);
    baseEntitySnap.set(key, existed ? { ...(graph.entityStore.get(key) as any) } : null);
  }

  function captureConnBase(key: string) {
    if (baseConnSnap.has(key)) {
      return;
    }
    const state = graph.ensureReactiveConnection(key);
    baseConnSnap.set(key, {
      list: cloneList(state.list),
      pageInfo: shallowClone(state.pageInfo) || {},
      meta: shallowClone(state.meta) || {},
    });
  }

  function applyEntityWrite(obj: any, policy: "merge" | "replace") {
    const key = graph.identify(obj);
    if (!key) {
      return;
    }
    captureEntityBase(key);
    const entity = { ...obj };
    const ek = graph.putEntity(entity, policy);
    views.markEntityDirty(ek);
    views.touchConnectionsForEntityKey(ek);
  }

  function applyEntityDelete(key: string) {
    captureEntityBase(key);

    const existed = graph.entityStore.has(key);
    if (existed) {
      graph.entityStore.delete(key);
      views.markEntityDirty(key);
      views.touchConnectionsForEntityKey(key);
      graph.bumpEntitiesTick();
    }
  }

  function applyConnOp(op: ConnOp) {
    const state = graph.ensureReactiveConnection(op.key);
    captureConnBase(op.key);

    if (op.type === "connAdd") {
      upsertEntry(state, op.entry, op.position);
    } else if (op.type === "connRemove") {
      const idx = state.list.findIndex((e: any) => e.key === op.entryKey);
      if (idx >= 0) {
        state.list.splice(idx, 1);
        state.keySet.delete(op.entryKey);
      }
    } else if (op.type === "connPageInfo") {
      const pi = state.pageInfo as any;
      for (const k of Object.keys(op.patch)) {
        pi[k] = op.patch[k];
      }
    }

    views.markConnectionDirty(state);
  }

  /** Reset stores to base snapshots, preserving array/object identity where possible. */
  function resetToBase() {
    // Entities
    for (const [key, snap] of baseEntitySnap) {
      if (snap === null) {
        const existed = graph.entityStore.has(key);
        const { typename } = parseEntityKey(key);
        if (existed) {
          graph.entityStore.delete(key);
          views.markEntityDirty(key);
          views.touchConnectionsForEntityKey(key);
          graph.bumpEntitiesTick();
        }
      } else {
        graph.entityStore.set(key, { ...snap });
        views.markEntityDirty(key);
      }
    }

    // Connections (preserve array identity)
    for (const [key, snap] of baseConnSnap) {
      const st = graph.ensureReactiveConnection(key);

      // replace list contents, keep reference
      st.list.splice(0, st.list.length, ...cloneList(snap.list));

      // pageInfo in place
      const curPI = st.pageInfo;
      for (const k of Object.keys(curPI)) {
        delete curPI[k];
      }
      for (const k of Object.keys(snap.pageInfo)) {
        (curPI as any)[k] = snap.pageInfo[k];
      }

      // meta in place
      const curMeta = st.meta;
      for (const k of Object.keys(curMeta)) {
        delete curMeta[k];
      }
      for (const k of Object.keys(snap.meta)) {
        (curMeta as any)[k] = snap.meta[k];
      }

      st.keySet = new Set<string>(st.list.map((e: any) => e.key));
      views.markConnectionDirty(st);
    }
  }

  function reapplyLayers() {
    // Apply committed non-reverted, then all pending (in id order)
    for (const L of committed) {
      if (revertedCommitted.has(L.id)) {
        continue;
      }
      for (const w of L.entityOps) {
        if (w.type === "entityWrite") {
          applyEntityWrite(w.obj, w.policy);
        } else {
          applyEntityDelete(w.key);
        }
      }
      for (const c of L.connOps) {
        applyConnOp(c);
      }
    }

    const pendingSorted = Array.from(pending).sort((a, b) => a.id - b.id);
    for (const L of pendingSorted) {
      for (const w of L.entityOps) {
        if (w.type === "entityWrite") {
          applyEntityWrite(w.obj, w.policy);
        } else {
          applyEntityDelete(w.key);
        }
      }
      for (const c of L.connOps) {
        applyConnOp(c);
      }
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
      removeNode: (ref: { __typename: string; id?: any; _id?: any }) => void;
      patch: (pi: Record<string, any>) => void;
      key: string;
    }]>;
  }) => void) {
    const layer: Layer = {
      id: nextId++,
      entityOps: [],
      connOps: [],
    };

    // API used by the builder; applies immediately
    const apiForBuilder = {
      patch(entity: any, policy: "merge" | "replace" = "merge") {
        const key = graph.identify(entity);
        if (!key) {
          return;
        }
        const op: EntityOp = { type: "entityWrite", obj: entity, policy };
        layer.entityOps.push(op);
        applyEntityWrite(entity, policy);
      },

      delete(key: string) {
        const op: EntityOp = { type: "entityDelete", key };
        layer.entityOps.push(op);
        applyEntityDelete(key);
      },

      connections(args: ConnectionsArgs) {
        const parentTypename = typeof args.parent === "string"
            ? args.parent
            : ((args.parent as any)?.__typename || null);
        const parentId = (args.parent as any)?.id ?? (args.parent as any)?._id;
        const parentKey = graph.getEntityParentKey(parentTypename, parentId) || "Query";

        const relay = getRelayOptionsByType(parentTypename, args.field);
        if (!relay) {
          const noop = { addNode() { }, removeNode() { }, patch() { }, key: "" } as const;
          return [noop] as const;
        }

        const connKey = buildConnectionKey(parentKey, args.field, relay as any, args.variables || {});

        const handle = {
          addNode: (node: any, opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}) => {
            const nodeKey = identifyNodeKey(node);
            if (!nodeKey) {
              return;
            }
            const cursor = opts.cursor ?? null;
            const meta = edgeMetaShallow(opts.edge || {}, relay.names.nodeField);

            // Ensure entity exists/updates in the store (dedup + latest snapshot)
            layer.entityOps.push({ type: "entityWrite", obj: node, policy: "merge" });
            applyEntityWrite(node, "merge");

            // Connection entry upsert
            const op: ConnOp = {
              type: "connAdd",
              key: connKey,
              entry: { key: nodeKey, cursor, edge: meta },
              position: opts.position === "start" ? "start" : "end",
            };

            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename: string; id?: any; _id?: any }) => {
            const nodeKey = identifyNodeKey(ref);
            if (!nodeKey) {
              return;
            }
            const op: ConnOp = { type: "connRemove", key: connKey, entryKey: nodeKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          patch: (pi: Record<string, any>) => {
            if (!pi || typeof pi !== "object") {
              return;
            }
            const patch = { ...pi };
            const op: ConnOp = { type: "connPageInfo", key: connKey, patch };
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

    return {
      commit() {
        if (pending.has(layer)) {
          pending.delete(layer);
          committed.push(layer);
        }
      },

      revert() {
        // Remove from whichever pool it is in, mark as reverted if committed
        if (pending.has(layer)) {
          pending.delete(layer);
        }

        const idx = committed.findIndex((L) => L.id === layer.id);
        if (idx >= 0) {
          revertedCommitted.add(layer.id);
        }

        // Rebuild from base + remaining layers
        resetToBase();
        reapplyLayers();
        maybeCleanupSnapshots();
      },
    };
  };
}
