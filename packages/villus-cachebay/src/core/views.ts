// views.ts — connection + entity view helpers (no legacy back-compat)

import { shallowReactive, isReactive } from "vue";
import type { EntityKey, ConnectionState } from "./types";
import type { GraphAPI } from "./graph";

export type ViewsAPI = ReturnType<typeof createViews>;

export type ViewsDependencies = {
  graph: GraphAPI;
};

export function createViews(_options: {}, dependencies: ViewsDependencies) {
  const { graph } = dependencies;

  // ────────────────────────────────────────────────────────────────────────────
  // Entity: just return the graph-level reactive object (proxy/snapshot)
  // ────────────────────────────────────────────────────────────────────────────
  function proxyForEntityKey(key: EntityKey) {
    // ensure proxy is up to date
    graph.materializeEntity(key);
    // return reactive snapshot object for UI (no identity in it)
    return graph.getEntity(key);
  }

  /**
   * Walk a result tree and replace any "node" objects (that look like entities)
   * with live proxies from the graph (materialized).
   */
  function materializeResult(root: any) {
    if (!root || typeof root !== "object") return;
    const stack: any[] = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;

      if ("node" in cur && cur.node && typeof cur.node === "object") {
        const key = graph.identify(cur.node);
        if (key) {
          // Use the proxy with identity (__typename/id) for node
          cur.node = graph.materializeEntity(key);
        }
      }

      for (const k of Object.keys(cur)) {
        const v = (cur as any)[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Connection views
  // ────────────────────────────────────────────────────────────────────────────

  type ConnectionView = {
    edges: any[];
    pageInfo: Record<string, any>;
    root?: any;
    edgesKey: string;
    pageInfoKey: string;
    limit: number;
    pinned?: boolean;
    _lastLen?: number;
  };

  /**
   * Create and attach a connection view to a connection state.
   * - edges: shallow-reactive array (we mutate indices/length)
   * - pageInfo: shallow-reactive object (we update fields in place)
   * - limit: how many edges the view wants to keep in sync (window)
   */
  function createConnectionView(
    state: ConnectionState,
    opts: {
      edgesKey?: string;
      pageInfoKey?: string;
      limit?: number;
      root?: any;
      pinned?: boolean;
    } = {}
  ): ConnectionView {
    const edgesKey = opts.edgesKey ?? "edges";
    const pageInfoKey = opts.pageInfoKey ?? "pageInfo";
    const limit = Math.max(0, opts.limit ?? state.list.length);

    const view: ConnectionView = {
      edges: shallowReactive([]),
      pageInfo: shallowReactive({}),
      root: opts.root ?? {},
      edgesKey,
      pageInfoKey,
      limit,
      pinned: !!opts.pinned,
      _lastLen: 0,
    };

    state.views.add(view as any);
    return view;
  }

  function removeConnectionView(state: ConnectionState, view: ConnectionView) {
    state.views.delete(view as any);
  }

  function setViewLimit(view: ConnectionView, limit: number) {
    view.limit = Math.max(0, limit | 0);
  }

  /**
   * Synchronize a whole connection (all attached views) to the canonical state.
   * - Keeps view.edges length at most view.limit, pulls from state.list
   * - edge objects stay plain; edge.node is a reactive proxy (materialized)
   * - pageInfo fields are copied field-by-field
   */
  function syncConnection(state: ConnectionState) {
    if (!state || !state.views || state.views.size === 0) return;

    for (const rawView of state.views) {
      const view = rawView as ConnectionView;

      // ensure correct container shapes
      if (!isReactive(view.edges)) (view as any).edges = shallowReactive(view.edges || []);
      if (!isReactive(view.pageInfo)) view.pageInfo = shallowReactive(view.pageInfo || {});

      const desired = Math.min(state.list.length, view.limit ?? state.list.length);
      const edgesArr = view.edges as any[];

      // shrink if needed
      if (edgesArr.length > desired) edgesArr.splice(desired);

      // fill/update items
      for (let i = 0; i < desired; i++) {
        const entry = (state.list as any[])[i]; // { cursor, key, edge? }
        let edgeObj = edgesArr[i];

        if (!edgeObj || typeof edgeObj !== "object") {
          edgeObj = {};
          edgesArr[i] = edgeObj;
        }

        if (edgeObj.cursor !== entry.cursor) edgeObj.cursor = entry.cursor;

        // Copy custom edge metadata (except cursor/node)
        const meta = entry.edge;
        if (meta && typeof meta === "object") {
          for (const k of Object.keys(meta)) {
            if (k !== "cursor" && k !== "node") {
              if (edgeObj[k] !== (meta as any)[k]) edgeObj[k] = (meta as any)[k];
            }
          }
          // remove stale meta fields
          for (const k of Object.keys(edgeObj)) {
            if (k !== "cursor" && k !== "node" && !(k in meta)) delete edgeObj[k];
          }
        } else {
          // no meta → keep only cursor/node
          for (const k of Object.keys(edgeObj)) {
            if (k !== "cursor" && k !== "node") delete edgeObj[k];
          }
        }

        // Node proxy: update when key changes
        const oldKey =
          edgeObj.node &&
            edgeObj.node.__typename &&
            (edgeObj.node.id ?? undefined) != null
            ? `${edgeObj.node.__typename}:${String(edgeObj.node.id)}`
            : null;

        if (oldKey !== entry.key) {
          // use identity-bearing proxy for nodes
          const nodeProxy = graph.materializeEntity(entry.key);
          edgeObj.node = nodeProxy;
        }
      }

      view._lastLen = desired;

      // pageInfo: copy fields from state.pageInfo
      const srcPI = state.pageInfo as any;
      const dstPI = view.pageInfo as any;
      for (const k of Object.keys(srcPI)) {
        if (dstPI[k] !== srcPI[k]) dstPI[k] = srcPI[k];
      }
    }
  }

  // Simple GC: drop connection states that have no attached views
  function gcConnections(
    predicate?: (key: string, state: ConnectionState) => boolean
  ) {
    for (const [key, state] of (graph.connectionStore as Map<string, ConnectionState>).entries()) {
      if (!state.views || state.views.size === 0) {
        const ok = predicate ? predicate(key, state) : true;
        if (ok) graph.connectionStore.delete(key);
      }
    }
  }

  // For symmetry with prior code, but now it just clears connection views for all states
  function resetRuntime() {
    for (const [, state] of (graph.connectionStore as Map<string, ConnectionState>).entries()) {
      state.views.clear();
    }
  }

  return {
    // Entity helpers
    proxyForEntityKey,
    materializeResult,

    // Connection view lifecycle
    createConnectionView,
    removeConnectionView,
    setViewLimit,
    syncConnection,

    // GC / runtime
    gcConnections,
    resetRuntime,
  };
}
