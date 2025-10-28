import { buildConnectionCanonicalKey } from "../compiler/utils";
import {
  TYPENAME_FIELD,
  CONNECTION_EDGES_FIELD,
  CONNECTION_PAGE_INFO_FIELD,
  CONNECTION_TYPENAME,
  CONNECTION_PAGE_INFO_TYPENAME
} from "./constants";
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
   * Helper to get cursor index key for a canonical key.
   */
  const getCursorIndexKey = (canonicalKey: string): string => {
    return `${canonicalKey}::cursorIndex`;
  };

  /**
   * Reads cursor index from graph.
   */
  const readCursorIndex = (canonicalKey: string): CursorIndex => {
    const index = graph.getRecord(getCursorIndexKey(canonicalKey));
    return (index as CursorIndex) || {};
  };

  /**
   * Writes cursor index to graph.
   */
  const writeCursorIndex = (canonicalKey: string, index: CursorIndex): void => {
    graph.putRecord(getCursorIndexKey(canonicalKey), index);
  };

  /**
   * Gets cursor from an edge.
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
  const findCursorIndex = (edgeRefs: string[], cursor: string, cursorIndex?: CursorIndex): number => {
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
   * Extracts extra fields from connection (everything except edges, pageInfo, __typename).
   */
  const getExtras = (connection: Record<string, any>): Record<string, any> => {
    const extras: Record<string, any> = {};
    const keys = Object.keys(connection || {});

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === CONNECTION_EDGES_FIELD || key === CONNECTION_PAGE_INFO_FIELD || key === TYPENAME_FIELD) {
        continue;
      }
      extras[key] = connection[key];
    }

    return extras;
  };

  /**
   * Detects cursor role from variables (O(1) with buildArgs).
   */
  const detectCursorRole = (field: PlanField, variables: Record<string, any>): { after: string | null; before: string | null; isLeader: boolean } => {
    const args = field.buildArgs ? (field.buildArgs(variables) || {}) : (variables || {});

    const after: string | null = args.after ?? null;
    const before: string | null = args.before ?? null;
    const isLeader = !after && !before;

    return { after, before, isLeader };
  };

  /**
   * Ensures canonical record exists (prevents undefined reads).
   */
  const ensureCanonical = (canonicalKey: string): void => {
    if (graph.getRecord(canonicalKey)) {
      return;
    }

    const pageInfoKey = `${canonicalKey}.pageInfo`;
    graph.putRecord(pageInfoKey, {
      __typename: CONNECTION_PAGE_INFO_TYPENAME,
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: false,
    });

    graph.putRecord(canonicalKey, {
      __typename: CONNECTION_TYPENAME,
      edges: { __refs: [] },
      pageInfo: { __ref: pageInfoKey },
    });

    writeCursorIndex(canonicalKey, {});
  };

  /**
   * Merges incoming page into canonical using Relay-style splice logic.
   * Handles forward (after), backward (before), and leader (reset) pagination.
   */
  const updateConnection = (args: {
    field: PlanField;
    parentId: string;
    variables: Record<string, any>;
    normalizedPage: Record<string, any>;
  }): void => {
    const { field, parentId, variables, normalizedPage } = args;
    const canonicalKey = buildConnectionCanonicalKey(field, parentId, variables);

    ensureCanonical(canonicalKey);

    const incomingEdgeRefs = (normalizedPage.edges?.__refs as string[]) || [];

    // Page mode: replace entire canonical with incoming page
    if (field.connectionMode === "page") {
      const pageInfoRef = normalizedPage.pageInfo?.__ref;
      const pageInfoData = pageInfoRef ? graph.getRecord(pageInfoRef) : null;

      const pageInfoKey = `${canonicalKey}.pageInfo`;
      graph.putRecord(pageInfoKey, {
        __typename: pageInfoData?.__typename || CONNECTION_PAGE_INFO_TYPENAME,
        startCursor: pageInfoData?.startCursor ?? null,
        endCursor: pageInfoData?.endCursor ?? null,
        hasPreviousPage: !!pageInfoData?.hasPreviousPage,
        hasNextPage: !!pageInfoData?.hasNextPage,
      });

      graph.putRecord(canonicalKey, {
        __typename: normalizedPage.__typename || CONNECTION_TYPENAME,
        edges: { __refs: incomingEdgeRefs },
        pageInfo: { __ref: pageInfoKey },
        ...getExtras(normalizedPage),
      });

      writeCursorIndex(canonicalKey, buildCursorIndex(incomingEdgeRefs));
      optimistic.replayOptimistic({ connections: [canonicalKey] });
      return;
    }

    // Infinite mode: merge using cursor relationships
    const { after, before, isLeader } = detectCursorRole(field, variables);

    // Cache existing data
    const existing = graph.getRecord(canonicalKey);
    const existingEdges = (existing?.edges?.__refs as string[]) || [];
    const existingCursorIndex = readCursorIndex(canonicalKey);

    const incomingPageInfo = graph.getRecord(normalizedPage.pageInfo?.__ref) || {};

    // Determine splice indices (no array allocations yet)
    let prefixEnd = 0;
    let suffixStart = 0;
    let isPureAppend = false;
    let isPurePrepend = false;

    if (isLeader) {
      // Leader: reset everything (discard all existing edges)
      prefixEnd = 0;
      suffixStart = existingEdges.length; // Start suffix past the end = no suffix
    } else if (after) {
      const idx = findCursorIndex(existingEdges, after, existingCursorIndex);
      if (idx >= 0) {
        prefixEnd = idx + 1;
        suffixStart = existingEdges.length;
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
        prefixEnd = 0;
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

    for (let i = 0; i < prefixEnd; i++) {
      mergedEdges[writePos++] = existingEdges[i];
    }

    for (let i = 0; i < incomingEdgeRefs.length; i++) {
      mergedEdges[writePos++] = incomingEdgeRefs[i];
    }

    for (let i = suffixStart; i < existingEdges.length; i++) {
      mergedEdges[writePos++] = existingEdges[i];
    }

    // Build or update cursor index (copy-on-write optimization)
    let newCursorIndex: CursorIndex = existingCursorIndex;
    let copied = false;

    const ensureCopy = () => {
      if (!copied) {
        newCursorIndex = { ...existingCursorIndex };
        copied = true;
      }
    };

    if (isPureAppend && Object.keys(existingCursorIndex).length > 0) {
      // Incremental append: extend existing index
      let pos = existingEdges.length;
      for (let i = 0; i < incomingEdgeRefs.length; i++) {
        const cursor = getEdgeCursor(incomingEdgeRefs[i]);
        if (cursor) {
          ensureCopy();
          newCursorIndex[cursor] = pos++;
        }
      }
    } else if (isPurePrepend && Object.keys(existingCursorIndex).length > 0) {
      // Incremental prepend: shift existing indices
      newCursorIndex = {};
      copied = true;
      const shift = incomingEdgeRefs.length;

      const existingKeys = Object.keys(existingCursorIndex);
      for (let i = 0; i < existingKeys.length; i++) {
        const key = existingKeys[i];
        newCursorIndex[key] = existingCursorIndex[key] + shift;
      }

      for (let i = 0; i < incomingEdgeRefs.length; i++) {
        const cursor = getEdgeCursor(incomingEdgeRefs[i]);
        if (cursor) {
          newCursorIndex[cursor] = i;
        }
      }
    } else {
      // General case: rebuild full index
      newCursorIndex = {};
      copied = true;
      for (let i = 0; i < mergedEdges.length; i++) {
        const cursor = getEdgeCursor(mergedEdges[i]);
        if (cursor) {
          newCursorIndex[cursor] = i;
        }
      }
    }

    // Write cursor index only if changed
    if (copied) {
      writeCursorIndex(canonicalKey, newCursorIndex);
    }

    // Build pageInfo
    const existingPageInfo = graph.getRecord(existing?.pageInfo?.__ref) || {};

    // Extract boundary fields from incoming
    const { hasPreviousPage, hasNextPage, startCursor, endCursor, __typename, ...incomingPageInfoExtras } = incomingPageInfo;

    // Start from existing, apply incoming extras
    const pageInfo: any = {
      __typename,
      ...existingPageInfo,
      ...incomingPageInfoExtras,
    };

    // Track if boundaries changed
    let boundariesChanged = false;

    // Override boundary fields based on position (Relay logic)
    if (prefixLen === 0) {
      if (hasPreviousPage !== undefined) {
        const newVal = !!hasPreviousPage;
        if (pageInfo.hasPreviousPage !== newVal) {
          pageInfo.hasPreviousPage = newVal;
          boundariesChanged = true;
        }
      }
      if (startCursor !== undefined) {
        if (pageInfo.startCursor !== startCursor) {
          pageInfo.startCursor = startCursor;
          boundariesChanged = true;
        }
      }
    }

    if (suffixLen === 0) {
      if (hasNextPage !== undefined) {
        const newVal = !!hasNextPage;
        if (pageInfo.hasNextPage !== newVal) {
          pageInfo.hasNextPage = newVal;
          boundariesChanged = true;
        }
      }
      if (endCursor !== undefined) {
        if (pageInfo.endCursor !== endCursor) {
          pageInfo.endCursor = endCursor;
          boundariesChanged = true;
        }
      }
    }

    // Fallback: infer cursors from edges if missing
    if (pageInfo.startCursor == null && mergedEdges.length > 0) {
      const firstEdgeCursor = getEdgeCursor(mergedEdges[0]);
      if (firstEdgeCursor) {
        pageInfo.startCursor = firstEdgeCursor;
        boundariesChanged = true;
      }
    }

    if (pageInfo.endCursor == null && mergedEdges.length > 0) {
      const lastEdgeCursor = getEdgeCursor(mergedEdges[mergedEdges.length - 1]);
      if (lastEdgeCursor) {
        pageInfo.endCursor = lastEdgeCursor;
        boundariesChanged = true;
      }
    }

    // Ensure pageInfo has required fields
    pageInfo.__typename = pageInfo.__typename || CONNECTION_PAGE_INFO_TYPENAME;
    pageInfo.startCursor = pageInfo.startCursor ?? null;
    pageInfo.endCursor = pageInfo.endCursor ?? null;
    pageInfo.hasPreviousPage = !!pageInfo.hasPreviousPage;
    pageInfo.hasNextPage = !!pageInfo.hasNextPage;

    // Write pageInfo only if changed
    const pageInfoKey = `${canonicalKey}.pageInfo`;

    if (boundariesChanged || !existingPageInfo) {
      graph.putRecord(pageInfoKey, pageInfo);
    }

    // Merge extra fields (incoming overrides existing)
    const existingExtras = existing ? getExtras(existing) : {};
    const incomingConnectionExtras = getExtras(normalizedPage);

    // Write canonical
    graph.putRecord(canonicalKey, {
      __typename: normalizedPage.__typename || existing?.__typename || CONNECTION_TYPENAME,
      edges: { __refs: mergedEdges },
      pageInfo: { __ref: pageInfoKey },
      ...existingExtras,
      ...incomingConnectionExtras,
    });

    optimistic.replayOptimistic({ connections: [canonicalKey] });
  };

  return {
    updateConnection,
  };
};
