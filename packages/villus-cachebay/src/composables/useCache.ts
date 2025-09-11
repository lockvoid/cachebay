import {
  inject,
  shallowRef,
  isRef,
  watch,
  computed,
  unref,
  type Ref,
} from "vue";
import type { CachebayInstance } from "../core/internals";
import { CACHEBAY_KEY } from "../core/plugin";
export { provideCachebay } from "../core/plugin";

export function useCache(): {
  readFragment: CachebayInstance["readFragment"];
  writeFragment: CachebayInstance["writeFragment"];
  identify: CachebayInstance["identify"];
  modifyOptimistic: CachebayInstance["modifyOptimistic"];
  inspect: {
    entities: (typename?: string) => string[];
    get: (key: string) => any;
    connections: () => string[];
    connection: (
      parent: "Query" | { __typename: string; id?: any; _id?: any },
      field: string,
      variables?: Record<string, any>,
    ) => any;
  };
  hasFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }) => boolean;
  listEntityKeys: (selector: string | string[]) => string[];
  listEntities: (selector: string | string[], materialized?: boolean) => any[];
  entitiesTick: Ref<number>;
} {
  const api = inject<any>(CACHEBAY_KEY, null);
  if (!api) throw new Error("[cachebay] useCache() called before provideCachebay()");
  return api;
}
