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
  const order: string[] = [];
  const selectors = Array.isArray(pattern) ? pattern.slice() : [pattern];

  const expand = (sel: string): string[] => {
    if (!sel) return [];
    const idx = sel.indexOf(":");
    if (idx > 0 && sel.slice(idx + 1) !== "*") return [sel];
    const type = sel.endsWith(":*") ? sel.slice(0, -2) : sel;
    return (api as any).listEntityKeys(type);
  };

  return computed<T[]>(() => {
    void api.__entitiesTick.value;

    const nowSet = new Set<string>();
    for (let i = 0; i < selectors.length; i++) {
      const keys = expand(selectors[i]);
      for (let j = 0; j < keys.length; j++) nowSet.add(keys[j]);
    }

    const nextOrder: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      if (nowSet.has(k)) {
        nextOrder.push(k);
        nowSet.delete(k);
      }
    }

    const rest = Array.from(nowSet);
    rest.sort();
    nextOrder.push(...rest);

    order.length = 0;
    order.push(...nextOrder);

    const out = new Array(order.length);
    for (let i = 0; i < order.length; i++) {
      out[i] = api.readFragment(order[i], materialized);
    }

    return out as T[];
  });
}
