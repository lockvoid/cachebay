/* src/features/optimistic.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ROOT_ID } from "@/src/core/constants";
import { buildConnectionIdentity } from "@/src/core/utils"; // <— use your util

type GraphDeps = {
  identify: (obj: any) => string | null;
  getRecord: (recordId: string) => any | undefined;
  putRecord: (recordId: string, partialSnapshot: Record<string, any>) => void;
  removeRecord: (recordId: string) => void;
  keys: () => string[]; // enumerate graph record keys
};

type Deps = { graph: GraphDeps };

/** Deep clone JSON-safe (records are JSONy). */
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

const isCursorArg = (k: string) => k === "after" || k === "before" || k === "first" || k === "last";

/** Find next free numeric edge index on a page. */
const nextEdgeIndex = (pageKey: string, page: any): number => {
  if (!Array.isArray(page?.edges) || page.edges.length === 0) return 0;
  let maxIdx = -1;
  for (let i = 0; i < page.edges.length; i++) {
    const ref = page.edges[i]?.__ref;
    if (!ref) continue;
    const m = ref.match(/\.edges\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n) && n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
};

/** Insert/replace by entity ref; position "start"/"end". */
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

  // Update if present
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
  const idx = nextEdgeIndex(pageKey, page);
  const edgeKey = `${pageKey}.edges.${idx}`;
  graph.putRecord(edgeKey, {
    cursor: cursor ?? null,
    ...(edgeMeta || {}),
    node: { __ref: entityKey },
  });

  const ref = { __ref: edgeKey };
  if (position === "start") edges.unshift(ref);
  else edges.push(ref);
};

