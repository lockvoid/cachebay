/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import { buildConnectionCanonicalKey } from "./utils";

type OptimisticHook = {
  reapplyOptimistic: (hint?: { connections?: string[]; entities?: string[] }) => {
    inserted: string[];
    removed: string[];
  };
};

export type CanonicalDeps = { graph: GraphInstance; optimistic: OptimisticHook };
export type CanonicalInstance = ReturnType<typeof createCanonical>;

const metaKeyOf = (canKey: string) => `${canKey}::meta`;

type ConnMeta = {
  __typename: "__ConnMeta";
  pages: string[];                               // observed pages (arrival order)
  leader?: string;                               // the leader pageKey (no-cursor)
  hints?: Record<string, "before" | "after" | "leader">; // per-page role
};

export const createCanonical = ({ graph, optimistic }: CanonicalDeps) => {
  /* ------------------------------- helpers -------------------------------- */

  const nodeRefOf = (edgeRef: string): string | null => {
    const e = graph.getRecord(edgeRef);
    const nref = e?.node?.__ref;
    return typeof nref === "string" ? nref : null;
  };

  // Copy non-node, non-cursor fields from src edge to dst edge (meta refresh)
  const refreshEdgeMeta = (dstEdgeRef: string, srcEdgeRef: string) => {
    const src = graph.getRecord(srcEdgeRef) || {};
    const patch: Record<string, any> = {};
    for (const k of Object.keys(src)) {
      if (k === "node" || k === "cursor" || k === "__typename") continue;
      patch[k] = src[k];
    }
    if (Object.keys(patch).length) graph.putRecord(dstEdgeRef, patch);
  };

  const extractExtras = (pageSnap: Record<string, any>) => {
    const extras: Record<string, any> = {};
    for (const k of Object.keys(pageSnap || {})) {
      if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
      extras[k] = pageSnap[k];
    }
    return extras;
  };

  // PageInfo aggregates: head contributes start/hasPrevious; tail contributes end/hasNext
  const aggregatePageInfo = (pages: string[]) => {
    if (!pages.length) return undefined;
    const head = graph.getRecord(pages[0]);
    const tail = graph.getRecord(pages[pages.length - 1]) || head;
    const headPI = head?.pageInfo || {};
    const tailPI = tail?.pageInfo || {};
    return {
      __typename: headPI.__typename || tailPI.__typename || "PageInfo",
      startCursor: headPI.startCursor ?? null,
      endCursor: tailPI.endCursor ?? (headPI.endCursor ?? null),
      hasPreviousPage: !!headPI.hasPreviousPage,
      hasNextPage: !!tailPI.hasNextPage,
    };
  };

  // Classify role from request vars (not identity args)
  const detectCursorRole = (field: PlanField, requestVars: Record<string, any>) => {
    const req = field.buildArgs ? (field.buildArgs(requestVars) || {}) : (requestVars || {});
    let hasAfter = req.after != null;
    let hasBefore = req.before != null;

    if (!hasAfter) {
      for (const k of Object.keys(requestVars || {})) {
        if (k.toLowerCase().includes("after") && requestVars[k] != null) { hasAfter = true; break; }
      }
    }
    if (!hasBefore) {
      for (const k of Object.keys(requestVars || {})) {
        if (k.toLowerCase().includes("before") && requestVars[k] != null) { hasBefore = true; break; }
      }
    }
    return { hasAfter, hasBefore, isLeader: !hasAfter && !hasBefore };
  };

  // Compute deterministic canonical page order based on hints + leader
  const computeOrderedPages = (meta: ConnMeta): string[] => {
    const hints = meta.hints || {};
    const leader = meta.leader;

    const before: string[] = [];
    const after: string[] = [];

    for (const pk of meta.pages) {
      const h = hints[pk];
      if (h === "before") before.push(pk);
      else if (h === "after") after.push(pk);
      else if (h === "leader") {
        // placed centrally later
      } else {
        // unknown: treat as 'after' until leader lands
        after.push(pk);
      }
    }

    if (leader) {
      const beforeClean = before.filter((p) => p !== leader);
      const afterClean = after.filter((p) => p !== leader);
      return [...beforeClean, leader, ...afterClean];
    }

    // no leader → stable arrival order
    return meta.pages.slice();
  };

  // Full rebuild of canonical edges based on ordered page slices; dedup by node.
  // If a duplicate appears later, refresh meta on the first-kept edge.
  const rebuildCanonical = (canKey: string, orderedPages: string[]) => {
    const nextEdges: Array<{ __ref: string }> = [];
    const chosenByNode = new Map<string, string>(); // nodeRef -> kept edgeRef

    for (const pk of orderedPages) {
      const page = graph.getRecord(pk);
      const refs = Array.isArray(page?.edges) ? (page!.edges as Array<{ __ref: string }>) : [];
      for (let i = 0; i < refs.length; i++) {
        const eref = refs[i]?.__ref;
        if (!eref) continue;
        const nref = nodeRefOf(eref);
        if (!nref) continue;

        const kept = chosenByNode.get(nref);
        if (kept) {
          // refresh the kept edge’s meta from this later occurrence
          refreshEdgeMeta(kept, eref);
        } else {
          nextEdges.push({ __ref: eref });
          chosenByNode.set(nref, eref);
        }
      }
    }

    const pi = aggregatePageInfo(orderedPages) || {};
    const current = graph.getRecord(canKey) || {};
    graph.putRecord(canKey, {
      __typename: current.__typename || "Connection",
      edges: nextEdges,
      pageInfo: pi,
    });
  };

  // Meta writer
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

  /* ----------------------------- public API -------------------------------- */

  /** NETWORK PATH: replace for page-mode; infinite: record hints/leader, rebuild union, set extras on leader, reapply optimistic. */
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

    if (mode === "page") {
      // page-mode: last fetched page replaces; carry page extras
      const extras = extractExtras(pageSnap);
      graph.putRecord(canKey, {
        __typename: pageSnap.__typename || "Connection",
        edges: pageSnap.edges || [],
        pageInfo: pageSnap.pageInfo || {},
        ...extras,
      });
      optimistic.reapplyOptimistic({ connections: [canKey] });
      return;
    }

    // infinite
    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, requestVars);

    const meta = writeMeta(canKey, (m) => {
      if (isLeader) {
        m.pages = [pageKey];
        m.leader = pageKey;
        m.hints = { [pageKey]: "leader" };
      } else {
        if (!m.pages.includes(pageKey)) m.pages.push(pageKey);
        if (!m.hints) m.hints = {};
        m.hints[pageKey] = hasBefore ? "before" : "after";
        if (m.leader) m.hints[m.leader] = "leader";
      }
    });

    const ordered = computeOrderedPages(meta);
    rebuildCanonical(canKey, ordered);

    // leader sets “sticky” extras (e.g., totalCount) once
    if (isLeader) {
      const extras = extractExtras(pageSnap);
      if (Object.keys(extras).length) {
        graph.putRecord(canKey, extras); // merge extras (don’t delete unknown fields)
      }
    }

    optimistic.reapplyOptimistic({ connections: [canKey] });
  };

  /** CACHE PATH (prewarm): never reset; record hints; rebuild union; no extras overwrite; reapply optimistic. */
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

    if (mode === "page") {
      graph.putRecord(canKey, {
        __typename: args.pageSnap.__typename || "Connection",
        edges: args.pageSnap.edges || [],
        pageInfo: args.pageSnap.pageInfo || {},
        // no extras on prewarm page-mode (can be added if you want)
      });
      optimistic.reapplyOptimistic({ connections: [canKey] });
      return;
    }

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, requestVars);

    const meta = writeMeta(canKey, (m) => {
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
