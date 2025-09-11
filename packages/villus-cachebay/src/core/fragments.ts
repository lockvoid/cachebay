// fragments.ts - everything related to fragments

import type { EntityKey } from "./types";
import { parseEntityKey } from "./utils";
import { TYPENAME_FIELD } from "./constants";

export type Fragments = ReturnType<typeof createFragments>;

export function createFragments(
  options: {},
  dependencies: {
    // graph dependencies
    entityStore: Map<EntityKey, any>;
    identify: (o: any) => EntityKey | null;
    resolveEntityKey: (k: EntityKey) => EntityKey | null;
    materializeEntity: (k: EntityKey) => any;
    bumpEntitiesTick: () => void;
    isInterfaceType: (t: string | null) => boolean;
    getInterfaceTypes: (t: string) => string[];

    // views dependencies
    proxyForEntityKey: (k: EntityKey) => any;
    markEntityDirty: (k: EntityKey) => void;
    touchConnectionsForEntityKey: (k: EntityKey) => void;
  }
) {
  const {
    entityStore,
    identify,
    resolveEntityKey,
    materializeEntity,
    bumpEntitiesTick,
    isInterfaceType,
    getInterfaceTypes,
    proxyForEntityKey,
    markEntityDirty,
    touchConnectionsForEntityKey,
  } = dependencies;


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
    if (isInterfaceType(typename) && id != null) {
      const impls = getInterfaceTypes(typename);
      for (let i = 0; i < impls.length; i++) {
        const k = (impls[i] + ":" + id) as EntityKey;
        if (entityStore.has(k)) return true;
      }
      return false;
    }
    return entityStore.has(raw);
  }

  function readFragment(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, materialized = true) {
    const key = keyFromRefOrKey(refOrKey);
    if (!key) return undefined;
    if (!materialized) {
      const { typename, id } = parseEntityKey(key);
      if (isInterfaceType(typename) && id != null) {
        const impls = getInterfaceTypes(typename) || [];
        for (let i = 0; i < impls.length; i++) {
          const k = (impls[i] + ":" + id) as EntityKey;
          if (entityStore.has(k)) return entityStore.get(k);
        }
        return undefined;
      }
      const k = (resolveEntityKey(key) || key) as EntityKey;
      return entityStore.get(k);
    }
    return proxyForEntityKey(key);
  }

  function writeFragment(obj: any) {
    let key = identify(obj);
    if (key) {
      const { typename } = parseEntityKey(key);
      if (isInterfaceType(typename)) {
        const resolved = resolveEntityKey(key);
        if (!resolved) return { commit() { }, revert() { } };
        key = resolved;
      }
    }
    if (!key) return { commit() { }, revert() { } };

    const previous = entityStore.get(key);

    // Ensure typename is present when re-writing the snapshot
    const finalTypename = parseEntityKey(key).typename || (obj as any)[TYPENAME_FIELD];
    const snapshot: any = Object.create(null);
    const kk = Object.keys(obj ?? {});
    for (let i = 0; i < kk.length; i++) {
      const kf = kk[i];
      if (kf === TYPENAME_FIELD || kf === "id" || kf === "_id") continue;
      snapshot[kf] = (obj as any)[kf];
    }
    entityStore.set(key, snapshot);
    if (finalTypename) {
      // reflect typename + id in the materialized view
      const m = materializeEntity(key);
      m[TYPENAME_FIELD] = finalTypename;
    }
    touchConnectionsForEntityKey(key);
    markEntityDirty(key);

    return {
      commit() { },
      revert() {
        if (previous === undefined) {
          const existed = entityStore.has(key!);
          entityStore.delete(key!);
          if (existed) bumpEntitiesTick();
        } else {
          entityStore.set(key!, previous);
        }
        touchConnectionsForEntityKey(key!);
        markEntityDirty(key!);
      },
    };
  }

  return {
    identify,
    readFragment,
    hasFragment,
    writeFragment,
  };
}
