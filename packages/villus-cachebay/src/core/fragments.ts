// src/core/fragments.ts
import type { CachePlan } from "@/src/compiler";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";
import type { DocumentNode } from "graphql";

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
  /** use canonical fill (default: true) */
  canonical?: boolean;
};

export type WatchFragmentOptions = {
  id: string;
  fragment: DocumentNode | CachePlan;
  fragmentName?: string;
  variables?: Record<string, unknown>;
  canonical?: boolean;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  skipInitialEmit?: boolean;
};

export type WatchFragmentHandle = {
  unsubscribe: () => void;
};

export type WriteFragmentArgs<TData = unknown> = {
  id: string;
  fragment: DocumentNode | CachePlan;
  fragmentName?: string;
  data: TData;
  variables?: Record<string, unknown>;
};

export const createFragments = ({ graph, planner, documents }: FragmentsDependencies) => {
  // --- Watchers (same shape and batching strategy as queries) ---
  type WatcherState = {
    id: string;
    fragment: DocumentNode | CachePlan;
    fragmentName?: string;
    variables: Record<string, unknown>;
    canonical: boolean;
    onData: (data: any) => void;
    onError?: (error: Error) => void;
    deps: Set<string>;
    lastData: any | undefined;
  };

  const watchers = new Map<number, WatcherState>();
  const depIndex = new Map<string, Set<number>>();
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

        const result = documents.materializeDocument({
          document: planner.getPlan(w.fragment, { fragmentName: w.fragmentName }),
          variables: w.variables as Record<string, any>,
          canonical: w.canonical,
          entityId: w.id,
        }) as any;

        // New materialize shape:
        // { data?: any, deps?: string[], source: 'strict'|'canonical'|'none', ok: { strict:boolean, canonical:boolean } }
        if (!result || result.source === "none") {
          if (w.onError) w.onError(new Error("Fragment returned no data"));
          continue;
        }

        updateWatcherDeps(k, result.deps || []);
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

  const readFragment = <T = any>({
    id,
    fragment,
    fragmentName,
    variables = {},
    canonical = true,
  }: ReadFragmentArgs): T | undefined => {
    const result = documents.materializeDocument({
      document: planner.getPlan(fragment, { fragmentName }),
      variables: variables as Record<string, any>,
      canonical,
      entityId: id,
    }) as any;

    if (result && result.source !== "none") {
      return result.data as T;
    }
    return undefined;
  };

  const writeFragment = ({
    id,
    fragment,
    fragmentName,
    data,
    variables = {},
  }: WriteFragmentArgs): void => {
    const plan = planner.getPlan(fragment, { fragmentName });
    documents.normalizeDocument({
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
    canonical = true,
    onData,
    onError,
    skipInitialEmit = false,
  }: WatchFragmentOptions): WatchFragmentHandle => {
    const watcherId = watcherSeq++;

    const watcher: WatcherState = {
      id,
      fragment,
      fragmentName,
      variables: variables || {},
      canonical,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
    };
    watchers.set(watcherId, watcher);

    const initial = documents.materializeDocument({
      document: planner.getPlan(fragment, { fragmentName }),
      variables: variables as Record<string, any>,
      canonical,
      entityId: id,
    }) as any;

    if (initial && initial.source !== "none") {
      watcher.lastData = initial.data;
      updateWatcherDeps(watcherId, initial.deps || []);
      if (!skipInitialEmit) {
        try {
          onData(initial.data);
        } catch (e) {
          onError?.(e as Error);
        }
      }
    } else {
      updateWatcherDeps(watcherId, initial?.deps || []);
      if (onError && !skipInitialEmit) {
        onError(new Error("Fragment returned no data"));
      }
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
    };
  };

  return {
    readFragment,
    writeFragment,
    watchFragment,
    /** test/internal helper: notify watchers by record ids you touched */
    _notifyTouched: enqueueTouched,
  };
};
