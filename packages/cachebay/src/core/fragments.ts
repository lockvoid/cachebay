import { recycleSnapshots } from "./utils";
import type { CachePlan } from "../compiler";
import type { DocumentsInstance } from "./documents";
import type { PlannerInstance } from "./planner";
import type { DocumentNode } from "graphql";

export type FragmentsDependencies = {
  planner: PlannerInstance;
  documents: DocumentsInstance;
};

export type ReadFragmentArgs<TData = unknown> = {
  id: string;
  fragment: DocumentNode | CachePlan | string;
  fragmentName?: string;
  variables?: Record<string, unknown>;
};

export type WatchFragmentOptions = {
  id: string;
  fragment: DocumentNode | CachePlan | string;
  fragmentName?: string;
  variables?: Record<string, unknown>;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  /** Emit initial data immediately (default: true) */
  immediate?: boolean;
};

export type WatchFragmentHandle = {
  unsubscribe: () => void;
  update: (options: { id?: string; variables?: Record<string, unknown>; immediate?: boolean }) => void;
};

export type WriteFragmentArgs<TData = unknown> = {
  id: string;
  fragment: DocumentNode | CachePlan | string;
  fragmentName?: string;
  data: TData;
  variables?: Record<string, unknown>;
};

export type FragmentsInstance = ReturnType<typeof createFragments>;

