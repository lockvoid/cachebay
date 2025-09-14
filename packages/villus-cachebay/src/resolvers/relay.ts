// src/resolvers/relay.ts

export type RelayWritePolicy = "merge" | "replace";
export type RelayPaginationMode = "append" | "prepend" | "replace" | "auto";

export type RelayOptsPartial = {
  // mapping of connection field paths
  edges?: string;    // default "edges"         (supports dotted paths)
  node?: string;     // default "node"          (supports dotted paths)
  pageInfo?: string; // default "pageInfo"      (supports dotted paths)

  // cursor variable names in ctx.variables (not field args)
  after?: string;    // default "after"
  before?: string;   // default "before"
  first?: string;    // default "first"
  last?: string;     // default "last"

  // behavior
  paginationMode?: RelayPaginationMode; // default "auto"
  writePolicy?: RelayWritePolicy;       // "merge" | "replace"
};

export type RelayOptions = {
  paths: { edges: string; node: string; pageInfo: string };
  segs: { edges: string[]; node: string[]; pageInfo: string[] };
  names: { edges: string; pageInfo: string; nodeField: string };
  cursors: { after: string; before: string; first: string; last: string };
  hasNodePath: boolean;
  paginationMode: RelayPaginationMode;
  writePolicy?: RelayWritePolicy;
};

type ConnectionEntry = { key: string; cursor: string | null; edge?: Record<string, any> };

type ConnectionState = {
  list: ConnectionEntry[];
  pageInfo: Record<string, any>;
  meta: Record<string, any>;
  views: Set<any>;     // reserved (UI wires its own views elsewhere)
  keySet: Set<string>; // fast dedup by entity key
  initialized: boolean;
};

type Deps = {
  graph: {
    /** Normalize/write an entity node → returns canonical entity key like "Post:1" */
    putEntity: (node: any, writePolicy?: RelayWritePolicy) => string | null;
    /** Identify a parent entity object → "User:1" (or null); you'll pass ctx.parent here */
    identify?: (obj: any) => string | null;
  };
  views?: unknown;      // reserved for future wiring integration
  resolvers?: {
    /** Optional: run field resolvers on each edge.node before normalization */
    applyFieldResolvers?: (typename: string, obj: any, vars: Record<string, any>, hint?: any) => void;
  };
};

export type RelayContext = {
  parentTypename: string;
  parent: any;
  field: string; // the connection field name (unaliased) on parent
  value: any;    // the raw connection payload
  variables: Record<string, any>;
  hint?: { stale?: boolean; allowReplayOnStale?: boolean };
  set: (next: any) => void; // not used here
};

const normalizeRelayOptions = (opts?: RelayOptsPartial): RelayOptions => {
  const edges = opts?.edges ?? "edges";
  const node = opts?.node ?? "node";
  const pageInfo = opts?.pageInfo ?? "pageInfo";
  const nodeSegs = node.split(".");

  return {
    paths: { edges, node, pageInfo },
    segs: {
      edges: edges.split("."),
      node: nodeSegs,
      pageInfo: pageInfo.split("."),
    },
    names: {
      edges: edges.split(".").pop()!,
      pageInfo: pageInfo.split(".").pop()!,
      nodeField: nodeSegs[nodeSegs.length - 1]!,
    },
    cursors: {
      after: opts?.after ?? "after",
      before: opts?.before ?? "before",
      first: opts?.first ?? "first",
      last: opts?.last ?? "last",
    },
    hasNodePath: node.includes("."),
    paginationMode: opts?.paginationMode ?? "auto",
    writePolicy: opts?.writePolicy,
  };
};

const readPathValue = (objectValue: any, path: string) => {
  if (!objectValue || !path) {
    return undefined;
  }
  let current: any = objectValue;
  const segments = path.split(".");
  for (let i = 0; i < segments.length; i++) {
    if (current == null) {
      return undefined;
    }
    current = current[segments[i]];
  }
  return current;
};

const buildConnectionKey = (
  parentKey: string,
  fieldName: string,
  variables: Record<string, any>,
  cursors: { after: string; before: string; first: string; last: string }
) => {
  const filtered: Record<string, any> = { ...variables };
  delete filtered[cursors.after];
  delete filtered[cursors.before];
  delete filtered[cursors.first];
  delete filtered[cursors.last];

  const stableArgs = Object.keys(filtered)
    .sort()
    .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
    .join("|");

  return `${parentKey}.${fieldName}(${stableArgs})`;
};

/**
 * Creates a Relay resolver with its own per-instance connection cache.
 * The returned handler has an .inspect() helper to read the internal states in tests.
 */
