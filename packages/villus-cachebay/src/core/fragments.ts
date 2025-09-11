// fragments.ts - everything related to fragments

import type { EntityKey } from "./types";
import { parseEntityKey } from "./utils";
import { TYPENAME_FIELD } from "./constants";
import type { GraphAPI } from "./graph";
import type { ViewsAPI } from "./views";

export type Fragments = ReturnType<typeof createFragments>;

export type FragmentsDependencies = {
  graph: GraphAPI;
  views: ViewsAPI;
};

export function createFragments(options: {}, dependencies: FragmentsDependencies) {
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

  function readFragment(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, { materialized = true } = {}) {
    const key = typeof refOrKey === "string"
      ? refOrKey
      : graph.identify(refOrKey);

    if (!key) return null;

    const entity = graph.entityStore.get(key);
    if (!entity) return null;

    return materialized
      ? views.proxyForEntityKey(key)
      : graph.materializeEntity(key);
  }

  function writeFragment(obj: any) {
    const key = graph.identify(obj);
    if (!key) return { commit: null, revert: null };

    // Capture the previous state before any modifications
    const prevEntity = graph.entityStore.get(key);
    const prev = prevEntity ? { ...prevEntity } : undefined;
    const next = { ...prev, ...obj };
    let committed = false;

    function commit() {
      if (committed) return; // Prevent double commit
      committed = true;
      graph.entityStore.set(key, next);
      views.markEntityDirty(key);
      views.touchConnectionsForEntityKey(key);
      graph.bumpEntitiesTick();
    }

    function revert() {
      if (!committed) return; // Can only revert if committed
      committed = false;
      
      if (prev === undefined) {
        graph.entityStore.delete(key);
      } else {
        graph.entityStore.set(key, prev);
      }
      views.markEntityDirty(key);
      views.touchConnectionsForEntityKey(key);
      graph.bumpEntitiesTick();
    }

    return { commit, revert };
  }

  function readFragments(pattern: string | string[], opts: { materialized?: boolean } = {}) {
    const selectors = Array.isArray(pattern) ? pattern : [pattern];
    const results: any[] = [];

    for (const selector of selectors) {
      if (selector.endsWith(':*')) {
        // Get all entities of a type or interface
        const typename = selector.slice(0, -2);
        
        // Check if it's an interface
        const implementors = graph.getInterfaceTypes(typename);
        if (implementors && implementors.length > 0) {
          // It's an interface - get all entities of types that implement it
          for (const implementor of implementors) {
            const keys = graph.getEntityKeys(implementor + ':');
            for (const key of keys) {
              const result = readFragment(key, opts);
              if (result) results.push(result);
            }
          }
        } else {
          // Regular type - get all entities of this type
          const keys = graph.getEntityKeys(typename + ':');
          for (const key of keys) {
            const result = readFragment(key, opts);
            if (result) results.push(result);
          }
        }
      } else {
        // Single entity
        const result = readFragment(selector, opts);
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
