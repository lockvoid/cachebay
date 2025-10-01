 

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

const shallowEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") return undefined;
  const out: any = {};
  for (const k of Object.keys(meta)) {
    if (k === "cursor") continue; // ignore cursor
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

const findAnchorIndex = (graph: GraphDeps, canSnap: any, anchorKey: string): number => {
  const edges = Array.isArray(canSnap?.edges) ? canSnap.edges : [];
  // 1) exact match by node.__ref
  for (let i = 0; i < edges.length; i++) {
    const ref = edges[i]?.__ref;
    if (!ref) continue;
    const e = graph.getRecord(ref);
    if (e?.node?.__ref === anchorKey) return i;
  }
  // 2) fallback by node.id
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

// upsert with anchor
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

  // dedupe by node; refresh meta if present
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

  // create edge record
  const idx = nextEdgeIndex(canKey, canSnap);
  const edgeKey = `${canKey}.edges.${idx}`;
  const nodeType = (entityKey.split(":")[0] || "").trim();
  const edgeTypename = nodeType ? `${nodeType}Edge` : "Edge";

  graph.putRecord(edgeKey, { __typename: edgeTypename, node: { __ref: entityKey }, ...(edgeMeta || {}) });
  const ref = { __ref: edgeKey };

  if (position === "start") return void edges.unshift(ref);
  if (position === "end") return void edges.push(ref);

  // before/after with anchor
  let insertAt = -1;
  if (anchorKey) insertAt = findAnchorIndex(graph, canSnap, anchorKey);
  if (insertAt < 0) {
    if (position === "before") edges.unshift(ref); // fallback to start
    else edges.push(ref);                           // fallback to end
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

/* ────────────────────────────────────────────────────────────────────────────
 * Canonical reconstruction helpers (for revert)
 * -------------------------------------------------------------------------- */
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

  const nextEdges: Array<{ __ref: string }> = [];
  const seenNode = new Set<string>();

  if (ordered.length > 0) {
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
  }

  graph.putRecord(canKey, { edges: nextEdges });
};

/* ────────────────────────────────────────────────────────────────────────────
 * Main
 * -------------------------------------------------------------------------- */
export const createOptimistic = ({ graph }: Deps) => {
  const baseSnap = new Map<string, any | null>();
  const committed: Layer[] = [];
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

  const applyEntityWrite = (L: Layer, recordId: string, patch: Record<string, any>, policy: "merge" | "replace") => {
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

  /* -------------------------------- modifyOptimistic -------------------------------- */
  function modifyOptimistic(build: (tx: BuilderAPI) => void) {
    const layer: Layer = { id: nextId++, entityOps: [], canOps: [], touched: new Set() };
    pending.add(layer);

    const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
      if (typeof parent === "string") return parent === "Query" ? ROOT_ID : parent;
      return parent as any === "Query" ? ROOT_ID : (graph.identify(parent) || ROOT_ID);
    };

    const api: BuilderAPI = {
      patch(target, patchOrFn, opts) {
        const mode = (opts?.mode ?? "merge") as "merge" | "replace";
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;

        const prev = graph.getRecord(recordId) || {};
        const delta = typeof patchOrFn === "function" ? (patchOrFn as any)(cloneJSON(prev)) : patchOrFn;
        if (!delta || typeof delta !== "object") return;

        layer.entityOps.push({ kind: "entityWrite", recordId, patch: { ...delta }, policy: mode });
        applyEntityWrite(layer, recordId, { ...delta }, mode);
      },

      delete(target) {
        const recordId = typeof target === "string" ? target : (graph.identify(target) || null);
        if (!recordId) return;
        layer.entityOps.push({ kind: "entityDelete", recordId });
        applyEntityDelete(layer, recordId);
      },

      connection({ parent, key, filters = {} }) {
        const parentId = resolveParentId(parent);
        const canKey = buildConnectionCanonicalKey(
          { fieldName: key, buildArgs: (v: any) => v || {}, connectionFilters: Object.keys(filters) } as any,
          parentId,
          filters,
        );

        const ensureEntity = (node: any): string | null => {
          const ek = graph.identify(node);
          if (!ek) return null;
          const patch: any = { ...node }; delete patch.__typename; delete patch.id;
          layer.entityOps.push({ kind: "entityWrite", recordId: ek, patch, policy: "merge" });
          applyEntityWrite(layer, ek, patch, "merge");
          return ek;
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

            const op: CanonOp = {
              kind: "canAddNode",
              canKey,
              entityKey,
              meta: shallowEdgeMeta(opts.edge),
              position: (opts.position ?? "end") as "start" | "end" | "before" | "after",
              anchor: resolveAnchorKey(opts.anchor),
            };
            layer.canOps.push(op);
            applyCanonOp(layer, op);
          },

          removeNode(ref) {
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;
            const op: CanonOp = { kind: "canRemoveNode", canKey, entityKey };
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
        if (isCanonicalKey(id)) continue; // never reset canonical directly
        if (snap === null) graph.removeRecord(id);
        else replaceInPlace(id, snap);
      }
    };

    const reapplyLayers = () => {
      for (const L of committed) {
        for (const e of L.entityOps) {
          if (e.kind === "entityWrite") applyEntityWrite(L, e.recordId, e.patch, e.policy);
          else applyEntityDelete(L, e.recordId);
        }
        for (const c of L.canOps) applyCanonOp(L, c);
      }
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
        const inPending = pending.delete(layer);
        if (!inPending) {
          const idx = committed.findIndex((L) => L.id === layer.id);
          if (idx >= 0) committed.splice(idx, 1);
        }
        resetToBase();
        reconstructAllTouchedCanonicals(layer.id);
        reapplyLayers();
        cleanupIfIdle();
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
    const scopeConnections = conScope.size > 0;
    const scopeEntities = entScope.size > 0;

    if (committed.length === 0 && pending.size === 0) {
      return { added: [], removed: [] };
    }

    const added: string[] = [];
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

        if (c.kind === "canAddNode") {
          added.push(c.entityKey);
          let can = graph.getRecord(c.canKey);
          if (!can || typeof can !== "object") can = { __typename: "Connection", edges: [], pageInfo: {} };
          else can = { ...can, edges: Array.isArray(can.edges) ? [...can.edges] : [], pageInfo: { ...(can.pageInfo || {}) } };
          upsertCanonicalEdgeAnchored(graph, c.canKey, can, c.entityKey, c.meta, c.position, c.anchor);
          graph.putRecord(c.canKey, can);
        } else if (c.kind === "canRemoveNode") {
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

    return { added, removed };
  }

  return { modifyOptimistic, replayOptimistic };
};

export type OptimisticInstance = ReturnType<typeof createOptimistic>;
