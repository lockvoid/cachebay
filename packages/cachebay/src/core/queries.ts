// src/core/queries.ts
import type { DocumentsInstance } from "./documents";
import type { PlannerInstance } from "./planner";
import type { OperationsInstance } from "./operations";
import { CacheMissError } from "./errors";
import { recycleSnapshots } from "./utils";
import type { DocumentNode } from "graphql";

export type QueriesDependencies = {
  documents: DocumentsInstance;
  planner: PlannerInstance;
  operations: OperationsInstance;
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
  /** Update variables. If immediate=true, materializes and emits immediately. */
  update: (options: { variables?: Record<string, any>; immediate?: boolean }) => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = ({ documents, planner, operations: initialOperations }: QueriesDependencies) => {
  // Operations reference (not used in queries, only for dependency injection pattern)
  let operations = initialOperations;

  // --- Watcher state & indices ---
  type WatcherState = {
    query: DocumentNode | string;
    variables: Record<string, any>;
    signature: string;  // Query signature for error tracking
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
    skipNextPropagate?: boolean; // Flag to skip next propagateData emission (coalescing)
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  const signatureToWatcher = new Map<string, number>(); // Fast lookup by signature
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

        // Skip if recently emitted by handleQueryExecuted (coalescing)
        if (w.skipNextPropagate) {
          w.skipNextPropagate = false; // Clear flag after checking
          continue;
        }

        const result = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          canonical: true, // Always canonical for watchers
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
    // Find watcher with this signature
    for (const [_, watcher] of watchers) {
      if (watcher.signature === signature && watcher.onError) {
        watcher.onError(error);
        break;  // Only one watcher per signature
      }
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
    signatureToWatcher.set(signature, watcherId);

    // If immediate, materialize synchronously to get initial data
    if (immediate) {
      const initial = documents.materializeDocument({
        document: query,
        variables,
        canonical: true,
        fingerprint: true,
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

      update: ({ variables: newVariables = {}, immediate = true }) => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Update watcher state
        w.variables = newVariables;
        const plan = planner.getPlan(w.query);
        const newSignature = plan.makeSignature("canonical", newVariables);

        // Update signature mapping
        signatureToWatcher.delete(w.signature);
        w.signature = newSignature;
        signatureToWatcher.set(newSignature, watcherId);

        // If immediate, materialize and emit synchronously
        if (immediate) {
          const res = documents.materializeDocument({
            document: w.query,
            variables: newVariables,
            canonical: true,
            fingerprint: true,
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
   * Callback handler from operations - updates watcher dependencies and directly emits data
   */
  const handleQueryExecuted = ({ signature, data, dependencies }: {
    signature: string;
    data: any;
    dependencies: Set<string>;
    cachePolicy: string;
  }) => {
    const watcherId = signatureToWatcher.get(signature);
    if (watcherId !== undefined) {
      const w = watchers.get(watcherId);
      if (!w) return;

      // Update dependencies
      updateWatcherDependencies(watcherId, dependencies);

      // Directly emit data to watcher (avoid redundant materialize)
      // recycleSnapshots to preserve object identity
      const recycled = recycleSnapshots(w.lastData, data);
      if (recycled !== w.lastData) {
        w.lastData = recycled;

        // Set flag to skip next propagateData emission (coalescing)
        // This prevents double emission when normalize triggers graph.onChange
        w.skipNextPropagate = true;

        try {
          w.onData(recycled);
        } catch (e) {
          w.onError?.(e as Error);
        }
      }
    }
  };

  return {
    readQuery,
    writeQuery,
    watchQuery,
    propagateData,
    propagateError,
    handleQueryExecuted, // Expose for operations to call
    // Allow injecting operations after creation
    _setOperations: (ops: any) => { operations = ops; },
  };
};
