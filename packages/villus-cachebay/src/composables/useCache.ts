import { inject, type Ref } from "vue";
import { CACHEBAY_KEY } from "../core/plugin";

export type CacheAPI = {
  // fragments API
  readFragment: (refOrKey: string | { __typename: string; id?: any }, opts?: { materialized?: boolean }) => any;
  readFragments: (pattern: string | string[], opts?: { materialized?: boolean }) => any[];

  writeFragment: (obj: any) => { commit: () => void; revert: () => void } | any;
  identify: (obj: any) => string | null;

  // graph watcher API (NEW)
  registerEntityWatcher: (run: () => void) => number;
  unregisterEntityWatcher: (id: number) => void;
  trackEntity: (watcherId: number, entityKey: string) => void;

  // optionally: other Core API your app exposes via provideCachebay
  modifyOptimistic?: (fn: (draft: any) => void) => void;
  inspect?: {
    entities?: (typename?: string) => string[];
    entity?: (key: string) => any;
    connections?: () => string[];
    connection?: (parent: "Query" | { __typename: string; id?: any }, field: string, variables?: Record<string, any>) => any;
    operations?: () => string[];
  };
};

/**
 * Access the Cachebay API (must be provided via provideCachebay()).
 * Exposes watcher methods so hooks can subscribe to specific entity changes.
 */
export function useCache(): CacheAPI {
  const api = inject<CacheAPI | null>(CACHEBAY_KEY, null);
  if (!api) throw new Error("[cachebay] useCache() called before provideCachebay()");
  return api;
}
