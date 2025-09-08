/* eslint-disable @typescript-eslint/no-explicit-any */

type EntityKey = string;

type RelayOptionsLite = {
  names: { edges: string; pageInfo: string; nodeField: string };
  paths: { pageInfo: string };
  segs: { edges: string[]; node: string[]; pageInfo: string[] };
  hasNodePath: boolean;
  cursors: { after: string; before: string; first: string; last: string };
};

type Deps = {
  // stores
  entityStore: Map<EntityKey, Record<string, any>>;
  connectionStore: Map<string, any>;

  // connection/core helpers
  ensureConnectionState: (key: string) => any;
  buildConnectionKey: (
    parentKey: string,
    field: string,
    relay: RelayOptionsLite,
    variables: Record<string, any>,
  ) => string;
  parentEntityKeyFor: (typename: string, id?: any) => string | null;
  getRelayOptionsByType: (parentTypename: string | null, field: string) => RelayOptionsLite | undefined;

  // entity helpers
  parseEntityKey: (key: string) => { typename: string | null; id: string | null };
  resolveConcreteEntityKey: (abstractKey: string) => string | null;
  doesEntityKeyMatch: (a: string, b: string) => boolean;
  putEntity: (obj: any, writePolicy?: "merge" | "replace") => EntityKey | null;
  idOf: (obj: any) => EntityKey | null;

  // change propagation
  markConnectionDirty: (state: any) => void;
  touchConnectionsForEntityKey: (key: string) => void;
  markEntityDirty: (key: string) => void;
  bumpEntitiesTick: () => void;

  // interfaces + hashing
  isInterfaceTypename: (t: string | null) => boolean;
  getImplementationsFor: (t: string) => string[];
  stableIdentityExcluding: (vars: Record<string, any>, remove: string[]) => string;
};

type PublicAPI = {
  identify: (obj: any) => string | null;
  readFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }, materialized?: boolean) => any;
  hasFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }) => boolean;
  writeFragment: (obj: any) => { commit(): void; revert(): void };
};

type ConnectionsArgs = {
  parent: "Query" | { __typename: string; id?: any; _id?: any } | string;
  field: string;
  variables?: Record<string, any>;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Utilities
 * ──────────────────────────────────────────────────────────────────────────── */

function normalizeParentKey(
  parent: "Query" | { __typename: string; id?: any; _id?: any } | string,
  parentEntityKeyFor: Deps["parentEntityKeyFor"],
): string {
  if (typeof parent === "string") {
    if (parent === "Query") return "Query";
    if (parent.includes(":")) return parent;
    return "Query";
  }
  const t = (parent as any)?.__typename;
  const id = (parent as any)?.id ?? (parent as any)?._id;
  return parentEntityKeyFor(t, id) || "Query";
}

function identifyNodeKey(node: any): string | null {
  if (!node || typeof node !== "object") return null;
  const t = node.__typename;
  if (!t) return null;
  const id = node.id ?? node._id;
  if (id == null) return null;
  return `${t}:${String(id)}`;
}

function shallowClone<T extends object>(obj: T | null | undefined): T | null {
  if (!obj || typeof obj !== "object") return null;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) out[k] = (obj as any)[k];
  return out;
}

function cloneList(list: any[]) {
  return list.map(e => ({ ...e, edge: e.edge ? { ...e.edge } : undefined }));
}

function upsertEntry(state: any, entry: { key: string; cursor: string | null; edge?: any }, position: "start" | "end") {
  const idx = state.list.findIndex((e: any) => e.key === entry.key);
  if (idx >= 0) {
    const prev = state.list[idx];
    const mergedEdge = { ...(prev.edge || {}) };
    if (entry.edge) {
      for (const k of Object.keys(entry.edge)) mergedEdge[k] = entry.edge[k];
    }
    state.list[idx] = { ...prev, cursor: entry.cursor, edge: Object.keys(mergedEdge).length ? mergedEdge : undefined };
  } else {
    if (position === "start") state.list.unshift(entry);
    else state.list.push(entry);
  }
  state.keySet.add(entry.key);
}

