/**
 * Debug utilities + Inspect API (dev-only, opt-in)
 *
 * • Logging: import { Debug } and toggle at runtime:
 *     Debug.setEnabled(true)
 *     Debug.setFilter("Query.assets(")
 *
 * • Inspect: instance lazily loads this module; you can also import createInspect
 *   yourself if you want to wire it differently.
 */

import type { EntityKey, ConnectionState } from "../core/types";
import {
  normalizeParentKeyInput,
  parseVariablesFromConnectionKey,
  stableIdentityExcluding,
} from "../core/utils";

/* ────────────────────────────── INSPECT ────────────────────────────── */

export type InspectDeps = {
  graph: any;
  views?: any;
};

type OpFilter = {
  /** substring to match in op key (e.g. part of the query or hash) */
  keyIncludes?: string;
  /** shallow equals for provided vars; ignores keys not present in this object */
  varsEquals?: Record<string, any>;
  /** limit number of returned entries */
  limit?: number;
};

function varsMatch(entryVars: Record<string, any>, want?: Record<string, any>): boolean {
  if (!want) return true;
  for (const k of Object.keys(want)) {
    if (entryVars[k] !== want[k]) return false;
  }
  return true;
}

/**
 * Build the dev-only inspect API from internal stores.
 * NOTE: This is called lazily by core when you access `instance.inspect`.
 */
export function createInspect(deps: InspectDeps) {
  const { graph, views } = deps;

  return {
    /* ───────── entities ───────── */
    entities(typename?: string) {
      const out: string[] = [];
      graph.entityStore.forEach((_v: any, k: string) => {
        if (!typename) out.push(k);
        else if (k.startsWith(typename + ":")) out.push(k);
      });
      return out;
    },
    entity(key: EntityKey) {
      return graph.entityStore.get(key);
    },

    /* ───────── connections ───────── */
    connections() {
      return Array.from(graph.connectionStore.keys());
    },
    connection(
      parent: "Query" | { __typename: string; id?: any; _id?: any },
      field: string,
      variables?: Record<string, any>,
    ) {
      const pk = normalizeParentKeyInput(parent);
      const prefix = pk + "." + field + "(";
      const wantedId = variables
        ? stableIdentityExcluding(variables, ["after", "before", "first", "last"])
        : null;

      const results: Array<{
        key: string;
        variables: Record<string, any>;
        size: number;
        edges: Array<{ key: string; cursor: string | null }>;
        pageInfo: any;
        meta: any;
      }> = [];

      graph.connectionStore.forEach((state: any, ckey: string) => {
        if (!ckey.startsWith(prefix)) return;
        const vars = parseVariablesFromConnectionKey(ckey, prefix);
        if (vars == null) return;
        if (
          wantedId != null &&
          stableIdentityExcluding(vars, ["after", "before", "first", "last"]) !== wantedId
        ) return;
        results.push({
          key: ckey,
          variables: vars,
          size: state.list.length,
          edges: state.list.map((e) => ({ key: e.key, cursor: e.cursor })),
          pageInfo: { ...state.pageInfo },
          meta: { ...state.meta },
        });
      });

      return variables ? results[0] || null : results;
    },

    /* ───────── operation cache (ONE-SHOT) ───────── */
    /**
     * Returns an array of full op-cache entries, filtered.
     * You can filter by substring on the key and/or shallow vars equality.
     * Example:
     *   inspect.operations({ keyIncludes: "LegoColors", varsEquals: { first: 10 } })
     */
    operations(filter?: OpFilter) {
      const out: Array<{ key: string; variables: Record<string, any>; data: any }> = [];
      const { keyIncludes, varsEquals, limit } = filter || {};
      graph.operationStore.forEach((entry: any, k: string) => {
        if (keyIncludes && !k.includes(keyIncludes)) return;
        if (!varsMatch(entry.variables || {}, varsEquals)) return;
        out.push({ key: k, variables: entry.variables || {}, data: entry.data });
        if (limit && out.length >= limit) return;
      });
      return out;
    },

    /**
     * Read a specific operation cache entry by key (full object).
     */
    operation(key: string) {
      const count = graph.operationStore.size;
      if (count === 0) return null;
      const entry = graph.operationStore.get(key);
      if (!entry) return null;
      return { key, variables: entry.variables, data: entry.data };
    },
  };
}
