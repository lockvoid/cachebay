// src/features/ssr.ts — SSR de/hydration for the entities+selections model

type Deps = {
  graph: {
    entityStore: Map<string, any>;
    selectionStore: Map<string, any>;
  };
  resolvers?: {
    /** Optional: run resolvers during hydrate on a *clone* of each selection skeleton (no wiring). */
    applyOnObject?: (root: any, vars?: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
};

/** JSON-only deep clone; fine for snapshots. */
const cloneData = <T,>(data: T): T => {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
};

export const createSSR = (deps: Deps) => {
  const { graph, resolvers } = deps;

  // Selection “tickets” — e.g. a plugin can use them to publish cached-first on first mount after hydrate.
  const hydrateSelectionTicket = new Set<string>();

  // Hydration flag — true inside hydrate() until the next microtask.
  let hydrating = false;

  /** Serialize graph stores (entities, selections). */
  const dehydrate = () => ({
    entities: Array.from(graph.entityStore.entries()),
    selections: Array.from(graph.selectionStore.entries()),
  });

  /**
   * Hydrate a snapshot into the graph.
   * - input: snapshot object OR a function receiving a (hydrate) callback (streaming-friendly)
   * - opts.materialize: (default false) run resolvers.applyOnObject on a *clone* of each selection skeleton
   *                     (purely to warm derived fields—no wiring, no graph writes)
   * - opts.tickets: (default true) drop a ticket per selection key so a plugin can do cached-first publish
   */
  const hydrate = (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; tickets?: boolean }
  ) => {
    const doMaterialize = !!opts?.materialize;
    const withTickets = opts?.tickets !== false; // default true

    const run = (snapshot: any) => {
      if (!snapshot) {
        return;
      }

      // Reset stores
      graph.entityStore.clear();
      graph.selectionStore.clear();
      hydrateSelectionTicket.clear();

      // Restore entities: [key, snapshot][]
      if (Array.isArray(snapshot.entities)) {
        for (let i = 0; i < snapshot.entities.length; i++) {
          const [key, entitySnapshot] = snapshot.entities[i];
          graph.entityStore.set(key, entitySnapshot);
        }
      }

      // Restore selections: [key, skeleton][]
      if (Array.isArray(snapshot.selections)) {
        for (let i = 0; i < snapshot.selections.length; i++) {
          const [key, skeleton] = snapshot.selections[i];
          graph.selectionStore.set(key, skeleton);
          if (withTickets) {
            hydrateSelectionTicket.add(key);
          }
        }
      }

      // Optional: warm any derived fields on a clone of each selection skeleton
      if (doMaterialize && typeof resolvers?.applyOnObject === "function") {
        graph.selectionStore.forEach((skeleton) => {
          const clone = cloneData(skeleton);
          try {
            resolvers.applyOnObject!(clone, {}, { stale: false });
          } catch {
            // Best-effort; ignore resolver errors during SSR warm-up
          }
        });
      }
    };

    hydrating = true;
    try {
      if (typeof input === "function") {
        input((s) => run(s));
      } else {
        run(input);
      }
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
    hydrateSelectionTicket,
  };
};
