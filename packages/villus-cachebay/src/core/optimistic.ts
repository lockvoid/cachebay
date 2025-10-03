/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROOT_ID } from "../core/constants";
import { buildConnectionCanonicalKey } from "../core/utils";

/* ────────────────────────────────────────────────────────────────────────────
 * Graph deps
 * -------------------------------------------------------------------------- */
type GraphDeps = {
  identify: (obj: any) => string | null;
  getRecord: (recordId: string) => any | undefined;
  putRecord: (recordId: string, partialSnapshot: Record<string, any>) => void;
  removeRecord: (recordId: string) => void;
};

type Deps = { graph: GraphDeps };

/* ────────────────────────────────────────────────────────────────────────────
 * Utils
 * -------------------------------------------------------------------------- */
const cloneJSON = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const parseRecordId = (rid: string): { typename?: string; id?: string } => {
  const i = rid.indexOf(":");
  if (i < 0) return {};
  return { typename: rid.slice(0, i) || undefined, id: rid.slice(i + 1) || undefined };
};

const isCanonicalKey = (id: string) => id.startsWith("@connection.");

const shallowEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor") continue;
    out[k] = meta[k];
  }
  return Object.keys(out).length ? out : undefined;
};

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

const findEdgeIndexByNode = (graph: GraphDeps, canSnap: any, entityKey: string): number => {
  const edges = Array.isArray(canSnap?.edges) ? canSnap.edges : [];
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const e = graph.getRecord(ref);
    if (e?.node?.__ref === entityKey) return i;
  }
  return -1;
};

const nodeRefFromEdgeRef = (graph: GraphDeps, edgeRef?: string): string | null => {
  if (!edgeRef) return null;
  return (graph.getRecord(edgeRef)?.node?.__ref as string) || null;
};

const edgeRefForNodeInEdges = (graph: GraphDeps, edges: Array<{ __ref: string }> | undefined, entityKey: string): string | null => {
  if (!Array.isArray(edges)) return null;
  for (const r of edges) {
    const nref = nodeRefFromEdgeRef(graph, r?.__ref);
    if (nref === entityKey) return r.__ref;
  }
  return null;
};

const indexOfEdgeRef = (edges: Array<{ __ref: string }> | undefined, edgeRef: string): number =>
  Array.isArray(edges) ? edges.findIndex(r => r?.__ref === edgeRef) : -1;

const findAnchorIndex = (graph: GraphDeps, canSnap: any, anchorKey: string): number => {
  const edges = Array.isArray(canSnap?.edges) ? canSnap.edges : [];
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const e = graph.getRecord(ref);
    if (e?.node?.__ref === anchorKey) return i;
  }
  const anchorId = anchorKey.includes(":") ? anchorKey.slice(anchorKey.indexOf(":") + 1) : anchorKey;
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const e = graph.getRecord(ref);
    const nref = e?.node?.__ref;
    if (!nref) continue;
    const node = graph.getRecord(nref);
    if (node?.id != null && String(node.id) === String(anchorId)) return i;
  }
  return -1;
};

// Upsert into canonical with anchor
const upsertCanonicalEdgeAnchored = (
  graph: GraphDeps,
  canKey: string,
  canSnap: any,
  entityKey: string,
  edgeMeta: any,
  position: "start" | "end" | "before" | "after",
  anchorKey?: string | null,
) => {
  const edges = Array.isArray(canSnap.edges) ? canSnap.edges : (canSnap.edges = []);

  const existingIdx = findEdgeIndexByNode(graph, canSnap, entityKey);
  if (existingIdx >= 0) {
    const edgeRef = edges[existingIdx]?.__ref;
    if (edgeRef && edgeMeta && typeof edgeMeta === "object") {
      const patch: any = {};
      for (const k of Object.keys(edgeMeta)) patch[k] = edgeMeta[k];
      graph.putRecord(edgeRef, patch);
    }
    return;
  }

  const idx = nextEdgeIndex(canKey, canSnap);
  const edgeKey = `${canKey}.edges.${idx}`;
  const nodeType = (entityKey.split(":")[0] || "").trim();
  const edgeTypename = nodeType ? `${nodeType}Edge` : "Edge";

  graph.putRecord(edgeKey, { __typename: edgeTypename, node: { __ref: entityKey }, ...(edgeMeta || {}) });
  const ref = { __ref: edgeKey };

  if (position === "start") return void edges.unshift(ref);
  if (position === "end") return void edges.push(ref);

  let insertAt = -1;
  if (anchorKey) insertAt = findAnchorIndex(graph, canSnap, anchorKey);
  if (insertAt < 0) {
    if (position === "before") edges.unshift(ref);
    else edges.push(ref);
  } else {
    edges.splice(position === "before" ? insertAt : insertAt + 1, 0, ref);
  }
};

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

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * -------------------------------------------------------------------------- */
type EntityOp =
  | { kind: "entityWrite"; recordId: string; patch: Record<string, any>; policy: "merge" | "replace" }
  | { kind: "entityDelete"; recordId: string };

