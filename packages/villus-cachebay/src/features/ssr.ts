import type { EntityKey, ConnectionState } from "../core/types";

type Deps = {
  // stores
  entityStore: Map<EntityKey, any>;
  connectionStore: Map<string, ConnectionState>;
  operationCache: Map<string, { data: any; variables: Record<string, any> }>;

  // connection/core helpers
  ensureConnectionState: (key: string) => ConnectionState;
  linkEntityToConnection: (key: EntityKey, state: ConnectionState) => void;

  // vue reactivity
  shallowReactive: <T extends object>(obj: T) => T;

  // result → views/entities
  registerViewsFromResult: (root: any, variables: Record<string, any>) => void;

  /** Clears internal runtime bookkeeping (dirty sets, entity→connection links, etc.). */
  resetRuntime: () => void;

  // Optional graph/entity helpers used during hydrate(materialize: true)
  applyResolversOnGraph?: (root: any, vars: Record<string, any>, hint: { stale?: boolean }) => void;
  collectEntities?: (root: any) => void;

  // NEW: live materializer to stitch edges[].node → proxies
  materializeResult?: (root: any) => void;
};

export function createSSR(deps: Deps) {
  const {
    entityStore,
    connectionStore,
    operationCache,
    ensureConnectionState,
    linkEntityToConnection,
    shallowReactive,
    registerViewsFromResult,
    resetRuntime,
    applyResolversOnGraph,
    collectEntities,
    materializeResult,
  } = deps;

  // Used by cache plugin to allow CN cached+terminate on first mount after hydrate
  const hydrateOperationTicket = new Set<string>();
  let hydrating = false;

  const dehydrate = () => ({
    ent: Array.from(entityStore.entries()),
    conn: Array.from(connectionStore.entries()).map(([k, st]) => [
      k,
      { list: st.list, pageInfo: st.pageInfo, meta: st.meta },
    ]),
    op: Array.from(operationCache.entries()).map(([k, v]) => [
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
      entityStore.clear();
      connectionStore.clear();
      operationCache.clear();
      resetRuntime();

      // restore entities
      if (Array.isArray(snapshot.ent)) {
        for (const [k, v] of snapshot.ent) entityStore.set(k, v);
      }

      // restore connections
      if (Array.isArray(snapshot.conn)) {
        for (const [key, s] of snapshot.conn) {
          const state = ensureConnectionState(key);
          state.list = (s.list || []).slice();
          state.keySet = new Set(state.list.map((e: any) => e.key));
          for (let i = 0; i < state.list.length; i++) {
            linkEntityToConnection(state.list[i].key, state);
          }
          state.pageInfo = shallowReactive({ ...(s.pageInfo || {}) });
          state.meta = shallowReactive({ ...(s.meta || {}) });
        }
      }

      // restore op-cache (+ optional “rabbit” tickets)
      if (Array.isArray(snapshot.op)) {
        for (const [k, v] of snapshot.op) {
          operationCache.set(k, { data: v.data, variables: v.variables || {} });
          if (rabbit) hydrateOperationTicket.add(k);
        }
      }

      // Optional materialization pass from op-cache
      if (doMaterialize) {
        operationCache.forEach(({ data, variables }) => {
          const vars = variables || {};
          applyResolversOnGraph?.(data, vars, { stale: false });
          collectEntities?.(data);
          registerViewsFromResult(data, vars);
          // 🔑 stitch edges[].node into live proxies so writeFragment will update the view
          materializeResult?.(data);
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
