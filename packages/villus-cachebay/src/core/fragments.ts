import type { CachePlan } from "@/src/compiler";
import {
  isObject,
  hasTypename,
  upsertEntityShallow,
  buildConnectionKey,
} from "./utils";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { ViewsInstance } from "./views";
import type { PlanField } from "../compiler";
import type { DocumentNode } from "graphql";
import { markRaw } from "vue";

/**
 * Dependencies for fragments layer
 */
export type FragmentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  views: ViewsInstance;
};

/**
 * Arguments for reading a fragment from cache
 * @template TData - Expected fragment data type
 */
export type ReadFragmentArgs<TData = unknown> = {
  /** Entity ID (typename:id) */
  id: string;
  /** GraphQL fragment document or compiled plan */
  fragment: DocumentNode | CachePlan;
  /** Fragment name if document contains multiple fragments */
  fragmentName?: string;
  /** GraphQL variables */
  variables?: Record<string, unknown>;
};

/**
 * Arguments for watching a fragment reactively
 */
export type WatchFragmentOptions = {
  id: string;
  fragment: DocumentNode | CachePlan;
  fragmentName?: string;
  variables?: Record<string, unknown>;
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  skipInitialEmit?: boolean;
};

/**
 * Handle returned by watchFragment for cleanup
 */
export type WatchFragmentHandle = {
  unsubscribe: () => void;
};

/**
 * Arguments for writing a fragment to cache
 * @template TData - Fragment data type to write
 */
export type WriteFragmentArgs<TData = unknown> = {
  /** Entity ID (typename:id) */
  id: string;
  /** GraphQL fragment document or compiled plan */
  fragment: DocumentNode | CachePlan;
  /** Fragment name if document contains multiple fragments */
  fragmentName?: string;
  /** Data to write into the cache */
  data: TData;
  /** GraphQL variables */
  variables?: Record<string, unknown>;
};

/**
 * Create fragments layer for reading/writing fragment data
 * @param deps - Required dependencies (graph, planner, views)
 * @returns Fragments API with readFragment, writeFragment, and watchFragment methods
 */
