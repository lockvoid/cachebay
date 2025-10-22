// src/core/queries.ts
import type { DocumentsInstance } from "./documents";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentNode } from "graphql";

export type QueriesDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
};

export type ReadQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  /** use canonical fill (default: true) */
  canonical?: boolean;
};

export type ReadQueryResult<T = any> = {
  data: T | undefined;
  deps: string[];
  /** 'strict' | 'canonical' | 'none' */
  source: "strict" | "canonical" | "none";
  ok: { strict: boolean; canonical: boolean };
};

export type WriteQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  data: any;
};


export type WatchQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  canonical?: boolean;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  /** Emit initial data immediately (default: true) */
  immediate?: boolean;
};

export type WatchQueryHandle = {
  unsubscribe: () => void;
  refetch: () => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = ({ documents }: QueriesDependencies) => {
  // --- Watcher state & indices ---
  type WatcherState = {
    query: DocumentNode;
    variables: Record<string, any>;
    canonical: boolean;
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  let watcherSeq = 1;

  // --- Batched broadcasting ---
  let pendingTouched = new Set<string>();
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;

    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingTouched.size === 0) {
        return;
      }

      const touched = Array.from(pendingTouched);
      pendingTouched.clear();

      const affected = new Set<number>();
      for (const id of touched) {
        const ws = depIndex.get(id);
        if (ws) {
          for (const k of ws) affected.add(k);
        }
      }

      if (affected.size === 0) {
        return;
      }

      for (const k of affected) {
        const w = watchers.get(k);
        if (!w) continue;

        const result = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          canonical: w.canonical,
        }) as any;

        // Always refresh deps so missing -> fulfilled transitions trigger
        updateWatcherDeps(k, result?.deps || []);

        if (!result || result.source === "none") {
          continue;
        }

        if (result.data !== w.lastData) {
          w.lastData = result.data;
          try {
            w.onData(result.data);
          } catch (e) {
            w.onError?.(e as Error);
          }
        }
      }
    });
  };

  const enqueueTouched = (touched?: Set<string> | string[]) => {
    if (!touched) return;
    const arr = Array.isArray(touched) ? touched : Array.from(touched);
    for (const id of arr) pendingTouched.add(id);
    scheduleFlush();
  };

  // --- Dep index maintenance ---
  const updateWatcherDeps = (watcherId: number, nextDepsArr: string[]) => {
    const watcher = watchers.get(watcherId);
    if (!watcher) return;

    const old = watcher.deps;
    const next = new Set(nextDepsArr);

    // fast path
    if (old.size === next.size) {
      let same = true;
      for (const d of old) if (!next.has(d)) { same = false; break; }
      if (same) return;
    }

    // remove old
    for (const d of old) {
      if (!next.has(d)) {
        const set = depIndex.get(d);
        if (set) {
          set.delete(watcherId);
          if (set.size === 0) depIndex.delete(d);
        }
      }
    }

    // add new
    for (const d of next) {
      if (!old.has(d)) {
        let set = depIndex.get(d);
        if (!set) depIndex.set(d, (set = new Set()));
        set.add(watcherId);
      }
    }

    watcher.deps = next;
  };

  // --- Public API ---

  const readQuery = <T = any>({
    query,
    variables = {},
    canonical = true,
  }: ReadQueryOptions): ReadQueryResult<T> => {
    const result = documents.materializeDocument({
      document: query,
      variables,
      canonical,
    }) as any;

    if (result && result.source !== "none") {
      return {
        data: result.data as T,
        deps: result.deps || [],
        source: result.source,
        ok: result.ok ?? { strict: true, canonical: true },
      };
    }

    return {
      data: undefined,
      deps: result?.deps || [],
      source: "none",
      ok: result?.ok ?? { strict: false, canonical: false },
    };
  };

  const writeQuery = ({
    query,
    variables = {},
    data,
  }: WriteQueryOptions): void => {
    documents.normalizeDocument({
      document: query,
      variables,
      data,
    });
  };

  const watchQuery = ({
    query,
    variables = {},
    canonical = true,
    onData,
    onError,
    immediate = true,
  }: WatchQueryOptions): WatchQueryHandle => {
    const watcherId = watcherSeq++;

    const watcher: WatcherState = {
      query,
      variables,
      canonical,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
    };
    watchers.set(watcherId, watcher);

    const initial = documents.materializeDocument({
      document: query,
      variables,
      canonical,
    }) as any;

    // Track deps even if initial data is missing
    updateWatcherDeps(watcherId, initial?.deps || []);

    if (initial && initial.source !== "none") {
      watcher.lastData = initial.data;
      if (immediate) {
        try {
          onData(initial.data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    } else if (onError && immediate) {
      onError(new Error("CacheMiss"));
    }

    return {
      unsubscribe: () => {
        const w = watchers.get(watcherId);
        if (!w) return;
        for (const d of w.deps) {
          const set = depIndex.get(d);
          if (set) {
            set.delete(watcherId);
            if (set.size === 0) depIndex.delete(d);
          }
        }
        watchers.delete(watcherId);
      },

      emitChange: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        const res = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          canonical: w.canonical,
        }) as any;

        updateWatcherDeps(watcherId, res?.deps || []);

        if (res && res.source !== "none") {
          if (res.data !== w.lastData) {
            w.lastData = res.data;
            try {
              w.onData(res.data);
            } catch (e) {
              w.onError?.(e as Error);
            }
          }
        } else if (w.onError) {
          w.onError(new Error("Refetch returned no data"));
        }
      },

      refetch: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        const res = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          canonical: w.canonical,
        }) as any;

        updateWatcherDeps(watcherId, res?.deps || []);

        if (res && res.source !== "none") {
          if (res.data !== w.lastData) {
            w.lastData = res.data;
            try {
              w.onData(res.data);
            } catch (e) {
              w.onError?.(e as Error);
            }
          }
        } else if (w.onError) {
          w.onError(new Error("Refetch returned no data"));
        }
      },
    };
  };

  return {
    readQuery,
    writeQuery,
    watchQuery,
    /** Internal utility for integration points that want to notify watchers manually. */
    _notifyTouched: enqueueTouched,
  };
};
