// fragments.ts - everything related to fragments

import type { EntityKey } from "./types";
import { parseEntityKey } from "./utils";
import { TYPENAME_FIELD } from "./constants";

export type Fragments = ReturnType<typeof createFragments>;

export function createFragments(options: {}, dependencies: { graph: any; views: any }) {
  const { graph, views } = dependencies;

  function keyFromRefOrKey(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }): EntityKey | null {
    if (typeof refOrKey === "string") return refOrKey;
    const t = (refOrKey as any) && (refOrKey as any)[TYPENAME_FIELD];
    const id = (refOrKey as any)?.id ?? (refOrKey as any)?._id;
    return t && id != null ? (String(t) + ":" + String(id)) as EntityKey : null;
  }

  function hasFragment(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }) {
    const raw = keyFromRefOrKey(refOrKey);
    if (!raw) return false;
    const { typename, id } = parseEntityKey(raw);
    if (!typename) return false;
    if (graph.isInterfaceType(typename) && id != null) {
      const impls = graph.getInterfaceTypes(typename);
      for (let i = 0; i < impls.length; i++) {
        const k = (impls[i] + ":" + id) as EntityKey;
        if (graph.entityStore.has(k)) return true;
      }
      return false;
    }
    return graph.entityStore.has(raw);
  }

  function readFragment(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, materialized = true) {
    const key = keyFromRefOrKey(refOrKey);
    if (!key) return undefined;
    if (!materialized) {
      const { typename, id } = parseEntityKey(key);
      if (graph.isInterfaceType(typename) && id != null) {
        const impls = graph.getInterfaceTypes(typename) || [];
        for (let i = 0; i < impls.length; i++) {
          const k = (impls[i] + ":" + id) as EntityKey;
          if (graph.entityStore.has(k)) return graph.entityStore.get(k);
        }
        return undefined;
      }
      const k = (graph.resolveEntityKey(key) || key) as EntityKey;
      return graph.entityStore.get(k);
    }
    return views.proxyForEntityKey(key);
  }

  function writeFragment(obj: any) {
    let key = graph.identify(obj);
    if (!key) return { commit: null, revert: null };

    const prev = graph.entityStore.get(key);
    const next = { ...prev, ...obj };

    graph.entityStore.set(key, next);
    views.markEntityDirty(key);
    views.touchConnectionsForEntityKey(key);
    graph.bumpEntitiesTick();

    function commit() {
      // Already in store
    }

    function revert() {
      if (prev === undefined) {
        graph.entityStore.delete(key!);
      } else {
        graph.entityStore.set(key!, prev);
      }
      views.markEntityDirty(key!);
      views.touchConnectionsForEntityKey(key!);
      graph.bumpEntitiesTick();
    }

    return { commit, revert };
  }

  function readFragments(pattern: string | string[], opts: { materialized?: boolean } = {}) {
    const materialized = opts.materialized !== false;
    const selectors = Array.isArray(pattern) ? pattern : [pattern];
    const results: any[] = [];
    
    for (const selector of selectors) {
      if (selector.endsWith(':*')) {
        // Get all entities of a type
        const typename = selector.slice(0, -2);
        const keys = graph.getEntityKeys(typename);
        for (const key of keys) {
          const result = readFragment(key, materialized);
          if (result) results.push(result);
        }
      } else {
        // Single entity
        const result = readFragment(selector, materialized);
        if (result) results.push(result);
      }
    }
    
    return results;
  }

  return {
    identify: graph.identify,
    hasFragment,
    readFragment,
    writeFragment,
    readFragments,
  };
}