/** Remove first occurrence by entity key on page. */
const removeEdgeByEntityKey = (graph: GraphDeps, pageKey: string, page: any, entityKey: string) => {
  const edges = Array.isArray(page.edges) ? page.edges : [];
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

/** Parse args JSON from "...(<json>)" pageKey */
const argsFromPageKey = (k: string): Record<string, any> | null => {
  const m = k.match(/\((.*)\)$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

type EntityOp =
  | { kind: "entityWrite"; recordId: string; patch: Record<string, any> }
  | { kind: "entityDelete"; recordId: string };

type ConnOp =
  | { kind: "connAdd"; pageKey: string; entityKey: string; cursor: string | null; meta?: any; position: "start" | "end" }
  | { kind: "connRemove"; pageKey: string; entityKey: string }
  | { kind: "connPageInfo"; pageKey: string; patch: Record<string, any> };

type Layer = { id: number; entityOps: EntityOp[]; connOps: ConnOp[] };

type ConnectionArgs = {
  /** Provide explicit pageKey (no guessing). */
  pageKey: string;
};

type ConnectionsArgs = {
  /** Parent can be "Query", a record id string, or an { __typename, id } object. */
  parent: "Query" | string | { __typename?: string; id?: any };
  /** Field name (e.g., "posts"). */
  field: string;
  /** Identity args (non-cursor args). Cursor args in here are ignored for identity. */
  variables?: Record<string, any>;
};

type BuilderAPI = {
  patch: (entityOrPartial: any, policy?: "merge" | "replace") => void;
  delete: (entityRefOrRecordId: any) => void;

  connection: (
    args: ConnectionArgs
  ) => Readonly<[{
    addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
    removeNode: (ref: { __typename?: string; id?: any } | string) => void;
    patch: (pageInfoPatch: Record<string, any>) => void;
    pageKey: string;
  }]>;

  connections: (
    args: ConnectionsArgs
  ) => Readonly<[{
    addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
    removeNode: (ref: { __typename?: string; id?: any } | string) => void;
    patch: (pageInfoPatch: Record<string, any>) => void;
    /** The chosen pageKey resolved for this family (for debugging) */
    pageKey: () => string | undefined;
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

  const applyEntityWrite = (
    recordId: string,
    patch: Record<string, any>,
    policy: "merge" | "replace"
  ) => {
    captureBase(recordId);

    const existing = graph.getRecord(recordId);
    const [typename, id] = recordId.split(":", 2);

    if (!existing) {
      graph.putRecord(recordId, { __typename: typename, id, ...patch });
      return;
    }

    if (policy === "replace") {
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
    captureBase(op.pageKey);
    let page = graph.getRecord(op.pageKey);
    if (!page || typeof page !== "object") {
      page = { __typename: "Connection", edges: [], pageInfo: {} };
    } else {
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
    for (const L of committed) {
      if (reverted.has(L.id)) continue;
      for (const e of L.entityOps) {
        if (e.kind === "entityWrite") applyEntityWrite(e.recordId, e.patch, "merge");
        else applyEntityDelete(e.recordId);
      }
      for (const c of L.connOps) applyConnOp(c);
    }
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

  // ————————————————— helpers to resolve family pages and pick one
  const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
    if (typeof parent === "string") return parent === "Query" ? ROOT_ID : parent;
    return parent === "Query" ? ROOT_ID : (graph.identify(parent) || ROOT_ID);
  };

  const findFamilyPageKeys = (
    parentId: string,
    field: string,
    identityVars: Record<string, any> = {}
  ): string[] => {
    // strategy: rebuild the identity marker and match keys via comparing non-cursor arg subset
    const all = graph.keys();
    const prefix = parentId === ROOT_ID ? "@." : `@.${parentId}.`;
    const out: string[] = [];

    for (let i = 0; i < all.length; i++) {
      const k = all[i];
      if (!k.startsWith(prefix)) continue;
      if (!k.includes(`.${field}(`)) continue;

      const args = argsFromPageKey(k);
      if (!args || typeof args !== "object") continue;

      const pageIdentity: any = {};
      for (const key of Object.keys(args)) if (!isCursorArg(key)) pageIdentity[key] = args[key];

      const reqIdentity: any = {};
      for (const key of Object.keys(identityVars || {})) if (!isCursorArg(key)) reqIdentity[key] = identityVars[key];

      // compare JSON directly; keys are stable in our store
      if (JSON.stringify(pageIdentity) === JSON.stringify(reqIdentity)) {
        out.push(k);
      }
    }
    return out;
  };

  const chooseFamilyTarget = (
    pageKeys: string[],
    position: "start" | "end"
  ): string | undefined => {
    if (pageKeys.length === 0) return undefined;

    // Extract "after" arg from each page
    const withAfter = pageKeys.map((k) => {
      const a = argsFromPageKey(k);
      return { key: k, after: a ? a.after ?? null : null };
    });

    if (position === "start") {
      // prefer the page with after === null; else the first in list
      const root = withAfter.find((x) => x.after === null);
      return (root?.key) || withAfter[0]?.key;
    }

    // position === "end" → pick the page that looks like the "tail"
    // choose the lexicographically greatest non-null `after`, else the last in list
    const nonNull = withAfter.filter((x) => x.after != null);
    if (nonNull.length > 0) {
      nonNull.sort((a, b) => String(a.after).localeCompare(String(b.after)));
      return nonNull[nonNull.length - 1].key;
    }
    return withAfter[withAfter.length - 1]?.key;
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

      connection(args: ConnectionArgs) {
        const pageKey = args.pageKey;
        const handle = {
          addNode: (
            node: any,
            opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}
          ) => {
            const entityKey = graph.identify(node);
            if (!entityKey) return;

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

      connections(args: ConnectionsArgs) {
        const parentId = resolveParentId(args.parent);
        const identityKey = buildConnectionIdentity(
          // Faux PlanField-like minimal shape for identity extraction:
          {
            fieldName: args.field,
            buildArgs: (v: any) => v || {},
            connectionArgs: Object.keys(args.variables || {}).filter((k) => !isCursorArg(k)),
          } as any,
          parentId,
          args.variables || {}
        );
        // Discover pages in this family by scanning keys & comparing arg subset
        const familyPages = findFamilyPageKeys(parentId, args.field, args.variables || {});
        let chosen: string | undefined;

        const handle = {
          addNode: (
            node: any,
            opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}
          ) => {
            if (!familyPages.length) return;
            const targetKey = (chosen ||= chooseFamilyTarget(familyPages, opts.position === "start" ? "start" : "end"));
            if (!targetKey) return;

            const entityKey = graph.identify(node);
            if (!entityKey) return;

            const entityPatch: any = { ...node };
            delete entityPatch.__typename; delete entityPatch.id;
            layer.entityOps.push({ kind: "entityWrite", recordId: entityKey, patch: entityPatch });
            applyEntityWrite(entityKey, entityPatch, "merge");

            const op: ConnOp = {
              kind: "connAdd",
              pageKey: targetKey,
              entityKey,
              cursor: opts.cursor ?? null,
              meta: shallowEdgeMeta(opts.edge),
              position: opts.position === "start" ? "start" : "end",
            };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          removeNode: (ref: { __typename?: string; id?: any } | string) => {
            if (!familyPages.length) return;
            // Prefer chosen page if already chosen; else find the first page containing the node
            const entityKey = typeof ref === "string" ? ref : (graph.identify(ref) || null);
            if (!entityKey) return;

            let target = chosen;
            if (!target) {
              for (let i = 0; i < familyPages.length; i++) {
                const pageKey = familyPages[i];
                const page = graph.getRecord(pageKey);
                if (page && removeEdgeByEntityKey(graph, pageKey, { ...page, edges: [...(page.edges || [])] }, entityKey)) {
                  target = pageKey;
                  break;
                }
              }
            }
            // If still not found, fallback to first family page
            const targetKey = (chosen ||= target || familyPages[0]);

            const op: ConnOp = { kind: "connRemove", pageKey: targetKey, entityKey };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          patch: (pageInfoPatch: Record<string, any>) => {
            if (!familyPages.length || !pageInfoPatch || typeof pageInfoPatch !== "object") return;
            const targetKey = (chosen ||= chooseFamilyTarget(familyPages, "end") || familyPages[0]);
            const op: ConnOp = { kind: "connPageInfo", pageKey: targetKey, patch: { ...pageInfoPatch } };
            layer.connOps.push(op);
            applyConnOp(op);
          },

          pageKey: () => chosen,
        } as const;

        return [handle] as const;
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
