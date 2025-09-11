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
  
  return computed<T[]>(() => {
    void api.__entitiesTick.value;
    return (api as any).readFragments(pattern, opts) as T[];
  });
}