export const createFragments = ({ graph, planner, views }: FragmentsDependencies) => {
  // Active watchers: watcherId -> watcher state
  type WatcherState = {
    id: string;
    fragment: DocumentNode | CachePlan;
    fragmentName?: string;
    variables: Record<string, unknown>;
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

      // Find affected watchers
      const affectedWatchers = new Set<number>();
      for (const dep of touched) {
        const watcherIds = depIndex.get(dep);
        if (watcherIds) {
          for (const wid of watcherIds) affectedWatchers.add(wid);
        }
      }

      // Re-materialize and emit for each affected watcher
      for (const watcherId of affectedWatchers) {
        const w = watchers.get(watcherId);
        if (!w) continue;

        const result = readFragment({
          id: w.id,
          fragment: w.fragment,
          fragmentName: w.fragmentName,
          variables: w.variables,
        });

        if (result !== undefined) {
          w.lastData = result;
          w.onData(result); // Don't markRaw - views already return reactive proxies
        } else if (w.onError) {
          w.onError(new Error("Fragment returned no data"));
        }
      }
    });
  };

  const enqueueTouched = (touched: Set<string> | string[]) => {
    const arr = Array.isArray(touched) ? touched : Array.from(touched);
    for (const id of arr) pendingTouched.add(id);
    scheduleFlush();
  };

  const updateWatcherDeps = (watcherId: number, newDeps: string[]) => {
    const w = watchers.get(watcherId);
    if (!w) return;

    // Remove old deps
    for (const oldDep of w.deps) {
      const set = depIndex.get(oldDep);
      if (set) {
        set.delete(watcherId);
        if (set.size === 0) depIndex.delete(oldDep);
      }
    }

    // Add new deps
    w.deps.clear();
    for (const dep of newDeps) {
      w.deps.add(dep);
      let set = depIndex.get(dep);
      if (!set) {
        set = new Set();
        depIndex.set(dep, set);
      }
      set.add(watcherId);
    }
  };

  /**
   * Build a synthetic "root" PlanField from the plan.root array so the views
   * layer sees the root selection and can detect connection fields.
   */
  const makeRootField = (plan: CachePlan): PlanField => {
    const selectionMap = new Map<string, PlanField>();
    for (const f of plan.root) {
      selectionMap.set(f.responseKey, f);
    }
    return { selectionMap } as unknown as PlanField;
  };

  /**
   * Reads a fragment selection over an entity reactively.
   * Returns a view proxy with connections properly handled.
   * Missing entities return an empty view (placeholder), not undefined.
   */
  const readFragment = <T = any>({
    id,
    fragment,
    fragmentName,
    variables = {},
  }: ReadFragmentArgs): T | undefined => {
    const plan = planner.getPlan(fragment, { fragmentName });
    const proxy = graph.materializeRecord(id);

    return views.getView({
      source: proxy,
      field: makeRootField(plan),
      variables,
      canonical: false,
    }) as T;
  };

  /**
   * Writes a fragment-shaped patch into the graph.
   * - Entity fields are written shallowly with proper __ref linking for nested entities.
   * - Connection fields write a concrete "page" record:
   *     pageKey                    -> { __typename?, totalCount?, ... , edges: { __refs }, pageInfo: { __ref } }
   *     pageKey.edges.<i>          -> { __typename?, cursor?, ... , node: { __ref: nodeKey } }
   *     pageKey.pageInfo           -> { __typename: "PageInfo", ... }
   */
  const writeFragment = ({
    id,
    fragment,
    fragmentName,
    data,
    variables = {},
  }: WriteFragmentArgs): void => {
    if (!data || typeof data !== "object") return;

    const plan = planner.getPlan(fragment, { fragmentName });

    // Ensure parent record exists (materializeRecord already ensures a placeholder view,
    // but we still create/patch the concrete record below).
    const patch: Record<string, any> = {};
    if ((data as any).__typename) patch.__typename = (data as any).__typename;
    if ((data as any).id != null) patch.id = String((data as any).id);

    // Iterate root selection and apply each field.
    for (const field of plan.root) {
      const responseKey = field.responseKey;
      const value = (data as any)[responseKey];

      if (value === undefined) continue;

      // Connection: write a page subtree
      if (field.isConnection) {
        const subtree = value;
        if (!isObject(subtree)) continue;

        const pageKey = buildConnectionKey(field, id, variables);

        // Edges
        const inputEdges: any[] = Array.isArray((subtree as any).edges)
          ? (subtree as any).edges
          : [];
        const edgeKeys: string[] = new Array(inputEdges.length);

        for (let edgeIndex = 0; edgeIndex < inputEdges.length; edgeIndex++) {
          const edge = inputEdges[edgeIndex] || {};
          const nodeObject = edge.node;

          if (isObject(nodeObject) && hasTypename(nodeObject) && nodeObject.id != null) {
            const nodeKey = upsertEntityShallow(graph, nodeObject);
            if (nodeKey) {
              const edgeKey = `${pageKey}.edges.${edgeIndex}`;
              const { node, ...edgeRest } = edge as any;

              const edgeSnapshot: Record<string, any> = {
                __typename: (edge as any).__typename || "Edge",
                ...edgeRest,
                node: { __ref: nodeKey },
              };

              graph.putRecord(edgeKey, edgeSnapshot);
              edgeKeys[edgeIndex] = edgeKey;
            }
          }
        }

        // PageInfo
        let pageInfoRef: { __ref: string } | undefined;
        const pageInfoVal = (subtree as any).pageInfo;
        if (pageInfoVal && isObject(pageInfoVal)) {
          const pageInfoKey = `${pageKey}.pageInfo`;
          graph.putRecord(pageInfoKey, {
            __typename: "PageInfo",
            ...(pageInfoVal as any),
          });
          pageInfoRef = { __ref: pageInfoKey };
        }

        // Page record (connection container)
        const { edges, pageInfo, ...connectionRest } = subtree as any;
        const connectionTypename =
          (subtree as any).__typename ||
          (field.fieldName
            ? `${field.fieldName.charAt(0).toUpperCase()}${field.fieldName.slice(1)}Connection`
            : "Connection");

        const pageSnapshot: Record<string, any> = {
          __typename: connectionTypename,
          ...connectionRest,
          edges: { __refs: edgeKeys.filter(Boolean) },
        };

        if (pageInfoRef) pageSnapshot.pageInfo = pageInfoRef;

        graph.putRecord(pageKey, pageSnapshot);
        continue;
      }

      // Non-connection: shallow entity upserts and __ref linking
      if (isObject(value) && hasTypename(value) && (value as any).id != null) {
        const key = upsertEntityShallow(graph, value);
        if (key) patch[field.fieldName] = { __ref: key };
        continue;
      }

      if (Array.isArray(value)) {
        const out: any[] = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (isObject(item) && hasTypename(item) && (item as any).id != null) {
            const key = upsertEntityShallow(graph, item);
            out[i] = key ? { __ref: key } : undefined;
          } else {
            out[i] = item;
          }
        }
        patch[field.fieldName] = out;
        continue;
      }

      patch[field.fieldName] = value;
    }

    if (Object.keys(patch).length > 0) {
      graph.putRecord(id, patch);
    }
  };

  /**
   * Watch a fragment reactively - emits updates when dependencies change
   */
  const watchFragment = ({
    id,
    fragment,
    fragmentName,
    variables = {},
    onData,
    onError,
    skipInitialEmit = false,
  }: WatchFragmentOptions): WatchFragmentHandle => {
    const watcherId = watcherSeq++;

    // Initial read
    const initialResult = readFragment({
      id,
      fragment,
      fragmentName,
      variables,
    });

    const watcher: WatcherState = {
      id,
      fragment,
      fragmentName,
      variables,
      onData,
      onError,
      deps: new Set(),
      lastData: undefined,
    };

    watchers.set(watcherId, watcher);

    if (initialResult !== undefined) {
      watcher.lastData = initialResult;
      // Track the entity ID as a dependency
      updateWatcherDeps(watcherId, [id]);
      if (!skipInitialEmit) {
        onData(initialResult); // Don't markRaw - views already return reactive proxies
      }
    } else if (onError && !skipInitialEmit) {
      onError(new Error("Fragment returned no data"));
    }

    return {
      unsubscribe: () => {
        // Clean up deps
        const w = watchers.get(watcherId);
        if (w) {
          for (const dep of w.deps) {
            const set = depIndex.get(dep);
            if (set) {
              set.delete(watcherId);
              if (set.size === 0) depIndex.delete(dep);
            }
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
    // Internal: notify watchers of touched dependencies
    _notifyTouched: enqueueTouched,
  };
};
