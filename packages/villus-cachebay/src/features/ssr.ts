import type { EntityKey, ConnectionState } from "../core/types";
import { isReactive } from "vue";

type Deps = {
  graph: any;
  views: any;
  shallowReactive: <T extends object>(obj: T) => T;
  applyResolversOnGraph?: (root: any, vars: Record<string, any>, hint: { stale?: boolean }) => void;
};

function cloneData(data: any): any {
  return JSON.parse(JSON.stringify(data));
}

export function createSSR(deps: Deps) {
  const { graph, views, shallowReactive, applyResolversOnGraph } = deps;

  // Used by cache plugin to allow CN cached+terminate on first mount after hydrate
  const hydrateOperationTicket = new Set<string>();
  let hydrating = false;

  const dehydrate = () => ({
    ent: Array.from(graph.entityStore.entries()),
    conn: Array.from(graph.connectionStore.entries()).map(([k, st]) => [
      k,
      { list: st.list, pageInfo: st.pageInfo, meta: st.meta },
    ]),
    op: Array.from(graph.operationStore.entries()).map(([k, v]) => [
      k,
      { data: v.data, variables: v.variables },
    ]),
  });

  /**
   * Hydrate a snapshot.
   * opts.materialize — rebuilds views/entities from op-cache so UI renders immediately.
   * opts.rabbit — drops a "hydrate ticket" for each op-key so CN may emit cached once & terminate (Suspense-friendly).
   */
  const hydrate = (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => {
    const doMaterialize = !!opts?.materialize;
    const rabbit = opts?.rabbit !== false; // default true

    const run = (snapshot: any) => {
      if (!snapshot) return;

      // reset stores & runtime
      graph.entityStore.clear();
      graph.connectionStore.clear();
      graph.operationStore.clear();
      views.resetRuntime();

      // restore entities
      if (Array.isArray(snapshot.ent)) {
        for (const [key, snap] of snapshot.ent) {
          graph.entityStore.set(key, snap);
        }
      }

      // restore connections
      if (Array.isArray(snapshot.conn)) {
        for (const [key, { list, pageInfo, meta, initialized }] of snapshot.conn) {
          const state = graph.ensureReactiveConnection(key);
          state.list.splice(0, state.list.length, ...list);
          // pageInfo in place
          const curPI = state.pageInfo;
          for (const k of Object.keys(curPI)) delete curPI[k];
          for (const k of Object.keys(pageInfo)) (curPI as any)[k] = pageInfo[k];
          // meta in place
          const curMeta = state.meta;
          for (const k of Object.keys(curMeta)) delete curMeta[k];
          for (const k of Object.keys(meta)) (curMeta as any)[k] = meta[k];
          // keySet
          state.keySet = new Set<string>(state.list.map((e: any) => e.key));
          state.initialized = initialized;
          // make list + pageInfo reactive if not already
          if (!isReactive(state.list)) {
            const rlist = shallowReactive(state.list);
            state.list.splice(0, state.list.length, ...rlist);
          }
          if (!isReactive(state.pageInfo)) state.pageInfo = shallowReactive(state.pageInfo);
          // Link entities to connection
          for (const entry of state.list) {
            views.linkEntityToConnection(entry.key, state);
          }
        }
      }

      // restore op-cache (+ optional “rabbit” tickets)
      if (Array.isArray(snapshot.op)) {
        for (const [key, { data, variables }] of snapshot.op || []) {
          graph.operationStore.set(key, { data: cloneData(data), variables });
          hydrateOperationTicket.add(key);
        }
      }

      // Optional materialization pass from op-cache
      if (doMaterialize) {
        graph.operationStore.forEach(({ data, variables }: any) => {
          const vars = variables || {};
          applyResolversOnGraph?.(data, vars, { stale: false });
          views.registerViewsFromResult(data, vars);
          views.collectEntities(data);
          views.materializeResult(data);
        });
      }
    };

    hydrating = true;
    try {
      if (typeof input === "function") input((s) => run(s));
      else run(input);
    } finally {
      // keep microtask flip (tests can await tick(2) if needed)
      queueMicrotask(() => { hydrating = false; });
    }
  };

  return {
    dehydrate,
    hydrate,
    isHydrating: () => hydrating,
    hydrateOperationTicket,
  };
}