function edgeMetaShallow(edge: any, nodeFieldName: string): Record<string, any> | undefined {
  if (!edge || typeof edge !== "object") return undefined;
  const out: any = {};
  let has = false;
  for (const k of Object.keys(edge)) {
    if (k === "cursor" || k === nodeFieldName || k === "__typename") continue;
    out[k] = edge[k];
    has = true;
  }
  return has ? out : undefined;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Layer engine (cumulative reverts)
 *  - Each modifyOptimistic -> one layer of ops
 *  - Base snapshots captured on first touch
 *  - commit: append layer
 *  - revert: mark this layer as reverted and rebuild from base applying only non-reverted layers
 * ──────────────────────────────────────────────────────────────────────────── */

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
  touchedEntities: Set<string>;
  touchedConnections: Set<string>;
};

export function createModifyOptimistic(deps: Deps, _api: PublicAPI) {
  const {
    entityStore,
    connectionStore,
    ensureConnectionState,
    buildConnectionKey,
    parentEntityKeyFor,
    getRelayOptionsByType,
    putEntity,
    idOf,
    markConnectionDirty,
    markEntityDirty,
    touchConnectionsForEntityKey,
    bumpEntitiesTick,
  } = deps;

  // Committed layers and cumulative revert tracking
  const layers: Layer[] = [];
  const reverted = new Set<number>();
  let nextId = 1;

  // Base snapshots (first touch)
  const baseEntitySnap = new Map<string, Record<string, any> | null>(); // null => did not exist
  const baseConnSnap = new Map<string, { list: any[]; pageInfo: any; meta: any }>();

  function captureEntityBase(key: string) {
    if (baseEntitySnap.has(key)) return;
    const existed = entityStore.has(key);
    baseEntitySnap.set(key, existed ? { ...(entityStore.get(key) as any) } : null);
  }

  function captureConnBase(key: string) {
    if (baseConnSnap.has(key)) return;
    const st = ensureConnectionState(key);
    baseConnSnap.set(key, {
      list: cloneList(st.list),
      pageInfo: shallowClone(st.pageInfo) || {},
      meta: shallowClone(st.meta) || {},
    });
  }

  function applyEntityWrite(obj: any, policy: "merge" | "replace") {
    const key = idOf(obj);
    if (!key) return;
    captureEntityBase(key);
    putEntity(obj, policy);
    markEntityDirty(key);
    touchConnectionsForEntityKey(key);
  }

  function applyEntityDelete(key: string) {
    captureEntityBase(key);
    const existed = entityStore.has(key);
    if (existed) {
      entityStore.delete(key);
      bumpEntitiesTick();
    }
    markEntityDirty(key);
    touchConnectionsForEntityKey(key);
  }

  function applyConnOp(op: ConnOp) {
    const st = ensureConnectionState(op.key);
    captureConnBase(op.key);

    if (op.type === "connAdd") {
      upsertEntry(st, op.entry, op.position);
    } else if (op.type === "connRemove") {
      const idx = st.list.findIndex((e: any) => e.key === op.entryKey);
      if (idx >= 0) {
        st.list.splice(idx, 1);
        st.keySet.delete(op.entryKey);
      }
    } else if (op.type === "connPageInfo") {
      const pi = st.pageInfo as any;
      for (const k of Object.keys(op.patch)) pi[k] = op.patch[k];
    }
    markConnectionDirty(st);
  }

  function resetToBase() {
    // Entities
    for (const [key, snap] of baseEntitySnap) {
      if (snap === null) {
        const existed = entityStore.has(key);
        entityStore.delete(key);
        if (existed) bumpEntitiesTick();
        markEntityDirty(key);
      } else {
        entityStore.set(key, { ...snap });
        markEntityDirty(key);
      }
      touchConnectionsForEntityKey(key);
    }
    // Connections
    for (const [key, snap] of baseConnSnap) {
      const st = ensureConnectionState(key);
      st.list = cloneList(snap.list);
      const curPI = st.pageInfo;
      for (const k of Object.keys(curPI)) delete curPI[k];
      for (const k of Object.keys(snap.pageInfo)) (curPI as any)[k] = snap.pageInfo[k];
      const curMeta = st.meta;
      for (const k of Object.keys(curMeta)) delete curMeta[k];
      for (const k of Object.keys(snap.meta)) (curMeta as any)[k] = snap.meta[k];
      st.keySet = new Set<string>(st.list.map((e: any) => e.key));
      markConnectionDirty(st);
    }
  }

  function reapplyNonRevertedLayers() {
    for (const L of layers) {
      if (reverted.has(L.id)) continue;

      for (const w of L.entityOps) {
        if (w.type === "entityWrite") applyEntityWrite(w.obj, w.policy);
        else if (w.type === "entityDelete") applyEntityDelete(w.key);
      }
      for (const c of L.connOps) applyConnOp(c);
    }
  }

  return function modifyOptimistic(build: (c: {
    write: (entity: any, policy?: "merge" | "replace") => void;
    del: (key: string) => void;
    connections: (args: ConnectionsArgs) => Readonly<[{
      addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
      removeNode: (ref: { __typename: string; id?: any; _id?: any }) => void;
      updatePageInfo: (pi: Record<string, any>) => void;
      key: string;
    }]>;
  }) => void) {
    const layer: Layer = {
      id: nextId++,
      entityOps: [],
      connOps: [],
      touchedEntities: new Set<string>(),
      touchedConnections: new Set<string>(),
    };

    const apiForBuilder = {
      write(entity: any, policy: "merge" | "replace" = "merge") {
        const key = deps.idOf(entity);
        if (key) {
          layer.touchedEntities.add(key);
          layer.entityOps.push({ type: "entityWrite", obj: entity, policy });
        }
      },

      del(key: string) {
        layer.touchedEntities.add(key);
        layer.entityOps.push({ type: "entityDelete", key });
        // immediate effect
        applyEntityDelete(key);
      },

      connections(args: ConnectionsArgs) {
        const parentKey = normalizeParentKey(args.parent as any, deps.parentEntityKeyFor);
        const variables = args.variables || {};
        const parentTypename =
          typeof args.parent === "string"
            ? (args.parent === "Query" ? "Query" : "Query")
            : ((args.parent as any)?.__typename || "Query");
        const relay = deps.getRelayOptionsByType(parentTypename, args.field);
        if (!relay) {
          const noop = { addNode() { }, removeNode() { }, updatePageInfo() { }, key: "" } as const;
          return [noop] as const;
        }

        const key = deps.buildConnectionKey(parentKey, args.field, relay as any, variables);

        const handle = {
          addNode: (node: any, opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}) => {
            const nodeKey = identifyNodeKey(node);
            if (!nodeKey) return;
            const cursor = opts.cursor ?? null;
            const meta = edgeMetaShallow(opts.edge || {}, relay.names.nodeField);
            layer.touchedConnections.add(key);
            const op: ConnOp = {
              type: "connAdd",
              key,
              entry: { key: nodeKey, cursor, edge: meta },
              position: opts.position === "start" ? "start" : "end",
            };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename: string; id?: any; _id?: any }) => {
            const nodeKey = identifyNodeKey(ref);
            if (!nodeKey) return;
            layer.touchedConnections.add(key);
            const op: ConnOp = { type: "connRemove", key, entryKey: nodeKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          updatePageInfo: (pi: Record<string, any>) => {
            if (!pi || typeof pi !== "object") return;
            layer.touchedConnections.add(key);
            const op: ConnOp = { type: "connPageInfo", key, patch: { ...pi } };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          key,
        } as const;

        return [handle] as const;
      },
    };

    // Record and apply immediately
    build(apiForBuilder);
    for (const w of layer.entityOps) {
      if (w.type === "entityWrite") applyEntityWrite(w.obj, w.policy);
      else if (w.type === "entityDelete") applyEntityDelete(w.key);
    }
    for (const c of layer.connOps) applyConnOp(c);

    return {
      commit() {
        layers.push(layer);
      },

      revert() {
        // Mark this layer as reverted and rebuild from base + non-reverted layers
        reverted.add(layer.id);
        resetToBase();
        reapplyNonRevertedLayers();
      },
    };
  };
}