export const relay = (opts?: RelayOptsPartial) => {
  const RELAY = normalizeRelayOptions(opts);

  // Per-resolver-instance connection cache
  const connectionStore = new Map<string, ConnectionState>();

  const ensureConnection = (key: string): ConnectionState => {
    let state = connectionStore.get(key);
    if (!state) {
      state = {
        list: [],
        pageInfo: {},
        meta: {},
        views: new Set<any>(),
        keySet: new Set<string>(),
        initialized: false,
      };
      connectionStore.set(key, state);
    }
    return state;
  };

  const getParentKey = (parentTypename: string, parent: any, identify?: (o: any) => string | null) => {
    // Root Query (no id) -> "Query"
    if (parentTypename === "Query") {
      return "Query";
    }
    // Entities -> use graph.identify(parent) if present
    const id = typeof identify === "function" ? identify(parent) : null;
    return id ?? null; // if null, we’ll still generate a connection key; it's rare but safe
  };

  const handler = (deps: Deps) => {
    const { graph, resolvers } = deps;

    const run = (ctx: RelayContext) => {
      const variables = ctx.variables || {};
      const hasAfter = variables[RELAY.cursors.after] != null;
      const hasBefore = variables[RELAY.cursors.before] != null;

      if (hasAfter || hasBefore) {
        (ctx.hint ??= {}).allowReplayOnStale = true;
      }

      const writeMode: Exclude<RelayPaginationMode, "auto"> =
        RELAY.paginationMode !== "auto"
          ? (RELAY.paginationMode as any)
          : hasAfter
            ? "append"
            : hasBefore
              ? "prepend"
              : "replace";

      // Parent identity
      const parentKey = getParentKey(ctx.parentTypename, ctx.parent, graph.identify) ?? "Query";

      // Stable connection key ignoring cursor args
      const connectionKey = buildConnectionKey(parentKey, ctx.field, variables, RELAY.cursors);
      const state = ensureConnection(connectionKey);

      // Replace clears canonical list before merge
      if (writeMode === "replace") {
        state.list.length = 0;
        state.keySet.clear();
      }

      // Extract payload parts
      const edgesArray = readPathValue(ctx.value, RELAY.paths.edges);
      const pageInfoObj = readPathValue(ctx.value, RELAY.paths.pageInfo);

      // Merge edges
      if (Array.isArray(edgesArray)) {
        const newEntries: ConnectionEntry[] = [];

        for (let i = 0; i < edgesArray.length; i++) {
          const edge = edgesArray[i];
          if (!edge || typeof edge !== "object") {
            continue;
          }

          // Resolve node at simple/nested path
          const node = RELAY.hasNodePath
            ? readPathValue(edge, RELAY.paths.node)
            : (edge as any)[RELAY.names.nodeField];

          if (!node || typeof node !== "object") {
            continue;
          }

          // Optional: apply field resolvers on the node pre-normalization
          const typename = node["__typename"];
          if (typename && typeof resolvers?.applyFieldResolvers === "function") {
            resolvers.applyFieldResolvers(typename, node, variables, ctx.hint);
          }

          // Normalize into entity store
          const entityKey = graph.putEntity(node, RELAY.writePolicy);
          if (!entityKey) {
            continue;
          }

          const cursor = edge.cursor != null ? edge.cursor : null;

          // Capture edge meta (exclude 'cursor'; exclude simple 'node' field)
          let meta: Record<string, any> | undefined;
          for (const k of Object.keys(edge)) {
            if (k === "cursor") {
              continue;
            }
            if (!RELAY.hasNodePath && k === RELAY.names.nodeField) {
              continue;
            }
            (meta ??= Object.create(null))[k] = (edge as any)[k];
          }

          if (state.keySet.has(entityKey)) {
            // Update existing entry (keep stable order)
            for (let j = 0; j < state.list.length; j++) {
              if (state.list[j].key === entityKey) {
                state.list[j] = { key: entityKey, cursor, edge: meta ?? state.list[j].edge };
                break;
              }
            }
          } else {
            newEntries.push({ key: entityKey, cursor, edge: meta });
          }
        }

        if (writeMode === "prepend") {
          state.list.unshift(...newEntries);
        } else {
          state.list.push(...newEntries);
        }

        for (let i = 0; i < newEntries.length; i++) {
          state.keySet.add(newEntries[i].key);
        }
      }

      // Merge pageInfo
      if (pageInfoObj && typeof pageInfoObj === "object") {
        for (const k of Object.keys(pageInfoObj)) {
          const next = (pageInfoObj as any)[k];
          if (state.pageInfo[k] !== next) {
            state.pageInfo[k] = next;
          }
        }
      }

      // Merge connection-level meta (exclude edges/pageInfo/__typename)
      if (ctx.value && typeof ctx.value === "object") {
        const edgesField = RELAY.names.edges;
        const pageInfoField = RELAY.names.pageInfo;
        for (const k of Object.keys(ctx.value)) {
          if (k === edgesField || k === pageInfoField || k === "__typename") {
            continue;
          }
          const nv = (ctx.value as any)[k];
          if (state.meta[k] !== nv) {
            state.meta[k] = nv;
          }
        }
      }

      if (!state.initialized) {
        state.initialized = true;
      }

      // No return value required, but handy to return the state for the call
      return state;
    };

    // Attach helpers for tests / introspection
    (run as any).inspect = () => {
      const out: Record<string, any> = {};
      for (const [k, st] of connectionStore.entries()) {
        out[k] = {
          list: [...st.list],
          pageInfo: { ...st.pageInfo },
          meta: { ...st.meta },
          initialized: st.initialized,
          size: st.list.length,
        };
      }
      return out;
    };

    return run;
  };

  // Return an object with a .bind(deps) method (same pattern as before)
  return { bind: handler };
};
