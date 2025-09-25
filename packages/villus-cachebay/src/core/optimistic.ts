/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROOT_ID } from "../core/constants";
import { buildConnectionCanonicalKey } from "../core/utils";

type GraphDeps = {
  identify: (obj: any) => string | null;
  getRecord: (recordId: string) => any | undefined;
  putRecord: (recordId: string, partialSnapshot: Record<string, any>) => void;
  removeRecord: (recordId: string) => void;
};

type Deps = { graph: GraphDeps };

/** Deep JSON clone (records are JSONy). */
const cloneJSON = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// helper: find an edge ref in a canonical by node ref
const findEdgeRefByNode = (graph: GraphDeps, canSnap: any, entityKey: string): string | undefined => {
  const edges = Array.isArray(canSnap?.edges) ? canSnap.edges : [];
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const e = graph.getRecord(ref);
    if (e?.node?.__ref === entityKey) return ref;
  }
  return undefined;
};

/** Extract typename/id from record id like 'Post:1'. */
const parseRecordId = (rid: string): { typename?: string; id?: string } => {
  const i = rid.indexOf(":");
  if (i < 0) return {};
  return { typename: rid.slice(0, i) || undefined, id: rid.slice(i + 1) || undefined };
};

/** Shallow copy user edge meta (ignore cursor). */
const shallowEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor") continue;
    out[k] = meta[k];
  }
  return Object.keys(out).length ? out : undefined;
};

