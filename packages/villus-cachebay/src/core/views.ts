// src/core/views.ts
import type { GraphAPI } from "./graph";

/**
 * Views: a tiny adapter that lets UI code (or data hooks)
 * create a short-lived “view session” to materialize selections
 * and/or entities and keep references organized. No Relay logic here.
 */

export type ViewsConfig = Record<string, never>;

export type ViewsDeps = {
  graph: GraphAPI;
};

export type ViewsAPI = ReturnType<typeof createViews>;

export const createViews = ({
  config,
  dependencies,
}: {
  config?: ViewsConfig;
  dependencies: ViewsDeps;
}) => {
  const { graph } = dependencies;

  /**
   * A per-usage session (e.g., per `useQuery`) that keeps track of what
   * it mounted (entities and selections). Destroying a session does not
   * mutate the graph; it just lets the app drop references so WeakRefs can GC.
   */
  const createSession = () => {
    const mountedSelections = new Set<string>();
    const mountedEntities = new Set<string>();

    const mountSelection = (selectionKey: string) => {
      mountedSelections.add(selectionKey);
      // materializeSelection returns a reactive proxy (view wrapper).
      return graph.materializeSelection(selectionKey);
    };

    const mountEntity = (entityKey: string) => {
      mountedEntities.add(entityKey);
      // materializeEntity returns the canonical reactive proxy for that entity.
      return graph.materializeEntity(entityKey);
    };

    /**
     * Force a re-overlay on a mounted selection, useful if the caller
     * wants to re-read the same selection (graph takes care of proxy identity).
     */
    const refreshSelection = (selectionKey: string) => {
      if (!mountedSelections.has(selectionKey)) {
        return graph.materializeSelection(selectionKey);
      }
      return graph.materializeSelection(selectionKey);
    };

    /**
     * Destroy: drop bookkeeping references. We don't clear graph state here.
     * Callers that want to explicitly remove a selection skeleton can call
     * graph.removeSelection(key) themselves before/after destroy.
     */
    const destroy = () => {
      mountedSelections.clear();
      mountedEntities.clear();
    };

    return {
      mountSelection,
      mountEntity,
      refreshSelection,
      destroy,
      // For tests / inspection
      _mountedSelections: mountedSelections,
      _mountedEntities: mountedEntities,
    };
  };

  return {
    createSession,
  };
};
