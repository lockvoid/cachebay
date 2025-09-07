// src/resolvers/relay.ts
import { shallowReactive } from "vue";
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
    writePolicy: opts?.writePolicy,
    paginationMode: opts?.paginationMode ?? "auto",
  } as RelayOptions;
}

/**
 * Relay resolver (latest interface)
 * - Visibility is driven by `paginationMode` only:
 *   - append/prepend: view.limit += pageSize
 *   - replace:        view.limit  = pageSize (destructive)
 */
export const relay = defineResolver((internals, opts: RelayOptsPartial) => {
  const relayOptions = normalizeRelayOptions(opts);

  return (ctx) => {
    const v = ctx.variables || {};
    if (v[relayOptions.cursors.after] != null || v[relayOptions.cursors.before] != null) {
      ctx.hint.allowReplayOnStale = true;
    }

    const parentTypename = ctx.parentTypename;
    const fieldName = ctx.field;

    // Persist per-field options for later usage (e.g., view registration)
    internals.setRelayOptionsByType(parentTypename, fieldName, relayOptions);

    const parentId = (ctx.parent as any)?.id ?? (ctx.parent as any)?._id;
    const parentKey =
      ctx.parentTypename === "Query"
        ? "Query"
        : internals.parentEntityKeyFor(parentTypename, parentId) || "Query";

    const connectionKey = internals.buildConnectionKey(
      parentKey!,
      fieldName,
      relayOptions,
      ctx.variables,
    );
    const connectionState = internals.ensureConnectionState(connectionKey);

    const variables = ctx.variables || {};
    const afterVal = variables[relayOptions.cursors.after];
    const beforeVal = variables[relayOptions.cursors.before];

    // paginationMode: explicit > infer by cursors
    const configured = relayOptions.paginationMode;
    const writeMode: "append" | "prepend" | "replace" =
      configured !== "auto"
        ? (configured as any)
        : afterVal != null
          ? "append"
          : beforeVal != null
            ? "prepend"
            : "replace";

    // Destructive clear for replace
    if (writeMode === "replace") {
      for (let i = 0, n = connectionState.list.length; i < n; i++) {
        internals.unlinkEntityFromConnection(connectionState.list[i].key, connectionState);
      }
      connectionState.list.length = 0;
      connectionState.keySet.clear();
    }

    // Read edges/pageInfo using string paths (internals.readPathValue supports string)
    const edges = internals.readPathValue(ctx.value, relayOptions.paths.edges);
    const edgesCount = Array.isArray(edges) ? edges.length : 0;

    if (Array.isArray(edges)) {
      const hasNodePath = relayOptions.hasNodePath;
      const nodeFieldName = relayOptions.names.nodeField;

      // Preserve server order: prepend iterates backwards + unshift
      const start = writeMode === "prepend" ? edges.length - 1 : 0;
      const end = writeMode === "prepend" ? -1 : edges.length;
      const step = writeMode === "prepend" ? -1 : 1;

      for (let i = start; i !== end; i += step) {
        const edge = edges[i];
        if (!edge || typeof edge !== "object") continue;

        const node = hasNodePath
          ? internals.readPathValue(edge, relayOptions.paths.node)
          : (edge as any)[nodeFieldName];
        if (!node) continue;

        const nodeTypename = node?.[internals.TYPENAME_KEY];
        if (nodeTypename && internals.applyFieldResolvers) {
          internals.applyFieldResolvers(nodeTypename, node, ctx.variables || {}, ctx.hint);
        }

        const entityKey = internals.putEntity(node, relayOptions.writePolicy);
        if (!entityKey) continue;

        const cursor = (edge as any).cursor != null ? (edge as any).cursor : null;

        // Gather edge meta (excluding cursor and the node field when simple path)
        let edgeMeta: Record<string, any> | undefined;
        const ek = Object.keys(edge as any);
        for (let j = 0; j < ek.length; j++) {
          const k = ek[j];
          if (k === "cursor") continue;
          if (!hasNodePath && k === nodeFieldName) continue;
          (edgeMeta ??= Object.create(null))[k] = (edge as any)[k];
        }

        if (connectionState.keySet.has(entityKey)) {
          // Update in place (dedup by entity key)
          for (let j = 0, m = connectionState.list.length; j < m; j++) {
            if (connectionState.list[j].key === entityKey) {
              connectionState.list[j] = {
                key: entityKey,
                cursor,
                edge: edgeMeta ?? connectionState.list[j].edge,
              };
              internals.linkEntityToConnection(entityKey, connectionState);
              break;
            }
          }
        } else {
          const newEntry = { key: entityKey, cursor, edge: edgeMeta };
          if (writeMode === "prepend") {
            connectionState.list.unshift(newEntry);
          } else {
            connectionState.list.push(newEntry);
          }
          connectionState.keySet.add(entityKey);
          internals.linkEntityToConnection(entityKey, connectionState);
        }
      }
    }

    // Merge pageInfo
    const pageInfoFromServer = internals.readPathValue(ctx.value, relayOptions.paths.pageInfo);
    if (pageInfoFromServer && typeof pageInfoFromServer === "object") {
      const pik = Object.keys(pageInfoFromServer as any);
      for (let i = 0; i < pik.length; i++) {
        const k = pik[i];
        const nextValue = (pageInfoFromServer as any)[k];
        if ((connectionState.pageInfo as any)[k] !== nextValue) {
          (connectionState.pageInfo as any)[k] = nextValue;
        }
      }
    }

    // Merge connection-level meta (exclude edges/pageInfo/__typename)
    const edgesFieldName = relayOptions.names.edges;
    const pageInfoFieldName = relayOptions.names.pageInfo;

    if (ctx.value && typeof ctx.value === "object") {
      const exclude = new Set([edgesFieldName, pageInfoFieldName, "__typename"]);
      const ck = Object.keys(ctx.value as any);
      for (let i = 0; i < ck.length; i++) {
        const k = ck[i];
        const nextValue = (ctx.value as any)[k];
        if (!exclude.has(k)) {
          if ((connectionState.meta as any)[k] !== nextValue) {
            (connectionState.meta as any)[k] = nextValue;
          }
        }
      }
    }

    // Ensure reactive connection surface
    const connectionObject = internals.isReactive(ctx.value) ? ctx.value : internals.reactive(ctx.value);
    if (connectionObject !== ctx.value) ctx.set(connectionObject);

    if (
      !Array.isArray(connectionObject[edgesFieldName]) ||
      !internals.isReactive(connectionObject[edgesFieldName])
    ) {
      connectionObject[edgesFieldName] = internals.reactive(
        Array.isArray(connectionObject[edgesFieldName]) ? connectionObject[edgesFieldName] : [],
      );
    }
    if (!internals.isReactive(connectionObject[pageInfoFieldName])) {
      connectionObject[pageInfoFieldName] = shallowReactive(connectionObject[pageInfoFieldName] || {});
    }

    // Register a strong view for this edges array
    internals.addStrongView(connectionState, {
      edges: connectionObject[edgesFieldName],
      pageInfo: connectionObject[pageInfoFieldName],
      root: connectionObject,
      edgesKey: edgesFieldName,
      pageInfoKey: pageInfoFieldName,
      pinned: true,
    });

    // Mode-driven view sizing across ALL views of this connection
    const growBy = edgesCount;
    connectionState.views.forEach((view: any) => {
      if (!view || !Array.isArray(view.edges) || !view.pageInfo) return;
      if (writeMode === "replace") {
        view.limit = growBy;
      } else {
        view.limit = (view.limit ?? 0) + growBy;
      }
    });

    // Sync or schedule
    if (!connectionState.initialized) {
      (internals as any).synchronizeConnectionViews?.(connectionState);
      connectionState.initialized = true;
    } else {
      internals.markConnectionDirty(connectionState);
    }
  };
});