export const createFragments = ({ planner, documents }: FragmentsDependencies) => {
  // --- Watchers (same shape and batching strategy as queries) ---
  type WatcherState = {
    id: string;
    fragment: DocumentNode | CachePlan;
    fragmentName?: string;
    variables: Record<string, unknown>;
    signature: string;  // Fragment signature (rootId|fragmentSignature)
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
    lastFingerprints: any | undefined;
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  const signatureToWatchers = new Map<string, Set<number>>(); // Multiple watchers per signature (rootId|signature)
  let watcherSeq = 1;

  const pendingTouched = new Set<string>();
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingTouched.size === 0) return;

      const touched = Array.from(pendingTouched);
      pendingTouched.clear();

      const affected = new Set<number>();
      for (const id of touched) {
        const ws = depIndex.get(id);
        if (ws) for (const k of ws) affected.add(k);
      }
      if (affected.size === 0) return;

      for (const k of affected) {
        const w = watchers.get(k);
        if (!w) continue;

        const result = documents.materialize({
          document: planner.getPlan(w.fragment, { fragmentName: w.fragmentName }),
          variables: w.variables as Record<string, any>,
          canonical: true,  // Always use canonical mode
          rootId: w.id,
          fingerprint: true,
          preferCache: false,  // Data just changed - need fresh materialization
          updateCache: true,   // Update cache with fresh data
        });

        updateWatcherDeps(k, result.dependencies);

        if (result.source !== "none") {
          const recycled = recycleSnapshots(w.lastData, result.data, w.lastFingerprints, result.fingerprints);
          if (recycled !== w.lastData) {
            w.lastData = recycled;
            w.lastFingerprints = result.fingerprints;
            try {
              w.onData(recycled);
            } catch (e) {
              w.onError?.(e as Error);
            }
          }
        }
        // Don't call onError for cache miss - entity might be deleted or not loaded yet
      }
    });
  };

  const notifyDataByDependencies = (touched: Set<string>) => {
    for (const value of touched) {
      pendingTouched.add(value);
    }

    scheduleFlush();
  };

  const updateWatcherDeps = (watcherId: number, nextDepsArr: string[]) => {
    const watcher = watchers.get(watcherId);
    if (!watcher) return;

    const old = watcher.deps;
    const next = new Set(nextDepsArr);

    // fast path: identical
    if (old.size === next.size) {
      let same = true;
      for (const d of old) if (!next.has(d)) { same = false; break; }
      if (same) return;
    }

    for (const d of old) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(watcherId);
        if (set.size === 0) depIndex.delete(d);
      }
    }

    for (const d of next) {
      let set = depIndex.get(d);
      if (!set) depIndex.set(d, (set = new Set()));
      set.add(watcherId);
    }

    watcher.deps = next;
  };

  // --- Public API ---

  // --- Helper: Build signature for reference counting ---
  const buildSignature = (id: string, fragment: DocumentNode | CachePlan, fragmentName: string | undefined, variables: Record<string, unknown>): string => {
    const plan = planner.getPlan(fragment, { fragmentName });
    const sig = plan.makeSignature(true, variables as Record<string, any>);
    // Format: rootId|signature
    return `${id}|${sig}`;
  };

  const readFragment = <T = any>({
    id,
    fragment,
    fragmentName,
    variables = {},
  }: ReadFragmentArgs): T | null => {
    const result = documents.materialize({
      rootId: id,
      document: planner.getPlan(fragment, { fragmentName }),
      variables: variables as Record<string, any>,
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

  const writeFragment = ({
    id,
    fragment,
    fragmentName,
    data,
    variables = {},
  }: WriteFragmentArgs): void => {
    const plan = planner.getPlan(fragment, { fragmentName });
    documents.normalize({
      document: plan,
      variables: variables as Record<string, any>,
      data,
      // write "under" this entity and create links to connection pages
      rootId: id,
    });
  };

  const watchFragment = ({
    id,
    fragment,
    fragmentName,
    variables = {},
    onData,
    onError,
    immediate = true,
  }: WatchFragmentOptions): WatchFragmentHandle => {
    const watcherId = watcherSeq++;

    // Build signature
    const signature = buildSignature(id, fragment, fragmentName, variables);

    const watcher: WatcherState = {
      id,
      fragment,
      fragmentName,
      variables: variables || {},
      signature,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
      lastFingerprints: undefined,
    };
    watchers.set(watcherId, watcher);

    // Add to signature → watchers mapping
    let watcherSet = signatureToWatchers.get(signature);
    if (!watcherSet) {
      watcherSet = new Set();
      signatureToWatchers.set(signature, watcherSet);
    }
    watcherSet.add(watcherId);

    const initial = documents.materialize({
      document: planner.getPlan(fragment, { fragmentName }),
      variables: variables as Record<string, any>,
      canonical: true,  // Always use canonical mode
      rootId: id,
      fingerprint: true,
      preferCache: true,   // Try cache first
      updateCache: true,   // Watchers cache their results
    });

    updateWatcherDeps(watcherId, initial.dependencies);

    if (initial.source !== "none") {
      watcher.lastData = initial.data;
      watcher.lastFingerprints = initial.fingerprints;
      if (immediate) {
        try {
          onData(initial.data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    }
    // Don't call onError for initial cache miss - entity might not be loaded yet

    return {
      unsubscribe: () => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Remove from signature → watchers mapping
        const watcherSet = signatureToWatchers.get(w.signature);
        if (watcherSet) {
          watcherSet.delete(watcherId);
          if (watcherSet.size === 0) {
            // Last watcher for this signature - invalidate cache
            signatureToWatchers.delete(w.signature);
            documents.invalidate({
              document: planner.getPlan(w.fragment, { fragmentName: w.fragmentName }),
              variables: w.variables as Record<string, any>,
              canonical: true,
              rootId: w.id,
              fingerprint: true,
            });
          }
        }

        for (const d of w.deps) {
          const set = depIndex.get(d);
          if (set) {
            set.delete(watcherId);
            if (set.size === 0) depIndex.delete(d);
          }
        }
        watchers.delete(watcherId);
      },

      update: ({ id: newId, variables: newVariables, immediate = true }) => {
        const w = watchers.get(watcherId);
        if (!w) return;

        // Save old values for invalidation
        const oldId = w.id;
        const oldVariables = w.variables;

        // Update watcher state
        if (newId !== undefined) w.id = newId;
        if (newVariables !== undefined) w.variables = newVariables;

        // Build new signature
        const newSignature = buildSignature(w.id, w.fragment, w.fragmentName, w.variables);

        // Update signature mapping if signature changed
        if (w.signature !== newSignature) {
          // Remove from old signature set
          const oldSet = signatureToWatchers.get(w.signature);
          if (oldSet) {
            oldSet.delete(watcherId);
            if (oldSet.size === 0) {
              // Last watcher for old signature - invalidate cache
              signatureToWatchers.delete(w.signature);

              documents.invalidate({
                document: planner.getPlan(w.fragment, { fragmentName: w.fragmentName }),
                variables: oldVariables as Record<string, any>,
                canonical: true,
                rootId: oldId,
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
            document: planner.getPlan(w.fragment, { fragmentName: w.fragmentName }),
            variables: w.variables as Record<string, any>,
            canonical: true,
            rootId: w.id,
            fingerprint: true,
            preferCache: true,   // Try cache first
            updateCache: true,   // Watchers cache their results
          });

          updateWatcherDeps(watcherId, res.dependencies);

          if (res.source !== "none") {
            // recycleSnapshots automatically preserves object identity for unchanged parts
            const recycled = recycleSnapshots(w.lastData, res.data, w.lastFingerprints, res.fingerprints);
            // Only emit if data actually changed
            if (recycled !== w.lastData) {
              w.lastData = recycled;
              w.lastFingerprints = res.fingerprints;
              try {
                w.onData(recycled);
              } catch (e) {
                w.onError?.(e as Error);
              }
            }
          }
          // No else - watchers simply don't emit on cache miss, entity might not be loaded yet
        }
      },
    };
  };

  /**
   * Inspect current fragment watcher state
   * Returns total watcher count and method to get count for specific fragment
   */
  const inspect = () => {
    return {
      watchersCount: watchers.size,
      getFragmentWatchers: (id: string, fragment: DocumentNode | CachePlan, fragmentName?: string, variables: Record<string, unknown> = {}): number => {
        const signature = buildSignature(id, fragment, fragmentName, variables);
        const watcherSet = signatureToWatchers.get(signature);
        return watcherSet ? watcherSet.size : 0;
      },
    };
  };

  /**
   * Evict all watcher data after evictAll.
   * Emits undefined to all watchers that had data.
   * Fragments don't re-fetch (no network operation).
   */
  const notifyEvictAll = (): void => {
    for (const [, w] of watchers) {
      if (w.lastData !== undefined) {
        w.lastData = undefined;
        w.lastFingerprints = undefined;

        try {
          w.onData(undefined);
        } catch (e) {
          w.onError?.(e as Error);
        }
      }
    }
  };

  return {
    readFragment,
    writeFragment,
    watchFragment,
    notifyDataByDependencies,
    notifyEvictAll,
    inspect,
  };
};
