/* src/features/inspect.ts */
 
import type { GraphInstance } from "../core/graph";

/**
 * Lightweight debug/inspection helpers over the unified graph.
 * - keys(): list all record ids
 * - record(id): raw or materialized view of a record
 * - entityKeys(): filter "Type:id" records (excludes '@', '@.' pages, and '.edges.' keys)
 * - pageKeys(): connection page records ('@.' prefix, not edge records)
 * - edgeKeys(): edge records matching '*.edges.N' (optionally under a page)
 * - config(): returns graph creation options (keys/interfaces)
 */
export const createInspect = ({ graph }: { graph: GraphInstance }) => {
  const keys = (): string[] => graph.keys();

  const isRootKey = (id: string) => id === "@";
  const isEdgeKey = (id: string) => id.includes(".edges.");
  const isPageKey = (id: string) => id.startsWith("@.") && !isEdgeKey(id);
  const isEntityKey = (id: string) => !isRootKey(id) && !isPageKey(id) && !isEdgeKey(id);

  const entityKeys = (typename?: string): string[] => {
    const all = keys().filter(isEntityKey);
    if (!typename) return all;
    return all.filter((k) => k.startsWith(`${typename}:`));
  };

  const pageKeys = (): string[] => keys().filter(isPageKey);

  const edgeKeys = (pageKey?: string): string[] => {
    const all = keys().filter(isEdgeKey);
    if (!pageKey) return all;
    const prefix = `${pageKey}.edges.`;
    return all.filter((k) => k.startsWith(prefix));
  };

  const record = (id: string, opts?: { materialized?: boolean }): any => {
    if (opts?.materialized) return graph.materializeRecord(id);
    return graph.getRecord(id);
  };

  const config = () => {
    // graph.inspect() returns { records, options: { keys, interfaces } }
    const snap = graph.inspect?.();
    return snap?.options ?? { keys: {}, interfaces: {} };
  };

  return {
    keys,
    record,
    entityKeys,
    pageKeys,
    edgeKeys,
    config,
  };
};

export type InspectAPI = ReturnType<typeof createInspect>;
