import { shallowReactive } from "vue";
import { defineResolver, type RelayOptsPartial } from "../types";
import type { RelayOptions } from "../core/types";

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
    write: opts?.write,
  };
}

export const relay = defineResolver((internals, opts: RelayOptsPartial) => {
  const relayOptions = normalizeRelayOptions(opts);

  return (ctx) => {
    const v = ctx.variables || {};
    if (v[relayOptions.cursors.after] != null || v[relayOptions.cursors.before] != null) {
      ctx.hint.allowReplayOnStale = true;
    }

    const parentTypename = ctx.parentTypename;
    const fieldName = ctx.field;

    internals.setRelayOptionsByType(parentTypename, fieldName, relayOptions);

    const parentId = ctx.parent?.id ?? ctx.parent?._id;
    const parentKey =
      ctx.parentTypename === "Query"
        ? "Query"
        : internals.parentEntityKeyFor(parentTypename, parentId) || "Query";

    const connectionKey = internals.buildConnectionKey(parentKey!, fieldName, relayOptions, ctx.variables);
    const connectionState = internals.ensureConnectionState(connectionKey);

    const variables = ctx.variables || {};
    const afterVal = variables[relayOptions.cursors.after];
    const beforeVal = variables[relayOptions.cursors.before];

    const writeMode: "append" | "prepend" | "replace" =
      ctx.hint.relayMode && ctx.hint.relayMode !== "auto"
        ? ctx.hint.relayMode
        : afterVal != null
          ? "append"
          : beforeVal != null
            ? "prepend"
            : "replace";

    if (writeMode === "replace" && !ctx.hint.stale) {
      for (let i = 0, n = connectionState.list.length; i < n; i++) {
        internals.unlinkEntityFromConnection(connectionState.list[i].key, connectionState);
      }
      connectionState.list.length = 0;
      connectionState.keySet.clear();
    }

    const edges = internals.readPathValue(ctx.value, relayOptions.segs.edges);
    const edgesCount = Array.isArray(edges) ? edges.length : 0;

    if (Array.isArray(edges)) {
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (!edge || typeof edge !== "object") continue;

        const node = relayOptions.hasNodePath
          ? internals.readPathValue(edge, relayOptions.segs.node)
          : (edge as any)[relayOptions.names.nodeField];

        if (!node) continue;

        const nodeTypename = node?.[internals.TYPENAME_KEY];
        if (nodeTypename && internals.applyFieldResolvers) {
          internals.applyFieldResolvers(nodeTypename, node, ctx.variables || {}, ctx.hint);
        }

        const entityKey = internals.putEntity(node, relayOptions.write);
        if (!entityKey) continue;

        const cursor = (edge as any).cursor != null ? (edge as any).cursor : null;

        let edgeMeta: Record<string, any> | undefined;
        const ek = Object.keys(edge as any);
        for (let j = 0; j < ek.length; j++) {
          const k = ek[j];
          if (k === "cursor") continue;
          if (!relayOptions.hasNodePath && k === relayOptions.names.nodeField) continue;
          (edgeMeta ??= Object.create(null))[k] = (edge as any)[k];
        }

        if (connectionState.keySet.has(entityKey)) {
          for (let j = 0, m = connectionState.list.length; j < m; j++) {
            if (connectionState.list[j].key === entityKey) {
              connectionState.list[j] = { key: entityKey, cursor, edge: edgeMeta ?? connectionState.list[j].edge };
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

    const pageInfoFromServer = internals.readPathValue(ctx.value, relayOptions.segs.pageInfo);
    if (pageInfoFromServer && typeof pageInfoFromServer === "object") {
      const pik = Object.keys(pageInfoFromServer as any);
      for (let i = 0; i < pik.length; i++) {
        const k = pik[i];
        const nextValue = (pageInfoFromServer as any)[k];
        if (connectionState.pageInfo[k] !== nextValue) {
          connectionState.pageInfo[k] = nextValue;
        }
      }
    }

    const edgesFieldName = relayOptions.names.edges;
    const pageInfoFieldName = relayOptions.names.pageInfo;

    if (ctx.value && typeof ctx.value === "object") {
      const exclude = new Set([edgesFieldName, relayOptions.paths.pageInfo, "__typename"]);
      const ck = Object.keys(ctx.value as any);
      for (let i = 0; i < ck.length; i++) {
        const k = ck[i];
        const nextValue = (ctx.value as any)[k];
        if (!exclude.has(k)) {
          if (connectionState.meta[k] !== nextValue) {
            connectionState.meta[k] = nextValue;
          }
        }
      }
    }

    const connectionObject = internals.isReactive(ctx.value) ? ctx.value : internals.reactive(ctx.value);
    if (connectionObject !== ctx.value) ctx.set(connectionObject);

    if (!Array.isArray(connectionObject[edgesFieldName]) || !internals.isReactive(connectionObject[edgesFieldName])) {
      connectionObject[edgesFieldName] = internals.reactive(Array.isArray(connectionObject[edgesFieldName]) ? connectionObject[edgesFieldName] : []);
    }
    if (!internals.isReactive(connectionObject[pageInfoFieldName])) {
      connectionObject[pageInfoFieldName] = shallowReactive(connectionObject[pageInfoFieldName] || {});
    }

    internals.addStrongView(connectionState, {
      edges: connectionObject[edgesFieldName],
      pageInfo: connectionObject[pageInfoFieldName],
      root: connectionObject,
      edgesKey: edgesFieldName,
      pageInfoKey: pageInfoFieldName,
      pinned: true,
    });

    const isValid = (vv: any) => !!(vv && typeof vv === "object" && Array.isArray((vv as any).edges) && (vv as any).pageInfo);

    let targetView: any | undefined;
    const invalid: any[] = [];
    for (const v of connectionState.views) {
      if (!isValid(v)) {
        invalid.push(v as any);
        continue;
      }
      if (v.edges === connectionObject[edgesFieldName]) {
        targetView = v;
        break;
      }
    }
    for (let i = 0; i < invalid.length; i++) {
      connectionState.views.delete(invalid[i]);
    }

    const relayViewMode = ctx.hint.relayView || "cumulative";
    if (targetView) {
      if (relayViewMode === "windowed") {
        if (writeMode === "replace") {
          if (!ctx.hint.stale) (targetView as any).limit = edgesCount;
        } else {
          (targetView as any).limit = ((targetView as any).limit ?? 0) + edgesCount;
        }
      } else {
        (targetView as any).limit = connectionState.list.length;
      }
    }

    if (!connectionState.initialized) {
      internals.synchronizeConnectionViews(connectionState);
      connectionState.initialized = true;
    } else {
      internals.markConnectionDirty(connectionState);
    }
  };
});
