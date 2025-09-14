// src/features/ssr.ts — SSR de/hydration for the entities+selections model

type GraphAPIForSSR = {
  // entities
  listEntityKeys: () => string[];
  getEntity: (key: string) => any | undefined;
  putEntity: (obj: any) => string | null;
  removeEntity: (key: string) => boolean;
  clearAllEntities: () => void;

  // selections
  listSelectionKeys: () => string[];
  getSelection: (key: string) => any | undefined;
  putSelection: (key: string, subtree: any) => void;
  removeSelection: (key: string) => boolean;
  clearAllSelections: () => void;
};

type Deps = {
  graph: GraphAPIForSSR;
  resolvers?: {
    /** Optional: warm selection clones (purely derived work — no writes). */
    applyOnObject?: (root: any, vars?: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
};

/** JSON-only deep clone; safe for snapshots. */
const cloneData = <T,>(data: T): T => {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
};

export const createSSR = (deps: Deps) => {
  const { graph, resolvers } = deps;

  // Selection “tickets” — lets a plugin publish cached-first once after hydrate.
  const hydrateSelectionTicket = new Set<string>();

  // Hydration flag — true inside hydrate() until the next microtask.
  let hydrating = false;

  /** Serialize graph stores (entities, selections). */
  const dehydrate = () => {
    const entities = graph.listEntityKeys().map((k) => [k, graph.getEntity(k)]);
    const selections = graph.listSelectionKeys().map((k) => [k, graph.getSelection(k)]);
    return { entities, selections };
  };

  /**
   * Hydrate a snapshot into the graph.
   * - input: snapshot object OR a function receiving a (hydrate) callback (streaming-friendly)
   * - opts.materialize: warm resolvers on a clone of each selection skeleton (no writes)
   * - opts.tickets: (default true) emit a ticket per selection key for cached-first publish
   */
  const hydrate = (
    input: any | ((emit: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; tickets?: boolean }
  ) => {
    const doMaterialize = !!opts?.materialize;
    const withTickets = opts?.tickets !== false; // default true

    const run = (snapshot: any) => {
      if (!snapshot) return;

      // Reset stores using only public API
      graph.clearAllEntities();
      graph.clearAllSelections();
      hydrateSelectionTicket.clear();

      // Restore entities
      if (Array.isArray(snapshot.entities)) {
        for (let i = 0; i < snapshot.entities.length; i++) {
          const [, snap] = snapshot.entities[i];
          if (snap && typeof snap === "object") {
            graph.putEntity(snap);
          }
        }
      }

      // Restore selections
      if (Array.isArray(snapshot.selections)) {
        for (let i = 0; i < snapshot.selections.length; i++) {
          const [key, skeleton] = snapshot.selections[i];
          graph.putSelection(key, skeleton);
          if (withTickets) hydrateSelectionTicket.add(key);
        }
      }

      // Optional warm-up of derived fields (no writes; clones only)
      if (doMaterialize && typeof resolvers?.applyOnObject === "function") {
        const all = graph.listSelectionKeys();
        for (let i = 0; i < all.length; i++) {
          const skel = graph.getSelection(all[i]);
          if (skel) {
            try {
              resolvers.applyOnObject!(cloneData(skel), {}, { stale: false });
            } catch {
              /* ignore any resolver warm-up errors */
            }
          }
        }
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
