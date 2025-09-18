// src/core/sessions.ts
import type { GraphInstance } from "./graph";
import type { ViewsInstance } from "./views";

export type SessionsOptions = Record<string, never>;

export type SessionsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
};

export type SessionsAPI = ReturnType<typeof createSessions>;

/**
 * Sessions: lifecycle helper for UI/data hooks.
 * Responsibilities:
 *  - mount record proxies (entities),
 *  - create Relay-style connection composers that combine multiple pages on READ.
 * NOT responsible for: cache lookup (hasDocument) → put that in documents.ts.
 */
export const createSessions = (_options: SessionsOptions, deps: SessionsDependencies) => {
  const { graph, views } = deps;

  /**
   * Create a Relay-style connection composer (no cache merging).
   *   mode: "infinite" → concatenates edges from added pages (with dedupe)
   *         "page"     → shows one active page; you can switch pages
   *   dedupeBy: "edgeRef" | "cursor" | "node"
   */
  const createConnectionComposer = ({
    mode = "infinite",
    dedupeBy = "edgeRef",
  }: {
    mode?: "infinite" | "page";
    dedupeBy?: "edgeRef" | "cursor" | "node";
  } = {}) => {
    const pageKeys: string[] = [];
    let activePageIdx = 0;

    // edge-array cache for infinite mode
    let cachedRefs: string[] | null = null;
    let cachedEdges: any[] | null = null;

    const addPage = (pageKey: string) => {
      if (!pageKeys.includes(pageKey)) {
        pageKeys.push(pageKey);
        if (mode === "page") activePageIdx = pageKeys.length - 1;
        cachedRefs = null;
        cachedEdges = null;
      }
    };

    const removePage = (pageKey: string) => {
      const idx = pageKeys.indexOf(pageKey);
      if (idx >= 0) {
        pageKeys.splice(idx, 1);
        if (mode === "page" && activePageIdx >= pageKeys.length) {
          activePageIdx = Math.max(0, pageKeys.length - 1);
        }
        cachedRefs = null;
        cachedEdges = null;
      }
    };

    const clear = () => {
      pageKeys.length = 0;
      activePageIdx = 0;
      cachedRefs = null;
      cachedEdges = null;
    };

    const setActivePage = (pageKey: string) => {
      if (mode !== "page") return;
      const idx = pageKeys.indexOf(pageKey);
      if (idx >= 0) activePageIdx = idx;
    };

    const getView = () => {
      const composed = new Proxy(
        {},
        {
          get(_t, prop: string | symbol) {
            if (prop === "edges") {
              if (mode === "page") {
                const pk = pageKeys[activePageIdx];
                const snap = pk ? graph.getRecord(pk) : undefined;
                const list = Array.isArray(snap?.edges) ? snap!.edges : [];
                const arr = new Array(list.length);
                for (let i = 0; i < list.length; i++) {
                  const ref = list[i]?.__ref;
                  arr[i] = ref ? views.getEdgeView(ref, undefined, {}) : undefined;
                }
                return arr;
              }

              // infinite: concat and dedupe
              const allRefs: string[] = [];
              for (let i = 0; i < pageKeys.length; i++) {
                const s = graph.getRecord(pageKeys[i]);
                const refs = Array.isArray(s?.edges) ? s!.edges.map((r: any) => r?.__ref || "") : [];
                for (let j = 0; j < refs.length; j++) if (refs[j]) allRefs.push(refs[j]);
              }

              if (dedupeBy !== "edgeRef") {
                const seen = new Set<string>();
                const deduped: string[] = [];
                for (let i = 0; i < allRefs.length; i++) {
                  const ref = allRefs[i];
                  if (!ref) continue;
                  const e = graph.getRecord(ref);
                  let key: string | undefined;
                  if (dedupeBy === "cursor") key = e?.cursor;
                  else if (dedupeBy === "node") key = e?.node?.__ref;
                  if (!key) {
                    deduped.push(ref);
                    continue;
                  }
                  if (!seen.has(key)) {
                    seen.add(key);
                    deduped.push(ref);
                  }
                }
                allRefs.length = 0;
                Array.prototype.push.apply(allRefs, deduped);
              }

              if (
                cachedRefs &&
                cachedRefs.length === allRefs.length &&
                cachedRefs.every((v, i) => v === allRefs[i]) &&
                cachedEdges
              ) {
                return cachedEdges;
              }

              const arr = new Array(allRefs.length);
              for (let i = 0; i < allRefs.length; i++) {
                arr[i] = views.getEdgeView(allRefs[i], undefined, {});
              }
              cachedRefs = allRefs;
              cachedEdges = arr;
              return arr;
            }

            if (prop === "pageInfo") {
              if (mode === "page") {
                const pk = pageKeys[activePageIdx];
                const s = pk ? graph.getRecord(pk) : undefined;
                return s?.pageInfo ? { ...s.pageInfo } : undefined;
              }
              const last = pageKeys.length > 0 ? graph.getRecord(pageKeys[pageKeys.length - 1]) : undefined;
              return last?.pageInfo ? { ...last.pageInfo } : undefined;
            }

            if (prop === "__typename") {
              const first = pageKeys.length > 0 ? graph.getRecord(pageKeys[0]) : undefined;
              return first?.__typename;
            }

            // extras (e.g., totalCount): last page (infinite) or active page (page)
            if (typeof prop === "string") {
              if (mode === "page") {
                const pk = pageKeys[activePageIdx];
                const s = pk ? graph.getRecord(pk) : undefined;
                if (s && prop in (s as any)) {
                  const v = (s as any)[prop];
                  return typeof v === "object" && v !== null ? { ...v } : v;
                }
                return undefined;
              }
              const last = pageKeys.length > 0 ? graph.getRecord(pageKeys[pageKeys.length - 1]) : undefined;
              if (last && prop in (last as any)) {
                const v = (last as any)[prop];
                return typeof v === "object" && v !== null ? { ...v } : v;
              }
              for (let i = 0; i < pageKeys.length; i++) {
                const s = graph.getRecord(pageKeys[i]);
                if (s && prop in (s as any)) {
                  const v = (s as any)[prop];
                  return typeof v === "object" && v !== null ? { ...v } : v;
                }
              }
            }

            return undefined;
          },
        }
      );

      return composed;
    };

    const inspect = () => ({
      pages: pageKeys.slice(),
      mode,
    });

    return { addPage, removePage, clear, setActivePage, getView, inspect };
  };

  /**
   * per-usage session
   */
  const createSession = () => {
    const records = new Set<string>();
    const connections = new Set<ReturnType<typeof createConnectionComposer>>();

    const mountRecord = (recordId: string) => {
      records.add(recordId);
      return graph.materializeRecord(recordId);
    };

    const mountConnection = (opts?: Parameters<typeof createConnectionComposer>[0]) => {
      const c = createConnectionComposer(opts);
      connections.add(c);
      return c;
    };

    const inspect = () => ({
      records: Array.from(records),
      connections: Array.from(connections).map((c) => c.inspect()),
    });

    const destroy = () => {
      records.clear();
      connections.clear();
    };

    return {
      mountRecord,
      mountConnection,
      inspect,
      destroy,
    };
  };

  return { createSession };
};
