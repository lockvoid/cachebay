import type { CachePlan } from "@/src/compiler";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";
import type { DocumentNode } from "graphql";
import { CacheMissError } from "./errors";
import { recycleSnapshots } from "./utils";

export type FragmentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
};

export type ReadFragmentArgs<TData = unknown> = {
  id: string;
  fragment: DocumentNode | CachePlan;
  fragmentName?: string;
  variables?: Record<string, unknown>;
};

export type WatchFragmentOptions = {
  id: string;
  fragment: DocumentNode | CachePlan;
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
  fragment: DocumentNode | CachePlan;
  fragmentName?: string;
  data: TData;
  variables?: Record<string, unknown>;
};

export type FragmentsInstance = ReturnType<typeof createFragments>;

export const createFragments = ({ graph, planner, documents }: FragmentsDependencies) => {
  // --- Watchers (same shape and batching strategy as queries) ---
  type WatcherState = {
    id: string;
    fragment: DocumentNode | CachePlan;
    fragmentName?: string;
    variables: Record<string, unknown>;
    signature: string;  // Fragment signature (entityId|fragmentSignature)
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
  const signatureToWatchers = new Map<string, Set<number>>(); // Multiple watchers per signature (entityId|signature)
  let watcherSeq = 1;

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
          entityId: w.id,
          fingerprint: true,
          force: true, // Always force in propagateData - data changed
        });

        updateWatcherDeps(k, result.dependencies);

        if (result.source !== "none") {
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
        // Don't call onError for cache miss - entity might be deleted or not loaded yet
      }
    });
  };

  const propagateData = (touched: Set<string>) => {
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
    // Format: entityId|signature
    return `${id}|${sig}`;
  };

  const readFragment = <T = any>({
    id,
    fragment,
    fragmentName,
    variables = {},
  }: ReadFragmentArgs): T | null => {
    // Check if there's an active watcher for this fragment
    const signature = buildSignature(id, fragment, fragmentName, variables);
    const hasActiveWatcher = signatureToWatchers.has(signature);

    const result = documents.materialize({
      document: planner.getPlan(fragment, { fragmentName }),
      variables: variables as Record<string, any>,
      canonical: true,  // Always use canonical mode
      entityId: id,
      fingerprint: true, // Include version fingerprints
      force: !hasActiveWatcher, // Use cache if watcher exists, otherwise force fresh
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
      entityId: id,
      fingerprint: true,
    });

    updateWatcherDeps(watcherId, initial.dependencies);

    if (initial.source !== "none") {
      watcher.lastData = recycleSnapshots(undefined, initial.data);
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
              entityId: w.id,
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
                entityId: oldId,
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
            entityId: w.id,
            fingerprint: true,
            force: false, // Use cache - propagateData already updated it
          });

          updateWatcherDeps(watcherId, res.dependencies);

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

  return {
    readFragment,
    writeFragment,
    watchFragment,
    propagateData,
    inspect,
  };
};
