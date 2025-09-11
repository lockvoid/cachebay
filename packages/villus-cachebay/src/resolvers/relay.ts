// src/resolvers/relay.ts
import { shallowReactive, reactive, isReactive } from "vue";
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
export const relay = defineResolver((opts?: RelayOptsPartial) => {
  const relayOptions = normalizeRelayOptions(opts);

  return (deps: { graph: any; views: any; utils: any }) => (ctx: any) => {
    const { graph, views, utils } = deps;
    const v = ctx.variables || {};
    if (v[relayOptions.cursors.after] != null || v[relayOptions.cursors.before] != null) {
      ctx.hint.allowReplayOnStale = true;
    }

    const parentTypename = ctx.parentTypename;
    const fieldName = ctx.field;

    // Persist per-field options for later usage (e.g., view registration)
    utils.setRelayOptionsByType(parentTypename, fieldName, relayOptions);

    const parentKey = graph.getEntityParentKey(
      parentTypename,
      graph.identify?.(ctx.parent),
    );
    const connectionKey = utils.buildConnectionKey(
      parentKey!,
      fieldName,
      relayOptions,
      ctx.variables,
    );
    const connectionState = graph.ensureReactiveConnection(connectionKey);

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
        views.unlinkEntityFromConnection(connectionState.list[i].key, connectionState);
      }
      connectionState.list.length = 0;
      connectionState.keySet.clear();
    }

    // Read edges/pageInfo using string paths
    const edgesArray = utils.readPathValue(ctx.value, relayOptions.paths.edges);
    const edgesCount = Array.isArray(edgesArray) ? edgesArray.length : 0;

    if (Array.isArray(edgesArray)) {
      const hasNodePath = relayOptions.hasNodePath;
      const nodeFieldName = relayOptions.names.nodeField;

      // Always iterate forward to maintain order
      const start = 0;
      const end = edgesArray.length;
      const step = 1;

      const toUnlink: any[] = [];
      const nextEntries: any[] = [];

      for (let i = start; i !== end; i += step) {
        const edge = edgesArray[i];
        if (!edge || typeof edge !== "object") continue;

        let node = relayOptions.hasNodePath
          ? utils.readPathValue(edge, relayOptions.paths.node)
          : edge[nodeFieldName];
        if (!node) continue;

        const nodeTypename = node[utils.TYPENAME_KEY];
        if (nodeTypename && utils.applyFieldResolvers) {
          utils.applyFieldResolvers(nodeTypename, node, ctx.variables || {}, ctx.hint);
        }

        const entityKey = graph.putEntity(node, relayOptions.writePolicy);
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
              views.linkEntityToConnection(entityKey, connectionState);
              break;
            }
          }
        } else {
          nextEntries.push({ key: entityKey, cursor, edge: shallowReactive({}) });
        }
      }

      // unlink orphaned nodes
      for (const entry of toUnlink) {
        views.unlinkEntityFromConnection(entry.key, connectionState);
      }

      if (writeMode === "prepend") {
        connectionState.list.unshift(...nextEntries);
      } else {
        connectionState.list.push(...nextEntries);
      }
      connectionState.keySet.add(...nextEntries.map((entry) => entry.key));
      nextEntries.forEach((entry) => views.linkEntityToConnection(entry.key, connectionState));
    }

    // Merge pageInfo
    const pageInfoFromServer = utils.readPathValue(ctx.value, relayOptions.paths.pageInfo);
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
    const connectionObject = isReactive(ctx.value) ? ctx.value : reactive(ctx.value);
    if (connectionObject !== ctx.value) ctx.set(connectionObject);

    // Ensure edges array is reactive and empty for population from connection state
    if (!connectionObject[edgesFieldName] || !isReactive(connectionObject[edgesFieldName])) {
      connectionObject[edgesFieldName] = reactive([]);
    }
    
    if (!isReactive(connectionObject[pageInfoFieldName])) {
      connectionObject[pageInfoFieldName] = reactive(connectionObject[pageInfoFieldName] || {});
    }

    // Register a strong view for this edges array
    views.addStrongView(connectionState, {
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
        // For append/prepend, set limit to total size of connection
        view.limit = connectionState.list.length;
      }
    });

    // Sync or schedule
    if (!connectionState.initialized) {
      views.synchronizeConnectionViews?.(connectionState);
      connectionState.initialized = true;
    } else {
      views.markConnectionDirty(connectionState);
    }
  };
});