type CanonOp =
  | { kind: "canAddNode"; canKey: string; entityKey: string; meta?: any; position: "start" | "end" | "before" | "after"; anchor?: string | null }
  | { kind: "canRemoveNode"; canKey: string; entityKey: string }
  | { kind: "canPatch"; canKey: string; patch: Record<string, any> };

type Layer = {
  id: number;
  entityOps: EntityOp[];
  canOps: CanonOp[];
  touched: Set<string>;
  localBase: Map<string, any | null>;
  builder: (tx: BuilderAPI, ctx: BuilderCtx) => void;
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

  connection: (argsOrKey: ConnectionArgs | string) => {
    addNode: (node: any, opts?: {
      position?: "start" | "end" | "before" | "after";
      anchor?: string | { __typename: string; id: any };
      edge?: Record<string, any>;
    }) => void;
    removeNode: (ref: { __typename?: string; id?: any } | string) => void;
    patch: (patchOrFn: Record<string, any> | ((prev: any) => Record<string, any>)) => void;
    key: string;
  };
};

type BuilderCtx = {
  phase: "optimistic" | "commit";
  data?: any;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Main
 * -------------------------------------------------------------------------- */
export const createOptimistic = ({ graph }: Deps) => {
  const pending = new Set<Layer>();
  let nextId = 1;

  const replaceInPlace = (recordId: string, full: Record<string, any>) => {
    const current = graph.getRecord(recordId) || {};
    const deletions: Record<string, any> = {};
    for (const k of Object.keys(current)) if (!(k in full)) deletions[k] = undefined;
    if (Object.keys(deletions).length) graph.putRecord(recordId, deletions);
    graph.putRecord(recordId, full);
  };

  // Recording writers (optimistic)
  const recEntityWrite = (L: Layer, recordId: string, patch: Record<string, any>, policy: "merge" | "replace") => {
    if (!L.touched.has(recordId)) L.touched.add(recordId);
    if (!L.localBase.has(recordId)) {
      const prev = graph.getRecord(recordId);
      L.localBase.set(recordId, prev ? cloneJSON(prev) : null);
    }

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

  const recEntityDelete = (L: Layer, recordId: string) => {
    if (!L.touched.has(recordId)) L.touched.add(recordId);
    if (!L.localBase.has(recordId)) {
      const prev = graph.getRecord(recordId);
      L.localBase.set(recordId, prev ? cloneJSON(prev) : null);
    }
    graph.removeRecord(recordId);
  };

  const recCanonOp = (L: Layer, op: CanonOp) => {
    if (!L.touched.has(op.canKey)) L.touched.add(op.canKey);
    if (!L.localBase.has(op.canKey)) {
      const prev = graph.getRecord(op.canKey);
      L.localBase.set(op.canKey, prev ? cloneJSON(prev) : null);
    }

    let can = graph.getRecord(op.canKey);
    if (!can || typeof can !== "object") {
      can = { __typename: "Connection", edges: [], pageInfo: {} };
    } else {
      can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
    }

    if (op.kind === "canAddNode") {
      upsertCanonicalEdgeAnchored(graph, op.canKey, can, op.entityKey, op.meta, op.position, op.anchor);
      graph.putRecord(op.canKey, can);
      return;
    }
    if (op.kind === "canRemoveNode") {
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

  // Write-through writers (commit(data) pass)
  const wtEntityWrite = (recordId: string, patch: Record<string, any>, policy: "merge" | "replace") => {
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

  const wtEntityDelete = (recordId: string) => {
    graph.removeRecord(recordId);
  };

  const wtCanonAdd = (canKey: string, entityKey: string, meta: any, position: "start" | "end" | "before" | "after", anchor?: string | null) => {
    let can = graph.getRecord(canKey);
    if (!can || typeof can !== "object") can = { __typename: "Connection", edges: [], pageInfo: {} };
    else can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
    upsertCanonicalEdgeAnchored(graph, canKey, can, entityKey, meta, position, anchor);
    graph.putRecord(canKey, can);
  };

  const wtCanonRemove = (canKey: string, entityKey: string) => {
    let can = graph.getRecord(canKey);
    if (!can || typeof can !== "object") can = { __typename: "Connection", edges: [], pageInfo: {} };
    else can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
    removeCanonicalEdge(graph, canKey, can, entityKey);
    graph.putRecord(canKey, can);
  };

  const wtCanonPatch = (canKey: string, patch: Record<string, any>) => {
    const prev = graph.getRecord(canKey) || { __typename: "Connection", edges: [], pageInfo: {} };
    const p = patch || {};
    const next: any = { ...prev };
    if (p.pageInfo && typeof p.pageInfo === "object") {
      next.pageInfo = { ...(prev.pageInfo || {}), ...(p.pageInfo as any) };
    }
    for (const k of Object.keys(p)) {
      if (k === "pageInfo") continue;
      next[k] = (p as any)[k];
    }
    graph.putRecord(canKey, next);
  };

  /* -------------------------------- modifyOptimistic -------------------------------- */
  function modifyOptimistic(builder: (tx: BuilderAPI, ctx: BuilderCtx) => void) {
    const layer: Layer = {
      id: nextId++,
      entityOps: [],
      canOps: [],
      touched: new Set(),
      localBase: new Map(),
      builder,
    };

    const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
      if (typeof parent === "string") return parent === "Query" ? ROOT_ID : parent;
      return (parent as any) === "Query" ? ROOT_ID : (graph.identify(parent) || ROOT_ID);
    };

    const makeAPI = (recording: boolean): BuilderAPI => ({
      patch(target, patchOrFn, opts) {
        const mode = (opts?.mode ?? "merge") as "merge" | "replace";
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;
        const prev = graph.getRecord(recordId) || {};
        const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(cloneJSON(prev)) : patchOrFn;
        if (!delta || typeof delta !== "object") return;

        if (recording) {
          layer.entityOps.push({ kind: "entityWrite", recordId, patch: { ...delta }, policy: mode });
          recEntityWrite(layer, recordId, { ...delta }, mode);
        } else {
          wtEntityWrite(recordId, { ...delta }, mode);
        }
      },

      delete(target) {
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;

        if (recording) {
          layer.entityOps.push({ kind: "entityDelete", recordId });
          recEntityDelete(layer, recordId);
        } else {
          wtEntityDelete(recordId);
        }
      },

      connection(input: ConnectionArgs | string) {
        const canKey =
          typeof input === "string"
            ? input
            : (() => {
              const parentId = resolveParentId(input.parent);
              const filters = input.filters || {};
              return buildConnectionCanonicalKey(
                {
                  fieldName: input.key,
                  buildArgs: (v: any) => v || {},
                  connectionFilters: Object.keys(filters),
                } as any,
                parentId,
                filters
              );
            })();

        const ensureEntity = (node: any): string | null => {
          const entityKey = graph.identify(node);
          if (!entityKey) return null;

          const patch: any = { ...node };
          delete patch.__typename;
          delete patch.id;

          if (recording) {
            layer.entityOps.push({ kind: "entityWrite", recordId: entityKey, patch, policy: "merge" });
            recEntityWrite(layer, entityKey, patch, "merge");
          } else {
            wtEntityWrite(entityKey, patch, "merge");
          }
          return entityKey;
        };

        const resolveAnchorKey = (anchor?: string | { __typename: string; id: any } | null): string | null => {
          if (!anchor) return null;
          if (typeof anchor === "string") return anchor;
          return graph.identify(anchor) || null;
        };

        return {
          addNode(node, opts = {}) {
            const entityKey = ensureEntity(node);
            if (!entityKey) return;

            const meta = shallowEdgeMeta(opts.edge);
            const position = (opts.position ?? "end") as "start" | "end" | "before" | "after";
            const anchor = resolveAnchorKey(opts.anchor);

            if (recording) {
              const op: CanonOp = { kind: "canAddNode", canKey, entityKey, meta, position, anchor };
              layer.canOps.push(op);
              recCanonOp(layer, op);
            } else {
              wtCanonAdd(canKey, entityKey, meta, position, anchor);
            }
          },

          removeNode(ref) {
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;

            if (recording) {
              const op: CanonOp = { kind: "canRemoveNode", canKey, entityKey };
              layer.canOps.push(op);
              recCanonOp(layer, op);
            } else {
              wtCanonRemove(canKey, entityKey);
            }
          },

          patch(patchOrFn) {
            const prev = graph.getRecord(canKey) || {};
            const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(cloneJSON(prev)) : patchOrFn;
            if (!delta || typeof delta !== "object") return;

            if (recording) {
              const op: CanonOp = { kind: "canPatch", canKey, patch: { ...delta } };
              layer.canOps.push(op);
              recCanonOp(layer, op);
            } else {
              wtCanonPatch(canKey, { ...delta });
            }
          },

          key: canKey,
        };
      },
    });

    // optimistic pass
    const optimisticAPI = makeAPI(true);
    pending.add(layer);
    layer.builder(optimisticAPI, { phase: "optimistic" });

    return {
      /**
       * commit(data?):
       * Always finalize this layer:
       *  - Undo this layer’s entity diffs (localBase)
       *  - Invert this layer’s canonical ops (reverse order)
       *  - Clear buffers
       *  - Write-through once with { phase:'commit', data } (data optional)
       *  - Drop this layer
       */
      commit(data?: any) {
        // ENTITIES → undo to local base
        for (const [id, snap] of layer.localBase) {
          if (isCanonicalKey(id)) continue;
          if (snap === null) graph.removeRecord(id);
          else replaceInPlace(id, snap);
        }

        // CANONICAL → inverse ops in reverse order
        for (let i = layer.canOps.length - 1; i >= 0; i--) {
          const op = layer.canOps[i];
          const canKey = op.canKey;

          let can = graph.getRecord(canKey);
          if (!can || typeof can !== "object") {
            can = { __typename: "Connection", edges: [], pageInfo: {} };
          } else {
            can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
          }

          if (op.kind === "canAddNode") {
            removeCanonicalEdge(graph, canKey, can, op.entityKey);
            graph.putRecord(canKey, can);
            continue;
          }

          if (op.kind === "canRemoveNode") {
            const base = layer.localBase.get(canKey) || {};
            const baseEdges: Array<{ __ref: string }> | undefined = base.edges;
            const edgeRef = edgeRefForNodeInEdges(graph, baseEdges, op.entityKey);
            if (edgeRef) {
              const wantIndex = indexOfEdgeRef(baseEdges, edgeRef);
              const exists = indexOfEdgeRef(can.edges, edgeRef) >= 0;
              if (!exists) {
                const insertAt = Math.max(0, Math.min(wantIndex, (can.edges as any[]).length));
                (can.edges as any[]).splice(insertAt, 0, { __ref: edgeRef });
                graph.putRecord(canKey, can);
              }
            } else {
              upsertCanonicalEdgeAnchored(graph, canKey, can, op.entityKey, undefined, "end", null);
              graph.putRecord(canKey, can);
            }
            continue;
          }

          if (op.kind === "canPatch") {
            const base = layer.localBase.get(canKey) || {};
            const reverted: any = { ...can };
            for (const k of Object.keys(op.patch)) {
              if (k === "pageInfo") {
                const piPatch = (op.patch as any).pageInfo || {};
                reverted.pageInfo = { ...(reverted.pageInfo || {}) };
                for (const pk of Object.keys(piPatch)) {
                  const baseVal = base?.pageInfo ? (base.pageInfo as any)[pk] : undefined;
                  if (baseVal === undefined) delete reverted.pageInfo[pk];
                  else reverted.pageInfo[pk] = baseVal;
                }
              } else {
                const baseVal = (base as any)[k];
                if (baseVal === undefined) delete reverted[k];
                else reverted[k] = baseVal;
              }
            }
            graph.putRecord(canKey, reverted);
            continue;
          }
        }

        // Clear buffers then write-through final
        layer.localBase.clear();
        layer.entityOps.length = 0;
        layer.canOps.length = 0;
        layer.touched.clear();

        const wtAPI = makeAPI(false);
        layer.builder(wtAPI, { phase: "commit", data });

        // Drop this layer
        pending.delete(layer);
      },

      /**
       * revert():
       * Only for live layers — undo entities from localBase and inverse canonical ops, then drop.
       */
      revert() {
        if (!pending.delete(layer)) return;

        // ENTITIES
        for (const [id, snap] of layer.localBase) {
          if (isCanonicalKey(id)) continue;
          if (snap === null) graph.removeRecord(id);
          else replaceInPlace(id, snap);
        }

        // CANONICAL inverse
        for (let i = layer.canOps.length - 1; i >= 0; i--) {
          const op = layer.canOps[i];
          const canKey = op.canKey;

          let can = graph.getRecord(canKey);
          if (!can || typeof can !== "object") {
            can = { __typename: "Connection", edges: [], pageInfo: {} };
          } else {
            can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
          }

          if (op.kind === "canAddNode") {
            removeCanonicalEdge(graph, canKey, can, op.entityKey);
            graph.putRecord(canKey, can);
            continue;
          }

          if (op.kind === "canRemoveNode") {
            const base = layer.localBase.get(canKey) || {};
            const baseEdges: Array<{ __ref: string }> | undefined = base.edges;
            const edgeRef = edgeRefForNodeInEdges(graph, baseEdges, op.entityKey);
            if (edgeRef) {
              const wantIndex = indexOfEdgeRef(baseEdges, edgeRef);
              const exists = indexOfEdgeRef(can.edges, edgeRef) >= 0;
              if (!exists) {
                const insertAt = Math.max(0, Math.min(wantIndex, (can.edges as any[]).length));
                (can.edges as any[]).splice(insertAt, 0, { __ref: edgeRef });
                graph.putRecord(canKey, can);
              }
            } else {
              upsertCanonicalEdgeAnchored(graph, canKey, can, op.entityKey, undefined, "end", null);
              graph.putRecord(canKey, can);
            }
            continue;
          }

          if (op.kind === "canPatch") {
            const base = layer.localBase.get(canKey) || {};
            const reverted: any = { ...can };
            for (const k of Object.keys(op.patch)) {
              if (k === "pageInfo") {
                const piPatch = (op.patch as any).pageInfo || {};
                reverted.pageInfo = { ...(reverted.pageInfo || {}) };
                for (const pk of Object.keys(piPatch)) {
                  const baseVal = base?.pageInfo ? (base.pageInfo as any)[pk] : undefined;
                  if (baseVal === undefined) delete reverted.pageInfo[pk];
                  else reverted.pageInfo[pk] = baseVal;
                }
              } else {
                const baseVal = (base as any)[k];
                if (baseVal === undefined) delete reverted[k];
                else reverted[k] = baseVal;
              }
            }
            graph.putRecord(canKey, reverted);
            continue;
          }
        }

        layer.localBase.clear();
        layer.entityOps.length = 0;
        layer.canOps.length = 0;
        layer.touched.clear();
      },
    };
  }

  /* -------------------------------- replayOptimistic -------------------------------- */
  function replayOptimistic(hint?: {
    connections?: string[];
    entities?: string[];
  }): { added: string[]; removed: string[] } {
    const conScope = new Set(hint?.connections || []);
    const entScope = new Set(hint?.entities || []);

    const added: string[] = [];
    const removed: string[] = [];

    const applyLayer = (L: Layer) => {
      for (const e of L.entityOps) {
        if (entScope.size && !entScope.has(e.recordId)) continue;
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
        if (conScope.size && !conScope.has(c.canKey)) continue;

        if (c.kind === "canAddNode") {
          added.push(c.entityKey);
          wtCanonAdd(c.canKey, c.entityKey, c.meta, c.position, c.anchor);
        } else if (c.kind === "canRemoveNode") {
          removed.push(c.entityKey);
          wtCanonRemove(c.canKey, c.entityKey);
        } else {
          wtCanonPatch(c.canKey, c.patch);
        }
      }
    };

    for (const L of Array.from(pending).sort((a, b) => a.id - b.id)) applyLayer(L);

    return { added, removed };
  }

  return { modifyOptimistic, replayOptimistic };
};

export type OptimisticInstance = ReturnType<typeof createOptimistic>;
