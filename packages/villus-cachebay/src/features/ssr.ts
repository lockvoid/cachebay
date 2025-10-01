// src/features/ssr.ts — SSR de/hydration for the unified graph record store
import type { GraphInstance } from "../core/graph";


type Deps = { graph: GraphInstance };

type GraphSnapshot = {
  /** Array of [recordId, snapshot] entries; JSON-safe */
  records: Array<[string, any]>;
};

/** JSON-only deep clone; safe for snapshots. */
const cloneJSON = <T,>(data: T): T => JSON.parse(JSON.stringify(data));

export type SSRInstance = ReturnType<typeof createSSR>;

type SSROptions = {
  hydrationTimeout?: number;
};

export const createSSR = (options: SSROptions = {}, { graph }: Deps) => {
  let hydrating = false;
  const { hydrationTimeout = 100 } = options;

  /** Serialize all graph records. */
  const dehydrate = (): GraphSnapshot => {
    const ids = graph.keys();
    const out: Array<[string, any]> = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const snap = graph.getRecord(id);
      out[i] = [id, snap != null ? cloneJSON(snap) : undefined];
    }
    return { records: out };
  };

  /**
   * Hydrate a snapshot into the graph.
   * - input can be a plain snapshot or a function that emits it (stream-friendly)
   * - clears the graph first, then restores records
   * - `isHydrating()` is true until the next microtask
   */
  const hydrate = (
    input: GraphSnapshot | ((emit: (snapshot: GraphSnapshot) => void) => void)
  ) => {
    const run = (snapshot: GraphSnapshot) => {
      if (!snapshot || !Array.isArray(snapshot.records)) return;

      graph.clear();

      for (let i = 0; i < snapshot.records.length; i++) {
        const entry = snapshot.records[i];
        if (!entry) continue;
        const [id, snap] = entry;
        if (!id || !snap || typeof snap !== "object") continue;
        graph.putRecord(id, snap);
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
      setTimeout(() => {
        hydrating = false;
      }, hydrationTimeout);
    }
  };

  return {
    dehydrate,
    hydrate,
    isHydrating: () => hydrating,
  };
};
