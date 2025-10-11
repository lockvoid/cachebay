import { buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";
import type { OptimisticInstance } from "./optimistic";

export type CanonicalDependencies = {
  graph: GraphInstance;
  optimistic: OptimisticInstance;
};

export type CanonicalInstance = ReturnType<typeof createCanonical>;

type CursorIndex = { [cursor: string]: number };

/**
 * Creates the canonical connection manager that merges paginated data
 * using Relay-style splice-based merging with cursor relationships.
 * Highly optimized for large lists (thousands of items).
 */
export const createCanonical = ({ graph, optimistic }: CanonicalDependencies) => {
  /**
   * Gets cursor from an edge (cached inline).
   */
  const getEdgeCursor = (edgeRef: string): string | null => {
    const edge = graph.getRecord(edgeRef);
    return edge?.cursor || null;
  };

  /**
   * Builds a cursor-to-index map for O(1) lookups.
   */
  const buildCursorIndex = (edgeRefs: string[]): CursorIndex => {
    const index: CursorIndex = {};
    for (let i = 0; i < edgeRefs.length; i++) {
      const cursor = getEdgeCursor(edgeRefs[i]);
      if (cursor) {
        index[cursor] = i;
      }
    }
    return index;
  };

  /**
   * Finds cursor position using index (O(1)) or fallback to scan (O(N)).
   */
  const findCursorIndex = (
    edgeRefs: string[],
    cursor: string,
    cursorIndex?: CursorIndex,
  ): number => {
    // Try index first (O(1))
    if (cursorIndex && cursor in cursorIndex) {
      return cursorIndex[cursor];
    }

    // Fallback to linear scan (O(N))
    for (let i = 0; i < edgeRefs.length; i++) {
      if (getEdgeCursor(edgeRefs[i]) === cursor) {
        return i;
      }
    }
    return -1;
  };

  /**
   * Extracts extra fields from connection (everything except edges, pageInfo, __typename, __cursorIndex).
   */
  const getExtras = (connection: Record<string, any>): Record<string, any> => {
    const extras: Record<string, any> = {};
    const keys = Object.keys(connection || {});

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "edges" || key === "pageInfo" || key === "__typename" || key === "__cursorIndex") {
        continue;
      }
      extras[key] = connection[key];
    }

    return extras;
  };

  /**
   * Detects cursor role from variables (O(1) with buildArgs).
   */
  const detectCursorRole = (
    field: PlanField,
    variables: Record<string, any>,
  ): { after: string | null; before: string | null; isLeader: boolean } => {
    const args = field.buildArgs ? (field.buildArgs(variables) || {}) : (variables || {});

    const after: string | null = args.after ?? null;
    const before: string | null = args.before ?? null;

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
        __cursorIndex: {},
      });
    }
  };

  /**
   * Merges incoming page into canonical using Relay-style splice logic.
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

    // Get incoming edges (reuse array, no copy)
    const incomingEdgeRefs = (normalizedPage.edges?.__refs as string[]) || [];

    // Page mode: replace entire canonical with incoming page
    if (mode === "page") {
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
        edges: { __refs: incomingEdgeRefs }, // Reuse array
        pageInfo: { __ref: pageInfoKey },
        __cursorIndex: buildCursorIndex(incomingEdgeRefs),
        ...getExtras(normalizedPage),
      });

      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    // Infinite mode: merge using cursor relationships
    const { after, before, isLeader } = detectCursorRole(field, variables);

    // Fast leader path: no merging needed
    if (isLeader) {
      const pageInfoRef = normalizedPage.pageInfo?.__ref;
      const pi = pageInfoRef ? graph.getRecord(pageInfoRef) : null;

      const pageInfoKey = `${canonicalKey}.pageInfo`;
      graph.putRecord(pageInfoKey, {
        __typename: pi?.__typename || "PageInfo",
        startCursor: pi?.startCursor ?? (incomingEdgeRefs[0] ? getEdgeCursor(incomingEdgeRefs[0]) : null),
        endCursor: pi?.endCursor ?? (incomingEdgeRefs.length ? getEdgeCursor(incomingEdgeRefs[incomingEdgeRefs.length - 1]) : null),
        hasPreviousPage: !!pi?.hasPreviousPage,
        hasNextPage: !!pi?.hasNextPage,
      });

      graph.putRecord(canonicalKey, {
        __typename: normalizedPage.__typename || "Connection",
        edges: { __refs: incomingEdgeRefs }, // Reuse array
        pageInfo: { __ref: pageInfoKey },
        __cursorIndex: buildCursorIndex(incomingEdgeRefs),
        ...getExtras(normalizedPage),
      });

      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    // Cache existing data (single read)
    const existing = graph.getRecord(canonicalKey);
    const existingEdges = (existing?.edges?.__refs as string[]) || [];
    const existingCursorIndex = existing?.__cursorIndex as CursorIndex | undefined;

    // Get incoming pageInfo (single read)
    const incomingPageInfoRef = normalizedPage.pageInfo?.__ref;
    const incomingPageInfo = incomingPageInfoRef ? graph.getRecord(incomingPageInfoRef) : null;

    // Determine splice indices (no array allocations yet)
    let prefixEnd = 0;
    let suffixStart = 0;
    let isPureAppend = false;
    let isPurePrepend = false;

    if (after) {
      const idx = findCursorIndex(existingEdges, after, existingCursorIndex);
      if (idx >= 0) {
        prefixEnd = idx + 1;
        suffixStart = existingEdges.length; // No suffix for forward
        isPureAppend = idx === existingEdges.length - 1;
      } else {
        // Cursor not found - append to end
        prefixEnd = existingEdges.length;
        suffixStart = existingEdges.length;
        isPureAppend = true;
      }
    } else if (before) {
      const idx = findCursorIndex(existingEdges, before, existingCursorIndex);
      if (idx >= 0) {
        prefixEnd = 0; // No prefix for backward
        suffixStart = idx;
        isPurePrepend = idx === 0;
      } else {
        // Cursor not found - prepend to start
        prefixEnd = 0;
        suffixStart = 0;
        isPurePrepend = true;
      }
    }

    // Calculate total size and preallocate
    const prefixLen = prefixEnd;
    const suffixLen = existingEdges.length - suffixStart;
    const totalLen = prefixLen + incomingEdgeRefs.length + suffixLen;
    const mergedEdges = new Array<string>(totalLen);

    // Copy ranges directly into preallocated array
    let writePos = 0;

    // Copy prefix
    for (let i = 0; i < prefixEnd; i++) {
      mergedEdges[writePos++] = existingEdges[i];
    }

    // Copy incoming
    for (let i = 0; i < incomingEdgeRefs.length; i++) {
      mergedEdges[writePos++] = incomingEdgeRefs[i];
    }

    // Copy suffix
    for (let i = suffixStart; i < existingEdges.length; i++) {
      mergedEdges[writePos++] = existingEdges[i];
    }

    // Build or update cursor index
    let newCursorIndex: CursorIndex;

    if (isPureAppend && existingCursorIndex) {
      // Incremental append: extend existing index
      newCursorIndex = { ...existingCursorIndex };
      let pos = existingEdges.length;
      for (let i = 0; i < incomingEdgeRefs.length; i++) {
        const cursor = getEdgeCursor(incomingEdgeRefs[i]);
        if (cursor) {
          newCursorIndex[cursor] = pos++;
        }
      }
    } else if (isPurePrepend && existingCursorIndex) {
      // Incremental prepend: shift existing indices
      newCursorIndex = {};
      const shift = incomingEdgeRefs.length;

      // Shift existing
      const existingKeys = Object.keys(existingCursorIndex);
      for (let i = 0; i < existingKeys.length; i++) {
        const key = existingKeys[i];
        newCursorIndex[key] = existingCursorIndex[key] + shift;
      }

      // Add new
      for (let i = 0; i < incomingEdgeRefs.length; i++) {
        const cursor = getEdgeCursor(incomingEdgeRefs[i]);
        if (cursor) {
          newCursorIndex[cursor] = i;
        }
      }
    } else {
      // General case: build while we have the merged array
      newCursorIndex = {};
      for (let i = 0; i < mergedEdges.length; i++) {
        const cursor = getEdgeCursor(mergedEdges[i]);
        if (cursor) {
          newCursorIndex[cursor] = i;
        }
      }
    }

    // Build pageInfo (Relay style)
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

    // Track if boundaries changed (optimization for skipping pageInfo write)
    let boundariesChanged = false;

    // Override pageInfo at boundaries (Relay logic)
    if (prefixLen === 0) {
      // Incoming page is at the START - it defines the new start boundary
      if (incomingPageInfo && incomingPageInfo.hasPreviousPage !== undefined) {
        const newVal = !!incomingPageInfo.hasPreviousPage;
        if (pageInfo.hasPreviousPage !== newVal) {
          pageInfo.hasPreviousPage = newVal;
          boundariesChanged = true;
        }
      }
      if (incomingPageInfo && incomingPageInfo.startCursor !== undefined) {
        if (pageInfo.startCursor !== incomingPageInfo.startCursor) {
          pageInfo.startCursor = incomingPageInfo.startCursor;
          boundariesChanged = true;
        }
      }
    }

    if (suffixLen === 0) {
      // Incoming page is at the END - it defines the new end boundary
      if (incomingPageInfo && incomingPageInfo.hasNextPage !== undefined) {
        const newVal = !!incomingPageInfo.hasNextPage;
        if (pageInfo.hasNextPage !== newVal) {
          pageInfo.hasNextPage = newVal;
          boundariesChanged = true;
        }
      }
      if (incomingPageInfo && incomingPageInfo.endCursor !== undefined) {
        if (pageInfo.endCursor !== incomingPageInfo.endCursor) {
          pageInfo.endCursor = incomingPageInfo.endCursor;
          boundariesChanged = true;
        }
      }
    }

    // Fallback: if pageInfo cursors are still missing, infer from edges
    if ((pageInfo.startCursor === null || pageInfo.startCursor === undefined) && mergedEdges.length > 0) {
      const firstEdgeCursor = getEdgeCursor(mergedEdges[0]);
      if (firstEdgeCursor) {
        pageInfo.startCursor = firstEdgeCursor;
        boundariesChanged = true;
      }
    }

    if ((pageInfo.endCursor === null || pageInfo.endCursor === undefined) && mergedEdges.length > 0) {
      const lastEdgeCursor = getEdgeCursor(mergedEdges[mergedEdges.length - 1]);
      if (lastEdgeCursor) {
        pageInfo.endCursor = lastEdgeCursor;
        boundariesChanged = true;
      }
    }

    // Ensure pageInfo has required fields with proper types
    pageInfo.__typename = pageInfo.__typename || "PageInfo";
    pageInfo.startCursor = pageInfo.startCursor ?? null;
    pageInfo.endCursor = pageInfo.endCursor ?? null;
    pageInfo.hasPreviousPage = !!pageInfo.hasPreviousPage;
    pageInfo.hasNextPage = !!pageInfo.hasNextPage;

    // Write pageInfo only if boundaries changed or it's new
    const pageInfoKey = `${canonicalKey}.pageInfo`;
    if (boundariesChanged || !existingPageInfo) {
      graph.putRecord(pageInfoKey, pageInfo);
    }

    // Merge extra fields (incoming overrides existing)
    const existingExtras = existing ? getExtras(existing) : {};
    const incomingExtras = getExtras(normalizedPage);

    // Write canonical
    graph.putRecord(canonicalKey, {
      __typename: normalizedPage.__typename || existing?.__typename || "Connection",
      edges: { __refs: mergedEdges },
      pageInfo: { __ref: pageInfoKey },
      __cursorIndex: newCursorIndex,
      ...existingExtras,
      ...incomingExtras, // Incoming overrides
    });

    optimistic.replayOptimistic({ connections: [canonicalKey] });
  };

  return {
    updateConnection,
  };
};
