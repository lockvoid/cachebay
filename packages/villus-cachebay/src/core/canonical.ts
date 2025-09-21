/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import { buildConnectionCanonicalKey } from "./utils";

/* ────────────────────────────────────────────────────────────────────────── */
/* Factory                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export type CanonicalDeps = { graph: GraphInstance };
export type CanonicalInstance = ReturnType<typeof createCanonical>;

export const createCanonical = ({ graph }: CanonicalDeps) => {
  /** Get the node ref for an edge record ref. */
  const nodeRefOf = (edgeRef: string): string | null => {
    const e = graph.getRecord(edgeRef);
    const nref = e?.node?.__ref;
    return typeof nref === "string" ? nref : null;
  };

  /** Copy cursor and any extra edge meta (but not node) from `src` edge to `dst` edge. */
  const refreshEdgeMeta = (dstEdgeRef: string, srcEdgeRef: string) => {
    const src = graph.getRecord(srcEdgeRef) || {};
    const patch: Record<string, any> = {};
    for (const k of Object.keys(src)) {
      if (k === "node") continue; // never overwrite node
      patch[k] = src[k];
    }
    if (Object.keys(patch).length) graph.putRecord(dstEdgeRef, patch);
  };

  /** Append page edges into canonical, deduping by node ref; update meta in place when duplicate. */
  const appendByNode = (
    dst: Array<{ __ref: string }>,
    add: Array<{ __ref: string }>
  ) => {
    const pos = new Map<string, number>(); // nodeRef -> existing index
    for (let i = 0; i < dst.length; i++) {
      const eref = dst[i]?.__ref;
      if (!eref) continue;
      const nref = nodeRefOf(eref);
      if (nref) pos.set(nref, i);
    }

    for (let i = 0; i < add.length; i++) {
      const aref = add[i]?.__ref;
      if (!aref) continue;
      const nref = nodeRefOf(aref);
      if (!nref) continue;
      const at = pos.get(nref);
      if (at != null) {
        refreshEdgeMeta(dst[at].__ref, aref);
      } else {
        dst.push({ __ref: aref });
        pos.set(nref, dst.length - 1);
      }
    }
  };

  /** Prepend page edges into canonical, deduping by node ref; update meta in place when duplicate. */
  const prependByNode = (
    dst: Array<{ __ref: string }>,
    add: Array<{ __ref: string }>
  ) => {
    const pos = new Map<string, number>(); // nodeRef -> existing index
    for (let i = 0; i < dst.length; i++) {
      const eref = dst[i]?.__ref;
      if (!eref) continue;
      const nref = nodeRefOf(eref);
      if (nref) pos.set(nref, i);
    }

    const front: Array<{ __ref: string }> = [];
    for (let i = 0; i < add.length; i++) {
      const aref = add[i]?.__ref;
      if (!aref) continue;
      const nref = nodeRefOf(aref);
      if (!nref) continue;
      const at = pos.get(nref);
      if (at != null) {
        refreshEdgeMeta(dst[at].__ref, aref);
      } else {
        front.push({ __ref: aref });
        pos.set(nref, -1);
      }
    }

    if (front.length) dst.unshift(...front);
  };

  const detectCursorRole = (
    field: PlanField,
    requestVars: Record<string, any>
  ): { hasAfter: boolean; hasBefore: boolean; isLeader: boolean } => {
    const reqArgs = field.buildArgs(requestVars) || {};
    let hasAfter = "after" in reqArgs && reqArgs.after != null;
    let hasBefore = "before" in reqArgs && reqArgs.before != null;

    // Loose fallback: accept variables whose names "look like" after/before
    if (!hasAfter) {
      for (const k of Object.keys(requestVars)) {
        if (k.toLowerCase().includes("after") && requestVars[k] != null) { hasAfter = true; break; }
      }
    }
    if (!hasBefore) {
      for (const k of Object.keys(requestVars)) {
        if (k.toLowerCase().includes("before") && requestVars[k] != null) { hasBefore = true; break; }
      }
    }

    return { hasAfter, hasBefore, isLeader: !hasAfter && !hasBefore };
  };

  /** Public: update the canonical connection record for a page write. */
  const updateConnection = (args: {
    field: PlanField;
    parentRecordId: string;
    requestVars: Record<string, any>;
    pageKey: string;
    pageSnap: Record<string, any>;
    pageEdgeRefs: Array<{ __ref: string }>;
  }) => {
    const { field, parentRecordId, requestVars, pageKey, pageSnap, pageEdgeRefs } = args;

    const canonicalKey = buildConnectionCanonicalKey(field, parentRecordId, requestVars);
    const mode = field.connectionMode || "page";

    const current = graph.getRecord(canonicalKey) || {
      __typename: pageSnap.__typename || "Connection",
      edges: [] as Array<{ __ref: string }>,
      pageInfo: {},
    };

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, requestVars);

    let nextEdges: Array<{ __ref: string }> = Array.isArray(current.edges) ? current.edges.slice() : [];
    let nextPageInfo: Record<string, any> | undefined;
    const extrasPatch: Record<string, any> = {};

    if (mode === "infinite") {
      if (isLeader) {
        nextEdges = pageEdgeRefs.slice();
        if (pageSnap.pageInfo) nextPageInfo = { ...(pageSnap.pageInfo as any) };
        for (const k of Object.keys(pageSnap)) {
          if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
          extrasPatch[k] = (pageSnap as any)[k];
        }
      } else if (hasBefore) {
        const tmp = nextEdges.slice();
        prependByNode(tmp, pageEdgeRefs);
        nextEdges = tmp;
        nextPageInfo = pageSnap.pageInfo ? { ...(pageSnap.pageInfo as any) } : {};
      } else if (hasAfter) {
        const tmp = nextEdges.slice();
        appendByNode(tmp, pageEdgeRefs);
        nextEdges = tmp;
        nextPageInfo = pageSnap.pageInfo ? { ...(pageSnap.pageInfo as any) } : {};
      }
    } else {
      // mode === 'page' → always the last fetched page
      nextEdges = pageEdgeRefs.slice();
      if (pageSnap.pageInfo) nextPageInfo = { ...(pageSnap.pageInfo as any) };
      for (const k of Object.keys(pageSnap)) {
        if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
        extrasPatch[k] = (pageSnap as any)[k];
      }
    }

    const patch: any = {
      __typename: current.__typename || pageSnap.__typename || "Connection",
      edges: nextEdges,
    };
    if (nextPageInfo) patch.pageInfo = nextPageInfo;
    for (const k of Object.keys(extrasPatch)) patch[k] = extrasPatch[k];

    graph.putRecord(canonicalKey, patch);
  };

  return { updateConnection };
};
