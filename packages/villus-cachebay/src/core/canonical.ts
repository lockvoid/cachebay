import { buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import type { OptimisticInstance } from "./optimistic";

export type CanonicalDependencies = {
  graph: GraphInstance;
  optimistic: OptimisticInstance;
};

export type CanonicalInstance = ReturnType<typeof createCanonical>;

type ConnectionMeta = {
  __typename: "__ConnMeta";
  pages: string[];
  leader?: string;
  hints?: Record<string, "before" | "after" | "leader">;
  origin?: Record<string, "cache" | "network">;
};

const metaKeyOf = (canonicalKey: string): string => `${canonicalKey}::meta`;

/**
 * Creates the canonical connection manager that merges paginated data
 * into stable, deduplicated views across network and cache paths.
 */
export const createCanonical = ({ graph, optimistic }: CanonicalDependencies) => {

  /**
   * Extracts the node reference from an edge record.
   */
  const getNodeRef = (edgeRef: string): string | null => {
    const edge = graph.getRecord(edgeRef);
    const nodeRef = edge?.node?.__ref;
    return typeof nodeRef === "string" ? nodeRef : null;
  };

  /**
   * Refreshes all non-structural metadata from source edge to destination edge.
   * Only preserves node reference and __typename (structural identity).
   */
  const refreshEdgeMeta = (dstEdgeRef: string, srcEdgeRef: string): void => {
    const src = graph.getRecord(srcEdgeRef);
    if (!src) {
      return;
    }

    const patch: Record<string, any> = {};
    const keys = Object.keys(src);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "node" || key === "__typename") {
        continue;
      }
      patch[key] = src[key];
    }

    if (Object.keys(patch).length > 0) {
      graph.putRecord(dstEdgeRef, patch);
    }
  };

  /**
   * Extracts extra fields from page snapshot (everything except edges, pageInfo, __typename).
   */
  const extractExtras = (pageSnapshot: Record<string, any>): Record<string, any> => {
    const extras: Record<string, any> = {};
    const keys = Object.keys(pageSnapshot || {});

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "edges" || key === "pageInfo" || key === "__typename") {
        continue;
      }
      extras[key] = pageSnapshot[key];
    }

    return extras;
  };

  /**
   * Reads edge keys from concrete page record.
   */
  const readPageEdges = (pageKey: string): string[] => {
    const page = graph.getRecord(pageKey);
    if (!page?.edges?.__refs || !Array.isArray(page.edges.__refs)) {
      return [];
    }
    return page.edges.__refs;
  };

  /**
   * Reads pageInfo from page record (handles inline and reference formats).
   */
  const readPageInfo = (page: any): Record<string, any> => {
    if (!page?.pageInfo) {
      return {};
    }

    if (page.pageInfo.__ref) {
      return graph.getRecord(page.pageInfo.__ref) || {};
    }

    return page.pageInfo;
  };

  /**
   * Aggregates pageInfo from multiple pages:
   * - Head page contributes startCursor and hasPreviousPage
   * - Tail page contributes endCursor and hasNextPage
   */
  const aggregatePageInfo = (pageKeys: string[]): Record<string, any> => {
    if (pageKeys.length === 0) {
      return {};
    }

    const headPage = graph.getRecord(pageKeys[0]);
    const tailPage = graph.getRecord(pageKeys[pageKeys.length - 1]) || headPage;

    const headInfo = readPageInfo(headPage);
    const tailInfo = readPageInfo(tailPage);

    return {
      __typename: headInfo.__typename || tailInfo.__typename || "PageInfo",
      startCursor: headInfo.startCursor ?? null,
      endCursor: tailInfo.endCursor ?? (headInfo.endCursor ?? null),
      hasPreviousPage: !!headInfo.hasPreviousPage,
      hasNextPage: !!tailInfo.hasNextPage,
    };
  };

  /**
   * Detects cursor role from variables (leader vs before vs after).
   */
  const detectCursorRole = (
    field: PlanField,
    variables: Record<string, any>,
  ): { hasAfter: boolean; hasBefore: boolean; isLeader: boolean } => {
    const args = field.buildArgs ? (field.buildArgs(variables) || {}) : (variables || {});

    let hasAfter = args.after != null;
    let hasBefore = args.before != null;

    if (!hasAfter) {
      const varKeys = Object.keys(variables || {});
      for (let i = 0; i < varKeys.length; i++) {
        const key = varKeys[i];
        if (key.toLowerCase().includes("after") && variables[key] != null) {
          hasAfter = true;
          break;
        }
      }
    }

    if (!hasBefore) {
      const varKeys = Object.keys(variables || {});
      for (let i = 0; i < varKeys.length; i++) {
        const key = varKeys[i];
        if (key.toLowerCase().includes("before") && variables[key] != null) {
          hasBefore = true;
          break;
        }
      }
    }

    return {
      hasAfter,
      hasBefore,
      isLeader: !hasAfter && !hasBefore,
    };
  };

  /**
   * Computes deterministic page ordering based on hints and leader.
   * Before pages are reversed to maintain chronological order.
   */
  const computeOrderedPages = (meta: ConnectionMeta): string[] => {
    const hints = meta.hints || {};
    const leader = meta.leader;

    const beforePages: string[] = [];
    const afterPages: string[] = [];

    for (let i = 0; i < meta.pages.length; i++) {
      const pageKey = meta.pages[i];
      const hint = hints[pageKey];

      if (hint === "before") {
        beforePages.push(pageKey);
      } else if (hint === "after") {
        afterPages.push(pageKey);
      } else if (hint === "leader") {
        continue;
      } else {
        afterPages.push(pageKey);
      }
    }

    if (leader) {
      const beforeClean = beforePages.filter(pk => pk !== leader);
      const afterClean = afterPages.filter(pk => pk !== leader);
      const orderedBefore = beforeClean.slice().reverse();

      return [...orderedBefore, leader, ...afterClean];
    }

    return meta.pages.slice();
  };

  /**
   * Rebuilds canonical edges by deduplicating nodes across ordered pages.
   * When duplicate nodes appear, keeps first occurrence and refreshes metadata.
   */
  const rebuildCanonical = (canonicalKey: string, orderedPageKeys: string[]): void => {
    const canonicalEdgeRefs: string[] = [];
    const nodeToEdge = new Map<string, string>();

    for (let i = 0; i < orderedPageKeys.length; i++) {
      const pageKey = orderedPageKeys[i];
      const edgeKeys = readPageEdges(pageKey);

      for (let j = 0; j < edgeKeys.length; j++) {
        const edgeRef = edgeKeys[j];
        if (!edgeRef) {
          continue;
        }

        const nodeRef = getNodeRef(edgeRef);
        if (!nodeRef) {
          continue;
        }

        const existingEdge = nodeToEdge.get(nodeRef);
        if (existingEdge) {
          refreshEdgeMeta(existingEdge, edgeRef);
        } else {
          canonicalEdgeRefs.push(edgeRef);
          nodeToEdge.set(nodeRef, edgeRef);
        }
      }
    }

    const pageInfo = aggregatePageInfo(orderedPageKeys);
    const current = graph.getRecord(canonicalKey) || {};

    // Create pageInfo as a separate record with a reference
    const pageInfoKey = `${canonicalKey}.pageInfo`;
    graph.putRecord(pageInfoKey, pageInfo);

    graph.putRecord(canonicalKey, {
      __typename: current.__typename || "Connection",
      edges: {
        __refs: canonicalEdgeRefs,
      },
      pageInfo: { __ref: pageInfoKey },
    });
  };

  /**
   * Updates connection metadata with provided updater function.
   */
  const updateMeta = (
    canonicalKey: string,
    updater: (meta: ConnectionMeta) => void,
  ): ConnectionMeta => {
    const existing = graph.getRecord(metaKeyOf(canonicalKey)) as ConnectionMeta | undefined;

    const meta: ConnectionMeta = {
      __typename: "__ConnMeta",
      pages: Array.isArray(existing?.pages) ? existing.pages.slice() : [],
      leader: existing?.leader,
      hints: existing?.hints ? { ...existing.hints } : {},
      origin: existing?.origin ? { ...existing.origin } : {},
    };

    updater(meta);
    graph.putRecord(metaKeyOf(canonicalKey), meta);

    return meta;
  };

  /**
   * Ensures canonical record exists (prevents undefined reads).
   */
  const ensureCanonical = (canonicalKey: string): void => {
    if (!graph.getRecord(canonicalKey)) {
      const pageInfoKey = `${canonicalKey}.pageInfo`;
      graph.putRecord(pageInfoKey, {
        __typename: "PageInfo",
        startCursor: null,
        endCursor: null,
        hasPreviousPage: false,
        hasNextPage: false,
      });
      graph.putRecord(canonicalKey, {
        __typename: "Connection",
        edges: { __refs: [] },
        pageInfo: { __ref: pageInfoKey },
      });
    }
  };

  /**
   * Updates connection from network fetch.
   * Leader fetches collapse to single page; before/after extend union.
   */
  const updateConnection = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    pageKey: string;
    pageSnapshot: Record<string, any>;
  }): void => {
    const { field, parentId, variables, pageKey, pageSnapshot } = args;
    const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
    const mode = field.connectionMode || "infinite";

    ensureCanonical(canonicalKey);

    if (mode === "page") {
      const extras = extractExtras(pageSnapshot);
      const edgeRefs: string[] = [];

      if (pageSnapshot.edges?.__refs && Array.isArray(pageSnapshot.edges.__refs)) {
        for (let i = 0; i < pageSnapshot.edges.__refs.length; i++) {
          const ref = pageSnapshot.edges.__refs[i];
          if (typeof ref === "string") {
            edgeRefs.push(ref);
          }
        }
      }

      graph.putRecord(canonicalKey, {
        __typename: pageSnapshot.__typename || "Connection",
        edges: { __refs: edgeRefs },
        pageInfo: pageSnapshot.pageInfo || {},
        ...extras,
      });
      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    const { hasBefore, isLeader } = detectCursorRole(field, variables);

    if (isLeader) {
      const edgeKeys = readPageEdges(pageKey);

      let leaderEdgeRefs: string[];
      if (edgeKeys.length > 0) {
        leaderEdgeRefs = edgeKeys;
      } else if (pageSnapshot.edges?.__refs && Array.isArray(pageSnapshot.edges.__refs)) {
        leaderEdgeRefs = pageSnapshot.edges.__refs.slice();
      } else {
        leaderEdgeRefs = [];
      }

      const page = graph.getRecord(pageKey);
      const leaderPageInfo = readPageInfo(page) || pageSnapshot.pageInfo || {};
      const extras = extractExtras(pageSnapshot);

      // Store pageInfo as a separate record
      const pageInfoKey = `${canonicalKey}.pageInfo`;
      graph.putRecord(pageInfoKey, {
        __typename: leaderPageInfo.__typename || "PageInfo",
        startCursor: leaderPageInfo.startCursor ?? null,
        endCursor: leaderPageInfo.endCursor ?? null,
        hasPreviousPage: !!leaderPageInfo.hasPreviousPage,
        hasNextPage: !!leaderPageInfo.hasNextPage,
      });

      graph.putRecord(canonicalKey, {
        __typename: pageSnapshot.__typename || "Connection",
        edges: { __refs: leaderEdgeRefs },
        pageInfo: { __ref: pageInfoKey },
        ...extras,
      });

      graph.putRecord(metaKeyOf(canonicalKey), {
        __typename: "__ConnMeta",
        pages: [pageKey],
        leader: pageKey,
        hints: { [pageKey]: "leader" },
        origin: { [pageKey]: "network" },
      });

      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    const meta = updateMeta(canonicalKey, (m) => {
      if (!m.pages.includes(pageKey)) {
        m.pages.push(pageKey);
      }

      if (!m.hints) {
        m.hints = {};
      }
      if (!m.origin) {
        m.origin = {};
      }

      m.origin[pageKey] = "network";
      m.hints[pageKey] = hasBefore ? "before" : "after";

      if (m.leader) {
        m.hints[m.leader] = "leader";
      }
    });

    const orderedPages = computeOrderedPages(meta);
    rebuildCanonical(canonicalKey, orderedPages);

    optimistic.replayOptimistic({ connections: [canonicalKey] });
  };

  /**
   * Merges connection from cache (prewarm).
   * Builds union without collapsing until network leader arrives.
   */
  const mergeFromCache = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    pageKey: string;
    pageSnapshot: Record<string, any>;
  }): void => {
    const { field, parentId, variables, pageKey, pageSnapshot } = args;
    const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
    const mode = field.connectionMode || "infinite";

    ensureCanonical(canonicalKey);

    if (mode === "page") {
      const edgeRefs: string[] = [];

      if (pageSnapshot.edges?.__refs && Array.isArray(pageSnapshot.edges.__refs)) {
        for (let i = 0; i < pageSnapshot.edges.__refs.length; i++) {
          const ref = pageSnapshot.edges.__refs[i];
          if (typeof ref === "string") {
            edgeRefs.push(ref);
          }
        }
      }

      graph.putRecord(canonicalKey, {
        __typename: pageSnapshot.__typename || "Connection",
        edges: { __refs: edgeRefs },
        pageInfo: pageSnapshot.pageInfo || {},
      });
      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    const { hasBefore, isLeader } = detectCursorRole(field, variables);

    const meta = updateMeta(canonicalKey, (m) => {
      if (!m.pages.includes(pageKey)) {
        m.pages.push(pageKey);
      }

      if (!m.hints) {
        m.hints = {};
      }
      if (!m.origin) {
        m.origin = {};
      }

      m.origin[pageKey] = "cache";

      if (isLeader) {
        m.leader = pageKey;
        m.hints[pageKey] = "leader";
      } else {
        m.hints[pageKey] = hasBefore ? "before" : "after";
        if (m.leader) {
          m.hints[m.leader] = "leader";
        }
      }
    });

    const orderedPages = computeOrderedPages(meta);
    rebuildCanonical(canonicalKey, orderedPages);

    optimistic.replayOptimistic({ connections: [canonicalKey] });
  };

  return {
    updateConnection,
    mergeFromCache,
  };
};
