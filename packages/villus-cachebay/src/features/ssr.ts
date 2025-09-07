import type { EntityKey, ConnectionState } from "../core/types";

type Deps = {
  entityStore: Map<EntityKey, any>;
  connectionStore: Map<string, ConnectionState>;
  operationCache: Map<string, { data: any; variables: Record<string, any> }>;

  ensureConnectionState: (key: string) => ConnectionState;
  linkEntityToConnection: (key: EntityKey, state: ConnectionState) => void;

  shallowReactive: <T extends object>(obj: T) => T;

  registerViewsFromResult: (root: any, variables: Record<string, any>) => void;

  /** Clears internal runtime bookkeeping (dirty sets, entity→connection links, etc.). */
  resetRuntime: () => void;
};

export function createSSRFeatures(deps: Deps) {
  const {
    entityStore,
    connectionStore,
    operationCache,
    ensureConnectionState,
    linkEntityToConnection,
    shallowReactive,
    registerViewsFromResult,
    resetRuntime,
  } = deps;

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

  const hydrate = (input: any | ((hydrate: (snapshot: any) => void) => void)) => {
    const run = (snapshot: any) => {
      if (!snapshot) return;

      entityStore.clear();
      connectionStore.clear();
      operationCache.clear();
      resetRuntime();

      if (Array.isArray(snapshot.ent)) {
        for (const [k, v] of snapshot.ent) entityStore.set(k, v);
      }

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

      if (Array.isArray(snapshot.op)) {
        for (const [k, v] of snapshot.op) {
          operationCache.set(k, { data: v.data, variables: v.variables || {} });
          hydrateOperationTicket.add(k);
        }
      }

      operationCache.forEach(({ data, variables }) =>
        registerViewsFromResult(data, variables || {}),
      );
    };

    hydrating = true;
    try {
      if (typeof input === "function") input((s) => run(s));
      else run(input);
    } finally {
      queueMicrotask(() => {
        hydrating = false;
      });
    }
  };

  return {
    dehydrate,
    hydrate,
    isHydrating: () => hydrating,
    hydrateOperationTicket,
  };
}
