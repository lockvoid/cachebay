import { ROOT_ID } from "./constants";
import { buildConnectionCanonicalKey } from "../compiler/utils";
import type { GraphInstance } from "./graph";

type OptimisticDependencies = { graph: GraphInstance };

const ENTITY_WRITE = Symbol("EntityWrite");
const ENTITY_DELETE = Symbol("EntityDelete");
const CONNECTION_ADD_NODE = Symbol("ConnectionAddNode");
const CONNECTION_REMOVE_NODE = Symbol("ConnectionRemoveNode");
const CONNECTION_PATCH = Symbol("ConnectionPatch");
const EDGE_INDEX_REGEX = /\.edges:(\d+)$/;

type EntityOp =
  | { kind: typeof ENTITY_WRITE; recordId: string; patch: Record<string, any>; policy: "merge" | "replace" }
  | { kind: typeof ENTITY_DELETE; recordId: string };

type ConnectionOp =
  | {
    kind: typeof CONNECTION_ADD_NODE;
    connectionKey: string;
    entityKey: string;
    meta?: any;
    position: "start" | "end" | "before" | "after";
    anchor?: string | null;
  }
  | { kind: typeof CONNECTION_REMOVE_NODE; connectionKey: string; entityKey: string }
  | { kind: typeof CONNECTION_PATCH; connectionKey: string; patch: Record<string, any> };

type Layer = {
  id: number;
  entityOps: EntityOp[];
  connectionOps: ConnectionOp[];
  touched: Set<string>;
  localBase: Map<string, any | null>;
  builder: (tx: BuilderInstance, ctx: BuilderContext) => void;
};

type ConnectionArgs = {
  parent: "Query" | string | { __typename?: string; id?: any };
  key: string;
  filters?: Record<string, any>;
};

type EntityRef = string | { __typename?: string; id?: any };

type PatchInput = Record<string, any> | ((prev: any) => Record<string, any>);

type ConnectionAPI = {
  addNode: (
    node: any,
    opts?: { position?: "start" | "end" | "before" | "after"; anchor?: EntityRef; edge?: Record<string, any> },
  ) => void;
  removeNode: (ref: EntityRef) => void;
  patch: (patchOrFn: PatchInput) => void;
  key: string;
};

type BuilderInstance = {
  patch: (target: EntityRef, patchOrFn: PatchInput, opts?: { mode?: "merge" | "replace" }) => void;
  delete: (target: EntityRef) => void;
  connection: (argsOrKey: ConnectionArgs | string) => ConnectionAPI;
};

type BuilderContext = {
  phase: "optimistic" | "commit";
  data?: any;
};

export type OptimisticTransaction = {
  commit: (data?: any) => void;
  revert: () => void;
};

const cloneJSON = <T,>(value: T): T => {
  return JSON.parse(JSON.stringify(value));
};

const parseRecordId = (recordId: string): { typename?: string; id?: string } => {
  const colonIndex = recordId.indexOf(":");

  if (colonIndex < 0) {
    return {};
  }

  return {
    typename: recordId.slice(0, colonIndex) || undefined,
    id: recordId.slice(colonIndex + 1) || undefined,
  };
};

const isCanonicalKey = (id: string): boolean => {
  return id.startsWith("@connection.");
};

