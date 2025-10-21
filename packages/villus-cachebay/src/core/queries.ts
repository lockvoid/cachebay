import { markRaw } from "vue";
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
  canonical?: boolean;
};

export type ReadQueryResult<T = any> = {
  data: T | undefined;
  deps: string[];
  status?: "FULFILLED" | "MISSING";
  hasCanonical?: boolean;
};

export type WriteQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  data: any;
};

export type WriteQueryResult = {
  touched: Set<string>;
};

export type WatchQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  canonical?: boolean;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  skipInitialEmit?: boolean;
};

export type WatchQueryHandle = {
  unsubscribe: () => void;
  refetch: () => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = (deps: QueriesDependencies) => {
  const { documents } = deps;

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
    if (flushScheduled) return;
    flushScheduled = true;

    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingTouched.size === 0) return;

      // Drain once per microtask
      const touched = Array.from(pendingTouched);
      pendingTouched.clear();

      // Find affected watchers
      const affected = new Set<number>();
      for (const id of touched) {
        const ws = depIndex.get(id);
        if (ws) for (const k of ws) affected.add(k);
      }
      if (affected.size === 0) return;

      // Re-materialize and conditionally emit
      for (const k of affected) {
        const watcher = watchers.get(k);
        if (!watcher) continue;

        const result = documents.materializeDocument({
          document: watcher.query,
          variables: watcher.variables,
          canonical: watcher.canonical,
        }) as any;

        if (!result || result.status !== "FULFILLED") continue;

        // Update dep index with delta
        updateWatcherDeps(k, result.deps || []);

        // Emit only on identity change
        if (result.data !== watcher.lastData) {
          watcher.lastData = result.data;
          try {
            watcher.onData(markRaw(result.data));
          } catch (e) {
            watcher.onError?.(e as Error);
          }
        }
      }
    });
  };

  const enqueueTouched = (touched?: Set<string>) => {
    if (!touched || touched.size === 0) return;
    for (const id of touched) pendingTouched.add(id);
    scheduleFlush();
  };

  // --- Dep index maintenance (delta-based) ---

  const updateWatcherDeps = (watcherId: number, nextDepsArr: string[]) => {
    const watcher = watchers.get(watcherId);
    if (!watcher) return;

    const old = watcher.deps;
    const next = new Set(nextDepsArr);

    // Fast path: identical sets
    if (old.size === next.size) {
      let same = true;
      for (const d of old) if (!next.has(d)) { same = false; break; }
      if (same) return;
    }

    // Remove removed deps
    for (const d of old) if (!next.has(d)) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(watcherId);
        if (set.size === 0) depIndex.delete(d);
      }
    }

    // Add new deps
    for (const d of next) if (!old.has(d)) {
      let set = depIndex.get(d);
      if (!set) depIndex.set(d, (set = new Set()));
      set.add(watcherId);
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

    if (result && result.status === "FULFILLED") {
      return { 
        data: markRaw(result.data) as T, 
        deps: result.deps || [],
        status: result.status,
        hasCanonical: result.hasCanonical,
      };
    }
    return { 
      data: undefined, 
      deps: [],
      status: result?.status || "MISSING",
      hasCanonical: result?.hasCanonical,
    };
  };

  const writeQuery = ({
    query,
    variables = {},
    data,
  }: WriteQueryOptions): WriteQueryResult => {
    const result = documents.normalizeDocument({
      document: query,
      variables,
      data,
    }) as any;

    const touched = result?.touched || new Set<string>();
    enqueueTouched(touched);
    return { touched };
  };

  const watchQuery = ({
    query,
    variables = {},
    canonical = true,
    onData,
    onError,
    skipInitialEmit = false,
  }: WatchQueryOptions): WatchQueryHandle => {
    const watcherId = watcherSeq++;

    // Create state now (so we can index it after initial read)
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

    // Initial read
    const initial = documents.materializeDocument({
      document: query,
      variables,
      canonical,
    }) as any;

    if (initial?.status === "FULFILLED") {
      watcher.lastData = initial.data;
      updateWatcherDeps(watcherId, initial.deps || []);
      if (!skipInitialEmit) {
        try {
          onData(markRaw(initial.data));
        } catch (e) {
          onError?.(e as Error);
        }
      }
    } else {
      // IMPORTANT: Register deps even for MISSING queries so watcher triggers when data arrives
      updateWatcherDeps(watcherId, initial?.deps || []);
      if (onError && !skipInitialEmit) {
        onError(new Error("Query returned no data"));
      }
    }

    return {
      unsubscribe: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Remove from dep index
        for (const d of w.deps) {
          const set = depIndex.get(d);
          if (set) {
            set.delete(watcherId);
            if (set.size === 0) depIndex.delete(d);
          }
        }
        watchers.delete(watcherId);
      },

      refetch: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        const res = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          decisionMode: w.decisionMode,
        }) as any;

        if (res?.status === "FULFILLED") {
          updateWatcherDeps(watcherId, res.deps || []);
          if (res.data !== w.lastData) {
            w.lastData = res.data;
            try {
              w.onData(markRaw(res.data));
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
