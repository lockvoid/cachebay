// src/core/queries.ts
import type { DocumentsInstance } from "./documents";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import { CacheMissError } from "./errors";
import { recycleSnapshots } from "./utils";
import { ROOT_ID } from "./constants";
import type { DocumentNode } from "graphql";

export type QueriesDependencies = {
  graph: GraphInstance;
  documents: DocumentsInstance;
  planner: PlannerInstance;
};

export type ReadQueryOptions = {
  query: DocumentNode | string;
  variables?: Record<string, any>;
};

export type ReadQueryResult<T = any> = {
  /** Query data if available in cache */
  data: T | undefined;
  /** Error if query cannot be read from cache (e.g., missing required fields) */
  error?: Error;
};

export type WriteQueryOptions = {
  query: DocumentNode | string;
  variables?: Record<string, any>;
  data: any;
};

export type WatchQueryOptions = {
  query: DocumentNode | string;
  variables?: Record<string, any>;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  /** Emit initial data immediately (default: true) */
  immediate?: boolean;
};

export type WatchQueryHandle = {
  unsubscribe: () => void;
  refetch: () => void;
  /** Update variables and refetch. Handles pagination recycling automatically. */
  update: (options: { variables?: Record<string, any> }) => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = ({ documents, planner, operations }: QueriesDependencies) => {
  // --- Watcher state & indices ---
  type WatcherState = {
    query: DocumentNode | string;
    variables: Record<string, any>;
    signature: string;  // Query signature for error tracking
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
          fingerprint: true,
        });

        // Always refresh deps so missing -> fulfilled transitions trigger
        updateWatcherDependencies(k, result.dependencies);

        if (result.source === "none") {
          continue;
        }

        const recycled = recycleSnapshots(w.lastData, result.data);
        if (recycled !== w.lastData) {
          w.lastData = recycled;
          try {
            w.onData(recycled);
          } catch (e) {
            w.onError?.(e as Error);
          }
        }
      }
    });
  };

  /**
   * Propagate data changes to watchers tracking the given dependencies
   */
  const propagateData = (touched?: Set<string> | string[]) => {
    if (!touched) return;
    const arr = Array.isArray(touched) ? touched : Array.from(touched);
    for (const id of arr) pendingTouched.add(id);
    scheduleFlush();
  };

  /**
   * Propagate error to the watcher with the given signature
   */
  const propagateError = (signature: string, error: Error) => {
    console.log('[queries] propagateError called, signature:', signature);
    console.log('[queries] watchers count:', watchers.size);
    
    // Find watcher with this signature
    let found = false;
    for (const [id, watcher] of watchers) {
      console.log('[queries] checking watcher', id, 'signature:', watcher.signature);
      if (watcher.signature === signature && watcher.onError) {
        console.log('[queries] MATCH! Calling onError');
        watcher.onError(error);
        found = true;
        break;  // Only one watcher per signature
      }
    }
    
    if (!found) {
      console.log('[queries] NO MATCH FOUND for signature:', signature);
    }
  };

  // --- Dep index maintenance ---
  const updateWatcherDependencies = (watcherId: number, nextDeps: Set<string>) => {
    const watcher = watchers.get(watcherId);
    if (!watcher) return;

    const old = watcher.deps;
    const next = nextDeps;

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
  }: ReadQueryOptions): ReadQueryResult<T> => {
    const result = documents.materializeDocument({
      document: query,
      variables,
      canonical: true,  // Always use canonical mode
      fingerprint: false,
    });

    if (result.source === "none") {
      // No data available - create descriptive error
      const error = new CacheMissError(
        'Query cannot be read from cache. Required fields are missing.'
      );
      return { data: undefined, error };
    }

    return {
      data: result.data as T,
      error: undefined,
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
    onData,
    onError,
    immediate = true,
  }: WatchQueryOptions): WatchQueryHandle => {
    const watcherId = watcherSeq++;

    // Generate signature for error tracking (always canonical)
    const plan = planner.getPlan(query);
    const signature = plan.makeSignature("canonical", variables);

    const watcher: WatcherState = {
      query,
      variables,
      signature,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
    };
    watchers.set(watcherId, watcher);

    const initial = documents.materializeDocument({
      document: query,
      variables,
      canonical: true,  // Always use canonical mode
      fingerprint: true,
    });

    // Track deps even if initial data is missing
    updateWatcherDependencies(watcherId, initial.dependencies);

    if (initial.source !== "none") {
      watcher.lastData = recycleSnapshots(undefined, initial.data);
      if (immediate) {
        try {
          onData(initial.data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    } else if (onError && immediate) {
      onError(new CacheMissError());
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

      refetch: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        const res = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          canonical: true,  // Always use canonical mode
          fingerprint: true,
        });

        updateWatcherDependencies(watcherId, res.dependencies);

        if (res.source !== "none") {
          const recycled = recycleSnapshots(w.lastData, res.data);
          if (recycled !== w.lastData) {
            w.lastData = recycled;
            try {
              w.onData(recycled);
            } catch (e) {
              w.onError?.(e as Error);
            }
          }
        } else if (w.onError) {
          w.onError(new Error("Refetch returned no data"));
        }
      },

      update: ({ variables: newVariables = {} }) => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Update variables and signature
        w.variables = newVariables;
        const plan = planner.getPlan(w.query);
        w.signature = plan.makeSignature("canonical", newVariables);

        const res = documents.materializeDocument({
          document: w.query,
          variables: newVariables,
          canonical: true,  // Always use canonical mode
          fingerprint: true,
        });

        updateWatcherDependencies(watcherId, res.dependencies);

        if (res.source !== "none") {
          // recycleSnapshots automatically preserves object identity for unchanged parts
          const recycled = recycleSnapshots(w.lastData, res.data);
          w.lastData = recycled;
          try {
            w.onData(recycled);
          } catch (e) {
            w.onError?.(e as Error);
          }
        } else if (w.onError) {
          w.onError(new Error("Update returned no data"));
        }
      },
    };
  };

  return {
    readQuery,
    writeQuery,
    watchQuery,
    propagateData,
    propagateError,
  };
};
