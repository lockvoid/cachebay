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
  // Entity helpers
  // ────────────────────────────────────────────────────────────────────────────

  function proxyForEntityKey(key: EntityKey) {
    graph.materializeEntity(key);
    return graph.getEntity(key);
  }

  function materializeResult(root: any) {
    if (!root || typeof root !== "object") return;
    const stack: any[] = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;

      if ("node" in cur && cur.node && typeof cur.node === "object") {
        const key = graph.identify?.(cur.node);
        if (key) cur.node = graph.materializeEntity(key);
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

  function synchronizeConnectionViews(state: ConnectionState) {
    if (!state || !state.views || state.views.size === 0) return;

    for (const rawView of state.views) {
      const view = rawView as ConnectionView;

      if (!isReactive(view.edges)) (view as any).edges = shallowReactive(view.edges || []);
      if (!isReactive(view.pageInfo)) view.pageInfo = shallowReactive(view.pageInfo || {});

      const desired = Math.min(state.list.length, view.limit ?? state.list.length);
      const edgesArr = view.edges as any[];

      if (edgesArr.length > desired) edgesArr.splice(desired);

      for (let i = 0; i < desired; i++) {
        const entry = (state.list as any[])[i];
        let edgeObj = edgesArr[i];

        if (!edgeObj || typeof edgeObj !== "object") {
          edgeObj = {};
          edgesArr[i] = edgeObj;
        }

        if (edgeObj.cursor !== entry.cursor) edgeObj.cursor = entry.cursor;

        const meta = entry.edge;
        if (meta && typeof meta === "object") {
          for (const k of Object.keys(meta)) {
            if (k !== "cursor" && k !== "node") {
              if (edgeObj[k] !== (meta as any)[k]) edgeObj[k] = (meta as any)[k];
            }
          }
          for (const k of Object.keys(edgeObj)) {
            if (k !== "cursor" && k !== "node" && !(k in meta)) delete edgeObj[k];
          }
        } else {
          for (const k of Object.keys(edgeObj)) {
            if (k !== "cursor" && k !== "node") delete edgeObj[k];
          }
        }

        const oldKey =
          edgeObj.node &&
            edgeObj.node.__typename &&
            (edgeObj.node.id ?? undefined) != null
            ? `${edgeObj.node.__typename}:${String(edgeObj.node.id)}`
            : null;

        if (oldKey !== entry.key) {
          edgeObj.node = graph.materializeEntity(entry.key);
        }
      }

      view._lastLen = desired;

      const srcPI = state.pageInfo as any;
      const dstPI = view.pageInfo as any;
      for (const k of Object.keys(srcPI)) {
        if (dstPI[k] !== srcPI[k]) dstPI[k] = srcPI[k];
      }
    }
  }

  function gcConnections(predicate?: (key: string, state: ConnectionState) => boolean) {
    for (const [key, state] of (graph.connectionStore as Map<string, ConnectionState>).entries()) {
      if (!state.views || state.views.size === 0) {
        const ok = predicate ? predicate(key, state) : true;
        if (ok) graph.connectionStore.delete(key);
      }
    }
  }

  function resetRuntime() {
    for (const [, state] of (graph.connectionStore as Map<string, ConnectionState>).entries()) {
      state.views.clear();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Per-useQuery session
  // ────────────────────────────────────────────────────────────────────────────

  function buildConnKey(parentKey: string, field: string, vars: Record<string, any>) {
    const filtered: Record<string, any> = { ...vars };
    delete filtered.after; delete filtered.before; delete filtered.first; delete filtered.last;
    const id = Object.keys(filtered)
      .sort()
      .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
      .join("|");
    return `${parentKey}.${field}(${id})`;
  }

  function createViewSession() {
    const viewByConnKey = new Map<string, ConnectionView>();

    function wireConnections(root: any, vars: Record<string, any>) {
      if (!root || typeof root !== "object") return;

      const stack: Array<{ node: any; parentType: string | null }> = [{ node: root, parentType: "Query" }];
      while (stack.length) {
        const { node, parentType } = stack.pop()!;
        if (!node || typeof node !== "object") continue;

        const t = (node as any).__typename ?? parentType;

        for (const field of Object.keys(node)) {
          const val = (node as any)[field];
          if (!val || typeof val !== "object") continue;

          const edges = (val as any).edges;
          const pageInfo = (val as any).pageInfo;
          if (Array.isArray(edges) && pageInfo && typeof pageInfo === "object") {
            const parentKey = graph.getEntityParentKey(t!, graph.identify?.(node)) ?? "Query";
            const connKey = buildConnKey(parentKey, field, vars);
            const state = graph.ensureConnection(connKey);

            let view = viewByConnKey.get(connKey);
            if (!view) {
              view = createConnectionView(state, {
                edgesKey: "edges",
                pageInfoKey: "pageInfo",
                root: val,
                limit: 0,
                pinned: true,
              });
              viewByConnKey.set(connKey, view);
            }

            (val as any).edges = view.edges;
            (val as any).pageInfo = view.pageInfo;

            const hasAfter = vars.after != null;
            const hasBefore = vars.before != null;
            if (!hasAfter && !hasBefore) {
              setViewLimit(view, edges.length);
            } else {
              setViewLimit(view, state.list.length);
            }

            synchronizeConnectionViews(state);
          }

          if (Array.isArray(val)) {
            for (const it of val) if (it && typeof it === "object") stack.push({ node: it, parentType: t });
          } else {
            stack.push({ node: val, parentType: t });
          }
        }
      }
    }

    function destroy() {
      viewByConnKey.clear();
    }

    return { wireConnections, destroy };
  }

  return {
    proxyForEntityKey,
    materializeResult,

    createConnectionView,
    removeConnectionView,
    setViewLimit,
    synchronizeConnectionViews,

    gcConnections,
    resetRuntime,

    createViewSession,
  };
}
