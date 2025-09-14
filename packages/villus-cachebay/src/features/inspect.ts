// src/features/inspect.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GraphAPI } from "@/src/core/graph";

/**
 * Lightweight debug/inspection helpers over the selection-first graph.
 * - Lists entity keys (optionally filtered by typename)
 * - Reads raw or materialized entities/selections
 * - Exposes current config (keys/interfaces)
 */
export const createInspect = ({ graph }: { graph: GraphAPI }) => {
  const snapshot = () => graph.inspect() || { entities: {}, selections: {}, config: {} };

  const entities = (typename?: string): string[] => {
    const snap = snapshot();
    const keys = Object.keys(snap.entities || {});
    if (!typename) {
      return keys;
    }
    return keys.filter((k) => k.startsWith(`${typename}:`));
  };

  const entity = (key: string, opts?: { materialized?: boolean }): any => {
    if (opts?.materialized) {
      return graph.materializeEntity(key);
    }
    return graph.getEntity(key);
  };

  const selections = (): string[] => {
    const snap = snapshot();
    return Object.keys(snap.selections || {});
  };

  const selection = (key: string, opts?: { materialized?: boolean }): any => {
    if (opts?.materialized) {
      return graph.materializeSelection(key);
    }
    return graph.getSelection(key);
  };

  const config = () => snapshot().config;

  return {
    entities,
    entity,
    selections,
    selection,
    config,
  };
};

export type InspectAPI = ReturnType<typeof createInspect>;