const extractEdgeMeta = (meta: any): any => {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }

  const result: any = {};

  for (const key in meta) {
    if (key !== "cursor") {
      result[key] = meta[key];
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const getCursorIndexKey = (canonicalKey: string): string => {
  return `${canonicalKey}::cursorIndex`;
};

const readCursorIndex = (graph: GraphInstance, canonicalKey: string): Record<string, number> => {
  const index = graph.getRecord(getCursorIndexKey(canonicalKey));
  return (index as Record<string, number>) || {};
};

const writeCursorIndex = (graph: GraphInstance, canonicalKey: string, index: Record<string, number>): void => {
  graph.putRecord(getCursorIndexKey(canonicalKey), index);
};

const writeCursorIndexPatch = (graph: GraphInstance, canonicalKey: string, patch: Record<string, number | undefined>): void => {
  graph.putRecord(getCursorIndexKey(canonicalKey), patch);
};

const getEdgeCursor = (graph: GraphInstance, edgeRef: string): string | null => {
  const edge = graph.getRecord(edgeRef);
  return edge?.cursor || null;
};

const shiftCursorIndicesAfter = (graph: GraphInstance, canonicalKey: string, fromPosition: number, shift: number): void => {
  if (shift === 0) {
    return;
  }

  const cursorIndex = readCursorIndex(graph, canonicalKey);
  const keys = Object.keys(cursorIndex);

  if (keys.length === 0) {
    return;
  }

  const patch: Record<string, number> = {};
  let hasChanges = false;

  for (let i = 0; i < keys.length; i++) {
    const cursor = keys[i];
    const pos = cursorIndex[cursor];

    if (pos >= fromPosition) {
      patch[cursor] = pos + shift;
      hasChanges = true;
    }
  }

  if (hasChanges) {
    writeCursorIndexPatch(graph, canonicalKey, patch);
  }
};

const addCursorToIndex = (graph: GraphInstance, canonicalKey: string, cursor: string, position: number): void => {
  const cursorIndex = readCursorIndex(graph, canonicalKey);

  if (cursor in cursorIndex) {
    return;
  }

  writeCursorIndexPatch(graph, canonicalKey, { [cursor]: position });
};

const removeCursorFromIndex = (graph: GraphInstance, canonicalKey: string, cursor: string): void => {
  const cursorIndex = readCursorIndex(graph, canonicalKey);

  if (!(cursor in cursorIndex)) {
    return;
  }

  graph.putRecord(getCursorIndexKey(canonicalKey), { [cursor]: undefined });
};

const getEdgeRefs = (canonical: any): string[] => {
  const edgesField = canonical?.edges;

  if (!edgesField || typeof edgesField !== "object") {
    return [];
  }

  return Array.isArray(edgesField.__refs) ? edgesField.__refs : [];
};

const setEdgeRefs = (canonical: any, refs: string[]): void => {
  if (!canonical.edges || typeof canonical.edges !== "object") {
    canonical.edges = { __refs: refs };
  } else {
    canonical.edges.__refs = refs;
  }
};

const shallowCopy = (source: any): any => {
  const result: any = {};

  for (const key in source) {
    result[key] = source[key];
  }

  return result;
};

// === Edge key counter (avoids O(n) scans for next index) ===

const getEdgeCounterKey = (canonicalKey: string): string => {
  return `${canonicalKey}::edgeCounter`;
};

const readEdgeCounter = (graph: GraphInstance, canonicalKey: string): number => {
  const rec = graph.getRecord(getEdgeCounterKey(canonicalKey));
  // Store as object { value } to align with patch semantics of putRecord
  if (rec && typeof rec === "object" && typeof (rec as any).value === "number") {
    return (rec as any).value as number;
  }
  return 0;
};

const nextEdgeIndex = (graph: GraphInstance, canonicalKey: string): number => {
  const next = readEdgeCounter(graph, canonicalKey) + 1;
  graph.putRecord(getEdgeCounterKey(canonicalKey), { value: next });
  return next;
};

// Kept for back-compat in case it's ever called elsewhere.
// Now falls back to regex scan ONLY if no counter is present.
const findNextEdgeIndex = (canonical: any, graph?: GraphInstance, canonicalKey?: string): number => {
  if (graph && canonicalKey) {
    return nextEdgeIndex(graph, canonicalKey);
  }

  const refs = getEdgeRefs(canonical);

  if (refs.length === 0) {
    return 0;
  }

  let maxIndex = -1;

  for (let i = 0; i < refs.length; i++) {
    const match = refs[i]?.match(EDGE_INDEX_REGEX);

    if (match) {
      const number = Number(match[1]);

      if (!Number.isNaN(number) && number > maxIndex) {
        maxIndex = number;
      }
    }
  }

  return maxIndex + 1;
};

const findEdgeByNode = (graph: GraphInstance, refs: string[], entityKey: string): number => {
  for (let i = 0; i < refs.length; i++) {
    const edge = graph.getRecord(refs[i]);

    if (edge?.node?.__ref === entityKey) {
      return i;
    }
  }

  return -1;
};

const findAnchorIndex = (graph: GraphInstance, refs: string[], anchorKey: string): number => {
  for (let i = 0; i < refs.length; i++) {
    const edge = graph.getRecord(refs[i]);

    if (edge?.node?.__ref === anchorKey) {
      return i;
    }
  }

  const anchorId = anchorKey.includes(":") ? anchorKey.slice(anchorKey.indexOf(":") + 1) : anchorKey;

  for (let i = 0; i < refs.length; i++) {
    const edge = graph.getRecord(refs[i]);
    const nodeKey = edge?.node?.__ref;

    if (!nodeKey) {
      continue;
    }

    const node = graph.getRecord(nodeKey);

    if (node?.id != null && String(node.id) === String(anchorId)) {
      return i;
    }
  }

  return -1;
};

const insertEdge = (
  graph: GraphInstance,
  canonicalKey: string,
  canonical: any,
  entityKey: string,
  edgeMeta: any,
  position: "start" | "end" | "before" | "after",
  anchorKey?: string | null,
): void => {
  const refs = getEdgeRefs(canonical);
  const existingIndex = findEdgeByNode(graph, refs, entityKey);

  if (existingIndex >= 0) {
    if (edgeMeta) {
      graph.putRecord(refs[existingIndex]!, shallowCopy(edgeMeta));
    }
    return;
  }

  // Use O(1) counter instead of scanning existing refs
  const edgeIndex = findNextEdgeIndex(canonical, graph, canonicalKey);
  const edgeKey = `${canonicalKey}.edges.${edgeIndex}`;
  const nodeType = entityKey.split(":")[0]?.trim() || "";
  const edgeTypename = nodeType ? `${nodeType}Edge` : "Edge";

  const edgeRecord: any = {
    __typename: edgeTypename,
    node: { __ref: entityKey },
  };

  if (edgeMeta) {
    for (const key in edgeMeta) {
      edgeRecord[key] = edgeMeta[key];
    }
  }

  graph.putRecord(edgeKey, edgeRecord);

  const newRefs = [...refs];
  let insertPosition: number;

  if (position === "start") {
    newRefs.unshift(edgeKey);
    insertPosition = 0;
  } else if (position === "end") {
    newRefs.push(edgeKey);
    insertPosition = newRefs.length - 1;
  } else {
    const insertAt = anchorKey ? findAnchorIndex(graph, refs, anchorKey) : -1;

    if (insertAt < 0) {
      if (position === "before") {
        newRefs.unshift(edgeKey);
        insertPosition = 0;
      } else {
        newRefs.push(edgeKey);
        insertPosition = newRefs.length - 1;
      }
    } else {
      insertPosition = position === "before" ? insertAt : insertAt + 1;
      newRefs.splice(insertPosition, 0, edgeKey);
    }
  }

  setEdgeRefs(canonical, newRefs);

  const cursor = getEdgeCursor(graph, edgeKey);
  if (cursor) {
    if (insertPosition < refs.length) {
      shiftCursorIndicesAfter(graph, canonicalKey, insertPosition, 1);
    }
    addCursorToIndex(graph, canonicalKey, cursor, insertPosition);
  } else if (insertPosition < refs.length) {
    shiftCursorIndicesAfter(graph, canonicalKey, insertPosition, 1);
  }
};

const removeEdge = (graph: GraphInstance, canonicalKey: string, canonical: any, entityKey: string): boolean => {
  const refs = getEdgeRefs(canonical);

  for (let i = 0; i < refs.length; i++) {
    const edge = graph.getRecord(refs[i]);

    if (edge?.node?.__ref === entityKey) {
      const newRefs = [...refs];
      newRefs.splice(i, 1);
      setEdgeRefs(canonical, newRefs);

      const cursor = getEdgeCursor(graph, refs[i]);
      if (cursor) {
        removeCursorFromIndex(graph, canonicalKey, cursor);
      }
      shiftCursorIndicesAfter(graph, canonicalKey, i + 1, -1);

      return true;
    }
  }

  return false;
};

const createEmptyCanonical = (canonicalKey: string): any => {
  return {
    __typename: "Connection",
    edges: { __refs: [] },
    pageInfo: { __ref: `${canonicalKey}.pageInfo` },
  };
};

const cloneCanonical = (canonical: any): any => {
  return {
    __typename: canonical.__typename,
    edges: { __refs: [...getEdgeRefs(canonical)] },
    pageInfo: canonical.pageInfo || {},
  };
};

const ensurePageInfo = (graph: GraphInstance, canonicalKey: string): void => {
  const pageInfoKey = `${canonicalKey}.pageInfo`;
  if (!graph.getRecord(pageInfoKey)) {
    graph.putRecord(pageInfoKey, { __typename: "PageInfo" });
  }
};

const patchPageInfo = (graph: GraphInstance, canonical: any, pageInfoPatch: any): void => {
  const pageInfoRef = canonical.pageInfo?.__ref;

  if (!pageInfoRef) {
    return;
  }

  const current = graph.getRecord(pageInfoRef) || {};
  const updated = shallowCopy(current);

  for (const key in pageInfoPatch) {
    updated[key] = pageInfoPatch[key];
  }

  graph.putRecord(pageInfoRef, updated);
};

const writeEntity = (graph: GraphInstance, recordId: string, patch: Record<string, any>, policy: "merge" | "replace"): void => {
  const prevRecord = graph.getRecord(recordId);
  const { typename, id } = parseRecordId(recordId);

  if (policy === "replace" || !prevRecord) {
    const nextTypename = (patch.__typename as string) ?? typename ?? prevRecord?.__typename;
    const nextId = (patch.id != null ? String(patch.id) : undefined) ?? id ?? prevRecord?.id;
    const record = shallowCopy(patch);

    if (record.__typename === undefined && nextTypename) {
      record.__typename = nextTypename;
    }

    if (record.id === undefined && nextId) {
      record.id = nextId;
    }

    graph.putRecord(recordId, record);
  } else {
    graph.putRecord(recordId, patch);
  }
};

const deleteEntity = (graph: GraphInstance, recordId: string): void => {
  graph.removeRecord(recordId);
};

const restoreEntity = (graph: GraphInstance, recordId: string, snapshot: any | null): void => {
  if (snapshot === null) {
    graph.removeRecord(recordId);
    return;
  }

  const current = graph.getRecord(recordId);

  if (current) {
    const deletions: Record<string, any> = {};

    for (const key in current) {
      if (!(key in snapshot)) {
        deletions[key] = undefined;
      }
    }

    if (Object.keys(deletions).length > 0) {
      graph.putRecord(recordId, deletions);
    }
  }

  graph.putRecord(recordId, snapshot);
};

const captureBaseline = (layer: Layer, graph: GraphInstance, recordId: string): void => {
  if (layer.touched.has(recordId)) {
    return;
  }

  layer.touched.add(recordId);

  if (!layer.localBase.has(recordId)) {
    const snapshot = graph.getRecord(recordId);
    layer.localBase.set(recordId, snapshot ? cloneJSON(snapshot) : null);
  }
};

const applyEntityOp = (graph: GraphInstance, op: EntityOp): void => {
  if (op.kind === ENTITY_WRITE) {
    writeEntity(graph, op.recordId, op.patch, op.policy);
  } else {
    deleteEntity(graph, op.recordId);
  }
};

const applyConnectionOp = (graph: GraphInstance, op: ConnectionOp): void => {
  let canonical = graph.getRecord(op.connectionKey);

  if (!canonical || typeof canonical !== "object") {
    canonical = createEmptyCanonical(op.connectionKey);
    if (op.kind !== CONNECTION_REMOVE_NODE) {
      ensurePageInfo(graph, op.connectionKey);
    }
  } else {
    canonical = cloneCanonical(canonical);
  }

  if (op.kind === CONNECTION_ADD_NODE) {
    insertEdge(graph, op.connectionKey, canonical, op.entityKey, op.meta, op.position, op.anchor);
  } else if (op.kind === CONNECTION_REMOVE_NODE) {
    removeEdge(graph, op.connectionKey, canonical, op.entityKey);
  } else {
    if (op.patch.pageInfo) {
      patchPageInfo(graph, canonical, op.patch.pageInfo);
    }

    for (const key in op.patch) {
      if (key !== "pageInfo") {
        canonical[key] = op.patch[key];
      }
    }
  }

  graph.putRecord(op.connectionKey, canonical);
};

const recordOp = (layer: Layer, graph: GraphInstance, op: EntityOp | ConnectionOp): void => {
  const recordId = "recordId" in op ? op.recordId : op.connectionKey;
  captureBaseline(layer, graph, recordId);

  if ("recordId" in op) {
    applyEntityOp(graph, op);
  } else {
    applyConnectionOp(graph, op);
  }
};

const revertEntities = (layer: Layer, graph: GraphInstance): void => {
  for (const [recordId, snapshot] of layer.localBase) {
    if (!isCanonicalKey(recordId)) {
      restoreEntity(graph, recordId, snapshot);
    }
  }
};

const revertConnectionOp = (layer: Layer, graph: GraphInstance, op: ConnectionOp): void => {
  let canonical = graph.getRecord(op.connectionKey);

  if (!canonical || typeof canonical !== "object") {
    canonical = createEmptyCanonical(op.connectionKey);
  } else {
    canonical = cloneCanonical(canonical);
  }

  if (op.kind === CONNECTION_ADD_NODE) {
    removeEdge(graph, op.connectionKey, canonical, op.entityKey);
    graph.putRecord(op.connectionKey, canonical);
    return;
  }

  if (op.kind === CONNECTION_REMOVE_NODE) {
    const baseline = layer.localBase.get(op.connectionKey) || {};
    const baseRefs = getEdgeRefs(baseline);

    let edgeRef: string | null = null;

    for (let i = 0; i < baseRefs.length; i++) {
      const edge = graph.getRecord(baseRefs[i]);
      if (edge?.node?.__ref === op.entityKey) {
        edgeRef = baseRefs[i];
        break;
      }
    }

    if (edgeRef) {
      const wantIndex = baseRefs.indexOf(edgeRef);
      const currentRefs = getEdgeRefs(canonical);

      if (!currentRefs.includes(edgeRef)) {
        const newRefs = [...currentRefs];
        const insertPosition = Math.max(0, Math.min(wantIndex, newRefs.length));
        newRefs.splice(insertPosition, 0, edgeRef);
        setEdgeRefs(canonical, newRefs);

        const cursor = getEdgeCursor(graph, edgeRef);
        if (cursor) {
          if (insertPosition < currentRefs.length) {
            shiftCursorIndicesAfter(graph, op.connectionKey, insertPosition, 1);
          }
          addCursorToIndex(graph, op.connectionKey, cursor, insertPosition);
        } else if (insertPosition < currentRefs.length) {
          shiftCursorIndicesAfter(graph, op.connectionKey, insertPosition, 1);
        }
      }
    } else {
      insertEdge(graph, op.connectionKey, canonical, op.entityKey, undefined, "end", null);
    }

    graph.putRecord(op.connectionKey, canonical);
    return;
  }

  if (op.kind === CONNECTION_PATCH) {
    const baseline = layer.localBase.get(op.connectionKey) || {};

    if (op.patch.pageInfo) {
      const pageInfoRef = canonical.pageInfo?.__ref;

      if (pageInfoRef) {
        const basePageInfo = baseline.pageInfo?.__ref ? graph.getRecord(baseline.pageInfo.__ref) || {} : {};
        const current = graph.getRecord(pageInfoRef) || {};
        const updated = shallowCopy(current);

        for (const key in op.patch.pageInfo) {
          const baseValue = basePageInfo[key];

          if (baseValue === undefined) {
            delete updated[key];
          } else {
            updated[key] = baseValue;
          }
        }

        graph.putRecord(pageInfoRef, updated);
      }
    }

    for (const key in op.patch) {
      if (key === "pageInfo") {
        continue;
      }

      const baseValue = baseline[key];
      if (baseValue === undefined) {
        delete canonical[key];
      } else {
        canonical[key] = baseValue;
      }
    }

    graph.putRecord(op.connectionKey, canonical);
  }
};

const revertConnections = (layer: Layer, graph: GraphInstance): void => {
  for (let i = layer.connectionOps.length - 1; i >= 0; i--) {
    revertConnectionOp(layer, graph, layer.connectionOps[i]);
  }
};

export const createOptimistic = ({ graph }: OptimisticDependencies) => {
  const pending = new Set<Layer>();
  let nextLayerId = 1;

  const resolveParentId = (parent: "Query" | string | { __typename?: string; id?: any }): string => {
    if (typeof parent === "string") {
      return parent === "Query" ? ROOT_ID : parent;
    }

    if (parent === "Query") {
      return ROOT_ID;
    }

    return graph.identify(parent) || ROOT_ID;
  };

  const createBuilder = (layer: Layer, recording: boolean): BuilderInstance => {
    const ensureEntity = (node: any): string | null => {
      const entityKey = graph.identify(node);

      if (!entityKey) {
        return null;
      }

      // Avoid no-op writes (perf): if node only has __typename/id, skip the merge
      const patch: any = {};
      for (const key in node) {
        if (key !== "__typename" && key !== "id") {
          patch[key] = node[key];
        }
      }
      const hasFields = Object.keys(patch).length > 0;

      const op: EntityOp = { kind: ENTITY_WRITE, recordId: entityKey, patch, policy: "merge" };

      if (recording) {
        if (hasFields) {
          layer.entityOps.push(op);
          recordOp(layer, graph, op);
        }
      } else {
        if (hasFields) {
          writeEntity(graph, entityKey, patch, "merge");
        }
      }

      return entityKey;
    };

    const resolveAnchor = (anchor?: string | { __typename: string; id: any } | null): string | null => {
      if (!anchor) {
        return null;
      }

      return typeof anchor === "string" ? anchor : graph.identify(anchor) || null;
    };

    return {
      patch(target, patchOrFn, opts) {
        const recordId = typeof target === "string" ? target : graph.identify(target);
        if (!recordId) {
          return;
        }

        const previous = graph.getRecord(recordId) || {};
        const delta = typeof patchOrFn === "function" ? patchOrFn(cloneJSON(previous)) : patchOrFn;

        if (!delta || typeof delta !== "object") {
          return;
        }

        // Skip empty patch objects
        let hasAny = false;
        for (const _ in delta) {
          hasAny = true;
          break;
        }
        if (!hasAny) {
          return;
        }

        const mode = opts?.mode ?? "merge";
        const patch = shallowCopy(delta);
        const op: EntityOp = { kind: ENTITY_WRITE, recordId, patch, policy: mode };

        if (recording) {
          layer.entityOps.push(op);
          recordOp(layer, graph, op);
        } else {
          writeEntity(graph, recordId, patch, mode);
        }
      },

      delete(target) {
        const recordId = typeof target === "string" ? target : graph.identify(target);
        if (!recordId) {
          return;
        }

        const op: EntityOp = { kind: ENTITY_DELETE, recordId };

        if (recording) {
          layer.entityOps.push(op);
          recordOp(layer, graph, op);
        } else {
          deleteEntity(graph, recordId);
        }
      },

      connection(input) {
        let canonicalKey: string;

        if (typeof input === "string") {
          canonicalKey = input;
        } else {
          const parent = resolveParentId(input.parent);
          const filters = input.filters || {};
          const filterKeys = Object.keys(filters);

          canonicalKey = buildConnectionCanonicalKey(
            {
              fieldName: input.key,
              buildArgs: (v: any) => v || {},
              connectionFilters: filterKeys,
            } as any,
            parent,
            filters,
          );
        }

        return {
          addNode(node, opts = {}) {
            const entityKey = ensureEntity(node);
            if (!entityKey) {
              return;
            }

            const meta = extractEdgeMeta(opts.edge);
            const position = opts.position ?? "end";
            const anchor = resolveAnchor(opts.anchor);

            const op: ConnectionOp = {
              kind: CONNECTION_ADD_NODE,
              connectionKey: canonicalKey,
              entityKey,
              meta,
              position,
              anchor,
            };

            if (recording) {
              layer.connectionOps.push(op);
              recordOp(layer, graph, op);
            } else {
              applyConnectionOp(graph, op);
            }
          },

          removeNode(ref) {
            const entityKey = typeof ref === "string" ? ref : graph.identify(ref);
            if (!entityKey) {
              return;
            }

            const op: ConnectionOp = { kind: CONNECTION_REMOVE_NODE, connectionKey: canonicalKey, entityKey };

            if (recording) {
              layer.connectionOps.push(op);
              recordOp(layer, graph, op);
            } else {
              applyConnectionOp(graph, op);
            }
          },

          patch(patchOrFn) {
            const previous = graph.getRecord(canonicalKey) || {};
            const delta = typeof patchOrFn === "function" ? patchOrFn(cloneJSON(previous)) : patchOrFn;

            if (!delta || typeof delta !== "object") {
              return;
            }

            // Skip empty patch objects
            let hasAny = false;
            for (const _ in delta) {
              hasAny = true;
              break;
            }
            if (!hasAny) {
              return;
            }

            const patch = shallowCopy(delta);
            const op: ConnectionOp = { kind: CONNECTION_PATCH, connectionKey: canonicalKey, patch };

            if (recording) {
              layer.connectionOps.push(op);
              recordOp(layer, graph, op);
            } else {
              applyConnectionOp(graph, op);
            }
          },

          key: canonicalKey,
        };
      },
    };
  };

  const modifyOptimistic = (builder: (tx: BuilderInstance, ctx: BuilderContext) => void): OptimisticTransaction => {
    const layer: Layer = {
      id: nextLayerId++,
      entityOps: [],
      connectionOps: [],
      touched: new Set(),
      localBase: new Map(),
      builder,
    };

    pending.add(layer);

    builder(createBuilder(layer, true), { phase: "optimistic" });

    return {
      commit(data?: any) {
        revertEntities(layer, graph);
        revertConnections(layer, graph);

        layer.localBase.clear();
        layer.entityOps.length = 0;
        layer.connectionOps.length = 0;
        layer.touched.clear();

        layer.builder(createBuilder(layer, false), { phase: "commit", data });
        pending.delete(layer);
      },

      revert() {
        if (!pending.delete(layer)) {
          return;
        }

        revertEntities(layer, graph);
        revertConnections(layer, graph);

        layer.localBase.clear();
        layer.entityOps.length = 0;
        layer.connectionOps.length = 0;
        layer.touched.clear();
      },
    };
  };

  const replayOptimistic = (hint?: { connections?: string[]; entities?: string[] }): { added: string[]; removed: string[] } => {
    const connectionScope = hint?.connections ? new Set(hint.connections) : null;
    const entityScope = hint?.entities ? new Set(hint.entities) : null;

    const added: string[] = [];
    const removed: string[] = [];

    const sortedLayers = Array.from(pending).sort((a, b) => a.id - b.id);

    for (const layer of sortedLayers) {
      for (const op of layer.entityOps) {
        if (entityScope && !entityScope.has(op.recordId)) {
          continue;
        }
        applyEntityOp(graph, op);
      }

      for (const op of layer.connectionOps) {
        if (connectionScope && !connectionScope.has(op.connectionKey)) {
          continue;
        }

        if (op.kind === CONNECTION_ADD_NODE) {
          added.push(op.entityKey);
        } else if (op.kind === CONNECTION_REMOVE_NODE) {
          removed.push(op.entityKey);
        }

        applyConnectionOp(graph, op);
      }
    }

    return { added, removed };
  };

  const inspect = (): { total: number; layers: any[] } => {
    const sortedLayers = Array.from(pending).sort((a, b) => a.id - b.id);
    const layers: any[] = [];

    for (const layer of sortedLayers) {
      const entityOps: any[] = [];

      for (const op of layer.entityOps) {
        entityOps.push(shallowCopy(op));
      }

      const connectionOps: any[] = [];

      for (const op of layer.connectionOps) {
        connectionOps.push(shallowCopy(op));
      }

      const touched: string[] = [];

      for (const key of layer.touched) {
        touched.push(key);
      }

      const localBaseKeys: string[] = [];
      const localBase: Record<string, any> = {};

      for (const [key, value] of layer.localBase) {
        localBaseKeys.push(key);
        localBase[key] = cloneJSON(value);
      }

      layers.push({
        id: layer.id,
        entityOps,
        connectionOps,
        touched,
        localBaseKeys,
        localBase,
      });
    }

    return { total: layers.length, layers };
  };

  return { modifyOptimistic, replayOptimistic, inspect };
};

export type OptimisticInstance = ReturnType<typeof createOptimistic>;
