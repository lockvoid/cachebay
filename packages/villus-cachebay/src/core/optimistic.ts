/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROOT_ID } from "../core/constants";
import { buildConnectionCanonicalKey } from "../core/utils";

/** Minimal graph surface we need from Cachebay */
type GraphDeps = {
  identify: (obj: any) => string | null;
  getRecord: (recordId: string) => any | undefined;
  putRecord: (recordId: string, partialSnapshot: Record<string, any>) => void;
  removeRecord: (recordId: string) => void;
};

type Deps = { graph: GraphDeps };

/** Deep JSON clone (records are JSONy). */
const jclone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Parse "Type:ID" */
const parseRecordId = (rid: string): { typename?: string; id?: string } => {
  const i = rid.indexOf(":");
  if (i < 0) return {};
  return { typename: rid.slice(0, i) || undefined, id: rid.slice(i + 1) || undefined };
};

/** Shallow copy user edge meta (ignore cursor when undefined) */
const shallowEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor" && meta[k] === undefined) continue;
    out[k] = meta[k];
  }
  return Object.keys(out).length ? out : undefined;
};

/** Next free numeric edge index on a canonical record. */
const nextEdgeIndex = (canKey: string, canSnap: any): number => {
  const edges = Array.isArray(canSnap?.edges) ? canSnap.edges : [];
  let maxIdx = -1;
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const m = ref.match(/\.edges\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
};

/** Insert/update an edge entry in a canonical connection by node ref. */
const upsertCanonicalEdge = (
  graph: GraphDeps,
  canKey: string,
  canSnap: any,
  entityKey: string,
  cursor: string | null | undefined,
  edgeMeta?: any,
  position: "start" | "end" = "end"
) => {
  const edges = Array.isArray(canSnap.edges) ? canSnap.edges : (canSnap.edges = []);

  // try update existing (dedup by node)
  for (let i = 0; i < edges.length; i++) {
    const edgeRef = edges[i]?.__ref;
    if (!edgeRef) continue;
    const edgeRec = graph.getRecord(edgeRef);
    if (edgeRec?.node?.__ref === entityKey) {
      const patch: any = {};
      if (cursor !== undefined) patch.cursor = cursor;
      if (edgeMeta && typeof edgeMeta === "object") {
        for (const k of Object.keys(edgeMeta)) patch[k] = edgeMeta[k];
      }
      graph.putRecord(edgeRef, patch);
      return;
    }
  }

  // create a new canonical-only edge
  const idx = nextEdgeIndex(canKey, canSnap);
  const edgeKey = `${canKey}.edges.${idx}`;

  const nodeType = (entityKey.split(":")[0] || "").trim();
  const edgeTypename = nodeType ? `${nodeType}Edge` : "Edge";

  graph.putRecord(edgeKey, {
    __typename: edgeTypename,
    cursor: cursor ?? null,
    ...(edgeMeta || {}),
    node: { __ref: entityKey },
  });

  const ref = { __ref: edgeKey };
  if (position === "start") edges.unshift(ref);
  else edges.push(ref);
};

/** Remove first occurrence by entity ref from canonical */
const removeCanonicalEdge = (graph: GraphDeps, canKey: string, canSnap: any, entityKey: string): boolean => {
  const edges = Array.isArray(canSnap.edges) ? canSnap.edges : [];
  for (let i = 0; i < edges.length; i++) {
    const edgeRef = edges[i]?.__ref;
    if (!edgeRef) continue;
    const edgeRec = graph.getRecord(edgeRef);
    if (edgeRec?.node?.__ref === entityKey) {
      edges.splice(i, 1);
      return true;
    }
  }
  return false;
};

/* ──────────────────────────────────────────────────────────────────────────── */
/* Layer model                                                                  */
/* ──────────────────────────────────────────────────────────────────────────── */

type EntityOp =
  | { kind: "entityWrite"; recordId: string; patch: Record<string, any>; policy: "merge" | "replace" }
  | { kind: "entityDelete"; recordId: string };

type CanonOp =
  | { kind: "canAdd"; canKey: string; entityKey: string; cursor: string | null | undefined; meta?: any; position: "start" | "end" }
  | { kind: "canRemove"; canKey: string; entityKey: string }
  | { kind: "canPatch"; canKey: string; patch: Record<string, any> };

type Layer = { id: number; entityOps: EntityOp[]; canOps: CanonOp[] };

type ConnectionArgs = {
  parent: "Query" | string | { __typename?: string; id?: any };
  key: string;
  filters?: Record<string, any>;
};

type BuilderAPI = {
  patch: (
    target: string | { __typename?: string; id?: any },
    patchOrFn: Record<string, any> | ((prev: any) => Record<string, any>),
    opts?: { mode?: "merge" | "replace" }
  ) => void;
  delete: (target: string | { __typename?: string; id?: any }) => void;
  connection: (args: ConnectionArgs) => {
    append: (node: any, opts?: { cursor?: string | null; edge?: Record<string, any> }) => void;
    prepend: (node: any, opts?: { cursor?: string | null; edge?: Record<string, any> }) => void;
    remove: (ref: { __typename?: string; id?: any } | string) => void;
    patch: (patchOrFn: Record<string, any> | ((prev: any) => Record<string, any>)) => void;
    key: string;
  };
};

/* ──────────────────────────────────────────────────────────────────────────── */

export const createOptimistic = ({ graph }: Deps) => {
  // global book-keeping
  const baseSnap = new Map<string, any | null>(); // recordId → snapshot|null (baseline before *first* optimistic write)
  const committed: Layer[] = [];
  const pending = new Set<Layer>();
  const removed = new Set<number>();
  let nextId = 1;

  const captureBase = (recordId: string) => {
    if (baseSnap.has(recordId)) return;
    const prev = graph.getRecord(recordId);
    baseSnap.set(recordId, prev ? jclone(prev) : null);
  };

  const applyEntityWrite = (
    recordId: string,
    patch: Record<string, any>,
    policy: "merge" | "replace"
  ) => {
    captureBase(recordId);
    const prev = graph.getRecord(recordId);
    const { typename: riType, id: riId } = parseRecordId(recordId);

    if (policy === "replace") {
      const typename = (patch.__typename as string) ?? riType ?? prev?.__typename;
      const id = (patch.id != null ? String(patch.id) : undefined) ?? riId ?? prev?.id;
      const clean = { ...patch };
      if (clean.__typename === undefined && typename) clean.__typename = typename;
      if (clean.id === undefined && id != null) clean.id = id;
      graph.putRecord(recordId, clean);
      return;
    }

    if (!prev) {
      const typename = (patch.__typename as string) ?? riType;
      const id = patch.id != null ? String(patch.id) : riId;
      const first = { ...patch };
      if (typename && first.__typename === undefined) first.__typename = typename;
      if (id != null && first.id === undefined) first.id = id;
      graph.putRecord(recordId, first);
      return;
    }

    graph.putRecord(recordId, patch);
  };

  const applyEntityDelete = (recordId: string) => {
    captureBase(recordId);
    graph.removeRecord(recordId);
  };

  const applyCanonOp = (op: CanonOp) => {
    captureBase(op.canKey);
    let can = graph.getRecord(op.canKey);
    if (!can || typeof can !== "object") {
      can = { __typename: "Connection", edges: [], pageInfo: {} };
    } else {
      can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
    }

    if (op.kind === "canAdd") {
      upsertCanonicalEdge(graph, op.canKey, can, op.entityKey, op.cursor, shallowEdgeMeta(op.meta), op.position);
      graph.putRecord(op.canKey, can);
      return;
    }

    if (op.kind === "canRemove") {
      removeCanonicalEdge(graph, op.canKey, can, op.entityKey);
      graph.putRecord(op.canKey, can);
      return;
    }

    if (op.kind === "canPatch") {
      const prev = can;
      const p = op.patch || {};
      const next: any = { ...prev };
      if (p.pageInfo && typeof p.pageInfo === "object") {
        next.pageInfo = { ...(prev.pageInfo || {}), ...(p.pageInfo as any) };
      }
      for (const k of Object.keys(p)) {
        if (k === "pageInfo") continue;
        next[k] = (p as any)[k];
      }
      graph.putRecord(op.canKey, next);
      return;
    }
  };

  /** Replace (in place) the whole snapshot of a record without changing proxy identity. */
  const replaceInPlace = (recordId: string, full: Record<string, any>) => {
    const current = graph.getRecord(recordId) || {};
    // delete fields missing in full
    const deletions: Record<string, any> = {};
    for (const k of Object.keys(current)) {
      if (!(k in full)) deletions[k] = undefined;
    }
    if (Object.keys(deletions).length) graph.putRecord(recordId, deletions);
    // then set entire snapshot
    graph.putRecord(recordId, full);
  };

  const resetToBase = () => {
    for (const [id, snap] of baseSnap) {
      if (snap === null) {
        graph.removeRecord(id);
      } else {
        replaceInPlace(id, snap);
      }
    }
  };

  const reapplyAll = () => {
    // committed in insertion order, except ones marked removed
    for (const L of committed) {
      if (removed.has(L.id)) continue;
      for (const e of L.entityOps) (e.kind === "entityWrite") ? applyEntityWrite(e.recordId, e.patch, e.policy) : applyEntityDelete(e.recordId);
      for (const c of L.canOps) applyCanonOp(c);
    }
    // then pending in id order
    const pend = Array.from(pending).sort((a, b) => a.id - b.id);
    for (const L of pend) {
      for (const e of L.entityOps) (e.kind === "entityWrite") ? applyEntityWrite(e.recordId, e.patch, e.policy) : applyEntityDelete(e.recordId);
      for (const c of L.canOps) applyCanonOp(c);
    }
  };

  const cleanupIfIdle = () => {
    if (committed.length === 0 && pending.size === 0) {
      baseSnap.clear();
      removed.clear();
    }
  };

  const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
    if (typeof parent === "string") return parent === "Query" ? ROOT_ID : parent;
    return parent === "Query" ? ROOT_ID : (graph.identify(parent) || ROOT_ID);
  };

  /** TX builder (applies immediately). */
  const modifyOptimistic = (build: (tx: BuilderAPI) => void) => {
    const layer: Layer = { id: nextId++, entityOps: [], canOps: [] };
    pending.add(layer);

    const api: BuilderAPI = {
      patch(target, patchOrFn, opts) {
        const mode = (opts?.mode ?? "merge") as "merge" | "replace";
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;

        const prev = graph.getRecord(recordId) || {};
        const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(jclone(prev)) : patchOrFn;
        if (!delta || typeof delta !== "object") return;

        layer.entityOps.push({ kind: "entityWrite", recordId, patch: { ...delta }, policy: mode });
        applyEntityWrite(recordId, { ...delta }, mode);
      },

      delete(target) {
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;
        layer.entityOps.push({ kind: "entityDelete", recordId });
        applyEntityDelete(recordId);
      },

      connection({ parent, key, filters = {} }) {
        const parentId = resolveParentId(parent);
        const canKey = buildConnectionCanonicalKey(
          { fieldName: key, buildArgs: (v: any) => v || {}, connectionFilters: Object.keys(filters) } as any,
          parentId,
          filters
        );

        const ensureEntity = (node: any): string | null => {
          const ek = graph.identify(node);
          if (!ek) return null;
          // merge shallow fields of node (excluding id/__typename)
          const patch: any = { ...node }; delete patch.__typename; delete patch.id;
          layer.entityOps.push({ kind: "entityWrite", recordId: ek, patch, policy: "merge" });
          applyEntityWrite(ek, patch, "merge");
          return ek;
        };

        return {
          append(node, opts = {}) {
            const entityKey = ensureEntity(node);
            if (!entityKey) return;
            const op: CanonOp = {
              kind: "canAdd",
              canKey,
              entityKey,
              cursor: opts.cursor ?? null,
              meta: shallowEdgeMeta(opts.edge),
              position: "end",
            };
            layer.canOps.push(op);
            applyCanonOp(op);
          },

          prepend(node, opts = {}) {
            const entityKey = ensureEntity(node);
            if (!entityKey) return;
            const op: CanonOp = {
              kind: "canAdd",
              canKey,
              entityKey,
              cursor: opts.cursor ?? null,
              meta: shallowEdgeMeta(opts.edge),
              position: "start",
            };
            layer.canOps.push(op);
            applyCanonOp(op);
          },

          remove(ref) {
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;
            const op: CanonOp = { kind: "canRemove", canKey, entityKey };
            layer.canOps.push(op);
            applyCanonOp(op);
          },

          patch(patchOrFn) {
            const prev = graph.getRecord(canKey) || {};
            const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(jclone(prev)) : patchOrFn;
            if (!delta || typeof delta !== "object") return;
            const op: CanonOp = { kind: "canPatch", canKey, patch: { ...delta } };
            layer.canOps.push(op);
            applyCanonOp(op);
          },

          key: canKey,
        };
      },
    };

    build(api);

    return {
      commit() {
        if (pending.has(layer)) {
          pending.delete(layer);
          committed.push(layer);
        }
      },
      revert() {
        // remove the layer from whichever set
        if (pending.has(layer)) pending.delete(layer);
        const idx = committed.findIndex((L) => L.id === layer.id);
        if (idx >= 0) committed.splice(idx, 1);
        else removed.add(layer.id);

        // reset all baseline-touched records, then reapply surviving layers
        resetToBase();
        reapplyAll();
        cleanupIfIdle();
      }
    };
  };

  /**
   * Re-apply all active overlays *without* resetting.
   * This is safe to call after base writes (canonical page merges, etc.).
   * You can scope by connection ids and/or entity ids for a tighter pass.
   */
  const reapplyOptimistic = (hint?: { connections?: string[]; entities?: string[] }): { inserted: string[]; removed: string[] } => {
    const allowConn = hint?.connections ? new Set(hint.connections) : null;
    const allowEnt = hint?.entities ? new Set(hint.entities) : null;

    const ins: string[] = [];
    const del: string[] = [];

    const applyLayer = (L: Layer) => {
      // Entities (optional scope)
      for (const e of L.entityOps) {
        if (allowEnt && e.kind === "entityWrite" && !allowEnt.has(e.recordId)) continue;
        if (allowEnt && e.kind === "entityDelete" && !allowEnt.has(e.recordId)) continue;
        (e.kind === "entityWrite") ? applyEntityWrite(e.recordId, e.patch, e.policy) : applyEntityDelete(e.recordId);
      }
      // Connections
      for (const c of L.canOps) {
        if (allowConn && !allowConn.has(c.canKey)) continue;
        applyCanonOp(c);
        if (c.kind === "canAdd") ins.push(c.entityKey);
        else if (c.kind === "canRemove") del.push(c.entityKey);
      }
    };

    for (const L of committed) { if (!removed.has(L.id)) applyLayer(L); }
    const pend = Array.from(pending).sort((a, b) => a.id - b.id);
    for (const L of pend) applyLayer(L);

    return { inserted: ins, removed: del };
  };

  return { modifyOptimistic, reapplyOptimistic };
};
