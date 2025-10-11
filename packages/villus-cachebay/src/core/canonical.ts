import { buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import type { OptimisticInstance } from "./optimistic";

export type CanonicalDependencies = {
  graph: GraphInstance;
  optimistic: OptimisticInstance;
};

export type CanonicalInstance = ReturnType<typeof createCanonical>;

/**
 * Creates the canonical connection manager that merges paginated data
 * using Relay-style splice-based merging with cursor relationships.
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
   * Gets cursor from an edge.
   */
  const getEdgeCursor = (edgeRef: string): string | null => {
    const edge = graph.getRecord(edgeRef);
    return edge?.cursor || null;
  };

  /**
   * Extracts extra fields from connection (everything except edges, pageInfo, __typename).
   */
  const getExtras = (connection: Record<string, any>): Record<string, any> => {
    const extras: Record<string, any> = {};
    const keys = Object.keys(connection || {});

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "edges" || key === "pageInfo" || key === "__typename") {
        continue;
      }
      extras[key] = connection[key];
    }

    return extras;
  };

  /**
   * Detects cursor role from variables.
   */
  const detectCursorRole = (
    field: PlanField,
    variables: Record<string, any>,
  ): { after: string | null; before: string | null; isLeader: boolean } => {
    const args = field.buildArgs ? (field.buildArgs(variables) || {}) : (variables || {});

    let after: string | null = args.after ?? null;
    let before: string | null = args.before ?? null;

    // Fallback: check variable keys
    if (!after) {
      const varKeys = Object.keys(variables || {});
      for (let i = 0; i < varKeys.length; i++) {
        const key = varKeys[i];
        if (key.toLowerCase().includes("after") && variables[key] != null) {
          after = variables[key];
          break;
        }
      }
    }

    if (!before) {
      const varKeys = Object.keys(variables || {});
      for (let i = 0; i < varKeys.length; i++) {
        const key = varKeys[i];
        if (key.toLowerCase().includes("before") && variables[key] != null) {
          before = variables[key];
          break;
        }
      }
    }

    return {
      after,
      before,
      isLeader: !after && !before,
    };
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
   * Merges incoming page into canonical using Apollo-style splice logic.
   * Handles forward (after), backward (before), and leader (reset) pagination.
   */
  const updateConnection = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    pageKey: string;
    normalizedPage: Record<string, any>;
  }): void => {
    const { field, parentId, variables, pageKey, normalizedPage } = args;
    const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);
    const mode = field.connectionMode || "infinite";

    ensureCanonical(canonicalKey);

    // Page mode: replace entire canonical with incoming page
    if (mode === "page") {
      const edgeRefs: string[] = [];

      if (normalizedPage.edges?.__refs && Array.isArray(normalizedPage.edges.__refs)) {
        for (let i = 0; i < normalizedPage.edges.__refs.length; i++) {
          const ref = normalizedPage.edges.__refs[i];
          if (typeof ref === "string") {
            edgeRefs.push(ref);
          }
        }
      }

      const pageInfoRef = normalizedPage.pageInfo?.__ref;
      const pageInfoData = pageInfoRef ? graph.getRecord(pageInfoRef) : null;

      const pageInfoKey = `${canonicalKey}.pageInfo`;
      graph.putRecord(pageInfoKey, {
        __typename: pageInfoData?.__typename || "PageInfo",
        startCursor: pageInfoData?.startCursor ?? null,
        endCursor: pageInfoData?.endCursor ?? null,
        hasPreviousPage: !!pageInfoData?.hasPreviousPage,
        hasNextPage: !!pageInfoData?.hasNextPage,
      });

      graph.putRecord(canonicalKey, {
        __typename: normalizedPage.__typename || "Connection",
        edges: { __refs: edgeRefs },
        pageInfo: { __ref: pageInfoKey },
        ...getExtras(normalizedPage),
      });

      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    // Infinite mode: merge using cursor relationships
    const { after, before, isLeader } = detectCursorRole(field, variables);
    const existing = graph.getRecord(canonicalKey);

    // Get incoming edges
    const incomingEdgeRefs: string[] = [];
    if (normalizedPage.edges?.__refs && Array.isArray(normalizedPage.edges.__refs)) {
      for (let i = 0; i < normalizedPage.edges.__refs.length; i++) {
        const ref = normalizedPage.edges.__refs[i];
        if (typeof ref === "string") {
          incomingEdgeRefs.push(ref);
        }
      }
    }

    // Get incoming pageInfo
    const incomingPageInfoRef = normalizedPage.pageInfo?.__ref;
    const incomingPageInfo = incomingPageInfoRef ? graph.getRecord(incomingPageInfoRef) : null;

    // Build prefix and suffix based on cursor
    const existingEdges = existing?.edges?.__refs || [];
    let prefix: string[] = [];
    let suffix: string[] = [];

    if (after) {
      // Forward pagination: find splice point
      const index = existingEdges.findIndex((edgeRef) => getEdgeCursor(edgeRef) === after);
      if (index >= 0) {
        // Keep everything up to and including the cursor
        prefix = existingEdges.slice(0, index + 1);
        // Everything after is discarded (suffix stays [])
      } else {
        // Cursor not found - append to end
        prefix = existingEdges;
      }
    } else if (before) {
      // Backward pagination: find splice point
      const index = existingEdges.findIndex((edgeRef) => getEdgeCursor(edgeRef) === before);
      if (index >= 0) {
        // Keep everything from the cursor onwards
        suffix = existingEdges.slice(index);
        // Everything before is discarded (prefix stays [])
      } else {
        // Cursor not found - prepend to start
        suffix = existingEdges;
      }
    } else if (isLeader) {
      // Leader: reset (no after/before)
      prefix = [];
      suffix = [];
    }

    // Merge edges: prefix + incoming + suffix
    const mergedEdges = [...prefix, ...incomingEdgeRefs, ...suffix];

    // Build pageInfo (Apollo style)
    const existingPageInfoRef = existing?.pageInfo?.__ref;
    const existingPageInfo = existingPageInfoRef ? graph.getRecord(existingPageInfoRef) : null;

    // Start with defaults, then layer incoming, then existing (existing wins by default)
    const pageInfo: Record<string, any> = {
      __typename: "PageInfo",
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: false,
      // Layer incoming values
      ...(incomingPageInfo || {}),
      // Layer existing values (wins by default - preserves current boundaries)
      ...(existingPageInfo || {}),
    };

    // Override pageInfo at boundaries (Apollo logic)
    // Only update boundary info when incoming page is actually at a boundary
    if (!prefix.length) {
      // Incoming page is at the START - it defines the new start boundary
      if (incomingPageInfo && incomingPageInfo.hasPreviousPage !== undefined) {
        pageInfo.hasPreviousPage = !!incomingPageInfo.hasPreviousPage;
      }
      if (incomingPageInfo && incomingPageInfo.startCursor !== undefined) {
        pageInfo.startCursor = incomingPageInfo.startCursor;
      }
    }

    if (!suffix.length) {
      // Incoming page is at the END - it defines the new end boundary
      if (incomingPageInfo && incomingPageInfo.hasNextPage !== undefined) {
        pageInfo.hasNextPage = !!incomingPageInfo.hasNextPage;
      }
      if (incomingPageInfo && incomingPageInfo.endCursor !== undefined) {
        pageInfo.endCursor = incomingPageInfo.endCursor;
      }
    }

    // Fallback: if pageInfo cursors are still missing, infer from edges
    if ((pageInfo.startCursor === null || pageInfo.startCursor === undefined) && mergedEdges.length > 0) {
      const firstEdgeRef = mergedEdges[0];
      const firstEdgeCursor = getEdgeCursor(firstEdgeRef);
      if (firstEdgeCursor) {
        pageInfo.startCursor = firstEdgeCursor;
      }
    }

    if ((pageInfo.endCursor === null || pageInfo.endCursor === undefined) && mergedEdges.length > 0) {
      const lastEdgeRef = mergedEdges[mergedEdges.length - 1];
      const lastEdgeCursor = getEdgeCursor(lastEdgeRef);
      if (lastEdgeCursor) {
        pageInfo.endCursor = lastEdgeCursor;
      }
    }

    // Ensure pageInfo has required fields with proper types
    pageInfo.__typename = pageInfo.__typename || "PageInfo";
    pageInfo.startCursor = pageInfo.startCursor ?? null;
    pageInfo.endCursor = pageInfo.endCursor ?? null;
    pageInfo.hasPreviousPage = !!pageInfo.hasPreviousPage;
    pageInfo.hasNextPage = !!pageInfo.hasNextPage;

    // Write pageInfo
    const pageInfoKey = `${canonicalKey}.pageInfo`;
    graph.putRecord(pageInfoKey, pageInfo);

    // Merge extra fields (incoming overrides existing)
    const existingExtras = existing ? getExtras(existing) : {};
    const incomingExtras = getExtras(normalizedPage);

    // Write canonical
    graph.putRecord(canonicalKey, {
      __typename: normalizedPage.__typename || existing?.__typename || "Connection",
      edges: { __refs: mergedEdges },
      pageInfo: { __ref: pageInfoKey },
      ...existingExtras,
      ...incomingExtras, // Incoming overrides
    });

    optimistic.replayOptimistic({ connections: [canonicalKey] });
  };

  return {
    updateConnection,
  };
};
