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
import type { CachebayInstance } from "./core/internals";

export const CACHEBAY_KEY: symbol = Symbol("villus-cachebay");

export function provideCachebay(app: App, instance: CachebayInstance) {
  const api: any = {
    readFragment: instance.readFragment,
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    hasFragment: (instance as any).hasFragment,
    listEntityKeys: (instance as any).listEntityKeys,
    listEntities: (instance as any).listEntities,
    __entitiesTick: (instance as any).__entitiesTick,
  };

  // Lazily proxy inspect to avoid pulling debug into prod bundles
  Object.defineProperty(api, "inspect", {
    configurable: true,
    enumerable: true,
    get() {
      return (instance as any).inspect; // this triggers lazy getter in core
    },
  });

  app.provide(CACHEBAY_KEY, api);
}

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
  __entitiesTick: Ref<number>;
} {
  const api = inject<any>(CACHEBAY_KEY, null);
  if (!api) throw new Error("[cachebay] useCache() called before provideCachebay()");
  return api;
}