/** Next free numeric edge index on a canonical record. */
const nextEdgeIndex = (canKey: string, canSnap: any): number => {
  if (!Array.isArray(canSnap?.edges) || canSnap.edges.length === 0) return 0;
  let maxIdx = -1;
  for (let i = 0; i < canSnap.edges.length; i++) {
    const ref = canSnap.edges[i]?.__ref;
    if (!ref) continue;
    const m = ref.match(/\.edges\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
};

/** Insert or update an edge entry in a canonical connection by node key. */
const upsertCanonicalEdge = (
  graph: GraphDeps,
  canKey: string,
  canSnap: any,
  entityKey: string,
  cursor: string | null,
  edgeMeta?: any,
  position: "start" | "end" = "end"
) => {
  const edges = Array.isArray(canSnap.edges) ? canSnap.edges : (canSnap.edges = []);

  // Update existing by node
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

  // Create new edge record
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

/** Remove first occurrence by entity key. */
const removeCanonicalEdge = (graph: GraphDeps, _canKey: string, canSnap: any, entityKey: string): boolean => {
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

type EntityOp =
  | { kind: "entityWrite"; recordId: string; patch: Record<string, any>; policy: "merge" | "replace" }
  | { kind: "entityDelete"; recordId: string };

type CanonOp =
  | { kind: "canAdd"; canKey: string; entityKey: string; cursor: string | null; meta?: any; position: "start" | "end" }
  | { kind: "canRemove"; canKey: string; entityKey: string }
  | { kind: "canPatch"; canKey: string; patch: Record<string, any> };

type Layer = {
  id: number;
  entityOps: EntityOp[];
  canOps: CanonOp[];
  touched: Set<string>;
};

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

/* ---------- helpers to reconstruct canonical from pages (server baseline) ---------- */

const isCanonicalKey = (id: string) => id.startsWith("@connection.");

const metaKeyOf = (canKey: string) => `${canKey}::meta`;

const computeOrderedPagesFromMeta = (meta: any): string[] => {
  if (!meta || !Array.isArray(meta.pages)) return [];
  const pages: string[] = meta.pages.slice();
  const hints: Record<string, "before" | "after" | "leader"> = meta.hints || {};
  const leader: string | undefined = meta.leader;

  const before: string[] = [];
  const after: string[] = [];

  for (const pk of pages) {
    const h = hints[pk];
    if (h === "before") before.push(pk);
    else if (h === "after") after.push(pk);
    else if (h === "leader") {
      // placed later
    } else {
      after.push(pk);
    }
  }
  if (leader) {
    const b = before.filter((p) => p !== leader);
    const a = after.filter((p) => p !== leader);
    return [...b, leader, ...a];
  }
  return pages;
};

const nodeRefOfEdge = (graph: GraphDeps, edgeRef: string): string | null =>
  (graph.getRecord(edgeRef)?.node?.__ref as string) || null;

const rebuildCanonicalFromPages = (graph: GraphDeps, canKey: string) => {
  const meta = graph.getRecord(metaKeyOf(canKey));
  const ordered = computeOrderedPagesFromMeta(meta);
  if (!ordered.length) return;

  const nextEdges: Array<{ __ref: string }> = [];
  const seenNode = new Set<string>();

  for (const pk of ordered) {
    const page = graph.getRecord(pk);
    const refs: Array<{ __ref: string }> = Array.isArray(page?.edges) ? page.edges : [];
    for (let i = 0; i < refs.length; i++) {
      const eref = refs[i]?.__ref;
      if (!eref) continue;
      const nref = nodeRefOfEdge(graph, eref);
      if (!nref || seenNode.has(nref)) continue;
      seenNode.add(nref);
      nextEdges.push({ __ref: eref });
    }
  }

  // merge edges only; keep existing pageInfo/extras untouched
  graph.putRecord(canKey, { edges: nextEdges });
};

/* ──────────────────────────────────────────────────────────────────────────── */

export const createOptimistic = ({ graph }: Deps) => {
  /** Earliest baseline snapshot for record ids touched across layers. */
  const baseSnap = new Map<string, any | null>(); // recordId → snapshot|null

  /** Committed layers (in insertion order). */
  const committed: Layer[] = [];
  /** Pending (not yet committed) layers. */
  const pending = new Set<Layer>();

  let nextId = 1;

  const captureBase = (recordId: string, currentLayer: Layer) => {
    if (!currentLayer.touched.has(recordId)) currentLayer.touched.add(recordId);
    if (baseSnap.has(recordId)) return;
    const prev = graph.getRecord(recordId);
    baseSnap.set(recordId, prev ? cloneJSON(prev) : null);
  };

  const replaceInPlace = (recordId: string, full: Record<string, any>) => {
    const current = graph.getRecord(recordId) || {};
    const deletions: Record<string, any> = {};
    for (const k of Object.keys(current)) if (!(k in full)) deletions[k] = undefined;
    if (Object.keys(deletions).length) graph.putRecord(recordId, deletions);
    graph.putRecord(recordId, full);
  };

  const applyEntityWrite = (
    L: Layer,
    recordId: string,
    patch: Record<string, any>,
    policy: "merge" | "replace"
  ) => {
    captureBase(recordId, L);

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

  const applyEntityDelete = (L: Layer, recordId: string) => {
    captureBase(recordId, L);
    graph.removeRecord(recordId);
  };

  const applyCanonOp = (L: Layer, op: CanonOp) => {
    captureBase(op.canKey, L);

    let can = graph.getRecord(op.canKey);
    if (!can || typeof can !== "object") {
      can = { __typename: "Connection", edges: [], pageInfo: {} };
    } else {
      can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
    }

    if (op.kind === "canAdd") {
      upsertCanonicalEdge(graph, op.canKey, can, op.entityKey, op.cursor, op.meta, op.position);
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

  /* ---------- modifyOptimistic ---------- */

  function modifyOptimistic(build: (tx: BuilderAPI) => void) {
    const layer: Layer = { id: nextId++, entityOps: [], canOps: [], touched: new Set() };
    pending.add(layer);

    const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
      if (typeof parent === "string") return parent === "Query" ? ROOT_ID : parent;
      return parent === "Query" ? ROOT_ID : (graph.identify(parent) || ROOT_ID);
    };

    const api: BuilderAPI = {
      patch(target, patchOrFn, opts) {
        const mode = (opts?.mode ?? "merge") as "merge" | "replace";
        const recordId =
          typeof target === "string"
            ? target
            : (graph.identify(target) || null);
        if (!recordId) return;

        const prev = graph.getRecord(recordId) || {};
        const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(cloneJSON(prev)) : patchOrFn;
        if (!delta || typeof delta !== "object") return;

        layer.entityOps.push({ kind: "entityWrite", recordId, patch: { ...delta }, policy: mode });
        applyEntityWrite(layer, recordId, { ...delta }, mode);
      },

      delete(target) {
        const recordId =
          typeof target === "string"
            ? target
            : (graph.identify(target) || null);
        if (!recordId) return;
        layer.entityOps.push({ kind: "entityDelete", recordId });
        applyEntityDelete(layer, recordId);
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
          const patch: any = { ...node }; delete patch.__typename; delete patch.id;
          layer.entityOps.push({ kind: "entityWrite", recordId: ek, patch, policy: "merge" });
          applyEntityWrite(layer, ek, patch, "merge");
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
            applyCanonOp(layer, op);
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
            applyCanonOp(layer, op);
          },

          remove(ref) {
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;
            const op: CanonOp = { kind: "canRemove", canKey, entityKey };
            layer.canOps.push(op);
            applyCanonOp(layer, op);
          },

          patch(patchOrFn) {
            const prev = graph.getRecord(canKey) || {};
            const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(cloneJSON(prev)) : patchOrFn;
            if (!delta || typeof delta !== "object") return;
            const op: CanonOp = { kind: "canPatch", canKey, patch: { ...delta } };
            layer.canOps.push(op);
            applyCanonOp(layer, op);
          },

          key: canKey,
        };
      },
    };

    build(api);

    const resetToBase = () => {
      for (const [id, snap] of baseSnap) {
        // Important: never reset canonical connections from stale baselines
        if (isCanonicalKey(id)) continue;
        if (snap === null) graph.removeRecord(id);
        else replaceInPlace(id, snap);
      }
    };

    const reapplyLayers = () => {
      // apply committed in order
      for (const L of committed) {
        for (const e of L.entityOps) {
          if (e.kind === "entityWrite") applyEntityWrite(L, e.recordId, e.patch, e.policy);
          else applyEntityDelete(L, e.recordId);
        }
        for (const c of L.canOps) applyCanonOp(L, c);
      }
      // then pending (sorted)
      const pend = Array.from(pending).sort((a, b) => a.id - b.id);
      for (const L of pend) {
        for (const e of L.entityOps) {
          if (e.kind === "entityWrite") applyEntityWrite(L, e.recordId, e.patch, e.policy);
          else applyEntityDelete(L, e.recordId);
        }
        for (const c of L.canOps) applyCanonOp(L, c);
      }
    };

    const reconstructAllTouchedCanonicals = (excludeLayerId?: number) => {
      const touched = new Set<string>();
      const collect = (L: Layer) => {
        for (const id of L.touched) if (isCanonicalKey(id)) touched.add(id);
      };
      for (const L of committed) collect(L);
      for (const L of pending) if (L.id !== excludeLayerId) collect(L);
      // also consider any canonical ids we captured earlier
      for (const id of baseSnap.keys()) if (isCanonicalKey(id)) touched.add(id);

      for (const canKey of touched) rebuildCanonicalFromPages(graph, canKey);
    };

    const cleanupIfIdle = () => {
      if (committed.length === 0 && pending.size === 0) baseSnap.clear();
    };

    return {
      commit() {
        if (pending.has(layer)) {
          pending.delete(layer);
          committed.push(layer);
        }
      },
      revert() {
        // Remove this layer from wherever it is
        const inPending = pending.delete(layer);
        if (!inPending) {
          const idx = committed.findIndex((L) => L.id === layer.id);
          if (idx >= 0) committed.splice(idx, 1);
        }

        // Reset entity records only (skip canonicals), then reconstruct canonicals from pages,
        // then re-apply all remaining layers to derive the correct union.
        resetToBase();
        reconstructAllTouchedCanonicals(layer.id);
        reapplyLayers();
        cleanupIfIdle();
      }
    };
  }

  /* ---------- replayOptimistic: non-destructive overlay ---------- */

  function replayOptimistic(hint?: { connections?: string[]; entities?: string[] }): { inserted: string[]; removed: string[] } {
    const conScope = new Set(hint?.connections || []);
    const entScope = new Set(hint?.entities || []);
    const scopeConnections = conScope.size > 0;
    const scopeEntities = entScope.size > 0;

    if (committed.length === 0 && pending.size === 0) {
      return { inserted: [], removed: [] };
    }

    const inserted: string[] = [];
    const removed: string[] = [];

    const playLayer = (L: Layer) => {
      for (const e of L.entityOps) {
        if (scopeEntities && !entScope.has(e.recordId)) continue;
        if (e.kind === "entityWrite") {
          const prev = graph.getRecord(e.recordId) || {};
          const mode = e.policy;
          if (mode === "replace") {
            graph.putRecord(e.recordId, { ...e.patch });
          } else {
            if (!prev) {
              const { typename: riType, id: riId } = parseRecordId(e.recordId);
              const first: any = { ...e.patch };
              if (first.__typename === undefined && riType) first.__typename = riType;
              if (first.id === undefined && riId != null) first.id = riId;
              graph.putRecord(e.recordId, first);
            } else {
              graph.putRecord(e.recordId, e.patch);
            }
          }
        } else {
          graph.removeRecord(e.recordId);
        }
      }

      for (const c of L.canOps) {
        if (scopeConnections && !conScope.has(c.canKey)) continue;

        if (c.kind === "canAdd") {
          inserted.push(c.entityKey);
          let can = graph.getRecord(c.canKey);
          if (!can || typeof can !== "object") can = { __typename: "Connection", edges: [], pageInfo: {} };
          else can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
          upsertCanonicalEdge(graph, c.canKey, can, c.entityKey, c.cursor, c.meta, c.position);
          graph.putRecord(c.canKey, can);
        } else if (c.kind === "canRemove") {
          removed.push(c.entityKey);
          let can = graph.getRecord(c.canKey);
          if (!can || typeof can !== "object") can = { __typename: "Connection", edges: [], pageInfo: {} };
          else can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
          removeCanonicalEdge(graph, c.canKey, can, c.entityKey);
          graph.putRecord(c.canKey, can);
        } else {
          const prev = graph.getRecord(c.canKey) || { __typename: "Connection", edges: [], pageInfo: {} };
          const p = c.patch || {};
          const next: any = { ...prev };
          if (p.pageInfo && typeof p.pageInfo === "object") {
            next.pageInfo = { ...(prev.pageInfo || {}), ...(p.pageInfo as any) };
          }
          for (const k of Object.keys(p)) {
            if (k === "pageInfo") continue;
            next[k] = (p as any)[k];
          }
          graph.putRecord(c.canKey, next);
        }
      }
    };

    for (const L of committed) playLayer(L);
    for (const L of Array.from(pending).sort((a, b) => a.id - b.id)) playLayer(L);

    return { inserted, removed };
  }

  return { modifyOptimistic, replayOptimistic };
};

export type OptimisticInstance = ReturnType<typeof createOptimistic>;
