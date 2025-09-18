/* src/features/optimistic.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROOT_ID } from "@/src/core/constants";
import { buildConnectionKey } from "@/src/core/utils";
import type { PlanField } from "@/src/compiler";

type GraphDeps = {
  identify: (obj: any) => string | null;
  getRecord: (recordId: string) => any | undefined;
  putRecord: (recordId: string, partialSnapshot: Record<string, any>) => void;
  removeRecord: (recordId: string) => void;
};

type Deps = { graph: GraphDeps };

/** Deep clone JSON-safe (records are JSONy by construction). */
const cloneJSON = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

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

/** Find next free numeric index suffix for edge records, fallback to a big monotonic index. */
const nextEdgeIndex = (pageKey: string, page: any): number => {
  if (!Array.isArray(page?.edges) || page.edges.length === 0) return 0;
  let maxIdx = -1;
  for (let i = 0; i < page.edges.length; i++) {
    const ref = page.edges[i]?.__ref;
    if (!ref) continue;
    // parse trailing ".<num>"
    const m = ref.match(/\.edges\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
};

/** Insert or replace by entity ref; position can be "start" or "end". */
const upsertEdgeRef = (
  graph: GraphDeps,
  pageKey: string,
  page: any,
  entityKey: string,
  cursor: string | null,
  edgeMeta?: any,
  position: "start" | "end" = "end"
) => {
  const edges = Array.isArray(page.edges) ? page.edges : (page.edges = []);

  // Update existing if present
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

  // Create a new edge record
  const idx = nextEdgeIndex(pageKey, page);
  const edgeKey = `${pageKey}.edges.${idx}`;
  graph.putRecord(edgeKey, {
    cursor: cursor ?? null,
    ...(edgeMeta || {}),
    node: { __ref: entityKey },
  });

  const ref = { __ref: edgeKey };
  if (position === "start") {
    edges.unshift(ref);
  } else {
    edges.push(ref);
  }
};

/** Remove first occurrence by entity key. */
const removeEdgeByEntityKey = (graph: GraphDeps, pageKey: string, page: any, entityKey: string) => {
  const edges = Array.isArray(page.edges) ? page.edges : [];
  for (let i = 0; i < edges.length; i++) {
    const edgeRef = edges[i]?.__ref;
    if (!edgeRef) continue;
    const edgeRec = graph.getRecord(edgeRef);
    if (edgeRec?.node?.__ref === entityKey) {
      edges.splice(i, 1);
      // optional: do not delete the edge record; it could be reused later
      return;
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Transactional optimistic API
// ─────────────────────────────────────────────────────────────────────────────

type EntityOp =
  | { kind: "entityWrite"; recordId: string; patch: Record<string, any> }
  | { kind: "entityDelete"; recordId: string };

type ConnOp =
  | {
    kind: "connAdd";
    pageKey: string;
    entityKey: string;
    cursor: string | null;
    meta?: any;
    position: "start" | "end";
  }
  | { kind: "connRemove"; pageKey: string; entityKey: string }
  | { kind: "connPageInfo"; pageKey: string; patch: Record<string, any> };

type Layer = { id: number; entityOps: EntityOp[]; connOps: ConnOp[] };

type ConnectionsByPageArgs =
  | {
    /** Provide an explicit pageKey (best if you know exactly which page to touch). */
    pageKey: string;
  }
  | {
    /** Build the pageKey from parent + compiled field + variables. */
    parent: "Query" | string | { __typename?: string; id?: any };
    field: PlanField; // from compiler
    variables: Record<string, any>;
  };

// Builder API
type BuilderAPI = {
  /** Patch entity record (entity object or recordId). */
  patch: (entityOrPartial: any, policy?: "merge" | "replace") => void;
  /** Delete entity record (by entity ref or recordId). */
  delete: (entityRefOrRecordId: any) => void;

  /**
   * Connection editor for a specific page:
   *   - addNode: insert or replace node edge on this page
   *   - removeNode: remove a node edge on this page
   *   - patch: patch pageInfo on this page
   */
  connection: (
    args: ConnectionsByPageArgs
  ) => Readonly<[{
    addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
    removeNode: (ref: { __typename?: string; id?: any } | string) => void;
    patch: (pageInfoPatch: Record<string, any>) => void;
    pageKey: string;
  }]>;
};

export const createModifyOptimistic = ({ graph }: Deps) => {
  const baseSnap = new Map<string, any | null>(); // recordId → snapshot|null
  const committed: Layer[] = [];
  const pending = new Set<Layer>();
  const reverted = new Set<number>();
  let nextId = 1;

  const captureBase = (recordId: string) => {
    if (baseSnap.has(recordId)) return;
    const prev = graph.getRecord(recordId);
    baseSnap.set(recordId, prev ? cloneJSON(prev) : null);
  };

  const applyEntityWrite = (recordId: string, patch: Record<string, any>, policy: "merge" | "replace") => {
    captureBase(recordId);
    if (policy === "replace") {
      // replace: compute next = { ...identityFromRecordId, ...patch }
      const [typename, id] = recordId.split(":", 2);
      graph.putRecord(recordId, { __typename: typename, id, ...patch });
    } else {
      graph.putRecord(recordId, patch);
    }
  };

  const applyEntityDelete = (recordId: string) => {
    captureBase(recordId);
    graph.removeRecord(recordId);
  };

  const applyConnOp = (op: ConnOp) => {
    // ensure page exists
    captureBase(op.pageKey);
    let page = graph.getRecord(op.pageKey);
    if (!page || typeof page !== "object") {
      page = { __typename: page?.__typename || "Connection", edges: [], pageInfo: {} };
    } else {
      // shallow normalize
      page = {
        ...page,
        edges: Array.isArray(page.edges) ? [...page.edges] : [],
        pageInfo: { ...(page.pageInfo || {}) },
      };
    }

    if (op.kind === "connAdd") {
      upsertEdgeRef(graph, op.pageKey, page, op.entityKey, op.cursor, op.meta, op.position);
      graph.putRecord(op.pageKey, page);
      return;
    }

    if (op.kind === "connRemove") {
      removeEdgeByEntityKey(graph, op.pageKey, page, op.entityKey);
      graph.putRecord(op.pageKey, page);
      return;
    }

    if (op.kind === "connPageInfo") {
      const pi = (page.pageInfo ||= {});
      for (const k of Object.keys(op.patch)) {
        const nv = op.patch[k];
        if (pi[k] !== nv) pi[k] = nv;
      }
      graph.putRecord(op.pageKey, page);
      return;
    }
  };

  const resetToBase = () => {
    for (const [id, snap] of baseSnap) {
      if (snap === null) {
        graph.removeRecord(id);
      } else {
        graph.putRecord(id, snap);
      }
    }
  };

  const reapplyLayers = () => {
    // committed (non-reverted)
    for (const L of committed) {
      if (reverted.has(L.id)) continue;
      for (const e of L.entityOps) {
        if (e.kind === "entityWrite") applyEntityWrite(e.recordId, e.patch, "merge");
        else applyEntityDelete(e.recordId);
      }
      for (const c of L.connOps) applyConnOp(c);
    }
    // pending (in id order)
    const pend = Array.from(pending).sort((a, b) => a.id - b.id);
    for (const L of pend) {
      for (const e of L.entityOps) {
        if (e.kind === "entityWrite") applyEntityWrite(e.recordId, e.patch, "merge");
        else applyEntityDelete(e.recordId);
      }
      for (const c of L.connOps) applyConnOp(c);
    }
  };

  const cleanupIfIdle = () => {
    if (committed.length === 0 && pending.size === 0) {
      baseSnap.clear();
      reverted.clear();
    }
  };

  return function modifyOptimistic(build: (tx: BuilderAPI) => void) {
    const layer: Layer = { id: nextId++, entityOps: [], connOps: [] };
    pending.add(layer);

    const api: BuilderAPI = {
      patch(entityOrPartial: any, policy: "merge" | "replace" = "merge") {
        const recordId =
          typeof entityOrPartial === "string"
            ? entityOrPartial
            : (graph.identify(entityOrPartial) || null);

        if (!recordId) return;

        // compute patch (avoid rewriting identity unless replace)
        let patch: Record<string, any>;
        if (typeof entityOrPartial === "string") {
          patch = {};
        } else {
          patch = { ...entityOrPartial };
          delete patch.__typename;
          delete patch.id;
        }

        layer.entityOps.push({ kind: "entityWrite", recordId, patch });
        applyEntityWrite(recordId, patch, policy);
      },

      delete(entityRefOrRecordId: any) {
        const recordId =
          typeof entityRefOrRecordId === "string"
            ? entityRefOrRecordId
            : (graph.identify(entityRefOrRecordId) || null);
        if (!recordId) return;
        layer.entityOps.push({ kind: "entityDelete", recordId });
        applyEntityDelete(recordId);
      },

      connection(args: ConnectionsByPageArgs) {
        // Resolve pageKey
        let pageKey: string;
        if ("pageKey" in args) {
          pageKey = args.pageKey;
        } else {
          const parentId =
            typeof args.parent === "string"
              ? (args.parent === "Query" ? ROOT_ID : args.parent)
              : (args.parent === "Query" ? ROOT_ID : (graph.identify(args.parent) || ROOT_ID));

          pageKey = buildConnectionKey(args.field, parentId, args.variables);
        }

        const handle = {
          addNode: (
            node: any,
            opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}
          ) => {
            const entityKey = graph.identify(node);
            if (!entityKey) return;

            // ensure entity patch (merge)
            const entityPatch: any = { ...node };
            delete entityPatch.__typename; delete entityPatch.id;
            layer.entityOps.push({ kind: "entityWrite", recordId: entityKey, patch: entityPatch });
            applyEntityWrite(entityKey, entityPatch, "merge");

            const op: ConnOp = {
              kind: "connAdd",
              pageKey,
              entityKey,
              cursor: opts.cursor ?? null,
              meta: shallowEdgeMeta(opts.edge),
              position: opts.position === "start" ? "start" : "end",
            };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename?: string; id?: any } | string) => {
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;
            const op: ConnOp = { kind: "connRemove", pageKey, entityKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          patch: (pageInfoPatch: Record<string, any>) => {
            if (!pageInfoPatch || typeof pageInfoPatch !== "object") return;
            const op: ConnOp = { kind: "connPageInfo", pageKey, patch: { ...pageInfoPatch } };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          pageKey,
        } as const;

        return [handle] as const;
      },
    };

    // run builder now
    build(api);

    return {
      commit() {
        if (pending.has(layer)) {
          pending.delete(layer);
          committed.push(layer);
        }
      },

      revert() {
        if (pending.has(layer)) pending.delete(layer);
        const idx = committed.findIndex((L) => L.id === layer.id);
        if (idx >= 0) reverted.add(layer.id);

        resetToBase();
        reapplyLayers();
        cleanupIfIdle();
      },
    };
  };
};
