import { inject } from "vue";
import { CACHEBAY_KEY } from "../core/plugin";

export type CacheAPI = {
  // Fragments (selection-first)
  readFragment: (args: {
    id: string;
    fragment: string;
    variables?: Record<string, any>;
  }) => any;

  writeFragment: (args: {
    id: string;
    fragment: string;
    data: any;
    variables?: Record<string, any>;
  }) => void;

  // Identity
  identify: (obj: any) => string | null;

  // Optimistic API (optional)
  modifyOptimistic?: (build: (c: any) => void) => { commit(): void; revert(): void };

  // Debug / inspect (optional)
  inspect?: {
    entities?: (typename?: string) => string[];
    entity?: (key: string) => any;
  };
};

/**
 * Access the Cachebay API (must be provided via provideCachebay()).
 * Throws if used outside a Vue app that called provideCachebay().
 */
export function useCache(): CacheAPI {
  const api = inject<CacheAPI | null>(CACHEBAY_KEY, null);
  if (!api) {
    throw new Error("[cachebay] useCache() called before provideCachebay()");
  }
  return api;
}
