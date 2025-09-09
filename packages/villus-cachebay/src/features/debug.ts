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
} from "../core/utils";

/* ────────────────────────────── LOGGING ────────────────────────────── */

export type CachebayDebugger = {
  group(label: string, key?: string): void;
  end(): void;
  log(keyOrMsg?: string, ...args: any[]): void;
  warn(keyOrMsg?: string, ...args: any[]): void;
  error(keyOrMsg?: string, ...args: any[]): void;
  setEnabled(v: boolean): void;
  enabled(): boolean;
  setFilter(f?: string): void;
  getFilter(): string | undefined;
};

function getWin(): any | undefined {
  try { return typeof window !== "undefined" ? (window as any) : undefined; } catch { return undefined; }
}

export function createDebug(): CachebayDebugger {
  const w = getWin();
  let on = w ? Boolean(w.__CB_DEBUG) : false;
  let filter: string | undefined = w ? (w.__CB_DEBUG_FILTER as any) : undefined;

  if (w) {
    try {
      Object.defineProperty(w, "__CB_DEBUG", {
        get() { return on; },
        set(v) { on = Boolean(v); },
      });
      Object.defineProperty(w, "__CB_DEBUG_FILTER", {
        get() { return filter; },
        set(v) { filter = v != null ? String(v) : undefined; },
      });
    } catch { /* ignore strict envs */ }
  }

  const match = (key?: string) => (!filter ? true : !!key && String(key).includes(String(filter)));

  return {
    group(label: string, key?: string) { if (on && match(key)) console.groupCollapsed(`[cachebay] ${label}`); },
    end() { if (on) console.groupEnd(); },
    log(key?: string, ...args: any[]) { if (on && match(key)) console.log(...args); },
    warn(key?: string, ...args: any[]) { if (on && match(key)) console.warn(...args); },
    error(key?: string, ...args: any[]) { if (on && match(key)) console.error(...args); },
    setEnabled(v: boolean) { on = !!v; },
    enabled() { return on; },
    setFilter(f?: string) { filter = f ? String(f) : undefined; },
    getFilter() { return filter; },
  };
}

export const Debug = createDebug();

/* ────────────────────────────── INSPECT ────────────────────────────── */

type InspectDeps = {
  entityStore: Map<EntityKey, any>;
  connectionStore: Map<string, ConnectionState>;
  operationCache: Map<string, { data: any; variables: Record<string, any> }>;
  stableIdentityExcluding: (vars: Record<string, any>, remove: string[]) => string;
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
  const { entityStore, connectionStore, operationCache, stableIdentityExcluding } = deps;

  return {
    /* ───────── entities ───────── */
    entities(typename?: string) {
      const out: string[] = [];
      entityStore.forEach((_v, k) => {
        if (!typename) out.push(k);
        else if (k.startsWith(typename + ":")) out.push(k);
      });
      return out;
    },
    get(key: EntityKey) {
      return entityStore.get(key);
    },

    /* ───────── connections ───────── */
    connections() {
      return Array.from(connectionStore.keys());
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

      connectionStore.forEach((state, ckey) => {
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
      for (const [key, entry] of operationCache.entries()) {
        if (keyIncludes && !key.includes(keyIncludes)) continue;
        if (!varsMatch(entry.variables || {}, varsEquals)) continue;
        out.push({ key, variables: entry.variables || {}, data: entry.data });
        if (limit && out.length >= limit) break;
      }
      return out;
    },

    /**
     * Read a specific operation cache entry by key (full object).
     */
    operation(key: string) {
      const entry = operationCache.get(key);
      if (!entry) return null;
      return { key, variables: entry.variables, data: entry.data };
    },
  };
}
