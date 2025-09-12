// src/resolvers/relay.ts
import { defineResolver, type RelayOptsPartial } from "../types";
import type { RelayOptions } from "../core/types";

/** Normalize user options into internal RelayOptions (no deprecations). */
function normalizeRelayOptions(opts?: RelayOptsPartial): RelayOptions {
  const edges = opts?.edges ?? "edges";
  const node = opts?.node ?? "node";
  const pageInfo = opts?.pageInfo ?? "pageInfo";
  const nodeSegs = node.split(".");

  return {
    paths: { edges, node, pageInfo },
    segs: { edges: edges.split("."), node: nodeSegs, pageInfo: pageInfo.split(".") },
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
    writePolicy: opts?.writePolicy,                  // 'merge' | 'replace' | undefined
    paginationMode: opts?.paginationMode ?? "auto",  // 'append' | 'prepend' | 'replace' | 'auto'
  } as RelayOptions;
}

function readPathValue(obj: any, path: string) {
  if (!obj || !path) return undefined;
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// Stable connection key (ignore cursor args)
function buildConnectionKey(
  parentKey: string,
  field: string,
  vars: Record<string, any>
) {
  const filtered: Record<string, any> = { ...vars };
  delete filtered.after; delete filtered.before; delete filtered.first; delete filtered.last;
  const id = Object.keys(filtered)
    .sort()
    .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
    .join("|");
  return `${parentKey}.${field}(${id})`;
}

/**
 * Relay resolver — view-agnostic, runs BEFORE normalization finishes.
 * - Merges edge pages into a single ConnectionState per (parent, field, non-cursor vars).
 * - Updates state.list (dedup by entity key), state.pageInfo, and state.meta.
 * - Does NOT create/resize views (plugin/UI should do that).
 */
export const relay = defineResolver((opts?: RelayOptsPartial) => {
  const RELAY = normalizeRelayOptions(opts);

  return (deps: {
    graph: {
      ensureConnection: (key: string) => any;
      putEntity: (node: any, policy?: "merge" | "replace") => string | null;
      getEntityParentKey: (typename: string, id?: any) => string | null;
      identify?: (obj: any) => string | null;
    };
    utils?: {
      TYPENAME_KEY?: string;
      applyFieldResolvers?: (typename: string, obj: any, vars: Record<string, any>, hint?: any) => void;
    };
  }) => (ctx: {
    parentTypename: string;
    parent: any;
    field: string;
    value: any;                // server connection object
    variables: Record<string, any>;
    hint?: { stale?: boolean; allowReplayOnStale?: boolean };
    set: (next: any) => void;  // not used (view-agnostic)
  }) => {
      const { graph, utils } = deps;

      const vars = ctx.variables || {};
      const hasAfter = vars[RELAY.cursors.after] != null;
      const hasBefore = vars[RELAY.cursors.before] != null;

      // Allow replay on stale when paging by cursor
      if (hasAfter || hasBefore) {
        (ctx.hint ??= {}).allowReplayOnStale = true;
      }

      // Decide write mode
      const writeMode: "append" | "prepend" | "replace" =
        RELAY.paginationMode !== "auto"
          ? (RELAY.paginationMode as any)
          : hasAfter
            ? "append"
            : hasBefore
              ? "prepend"
              : "replace";


      // Resolve connection identity and state
      const parentKey =
        graph.getEntityParentKey(ctx.parentTypename, graph.identify?.(ctx.parent)) ?? "Query";
      const connKey = buildConnectionKey(parentKey, ctx.field, vars);
      const state = graph.ensureConnection(connKey);

      // 'replace' clears the canonical list before merging
      if (writeMode === "replace") {
        state.list.length = 0;
        state.keySet.clear();
      }

      // Extract edges/pageInfo from the payload
      const edgesArray = readPathValue(ctx.value, RELAY.paths.edges);
      const pageInfoObj = readPathValue(ctx.value, RELAY.paths.pageInfo);

      // Merge edges (dedup by entity key)
      if (Array.isArray(edgesArray)) {
        const nodeField = RELAY.names.nodeField;
        const newEntries: Array<{ key: string; cursor: string | null; edge?: Record<string, any> }> = [];

        for (let i = 0; i < edgesArray.length; i++) {
          const edge = edgesArray[i];

          console.log('edge:', edge);

          if (!edge || typeof edge !== "object") continue;

          const node = RELAY.hasNodePath ? readPathValue(edge, RELAY.paths.node) : edge[nodeField];
          if (!node || typeof node !== "object") continue;

          const tKey = utils?.TYPENAME_KEY ?? "__typename";
          const tn = node[tKey];
          if (tn && typeof utils?.applyFieldResolvers === "function") {
            utils.applyFieldResolvers(tn, node, vars, ctx.hint);
          }

          const ek = graph.putEntity(node, RELAY.writePolicy);
          if (!ek) continue;

          const cursor = edge.cursor != null ? edge.cursor : null;

          // Gather edge meta (excluding cursor and node field for simple path)
          let meta: Record<string, any> | undefined;
          for (const k of Object.keys(edge)) {
            if (k === "cursor") continue;
            if (!RELAY.hasNodePath && k === nodeField) continue;
            (meta ??= Object.create(null))[k] = (edge as any)[k];
          }

          if (state.keySet.has(ek)) {
            // Update existing entry in place (keep ordering)
            for (let j = 0; j < state.list.length; j++) {
              if (state.list[j].key === ek) {
                state.list[j] = { key: ek, cursor, edge: meta ?? state.list[j].edge };
                break;
              }
            }
          } else {
            newEntries.push({ key: ek, cursor, edge: meta });
          }
        }

        if (writeMode === "prepend") state.list.unshift(...newEntries);
        else state.list.push(...newEntries);

        for (let i = 0; i < newEntries.length; i++) state.keySet.add(newEntries[i].key);
      }

      // Merge pageInfo in place
      if (pageInfoObj && typeof pageInfoObj === "object") {
        for (const k of Object.keys(pageInfoObj)) {
          const nv = (pageInfoObj as any)[k];
          if (state.pageInfo[k] !== nv) state.pageInfo[k] = nv;
        }
      }

      // Merge connection-level meta (exclude edges/pageInfo/__typename)
      const edgesField = RELAY.names.edges;
      const pageInfoField = RELAY.names.pageInfo;
      if (ctx.value && typeof ctx.value === "object") {
        for (const k of Object.keys(ctx.value)) {
          if (k === edgesField || k === pageInfoField || k === "__typename") continue;
          const nv = (ctx.value as any)[k];
          if (state.meta[k] !== nv) state.meta[k] = nv;
        }
      }

      console.log('newEntries:', state.list);
      console.log('newEntries:', state);

      // Mark initialized
      if (!state.initialized) {
        state.initialized = true;
      }
    };
});
