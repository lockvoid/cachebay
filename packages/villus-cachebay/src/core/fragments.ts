// fragments.ts - everything related to fragments (views-free version)

import type { EntityKey } from "./types";
import { parseEntityKey } from "./utils";
import { TYPENAME_FIELD } from "./constants";
import type { GraphAPI } from "./graph";

export type Fragments = ReturnType<typeof createFragments>;

export type FragmentsDependencies = {
  graph: GraphAPI;
};

export function createFragments(_options: {}, dependencies: FragmentsDependencies) {
  const { graph } = dependencies;

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  function identify(obj: any): EntityKey | null {
    return graph.identify(obj);
  }

  function keyFromRefOrKey(
    refOrKey: EntityKey | { __typename: string; id?: any }
  ): EntityKey | null {
    if (typeof refOrKey === "string") return refOrKey as EntityKey;
    const t = (refOrKey as any)?.[TYPENAME_FIELD];
    const id = (refOrKey as any)?.id; // _id not supported
    return t && id != null ? (String(t) + ":" + String(id)) as EntityKey : null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Exposed API
  // ────────────────────────────────────────────────────────────────────────────

  function hasFragment(refOrKey: EntityKey | { __typename: string; id?: any }) {
    const raw = keyFromRefOrKey(refOrKey);
    if (!raw) return false;

    const { typename, id } = parseEntityKey(raw);
    if (!typename) return false;

    // Resolve interface → concrete if needed
    if (graph.isInterfaceType(typename) && id != null) {
      const impls = graph.getInterfaceTypes(typename);
      for (let i = 0; i < impls.length; i++) {
        const k = (impls[i] + ":" + id) as EntityKey;
        if (graph.entityStore.has(k)) return true;
      }
      return false;
    }

    // Try resolved key if graph can resolve, else raw
    const resolved = (graph as any).resolveEntityKey
      ? (graph as any).resolveEntityKey(raw) || raw
      : raw;

    return graph.entityStore.has(resolved);
  }

  /**
   * Read a fragment by key or ref.
   * - materialized=true (default): returns a reactive materialized proxy (identity + snapshot).
   * - materialized=false: returns the raw snapshot stored in entityStore (no identity fields).
   */
  function readFragment(
    refOrKey: EntityKey | { __typename: string; id?: any },
    { materialized = true }: { materialized?: boolean } = {},
  ) {
    const key =
      typeof refOrKey === "string" ? (refOrKey as EntityKey) : graph.identify(refOrKey);

    if (!key) return null;

    const resolved = (graph as any).resolveEntityKey
      ? (graph as any).resolveEntityKey(key) || key
      : key;

    if (!graph.entityStore.has(resolved)) return null;

    return materialized
      ? graph.materializeEntity(resolved)
      : graph.entityStore.get(resolved);
  }

  /**
   * Transactional write:
   * - commit(): writes via graph.putEntity (merge by default, honoring graph.writePolicy)
   * - revert(): restores previous snapshot via 'replace' (if existed), or clears snapshot.
   */
  function writeFragment(obj: any) {
    const key = graph.identify(obj);
    if (!key) return { commit: () => { }, revert: () => { } };

    // capture previous snapshot (store contains snapshot only, no identity)
    const prevSnap = graph.entityStore.get(key);
    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      // use graph.putEntity to ensure watchers/proxies update
      graph.putEntity(obj, "merge");
    }

    function revert() {
      if (!committed) return;
      committed = false;

      const { typename, id } = parseEntityKey(key);
      if (prevSnap) {
        // restore previous snapshot (replace)
        graph.putEntity(
          { [TYPENAME_FIELD]: typename!, id, ...prevSnap },
          "replace",
        );
      } else {
        // clear snapshot (replace with empty)
        graph.putEntity({ [TYPENAME_FIELD]: typename!, id }, "replace");
      }
    }

    return { commit, revert };
  }

  /**
   * Read multiple fragments by pattern(s).
   * Supports:
   *  - "Type:*" → expands to all keys "Type:" via graph.getEntityKeys
   *  - "Type:123" → exact key
   *  - ["Type:*", "Other:*", "Type:1"] → union
   */
  function readFragments(
    pattern: string | string[],
    opts: { materialized?: boolean } = {},
  ) {
    const selectors = Array.isArray(pattern) ? pattern : [pattern];
    const materialized = opts.materialized !== false; // default true

    const results: any[] = [];

    for (const selector of selectors) {
      // Wildcard: Type:* → use graph.getEntityKeys("Type:")
      if (selector.endsWith(":*")) {
        const typename = selector.slice(0, -2); // "Type"
        // If interface, expand implementors
        const implementors = graph.getInterfaceTypes(typename);
        if (implementors && implementors.length > 0) {
          for (const impl of implementors) {
            const keys = graph.getEntityKeys(impl + ":");
            for (const k of keys) {
              const v = materialized ? graph.materializeEntity(k as EntityKey) : graph.entityStore.get(k);
              if (v != null) results.push(v);
            }
          }
        } else {
          const keys = graph.getEntityKeys(typename + ":");
          for (const k of keys) {
            const v = materialized ? graph.materializeEntity(k as EntityKey) : graph.entityStore.get(k);
            if (v != null) results.push(v);
          }
        }
      } else {
        // Exact key or free-form (we trust caller)
        const v = readFragment(selector as EntityKey, { materialized });
        if (v != null) results.push(v);
      }
    }

    return results;
  }

  return {
    identify,
    hasFragment,
    readFragment,
    writeFragment,
    readFragments,
  };
}
