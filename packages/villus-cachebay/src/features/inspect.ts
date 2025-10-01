
import type { GraphInstance } from "../core/graph";

type ParentSelector =
  | "@"
  | "Query"
  | string
  | { __typename: string; id: string | number };

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

const canonicalizeArgs = (raw: string): string => {
  if (!raw) {
    return "";
  }

  const s = raw.trim();

  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const src = JSON.parse(s) as Record<string, unknown>;

      const keys = Object.keys(src)
        .filter((k) => !PAGINATION_ARGS.has(k))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      if (keys.length === 0) {
        return "";
      }

      const out: Record<string, unknown> = {};
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        out[k] = (src as any)[k];
      }

      return JSON.stringify(out);
    } catch {
      // Fall through to string path.
    }
  }

  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  const kept: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].replace(/^[{]+|[}]+$/g, "");
    const c = p.indexOf(":");
    const key = (c === -1 ? p : p.slice(0, c)).trim();

    if (PAGINATION_ARGS.has(key)) {
      continue;
    }

    kept.push(p);
  }

  if (kept.length === 0) {
    return "";
  }

  kept.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + kept.join(",") + "}";
};

const canonicalOfPageKey = (pageKey: string): string => {
  const i = pageKey.indexOf("(");
  if (i < 0) {
    return pageKey;
  }

  const j = pageKey.lastIndexOf(")");
  if (j <= i) {
    return pageKey;
  }

  const prefix = pageKey.slice(0, i + 1);
  const canon = canonicalizeArgs(pageKey.slice(i + 1, j));
  return prefix + canon + ")";
};

const pageOfEdge = (edgeKey: string): string | null => {
  const i = edgeKey.indexOf(".edges.");
  if (i < 0) {
    return null;
  }
  return edgeKey.slice(0, i);
};

const unique = <T,>(xs: T[]): T[] => {
  if (xs.length < 2) {
    return xs;
  }
  return Array.from(new Set(xs));
};

/**
 * Create inspect helpers over the graph snapshot.
 * All functions are pure views and do not mutate the graph.
 */
export const createInspect = ({ graph }: { graph: GraphInstance }) => {

  /**
   * Return a record snapshot by id.
   * @param id Record id.
   * @param opts.materialized When true, returns a live proxy bound to graph.
   */
  const record = (id: string): any => {
    return graph.getRecord(id);
  };

  /**
   * List entity record ids (excludes root, pages, edges). Optional typename filter.
   * @param typename Optional typename prefix to filter, e.g. "User".
   */
  const entityKeys = (typename?: string): string[] => {
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
   * List connection page record ids that match the filter.
   * If no parent is provided, matches pages under any parent (root + entities).
   */
  const connectionPageKeys = (opts: ConnectionFilter = {}): string[] => {
    const all = graph.keys();
    const out: string[] = [];

    const wantField = opts.key;
    const testArgs = opts.argsFn;
    const hasParentFilter = opts.parent !== undefined;

    for (let i = 0; i < all.length; i++) {
      const k = all[i];

      if (hasParentFilter) {
        if (!isPageUnderParent(k, opts.parent)) {
          continue;
        }
      } else if (!isPageRecord(k)) {
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

      out.push(k);
    }

    return out;
  };

  /**
   * List canonical connection keys (pagination args removed) for pages that match the filter.
   * Keys are deduplicated.
   */
  const connectionKeys = (opts: ConnectionFilter = {}): string[] => {
    const pages = connectionPageKeys(opts);
    if (pages.length === 0) {
      return pages;
    }

    const canon: string[] = new Array(pages.length);
    for (let i = 0; i < pages.length; i++) {
      canon[i] = canonicalOfPageKey(pages[i]);
    }

    return unique(canon);
  };

  /**
   * List edge record ids that belong to pages matching the filter.
   */
  const connectionEdgeKeys = (opts: ConnectionFilter = {}): string[] => {
    const pages = connectionPageKeys(opts);
    if (pages.length === 0) {
      return [];
    }

    const pageSet = new Set<string>(pages);

    const all = graph.keys();
    const out: string[] = [];

    for (let i = 0; i < all.length; i++) {
      const k = all[i];

      if (!isEdgeRecord(k)) {
        continue;
      }

      const page = pageOfEdge(k);
      if (page && pageSet.has(page)) {
        out.push(k);
      }
    }

    return out;
  };

  /** Return the graph creation options (keys, interfaces). */
  const config = () => {
    const snap = (graph as any).inspect?.();
    return snap?.options ?? { keys: {}, interfaces: {} };
  };

  return {
    record,
    entityKeys,
    connectionKeys,
    connectionPageKeys,
    connectionEdgeKeys,
    config,
  };
};

export type InspectAPI = ReturnType<typeof createInspect>;
