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

export type DecisionMode = "strict" | "canonical";

export type ReadQueryOptions = {
  query: DocumentNode;
  variables?: Record<string, any>;
  decisionMode?: DecisionMode;
};

export type ReadQueryResult<T = any> = {
  data: T | undefined;
  deps: string[];
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
  decisionMode?: DecisionMode;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
};

export type WatchQueryHandle = {
  unsubscribe: () => void;
  refetch: () => void;
};

export type QueriesInstance = ReturnType<typeof createQueries>;

export const createQueries = (deps: QueriesDependencies) => {
  const { graph, planner, documents } = deps;

  // Active watchers: opKey -> watcher state
  type WatcherState = {
    query: DocumentNode;
    variables: Record<string, any>;
    decisionMode: DecisionMode;
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  let watcherSeq = 1;

  // Pending changes for batched broadcasting
  let pendingTouched = new Set<string>();
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingTouched.size === 0) return;

      const touched = Array.from(pendingTouched);
      pendingTouched.clear();

      // Collect affected watchers
      const affected = new Set<number>();
      for (const id of touched) {
        const ws = depIndex.get(id);
        if (ws) for (const k of ws) affected.add(k);
      }

      if (affected.size === 0) return;

      // Re-materialize each affected watcher
      for (const k of affected) {
        const watcher = watchers.get(k);
        if (!watcher) continue;

        const result = documents.materializeDocument({
          document: watcher.query,
          variables: watcher.variables,
          decisionMode: watcher.decisionMode,
        }) as any;

        if (!result || result.status !== "FULFILLED") continue;

        // Update deps
        updateWatcherDeps(k, result.deps || []);

        // Emit only on identity change
        if (result.data !== watcher.lastData) {
          watcher.lastData = result.data;
          watcher.onData(markRaw(result.data));
        }
      }
    });
  };

  const updateWatcherDeps = (watcherId: number, newDeps: string[]) => {
    const watcher = watchers.get(watcherId);
    if (!watcher) return;

    // Remove old deps
    for (const d of watcher.deps) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(watcherId);
        if (set.size === 0) depIndex.delete(d);
      }
    }

    // Add new deps
    watcher.deps = new Set(newDeps);
    for (const d of watcher.deps) {
      let set = depIndex.get(d);
      if (!set) depIndex.set(d, (set = new Set()));
      set.add(watcherId);
    }
  };

  const enqueueTouched = (touched?: Set<string>) => {
    if (!touched || touched.size === 0) return;
    for (const id of touched) pendingTouched.add(id);
    scheduleFlush();
  };

  /**
   * Read query from cache (sync)
   */
  const readQuery = <T = any>({
    query,
    variables = {},
    decisionMode = "canonical",
  }: ReadQueryOptions): ReadQueryResult<T> => {
    const result = documents.materializeDocument({
      document: query,
      variables,
      decisionMode,
    }) as any;

    if (result && result.status === "FULFILLED") {
      return {
        data: markRaw(result.data) as T,
        deps: result.deps || [],
      };
    }

    return {
      data: undefined,
      deps: [],
    };
  };

  /**
   * Write query to cache (sync)
   */
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

    // Trigger reactive updates for watchers
    enqueueTouched(touched);

    return { touched };
  };

  /**
   * Watch query reactively (returns unsubscribe handle)
   */
  const watchQuery = ({
    query,
    variables = {},
    decisionMode = "canonical",
    onData,
    onError,
  }: WatchQueryOptions): WatchQueryHandle => {
    const watcherId = watcherSeq++;

    // Initial read
    const initialResult = documents.materializeDocument({
      document: query,
      variables,
      decisionMode,
    }) as any;

    const watcher: WatcherState = {
      query,
      variables,
      decisionMode,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
    };

    watchers.set(watcherId, watcher);

    if (initialResult && initialResult.status === "FULFILLED") {
      watcher.lastData = initialResult.data;
      updateWatcherDeps(watcherId, initialResult.deps || []);
      onData(markRaw(initialResult.data));
    } else if (onError) {
      onError(new Error("Query returned no data"));
    }

    // Return handle
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

        const result = documents.materializeDocument({
          document: w.query,
          variables: w.variables,
          decisionMode: w.decisionMode,
        }) as any;

        if (result && result.status === "FULFILLED") {
          w.lastData = result.data;
          updateWatcherDeps(watcherId, result.deps || []);
          w.onData(markRaw(result.data));
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
  };
};
