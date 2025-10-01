 
import { buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";

type OptimisticHook = {
  replayOptimistic: (hint?: { connections?: string[]; entities?: string[] }) => {
    added: string[];
    removed: string[];
  };
};

export type CanonicalDeps = { graph: GraphInstance; optimistic: OptimisticHook };
export type CanonicalInstance = ReturnType<typeof createCanonical>;

const metaKeyOf = (canKey: string) => `${canKey}::meta`;

type ConnMeta = {
  __typename: "__ConnMeta";
  pages: string[]; // observed pages (arrival order)
  leader?: string; // leader pageKey (no-cursor)
  hints?: Record<string, "before" | "after" | "leader">; // per-page role
  origin?: Record<string, "cache" | "network">; // where a page came from
};

export const createCanonical = ({ graph, optimistic }: CanonicalDeps) => {
  /* ------------------------------- helpers -------------------------------- */

  const nodeRefOf = (edgeRef: string): string | null => {
    const e = graph.getRecord(edgeRef);
    const nref = e?.node?.__ref;
    return typeof nref === "string" ? nref : null;
  };

  // Copy non-node, non-cursor, non-typename fields from src edge to dst edge (meta refresh)
  const refreshEdgeMeta = (dstEdgeRef: string, srcEdgeRef: string) => {
    const src = graph.getRecord(srcEdgeRef) || {};
    const patch: Record<string, any> = {};
    for (const k of Object.keys(src)) {
      if (k === "node" || k === "cursor" || k === "__typename") continue;
      patch[k] = src[k];
    }
    if (Object.keys(patch).length) graph.putRecord(dstEdgeRef, patch);
  };

  const extractExtras = (pageSnapshot: Record<string, any>) => {
    const extras: Record<string, any> = {};
    for (const k of Object.keys(pageSnapshot || {})) {
      if (k === "edges" || k === "pageInfo" || k === "__typename") continue;
      extras[k] = pageSnapshot[k];
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
  const detectCursorRole = (field: PlanField, variables: Record<string, any>) => {
    const req = field.buildArgs ? (field.buildArgs(variables) || {}) : (variables || {});
    let hasAfter = req.after != null;
    let hasBefore = req.before != null;

    if (!hasAfter) {
      for (const k of Object.keys(variables || {})) {
        if (k.toLowerCase().includes("after") && variables[k] != null) { hasAfter = true; break; }
      }
    }
    if (!hasBefore) {
      for (const k of Object.keys(variables || {})) {
        if (k.toLowerCase().includes("before") && variables[k] != null) { hasBefore = true; break; }
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
          refreshEdgeMeta(kept, eref); // refresh from later occurrence
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

  // Meta updater
  const writeMeta = (canKey: string, updater: (m: ConnMeta) => void) => {
    const m0 = (graph.getRecord(metaKeyOf(canKey)) || { __typename: "__ConnMeta", pages: [] }) as ConnMeta;
    const meta: ConnMeta = {
      __typename: "__ConnMeta",
      pages: Array.isArray(m0.pages) ? m0.pages.slice() : [],
      leader: m0.leader,
      hints: { ...(m0.hints || {}) },
      origin: { ...(m0.origin || {}) },
    };
    updater(meta);
    graph.putRecord(metaKeyOf(canKey), meta);
    return meta;
  };

  // Ensure a concrete page record exists with edges so rebuild can read it
  const ensurePageEdges = (pageKey: string, pageSnapshot: any, pageEdgeRefs: Array<{ __ref: string }>) => {
    const rec = graph.getRecord(pageKey) || {};
    const hasEdges = Array.isArray(rec.edges) && rec.edges.length > 0;
    if (!hasEdges && Array.isArray(pageEdgeRefs) && pageEdgeRefs.length > 0) {
      graph.putRecord(pageKey, {
        __typename: rec.__typename || pageSnapshot?.__typename || "Connection",
        pageInfo: rec.pageInfo || pageSnapshot?.pageInfo || {},
        edges: pageEdgeRefs,
      });
    }
  };

  // Always ensure a canonical record exists (avoid reading edges from undefined)
  const ensureCanonicalRecord = (canKey: string) => {
    if (!graph.getRecord(canKey)) {
      graph.putRecord(canKey, { __typename: "Connection", edges: [], pageInfo: {} });
    }
  };

  /* ----------------------------- public API -------------------------------- */

  /** NETWORK PATH */
  const updateConnection = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    pageKey: string;
    pageSnapshot: Record<string, any>;
    pageEdgeRefs: Array<{ __ref: string }>;
  }) => {
    const { field, parentId, variables, pageKey, pageSnapshot, pageEdgeRefs } = args;
    const canKey = buildConnectionCanonicalKey(field, parentId, variables);
    const mode = field.connectionMode || "infinite";

    ensureCanonicalRecord(canKey);

    // make sure the page record has edges available for any path below
    ensurePageEdges(pageKey, pageSnapshot, pageEdgeRefs);

    if (mode === "page") {
      const extras = extractExtras(pageSnapshot);
      graph.putRecord(canKey, {
        __typename: pageSnapshot.__typename || "Connection",
        edges: pageSnapshot.edges || [],
        pageInfo: pageSnapshot.pageInfo || {},
        ...extras,
      });
      optimistic.replayOptimistic({ connections: [canKey] });
      return;
    }

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, variables);

    if (isLeader) {
      // UNCONDITIONAL COLLAPSE to leader slice on network leader fetch
      const page = graph.getRecord(pageKey) || {};
      const leaderEdges =
        Array.isArray(page.edges) && page.edges.length
          ? page.edges
          : (Array.isArray(pageSnapshot.edges) && pageSnapshot.edges.length
            ? pageSnapshot.edges
            : (Array.isArray(pageEdgeRefs) ? pageEdgeRefs : []));
      const leaderPI = page.pageInfo || pageSnapshot.pageInfo || {};

      const extras = extractExtras(pageSnapshot);
      graph.putRecord(canKey, {
        __typename: pageSnapshot.__typename || "Connection",
        edges: leaderEdges,
        pageInfo: leaderPI,
        ...extras,
      });

      // Reset meta to just the leader
      graph.putRecord(metaKeyOf(canKey), {
        __typename: "__ConnMeta",
        pages: [pageKey],
        leader: pageKey,
        hints: { [pageKey]: "leader" },
        origin: { [pageKey]: "network" },
      });

      optimistic.replayOptimistic({ connections: [canKey] });
      return;
    }

    // AFTER / BEFORE pages: extend union deterministically
    const meta = writeMeta(canKey, (m) => {
      if (!m.pages.includes(pageKey)) m.pages.push(pageKey);
      if (!m.hints) m.hints = {};
      if (!m.origin) m.origin = {};
      m.origin[pageKey] = "network";
      m.hints[pageKey] = hasBefore ? "before" : "after";
      if (m.leader) m.hints[m.leader] = "leader";
    });

    const ordered = computeOrderedPages(meta);
    rebuildCanonical(canKey, ordered);

    optimistic.replayOptimistic({ connections: [canKey] });
  };

  /** CACHE PATH (prewarm) */
  const mergeFromCache = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    pageKey: string;
    pageSnapshot: Record<string, any>;
    pageEdgeRefs: Array<{ __ref: string }>;
  }) => {
    const { field, parentId, variables, pageKey, pageSnapshot, pageEdgeRefs } = args;
    const canKey = buildConnectionCanonicalKey(field, parentId, variables);
    const mode = field.connectionMode || "infinite";

    ensureCanonicalRecord(canKey);
    ensurePageEdges(pageKey, pageSnapshot, pageEdgeRefs);

    if (mode === "page") {
      graph.putRecord(canKey, {
        __typename: args.pageSnapshot.__typename || "Connection",
        edges: args.pageSnapshot.edges || [],
        pageInfo: args.pageSnapshot.pageInfo || {},
      });
      optimistic.replayOptimistic({ connections: [canKey] });
      return;
    }

    const { hasAfter, hasBefore, isLeader } = detectCursorRole(field, variables);

    const meta = writeMeta(canKey, (m) => {
      if (!m.pages.includes(pageKey)) m.pages.push(pageKey);
      if (!m.hints) m.hints = {};
      if (!m.origin) m.origin = {};
      m.origin[pageKey] = "cache";

      if (isLeader) {
        m.leader = pageKey;
        m.hints[pageKey] = "leader";
      } else {
        m.hints[pageKey] = hasBefore ? "before" : "after";
        if (m.leader) m.hints[m.leader] = "leader";
      }
    });

    const ordered = computeOrderedPages(meta);
    rebuildCanonical(canKey, ordered);

    optimistic.replayOptimistic({ connections: [canKey] });
  };

  return { updateConnection, mergeFromCache };
};
