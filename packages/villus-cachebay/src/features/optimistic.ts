/* src/features/optimistic.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Transactional optimistic updates (entities + selections only).
 * - Uses Graph public API (identify / getEntity / putEntity / removeEntity / getSelection / putSelection / removeSelection).
 * - Connection list updates are applied to selection skeletons keyed by a stable "connection key"
 *   (parentKey.field(argsWithoutCursors)) so views/reads see the change immediately via materializeSelection().
 * - Batches no-op work; commit persists current deltas; revert restores pre-transaction snapshots.
 */

type EntityKey = string;

/** Build a connection selection key that ignores cursor args. */
const buildConnectionKey = (
  parentKey: string,
  fieldName: string,
  variables: Record<string, any> | undefined,
  cursorArgNames = { after: "after", before: "before", first: "first", last: "last" }
): string => {
  const filtered: Record<string, any> = { ...(variables || {}) };
  delete filtered[cursorArgNames.after];
  delete filtered[cursorArgNames.before];
  delete filtered[cursorArgNames.first];
  delete filtered[cursorArgNames.last];

  const stable = Object.keys(filtered)
    .sort()
    .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
    .join("|");

  return `${parentKey}.${fieldName}(${stable})`;
};

/** Shallow clone helpers (keep array/object identity where required). */
const cloneEdgeList = (edges: any[]): any[] =>
  edges.map((e) => ({ ...e, edge: e.edge ? { ...e.edge } : undefined }));

const shallowClone = (obj: any): any =>
  obj && typeof obj === "object" ? { ...obj } : obj;

/** Insert or replace an entry by entity key. */
const upsertEdgeEntry = (
  selection: any /* { edges: [], pageInfo: {...} } */,
  entry: { key: string; cursor: string | null; edge?: any },
  position: "start" | "end"
) => {
  const list: any[] = selection.edges || (selection.edges = []);
  const idx = list.findIndex((e: any) => e?.node?.__ref === entry.key);
  const normalized = { cursor: entry.cursor, node: { __ref: entry.key }, ...(entry.edge ? { ...entry.edge } : {}) };

  if (idx >= 0) {
    list[idx] = normalized;
  } else {
    if (position === "start") {
      list.unshift(normalized);
    } else {
      list.push(normalized);
    }
  }
};

/** Remove by entity key if present. */
const removeEdgeEntry = (selection: any, entityKey: string) => {
  const list: any[] = selection.edges || [];
  const idx = list.findIndex((e: any) => e?.node?.__ref === entityKey);
  if (idx >= 0) {
    list.splice(idx, 1);
  }
};

/** Shallow copy of user-provided edge meta (ignore cursor). */
const shallowEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor") continue;
    out[k] = meta[k];
  }
  return Object.keys(out).length ? out : undefined;
};

/** Public deps (Graph only). */
type Deps = {
  graph: {
    // identity + entities
    identify: (obj: any) => string | null;
    getEntity: (key: string) => Record<string, any> | undefined;
    putEntity: (obj: any, policy?: "merge" | "replace") => string | null;
    removeEntity: (key: string) => boolean;

    // selections (skeletons)
    getSelection: (selectionKey: string) => any | undefined;
    putSelection: (selectionKey: string, subtree: any) => void;
    removeSelection: (selectionKey: string) => boolean;
  };
};

type EntityOp =
  | { type: "entityWrite"; obj: any; policy: "merge" | "replace" }
  | { type: "entityDelete"; key: string };

type ConnOp =
  | {
    type: "connAdd";
    key: string; // selectionKey
    entry: { key: string; cursor: string | null; edge?: any };
    position: "start" | "end";
  }
  | { type: "connRemove"; key: string; entryKey: string }
  | { type: "connPageInfo"; key: string; patch: Record<string, any> };

type Layer = {
  id: number;
  entityOps: EntityOp[];
  connOps: ConnOp[];
};

type ConnectionsArgs = {
  parent: "Query" | { __typename?: string; id?: any } | string;
  field: string;
  variables?: Record<string, any>;
  cursorArgNames?: { after?: string; before?: string; first?: string; last?: string };
};

