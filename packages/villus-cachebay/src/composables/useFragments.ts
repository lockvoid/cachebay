import {
  inject,
  shallowRef,
  isRef,
  watch,
  computed,
  unref,
  type Ref,
  type App,
} from "vue";
import { useCache } from "./useCache";

export function useFragments<T = any>(pattern: string | string[], opts: { materialized?: boolean } = {}) {
  const api = useCache();
  const materialized = opts.materialized !== false;

  if (!materialized) {
    // Non-reactive snapshots: only update when list membership changes (add/remove)
    let lastKeys: string = '';
    let cachedResult: T[] = [];
    
    return computed<T[]>(() => {
      // Track entitiesTick to know when to check for changes
      void api.entitiesTick.value;
      
      // Get current list of keys
      const currentList = (api as any).readFragments(pattern, opts) as T[];
      const currentKeys = currentList.map((item: any) => 
        item?.__typename && (item.id || item._id) ? `${item.__typename}:${item.id || item._id}` : ''
      ).filter(Boolean).sort().join(',');
      
      // Only update cached result if the list of entities changed
      if (currentKeys !== lastKeys) {
        lastKeys = currentKeys;
        // Deep clone to ensure snapshots don't update
        cachedResult = currentList.map((item: any) => item ? structuredClone(item) : item);
      }
      
      return cachedResult;
    });
  }

  // Reactive: updates on any change
  return computed<T[]>(() => {
    void api.entitiesTick.value;
    return (api as any).readFragments(pattern, opts) as T[];
  });
}
