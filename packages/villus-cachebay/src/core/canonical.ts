/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import { buildConnectionCanonicalKey } from "./utils";

type OptimisticHook = {
  reapplyOptimistic: (hint?: { connections?: string[]; entities?: string[] }) => { inserted: string[]; removed: string[] };
};

export type CanonicalDeps = { graph: GraphInstance; optimistic: OptimisticHook };
export type CanonicalInstance = ReturnType<typeof createCanonical>;

const metaKeyOf = (canKey: string) => `${canKey}::meta`;

type ConnMeta = {
  __typename: "__ConnMeta";
  pages: string[];                       // arrival list (we’ll normalize order on rebuild)
  leader?: string;                       // current leader pageKey if known
  hints?: Record<string, "before" | "after" | "leader">; // per-page order hint
};

export const createCanonical = ({ graph, optimistic }: CanonicalDeps) => {
  const nodeRefOf = (edgeRef: string): string | null => {
    const e = graph.getRecord(edgeRef);
    const nref = e?.node?.__ref;
    return typeof nref === "string" ? nref : null;
  };

  const refreshEdgeMeta = (dstEdgeRef: string, srcEdgeRef: string) => {
    const src = graph.getRecord(srcEdgeRef) || {};
    const patch: Record<string, any> = {};
    for (const k of Object.keys(src)) {
      if (k === "node") continue;
      patch[k] = src[k];
    }
    if (Object.keys(patch).length) graph.putRecord(dstEdgeRef, patch);
  };

  // Build a union by appending new edges, deduping by node
  const appendByNode = (dst: Array<{ __ref: string }>, add: Array<{ __ref: string }>) => {
    const pos = new Map<string, number>();
    for (let i = 0; i < dst.length; i++) {
      const nref = nodeRefOf(dst[i]?.__ref || "");
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

  // Remove all canonical edges that belong to a given page
  const removePageSlice = (edges: Array<{ __ref: string }> | undefined, pageKey: string) => {
    if (!Array.isArray(edges) || edges.length === 0) return [];
    const prefix = `${pageKey}.edges.`;
    return edges.filter((e) => !(typeof e?.__ref === "string" && e.__ref.startsWith(prefix)));
  };

  // Recognize request role from variables
  const detectCursorRole = (field: PlanField, requestVars: Record<string, any>) => {
    const req = field.buildArgs ? (field.buildArgs(requestVars) || {}) : (requestVars || {});
    let hasAfter = req.after != null;
    let hasBefore = req.before != null;

    if (!hasAfter) for (const k of Object.keys(requestVars || {})) {
      if (k.toLowerCase().includes("after") && requestVars[k] != null) { hasAfter = true; break; }
    }
    if (!hasBefore) for (const k of Object.keys(requestVars || {})) {
      if (k.toLowerCase().includes("before") && requestVars[k] != null) { hasBefore = true; break; }
    }
    return { hasAfter, hasBefore, isLeader: !hasAfter && !hasBefore };
  };

  // Aggregate pageInfo from head & tail pages
  const aggregatePageInfo = (pages: string[]) => {
    if (!pages.length) return undefined;
    const head = graph.getRecord(pages[0]);
    const tail = graph.getRecord(pages[pages.length - 1]) || head;
    const headPI = head?.pageInfo || {};
    const tailPI = tail?.pageInfo || {};
    const out: any = { __typename: headPI.__typename || tailPI.__typename || "PageInfo" };
    out.startCursor = headPI.startCursor ?? null;
    out.hasPreviousPage = !!headPI.hasPreviousPage;
    out.endCursor = tailPI.endCursor ?? (headPI.endCursor ?? null);
    out.hasNextPage = !!tailPI.hasNextPage;
    return out;
  };

  // Compute canonical page order deterministically from meta.hints + leader
  const computeOrderedPages = (meta: ConnMeta): string[] => {
    const hints = meta.hints || {};
    const leader = meta.leader;
    // Keep arrival order within buckets for stability
    const before: string[] = [];
    const after: string[] = [];
    for (const pk of meta.pages) {
      const h = hints[pk];
      if (h === "before") before.push(pk);
      else if (h === "after") after.push(pk);
      else if (h === "leader") {
        // ignore here; we’ll place leader centrally if present
      } else {
        // no hint yet → treat as 'after' until leader appears
        after.push(pk);
      }
    }

    if (leader) {
      // de-dup leader if it is also in pages
      const beforeClean = before.filter((p) => p !== leader);
      const afterClean = after.filter((p) => p !== leader);
      return [...beforeClean, leader, ...afterClean];
    }

    // No leader yet: just keep arrival order (before/after grouping not enforceable)
    return meta.pages.slice();
  };

  // Full rebuild of the union from concrete pages (stable & deterministic)
  const rebuildCanonical = (canKey: string, orderedPages: string[]) => {
    const nextEdges: Array<{ __ref: string }> = [];
    const seen = new Set<string>(); // node refs

    for (const pk of orderedPages) {
      const page = graph.getRecord(pk);
      const refs = Array.isArray(page?.edges) ? page.edges as Array<{ __ref: string }> : [];
      for (let i = 0; i < refs.length; i++) {
        const eref = refs[i]?.__ref;
        if (!eref) continue;
        const nref = nodeRefOf(eref);
        if (!nref || seen.has(nref)) continue;
        nextEdges.push({ __ref: eref });
        seen.add(nref);
      }
    }

    const pageInfo = aggregatePageInfo(orderedPages) || {};
    const current = graph.getRecord(canKey) || {};
    graph.putRecord(canKey, {
      __typename: current.__typename || "Connection",
      edges: nextEdges,
      pageInfo,
    });
  };

  // Write meta (pages + hints + leader)
  const writeMeta = (canKey: string, updater: (m: ConnMeta) => void) => {
    const m0 = (graph.getRecord(metaKeyOf(canKey)) || { __typename: "__ConnMeta", pages: [] }) as ConnMeta;
    const meta: ConnMeta = {
      __typename: "__ConnMeta",
      pages: Array.isArray(m0.pages) ? m0.pages.slice() : [],
      leader: m0.leader,
      hints: { ...(m0.hints || {}) },
    };
    updater(meta);
    graph.putRecord(metaKeyOf(canKey), meta);
    return meta;
  };

  /** NETWORK PATH: leader may reset; before/after replace their slice; always rebuild union from meta. */
  const updateConnection = (args: {
    field: PlanField;
    parentRecordId: string;
    requestVars: Record<string, any>;
    pageKey: string;
    pageSnap: Record<string, any>;
    pageEdgeRefs: Array<{ __ref: string }>;
  }) => {
    const { field, parentRecordId, requestVars, pageKey, pageSnap } = args;
    const canKey = buildConnectionCanonicalKey(field, parentRecordId, requestVars);
    const mode = field.connectionMode || "infinite";
    if (mode !== "infinite") {
      // page-mode: trivial
      graph.putRecord(canKey, {
        __typename: pageSnap.__typename || "Connection",
        edges: pageSnap.edges || [],
        pageInfo: pageSnap.pageInfo || {},
      });
      optimistic.reapplyOptimistic({ connections: [canKey] });
      return;
    }

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, requestVars);

    const meta = writeMeta(canKey, (m) => {
      if (isLeader) {
        m.pages = [pageKey];
        m.leader = pageKey;
        m.hints = { [pageKey]: "leader" };
      } else {
        // add/ensure presence
        if (!m.pages.includes(pageKey)) m.pages.push(pageKey);
        if (!m.hints) m.hints = {};
        m.hints[pageKey] = hasBefore ? "before" : "after";
        // carry leader hint if already known
        if (m.leader) m.hints[m.leader] = "leader";
      }
    });

    const ordered = computeOrderedPages(meta);
    rebuildCanonical(canKey, ordered);
    optimistic.reapplyOptimistic({ connections: [canKey] });
  };

  /** CACHE PATH: never reset on leader; record hints; rebuild union deterministically. */
  const mergeFromCache = (args: {
    field: PlanField;
    parentRecordId: string;
    requestVars: Record<string, any>;
    pageKey: string;
    pageSnap: Record<string, any>;
    pageEdgeRefs: Array<{ __ref: string }>;
  }) => {
    const { field, parentRecordId, requestVars, pageKey } = args;
    const canKey = buildConnectionCanonicalKey(field, parentRecordId, requestVars);
    const mode = field.connectionMode || "infinite";
    if (mode !== "infinite") {
      graph.putRecord(canKey, {
        __typename: args.pageSnap.__typename || "Connection",
        edges: args.pageSnap.edges || [],
        pageInfo: args.pageSnap.pageInfo || {},
      });
      optimistic.reapplyOptimistic({ connections: [canKey] });
      return;
    }

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, requestVars);

    const meta = writeMeta(canKey, (m) => {
      // never destructive-reset on prewarm leader
      if (!m.pages.includes(pageKey)) m.pages.push(pageKey);
      if (!m.hints) m.hints = {};
      if (isLeader) { m.leader = pageKey; m.hints[pageKey] = "leader"; }
      else { m.hints[pageKey] = hasBefore ? "before" : "after"; }
      if (m.leader) m.hints[m.leader] = "leader";
    });

    const ordered = computeOrderedPages(meta);
    rebuildCanonical(canKey, ordered);
    optimistic.reapplyOptimistic({ connections: [canKey] });
  };

  return { updateConnection, mergeFromCache };
};
