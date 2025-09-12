// features/ssr.ts — SSR de/hydration for the new (view-agnostic) pipeline

type Deps = {
  graph: {
    entityStore: Map<string, any>;
    connectionStore: Map<string, any>;
    operationStore: Map<string, { data: any; variables: Record<string, any> }>;
    ensureConnection: (key: string) => any;
  };
  resolvers?: {
    applyResolversOnGraph?: (root: any, vars: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
};

/** JSON-only deep clone; fine for op-cache & snapshots. */
function cloneData<T>(data: T): T {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
}

export function createSSR(deps: Deps) {
  const { graph, resolvers } = deps;
  const applyResolversOnGraph = resolvers?.applyResolversOnGraph;

  // Used by the cache plugin to allow CN cached+resolve on first mount after hydrate
  const hydrateOperationTicket = new Set<string>();

  // Hydration flag — set true during hydrate() and flipped to false on microtask
  let hydrating = false;

  /** Serialize graph stores (entities, connections, operations). */
  const dehydrate = () => ({
    ent: Array.from(graph.entityStore.entries()),
    conn: Array.from(graph.connectionStore.entries()).map(([key, st]) => [
      key,
      {
        list: st.list,
        pageInfo: st.pageInfo,
        meta: st.meta,
        initialized: !!st.initialized,
      },
    ]),
    op: Array.from(graph.operationStore.entries()).map(([k, v]) => [
      k,
      { data: v.data, variables: v.variables },
    ]),
  });

  /**
   * Hydrate a snapshot into the graph.
   * - input: snapshot object or a function receiving a (hydrate) callback
   * - opts.materialize: (default false) apply resolvers to post-resolver ops to rebuild connection state for immediate UI
   * - opts.rabbit: (default true) drop a hydrate ticket per op key, so cache-and-network can publish cached immediately
   */
  const hydrate = (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => {
    const doMaterialize = !!opts?.materialize;
    const withTickets = opts?.rabbit !== false; // default true

    const run = (snapshot: any) => {
      if (!snapshot) return;

      // Reset stores
      graph.entityStore.clear();
      graph.connectionStore.clear();
      graph.operationStore.clear();

      // Restore entities (snapshot.ent is [key, snapshot][])
      if (Array.isArray(snapshot.ent)) {
        for (const [key, snap] of snapshot.ent) {
          graph.entityStore.set(key, snap);
        }
      }

      // Restore connections (~ConnectionState sans views/keySet)
      if (Array.isArray(snapshot.conn)) {
        for (const [key, { list, pageInfo, meta, initialized }] of snapshot.conn) {
          const st = graph.ensureConnection(key);
          // list
          st.list.length = 0;
          for (let i = 0; i < list.length; i++) st.list.push(list[i]);
          // pageInfo
          const pi = st.pageInfo;
          for (const k of Object.keys(pi)) delete pi[k];
          for (const k of Object.keys(pageInfo)) pi[k] = pageInfo[k];
          // meta
          const mt = st.meta;
          for (const k of Object.keys(mt)) delete mt[k];
          for (const k of Object.keys(meta)) mt[k] = meta[k];

          // keySet from list
          st.keySet = new Set<string>(st.list.map((e: any) => e.key));
          st.initialized = !!initialized;
        }
      }

      // Restore operation cache (+ hydrate tickets)
      if (Array.isArray(snapshot.op)) {
        for (const [key, { data, variables }] of snapshot.op) {
          graph.operationStore.set(key, { data: cloneData(data), variables });
          if (withTickets) hydrateOperationTicket.add(key);
        }
      }

      // Optional: materialize from op-cache — build canonical connection state by applying resolvers
      if (doMaterialize && typeof applyResolversOnGraph === "function") {
        graph.operationStore.forEach(({ data, variables }: any) => {
          const vars = variables || {};
          const cloned = cloneData(data);
          applyResolversOnGraph(cloned, vars, { stale: false });
          // Note: We do NOT wire views here; plugin will wire per-instance views on first publish.
        });
      }
    };

    hydrating = true;
    try {
      if (typeof input === "function") input((s) => run(s));
      else run(input);
    } finally {
      // Flip to false on microtask so tests can await a tick if needed.
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
