// src/core/queries.ts
import { recycleSnapshots } from "./utils";
import type { DocumentsInstance } from "./documents";
import type { PlannerInstance } from "./planner";
import type { CachePlan } from "../compiler";
import type { DocumentNode } from "graphql";

export type QueriesDependencies = {
  documents: DocumentsInstance;
  planner: PlannerInstance;
};

export type ReadQueryOptions = {
  query: CachePlan | DocumentNode | string;
  variables?: Record<string, any>;
};

export type WriteQueryOptions = {
  query: CachePlan | DocumentNode | string;
  variables?: Record<string, any>;
  data: any;
};

export type WatchQueryOptions = {
  query: CachePlan | DocumentNode | string;
  variables?: Record<string, any>;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  /** Emit initial data immediately (default: true) */
  immediate?: boolean;
};

export type WatchQueryHandle = {
  unsubscribe: () => void;
  /** Update variables. If immediate=true, materializes and emits immediately. */
  update: (options: { variables?: Record<string, any>; immediate?: boolean }) => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = ({ documents, planner }: QueriesDependencies) => {

  // --- Watcher state & indices ---
  type WatcherState = {
    query: CachePlan | DocumentNode | string;
    variables: Record<string, any>;
    signature: string;  // Query signature for error tracking
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
    skipNextPropagate?: boolean; // Flag to skip next notifyDataByDependencies emission (coalescing)
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  const signatureToWatchers = new Map<string, Set<number>>(); // Multiple watchers per signature
  let watcherSeq = 1;

  // --- Batched broadcasting ---
  const pendingTouched = new Set<string>();
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
          for (const k of ws) {
            affected.add(k);
          }
        }
      }

      if (affected.size === 0) {
        return;
      }

      for (const k of affected) {
        const w = watchers.get(k);
        if (!w) continue;

        // Skip if recently emitted by notifyDataBySignature (coalescing)
        if (w.skipNextPropagate) {
          continue;
        }

        const result = documents.materialize({
          document: w.query,
          variables: w.variables,
          canonical: true,
          fingerprint: true,
          preferCache: false,  // Data just changed - need fresh materialization
          updateCache: true,   // Update cache with fresh data
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
  const notifyDataByDependencies = (touched: Set<string>) => {
    for (const value of touched) {
      pendingTouched.add(value);
    }

    scheduleFlush();
  };

  /**
   * Propagate error to all watchers with the given signature
   * Returns true if watchers caught the error, false otherwise
   */
  const notifyErrorBySignature = (signature: string, error: Error): boolean => {
    // Find all watchers with this signature
    const watcherSet = signatureToWatchers.get(signature);
    if (!watcherSet || watcherSet.size === 0) return false;

    for (const watcherId of watcherSet) {
      const watcher = watchers.get(watcherId);
      if (watcher?.onError) {
        watcher.onError(error);
      }
    }

    return true;  // Watchers caught the error
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
      for (const d of old) {
        if (!next.has(d)) {
          same = false;
          break;
        }
      }

      if (same) {
        return;
      }
    }

    // remove old
    for (const d of old) {
      if (!next.has(d)) {
        const set = depIndex.get(d);

        if (set) {
          set.delete(watcherId);

          if (set.size === 0) {
            depIndex.delete(d);
          }
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

  const readQuery = <T = any>({ query, variables = {} }: ReadQueryOptions): T | null => {
    const result = documents.materialize({
      document: query,
      variables,
      canonical: true,
      fingerprint: true,
      preferCache: true,
      updateCache: false,
    });

    if (result.source !== "none") {
      return result.data as T;
    }

    return null;
  };

  const writeQuery = ({
    query,
    variables = {},
    data,
  }: WriteQueryOptions): void => {
    documents.normalize({
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
    const signature = plan.makeSignature(true, variables);

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

    // Add to signature → watchers mapping (multiple watchers per signature)
    let watcherSet = signatureToWatchers.get(signature);
    if (!watcherSet) {
      watcherSet = new Set();
      signatureToWatchers.set(signature, watcherSet);
    }
    watcherSet.add(watcherId);

    // If immediate, materialize synchronously to get initial data
    if (immediate) {
      const initial = documents.materialize({
        document: query,
        variables,
        canonical: true,
        preferCache: true,   // Try cache first
        updateCache: true,   // Watchers cache their results
      });

      // Track deps even if initial data is missing
      updateWatcherDependencies(watcherId, initial.dependencies);

      if (initial.source !== "none") {
        watcher.lastData = initial.data;

        try {
          onData(initial.data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
      // No else - watchers simply don't emit on cache miss, they wait for data
    } else {
      // Even with immediate: false, register basic dependencies from query plan
      // This ensures the watcher is notified when entities are added to the cache
      // Use canonical mode to match the signature mode (watchers use canonical signatures)
      const basicDeps = plan.getDependencies(true, variables);

      updateWatcherDependencies(watcherId, basicDeps);
    }

    return {
      unsubscribe: () => {
        const w = watchers.get(watcherId);

        if (!w) {
          return;
        }

        // Remove from dep index
        for (const d of w.deps) {
          const set = depIndex.get(d);

          if (set) {
            set.delete(watcherId);

            if (set.size === 0) {
              depIndex.delete(d);
            }
          }
        }

        // Remove from signature → watchers mapping
        const watcherSet = signatureToWatchers.get(w.signature);

        if (watcherSet) {
          watcherSet.delete(watcherId);
          if (watcherSet.size === 0) {
            // Last watcher for this signature - invalidate cache
            signatureToWatchers.delete(w.signature);

            documents.invalidate({
              document: w.query,
              variables: w.variables,
              canonical: true,
              fingerprint: true,
            });
          }
        }

        watchers.delete(watcherId);
      },

      update: ({ variables: newVariables = {}, immediate = true }) => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Save old variables for invalidation
        const oldVariables = w.variables;

        // Update watcher state
        w.variables = newVariables;
        const plan = planner.getPlan(w.query);
        const newSignature = plan.makeSignature(true, newVariables);

        // Update signature mapping if signature changed
        if (w.signature !== newSignature) {
          // Remove from old signature set
          const oldSet = signatureToWatchers.get(w.signature);
          if (oldSet) {
            oldSet.delete(watcherId);
            if (oldSet.size === 0) {
              // Last watcher for old signature - invalidate cache with OLD variables
              signatureToWatchers.delete(w.signature);

              documents.invalidate({
                document: w.query,
                variables: oldVariables,
                canonical: true,
                fingerprint: true,
              });
            }
          }

          // Add to new signature set
          w.signature = newSignature;
          let newSet = signatureToWatchers.get(newSignature);
          if (!newSet) {
            newSet = new Set();
            signatureToWatchers.set(newSignature, newSet);
          }
          newSet.add(watcherId);
        }

        // If immediate, materialize and emit synchronously
        if (immediate) {
          const res = documents.materialize({
            document: w.query,
            variables: newVariables,
            canonical: true,
            fingerprint: true,
            preferCache: true,
            updateCache: true,  // Watchers cache their results
          });

          updateWatcherDependencies(watcherId, res.dependencies);

          if (res.source !== "none") {
            // recycleSnapshots automatically preserves object identity for unchanged parts
            const recycled = recycleSnapshots(w.lastData, res.data);
            // Only emit if data actually changed
            if (recycled !== w.lastData) {
              w.lastData = recycled;
              try {
                w.onData(recycled);
              } catch (e) {
                w.onError?.(e as Error);
              }
            }
          }
          // No else - watchers simply don't emit on cache miss, they wait for data
        }
      },
    };
  };

  /**
   * Notify watchers by signature (called by operations after network response)
   * Handles multiple watchers per signature
   * Returns true if watchers caught the data, false otherwise
   */
  const notifyDataBySignature = (signature: string, data: any, dependencies: Set<string>): boolean => {
    // Find all watchers with this signature
    const watcherSet = signatureToWatchers.get(signature);

    if (!watcherSet || watcherSet.size === 0) {
      return false;
    }

    // Emit to all watchers with this signature
    for (const watcherId of watcherSet) {
      const w = watchers.get(watcherId);

      if (!w) {
        continue;
      }

      // Update watcher dependencies (since we have them from materialization)
      updateWatcherDependencies(watcherId, dependencies);

      // Directly emit data to watcher (avoid redundant materialize)
      // recycleSnapshots to preserve object identity
      const recycled = recycleSnapshots(w.lastData, data);
      if (recycled !== w.lastData) {
        w.lastData = recycled;

        // Set flag to skip next notifyDataByDependencies emission (coalescing)
        // This prevents double emission when normalize triggers graph.onChange
        w.skipNextPropagate = true;

        Promise.resolve().then(() => {
          w.skipNextPropagate = false;
        });

        try {
          w.onData(recycled);
        } catch (e) {
          if (w.onError) {
            w.onError(e as Error);
          }
        }
      }
    }

    return true;  // Watchers caught the data
  };

  /**
   * Inspect current query watcher state
   * Returns total watcher count and method to get count for specific query
   */
  const inspect = () => {
    return {
      watchersCount: watchers.size,

      getQueryWatchers: (query: DocumentNode | string, variables: Record<string, any> = {}): number => {
        const plan = planner.getPlan(query);
        const signature = plan.makeSignature(true, variables);
        const watcherSet = signatureToWatchers.get(signature);
        return watcherSet ? watcherSet.size : 0;
      },
    };
  };

  return {
    readQuery,
    writeQuery,
    watchQuery,
    notifyDataByDependencies,
    notifyErrorBySignature,
    notifyDataBySignature,
    inspect, // Expose for debugging and testing
  };
};
