import { ROOT_ID } from "../core/constants";
import { buildConnectionCanonicalKey } from "../compiler/utils";
import type { GraphInstance } from "../core/graph";
import type { OptimisticInstance } from "../core/optimistic";
import type { QueriesInstance } from "../core/queries";
import type { FragmentsInstance } from "../core/fragments";

/**
 * Inspect API instance type
 */
export type InspectAPI = ReturnType<typeof createInspect>;

/**
 * Parent selector for connection filtering
 */
type ParentSelector =
  | "@"
  | "Query"
  | string
  | { __typename: string; id: string | number };

/**
 * Filter criteria for connection inspection
 */
type ConnectionFilter = {
  /** Match only pages under this parent. Omit to match any parent. */
  parent?: ParentSelector;

  /** Field name (e.g. "projects", "posts") to match. */
  key?: string;

  /** Predicate over the raw argument string inside '(...)'. */
  argsFn?: (rawArgs: string) => boolean;
};

const PAGINATION_ARGS = new Set([
  "first",
  "last",
  "after",
  "before",
  "offset",
  "limit",
  "page",
  "cursor",
]);

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers (allocation-lean)
 * -------------------------------------------------------------------------- */

const isRootRecord = (id: string): boolean => {
  return id === "@";
};

const isEdgeRecord = (id: string): boolean => {
  return id.includes(".edges.");
};

const isPageRecord = (id: string): boolean => {
  return id.startsWith("@.") && !isEdgeRecord(id);
};

const parentId = (parent?: ParentSelector): string => {
  if (!parent || parent === "Query" || parent === "@") {
    return "";
  }
  if (typeof parent === "string") {
    return parent;
  }
  return `${parent.__typename}:${String(parent.id)}`;
};

/** Root pages: '@.<field>(...)' → last '.' before '(' is exactly index 1. */
const isPageUnderParent = (pageKey: string, p?: ParentSelector): boolean => {
  if (!isPageRecord(pageKey)) {
    return false;
  }

  const pid = parentId(p);

  if (!pid) {
    const paren = pageKey.indexOf("(");
    const stop = paren >= 0 ? paren : pageKey.length;
    const lastDot = pageKey.lastIndexOf(".", stop);
    return lastDot === 1;
  }

  return pageKey.startsWith(`@.${pid}.`);
};

const fieldOf = (pageKey: string): string | null => {
  const paren = pageKey.indexOf("(");
  const end = paren >= 0 ? paren : pageKey.length;

  const dot = pageKey.lastIndexOf(".", end);
  if (dot < 0) {
    return null;
  }

  return pageKey.slice(dot + 1, end);
};

const argsOf = (pageKey: string): string => {
  const i = pageKey.indexOf("(");
  if (i < 0) {
    return "";
  }

  const j = pageKey.lastIndexOf(")");
  if (j <= i) {
    return "";
  }

  return pageKey.slice(i + 1, j).trim();
};

/** Parse filters from raw '(...)' JSON; drop pagination args. */
const parseFilters = (raw: string): Record<string, any> => {
  if (!raw) {
    return {};
  }

  try {
    const src = JSON.parse(raw) as Record<string, any>;
    const out: Record<string, any> = {};

    const keys = Object.keys(src);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!PAGINATION_ARGS.has(k)) {
        out[k] = src[k];
      }
    }

    return out;
  } catch {
    // Non-JSON args are ignored for inspection; return empty to be safe.
    return {};
  }
};

const unique = <T,>(xs: T[]): T[] => {
  if (xs.length < 2) {
    return xs;
  }
  return Array.from(new Set(xs));
};

/* ────────────────────────────────────────────────────────────────────────────
 * Public API
 * -------------------------------------------------------------------------- */

/**
 * Create debug inspection API for cache internals
 * Provides methods to inspect entities, connections, optimistic state, queries, and fragments
 * @param deps - Required dependencies (graph, optimistic, queries, fragments)
 * @returns Inspect API with record, entityKeys, connectionKeys, config, optimistic, queries, and fragments methods
 */
export const createInspect = ({ 
  graph, 
  optimistic,
  queries,
  fragments,
}: { 
  graph: GraphInstance;
  optimistic: OptimisticInstance;
  queries: QueriesInstance;
  fragments: FragmentsInstance;
}) => {
  const getRecord = (id: string): any => {
    return graph.getRecord(id);
  };

  /**
   * List entity record ids (excludes root, pages, edges). Optional typename filter.
   * @param typename Optional typename prefix to filter, e.g. "User".
   */
  const getEntityKeys = (typename?: string): string[] => {
    const all = graph.keys();
    const out: string[] = [];

    for (let i = 0; i < all.length; i++) {
      const k = all[i];

      if (isRootRecord(k) || isPageRecord(k) || isEdgeRecord(k)) {
        continue;
      }
      if (typename && !k.startsWith(typename + ":")) {
        continue;
      }

      out.push(k);
    }

    return out;
  };

  /**
   * List canonical @connection keys for pages that match the filter.
   * Pagination args are removed; remaining args become the connection filters.
   */
  const getConnectionKeys = (opts: ConnectionFilter = {}): string[] => {
    const all = graph.keys();
    const results: string[] = [];

    const wantField = opts.key;
    const testArgs = opts.argsFn;
    const hasParentFilter = opts.parent !== undefined;

    for (let i = 0; i < all.length; i++) {
      const k = all[i];

      if (!isPageRecord(k)) {
        continue;
      }

      if (hasParentFilter && !isPageUnderParent(k, opts.parent)) {
        continue;
      }

      if (wantField) {
        const f = fieldOf(k);
        if (f !== wantField) {
          continue;
        }
      }

      if (testArgs) {
        const raw = argsOf(k);
        if (!testArgs(raw)) {
          continue;
        }
      }

      // Convert page key → canonical connection key using the shared builder.
      const paren = k.indexOf("(");
      const end = paren >= 0 ? paren : k.length;
      const lastDot = k.lastIndexOf(".", end);

      const hasParent = lastDot > 1;
      const parentStr = hasParent ? k.slice(2, lastDot) : ROOT_ID;
      const fieldName = k.slice(lastDot + 1, end);

      const filters = parseFilters(argsOf(k));
      const filterKeys = Object.keys(filters);

      const canonical = buildConnectionCanonicalKey(
        { fieldName, buildArgs: (v: any) => v || {}, connectionFilters: filterKeys } as any,
        parentStr,
        filters,
      );

      results.push(canonical);
    }

    return unique(results);
  };

  /** Return the graph creation options (keys, interfaces). */
  const config = () => {
    const snap = (graph as any).inspect?.();

    return snap?.options ?? { keys: {}, interfaces: {} };
  };

  return {
    getRecord,
    getEntityKeys,
    getConnectionKeys,
    config,
    optimistic: () => optimistic.inspect(),
    queries: () => queries.inspect(),
    fragments: () => fragments.inspect(),
  };
};