export const createModifyOptimistic = (deps: Deps) => {
  const { graph } = deps;

  // Committed layers + pending
  const committed: Layer[] = [];
  const pending = new Set<Layer>();
  const revertedCommitted = new Set<number>();
  let nextId = 1;

  // Base snapshots (first-touch capture)
  const baseEntitySnap = new Map<string, Record<string, any> | null>(); // null → didn’t exist
  const baseSelectionSnap = new Map<string, any | null>();              // null → didn’t exist

  const captureEntityBase = (key: string) => {
    if (baseEntitySnap.has(key)) return;
    const prev = graph.getEntity(key);
    baseEntitySnap.set(key, prev ? { ...prev } : null);
  };

  const captureSelectionBase = (selectionKey: string) => {
    if (baseSelectionSnap.has(selectionKey)) return;
    const prev = graph.getSelection(selectionKey);
    // store a shallow structural clone (enough for revert)
    baseSelectionSnap.set(selectionKey, prev ? JSON.parse(JSON.stringify(prev)) : null);
  };

  const applyEntityWrite = (obj: any, policy: "merge" | "replace") => {
    const key = graph.identify(obj);
    if (!key) return;
    captureEntityBase(key);
    graph.putEntity(obj, policy);
  };

  const applyEntityDelete = (key: string) => {
    captureEntityBase(key);
    graph.removeEntity(key);
  };

  const applyConnOp = (op: ConnOp) => {
    // Ensure we have a selection skeleton to mutate
    captureSelectionBase(op.key);
    let skel = graph.getSelection(op.key);
    if (!skel || typeof skel !== "object") {
      // initialize a minimal Relay-like skeleton
      skel = { edges: [], pageInfo: {} };
    } else {
      // shallow clone to avoid mutating caller-owned references
      skel = { ...skel, edges: Array.isArray(skel.edges) ? [...skel.edges] : [], pageInfo: { ...(skel.pageInfo || {}) } };
    }

    if (op.type === "connAdd") {
      upsertEdgeEntry(skel, op.entry, op.position);
    } else if (op.type === "connRemove") {
      removeEdgeEntry(skel, op.entryKey);
    } else if (op.type === "connPageInfo") {
      const pi = (skel.pageInfo ||= {});
      for (const k of Object.keys(op.patch)) {
        const nv = op.patch[k];
        if (pi[k] !== nv) {
          pi[k] = nv;
        }
      }
    }

    graph.putSelection(op.key, skel);
  };

  const resetToBase = () => {
    // Entities
    for (const [key, snap] of baseEntitySnap) {
      if (snap === null) {
        graph.removeEntity(key);
      } else {
        // Replace the whole snapshot (identity included)
        const idx = key.indexOf(":");
        const typename = idx > -1 ? key.slice(0, idx) : undefined;
        const idPart = idx > -1 ? key.slice(idx + 1) : undefined;
        graph.putEntity({ __typename: typename, id: idPart, ...snap }, "replace");
      }
    }

    // Selections
    for (const [selectionKey, snap] of baseSelectionSnap) {
      if (snap === null) {
        graph.removeSelection(selectionKey);
      } else {
        graph.putSelection(selectionKey, snap);
      }
    }
  };

  const reapplyLayers = () => {
    // Apply committed (non-reverted), then pending (id order)
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
  };

  const maybeCleanupSnapshots = () => {
    if (committed.length === 0 && pending.size === 0) {
      baseEntitySnap.clear();
      baseSelectionSnap.clear();
      revertedCommitted.clear();
    }
  };

  return function modifyOptimistic(
    build: (tx: {
      patch: (entity: any, policy?: "merge" | "replace") => void;
      delete: (key: string) => void;
      connections: (args: ConnectionsArgs) => Readonly<[{
        addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
        removeNode: (ref: { __typename?: string; id?: any }) => void;
        patch: (pageInfoPatch: Record<string, any>) => void;
        key: string;
      }]>;
    }) => void
  ) {
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
        // Resolve parentKey
        const parentKey =
          typeof args.parent === "string"
            ? (args.parent === "Query" ? "Query" : args.parent) // already "User:1" or "Query"
            : args.parent === "Query"
              ? "Query"
              : (graph.identify(args.parent) ?? "Query");

        const cursors = {
          after: args.cursorArgNames?.after ?? "after",
          before: args.cursorArgNames?.before ?? "before",
          first: args.cursorArgNames?.first ?? "first",
          last: args.cursorArgNames?.last ?? "last",
        };

        const selectionKey = buildConnectionKey(parentKey, args.field, args.variables, cursors);

        const handle = {
          addNode: (
            node: any,
            opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}
          ) => {
            // ensure entity exists
            const entityKey = graph.identify(node) as EntityKey | null;
            if (!entityKey) return;
            layer.entityOps.push({ type: "entityWrite", obj: node, policy: "merge" });
            applyEntityWrite(node, "merge");

            const entry = {
              key: entityKey,
              cursor: opts.cursor ?? null,
              edge: shallowEdgeMeta(opts.edge),
            };
            const op: ConnOp = {
              type: "connAdd",
              key: selectionKey,
              entry,
              position: opts.position === "start" ? "start" : "end",
            };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename?: string; id?: any }) => {
            const entityKey = graph.identify(ref) as EntityKey | null;
            if (!entityKey) return;
            const op: ConnOp = { type: "connRemove", key: selectionKey, entryKey: entityKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          patch: (pageInfoPatch: Record<string, any>) => {
            if (!pageInfoPatch || typeof pageInfoPatch !== "object") return;
            const op: ConnOp = { type: "connPageInfo", key: selectionKey, patch: { ...pageInfoPatch } };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          key: selectionKey,
        } as const;

        return [handle] as const;
      },
    };

    // Build now and apply deltas
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
        if (pending.has(layer)) {
          pending.delete(layer);
        }
        const idx = committed.findIndex((L) => L.id === layer.id);
        if (idx >= 0) {
          revertedCommitted.add(layer.id);
        }

        resetToBase();
        reapplyLayers();

        maybeCleanupSnapshots();
      },
    };
  };
};
