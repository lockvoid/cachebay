// internals.ts - entry point

import {
  reactive,
  shallowReactive,
  isReactive,
  ref,
  type App,
} from "vue";
import type { ClientPlugin } from "villus";

import { relay } from "../resolvers/relay";
import { buildCachebayPlugin, provideCachebay } from "./plugin";
import { createModifyOptimistic } from "../features/optimistic";
import { createSSRFeatures } from "../features/ssr";
import { createInspect } from "../features/debug";

import type {
  CachebayOptions,
  KeysConfig,
  ResolversFactory,
  ResolversDict,
  FieldResolver,
} from "../types";
import type {
  CachebayInternals,
  EntityKey,
  ConnectionState,
  RelayOptions,
} from "./types";

import {
  stableIdentityExcluding,
  readPathValue,
  parseEntityKey,
  buildConnectionKey,
} from "./utils";

// split modules
import { createGraph } from "./graph";
import { createViews } from "./views";
import {
  createResolvers,
  makeApplyFieldResolvers,
  applyResolversOnGraph as applyResolversOnGraphImpl,
  getRelayOptionsByType,
  setRelayOptionsByType,
  relayResolverIndex,
  relayResolverIndexByType,
} from "./resolvers";
import { createFragments } from "./fragments";

/* ─────────────────────────────────────────────────────────────────────────────
 * Public instance type
 * ──────────────────────────────────────────────────────────────────────────── */
export type CachebayInstance = ClientPlugin & {
  dehydrate: () => any;
  hydrate: (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => void;

  identify: (obj: any) => string | null;

  readFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }, materialized?: boolean) => any;
  hasFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }) => boolean;
  writeFragment: (obj: any) => { commit(): void; revert(): void };

  modifyOptimistic: (build: (cache: any) => void) => { commit(): void; revert(): void };

  inspect: {
    entities: (typename?: string) => string[];
    get: (key: string) => any;
    connections: () => string[];
    connection: (
      parent: "Query" | { __typename: string; id?: any; _id?: any },
      field: string,
      variables?: Record<string, any>,
    ) => any;
    operations?: () => Array<{ key: string; variables: Record<string, any>; data: any }>;
  };

  listEntityKeys: (selector: string | string[]) => string[];
  listEntities: (selector: string | string[], materialized?: boolean) => any[];
  __entitiesTick: ReturnType<typeof ref<number>>;

  gc?: { connections: (predicate?: (key: string, state: ConnectionState) => boolean) => void };

  install: (app: App) => void;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */
export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Config
  const writePolicy = options.writePolicy || "replace";
  const keys =
    typeof options.keys === "function" ? options.keys() : options.keys ? options.keys : ({} as NonNullable<KeysConfig>);
  const shouldAddTypename = options.addTypename !== false;

  const interfaces: Record<string, string[]> =
    typeof options.interfaces === "function"
      ? options.interfaces()
      : options.interfaces
        ? (options.interfaces as Record<string, string[]>)
        : {};

  const reactiveMode = options.entityShallow === true ? "shallow" : "deep";
  const trackNonRelayResults = options.trackNonRelayResults !== false;

  // Build raw graph (stores + helpers)
  const graph = createGraph({
    writePolicy,
    interfaces,
    reactiveMode,
    keys,
  });

  // Views (entity/connection views & proxy registration)
  const views = createViews({
    entityStore: graph.entityStore,
    connectionStore: graph.connectionStore,
    ensureConnectionState: graph.getOrCreateConnection,
    materializeEntity: graph.materializeEntity,
    makeEntityProxy: graph.makeReactive,
    idOf: graph.identify,
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * Internals object (exposed to resolvers & plugin)
   * ────────────────────────────────────────────────────────────────────────── */
  const internals: CachebayInternals = {
    TYPENAME_KEY: "__typename",
    DEFAULT_WRITE_POLICY: writePolicy,
    entityStore: graph.entityStore,
    connectionStore: graph.connectionStore,
    relayResolverIndex,
    relayResolverIndexByType,
    getRelayOptionsByType,
    setRelayOptionsByType,
    operationCache: graph.operationCache,
    putEntity: graph.putEntity,
    materializeEntity: graph.materializeEntity,
    ensureConnectionState: graph.getOrCreateConnection,
    synchronizeConnectionViews: views.synchronizeConnectionViews,
    parentEntityKeyFor: graph.getEntityParentKey,
    buildConnectionKey,
    readPathValue,
    markConnectionDirty: views.markConnectionDirty,
    linkEntityToConnection: views.linkEntityToConnection,
    unlinkEntityFromConnection: views.unlinkEntityFromConnection,
    touchConnectionsForEntityKey: views.touchConnectionsForEntityKey,
    addStrongView: views.addStrongView,
    isReactive,
    reactive,
    shallowReactive,
    writeOperationCache: graph.putOperation,
    // filled below:
    applyFieldResolvers: () => { },
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Resolvers binding + application on graph
   * ────────────────────────────────────────────────────────────────────────── */
  const resolverSource = options.resolvers;
  const resolverSpecs: ResolversDict | undefined =
    typeof resolverSource === "function"
      ? (resolverSource as ResolversFactory)({ relay })
      : (resolverSource as ResolversDict | undefined);

  const resolvers = createResolvers({}, {
    internals,
    resolverSpecs,
  });
  
  let FIELD_RESOLVERS = resolvers.FIELD_RESOLVERS;

  const applyFieldResolvers = makeApplyFieldResolvers({
    TYPENAME_KEY: internals.TYPENAME_KEY,
    FIELD_RESOLVERS,
  });

  internals.applyFieldResolvers = applyFieldResolvers;

  function applyResolversOnGraph(root: any, vars: Record<string, any>, hint: { stale?: boolean }) {
    applyResolversOnGraphImpl(root, vars, hint, {
      TYPENAME_KEY: internals.TYPENAME_KEY,
      FIELD_RESOLVERS,
    });
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Register views from result (Relay connections)
   * ────────────────────────────────────────────────────────────────────────── */
  const registerViewsFromResult = (root: any, variables: Record<string, any>) => {
    // Re-using the walker from resolvers implementation would create cycles,
    // so we do a light traversal here tailored for Relay connections.
    const stack: Array<{ obj: any; parentTypename: string | null }> = [{ obj: root, parentTypename: "Query" }];
    while (stack.length) {
      const { obj, parentTypename } = stack.pop()!;
      if (!obj || typeof obj !== "object") continue;

      const pt = (obj as any)[internals.TYPENAME_KEY] || parentTypename;
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const field = keys[i];
        const value = (obj as any)[field];

        // Relay connection spec present?
        const spec = getRelayOptionsByType(pt || null, field);
        if (spec && value && typeof value === "object") {
          // Resolve key/state
          const parentId = (obj as any)?.id ?? (obj as any)?._id;
          const parentKey = graph.getEntityParentKey(pt!, parentId) || "Query";
          const connKey = buildConnectionKey(parentKey!, field, spec as any, variables);
          const state = graph.ensureConnectionState(connKey);

          // Extract parts
          const edgesArr = readPathValue(value, spec.segs.edges);
          const pageInfoObj = readPathValue(value, spec.segs.pageInfo);
          if (!edgesArr || !pageInfoObj) continue;

          const edgesField = spec.names.edges;
          const pageInfoField = spec.names.pageInfo;

          const isCursorPage =
            (variables as any)?.after != null || (variables as any)?.before != null;

          // Requested "page" size from variables (fallback to payload size once)
          const pageSize =
            typeof (variables as any)?.first === "number"
              ? (variables as any).first
              : (Array.isArray(edgesArr) ? edgesArr.length : 0);

          // Prepare/reuse parent view container
          let viewObj: any = (obj as any)[field];
          const invalid =
            !viewObj ||
            typeof viewObj !== "object" ||
            !Array.isArray((viewObj as any)[edgesField]) ||
            !(viewObj as any)[pageInfoField];

          if (invalid) {
            viewObj = Object.create(null);
            viewObj.__typename = (value as any)?.__typename ?? "Connection";
            (obj as any)[field] = viewObj;
          }
          if (!isReactive(viewObj[edgesField])) viewObj[edgesField] = reactive(viewObj[edgesField] || []);
          if (!isReactive(viewObj[pageInfoField])) viewObj[pageInfoField] = shallowReactive(viewObj[pageInfoField] || {});

          // Merge connection-level meta
          const exclude = new Set([edgesField, spec.paths.pageInfo, "__typename"]);
          if (value && typeof value === "object") {
            const vk = Object.keys(value);
            for (let vi = 0; vi < vk.length; vi++) {
              const k = vk[vi];
              if (!exclude.has(k)) (state.meta as any)[k] = (value as any)[k];
            }
          }

          // ---- CANONICAL WINDOW: update exactly once per bind ----
          if (!state.initialized) {
            state.window = pageSize;  // first bind = one page
          } else if (isCursorPage) {
            state.window = Math.min(state.list.length, (state.window || 0) + pageSize);
          } else {
            state.window = pageSize;  // baseline reset back to one page
          }

          // Keep exactly one canonical view for this connection key
          state.views.clear();

          views.addStrongView(state, {
            edges: viewObj[edgesField],
            pageInfo: viewObj[pageInfoField],
            root: viewObj,
            edgesKey: edgesField,
            pageInfoKey: pageInfoField,
            pinned: false,
            limit: state.window,       // <- single source of truth
          });

          // Sync so UI renders now with the right window
          views.synchronizeConnectionViews(state);

          if (!state.initialized) state.initialized = true;

          // DEBUG
          // eslint-disable-next-line no-console
          console.debug("sdcsc", variables);
          // eslint-disable-next-line no-console
          console.debug("Connection key:", connKey);
          // eslint-disable-next-line no-console
          console.debug("[views]", Array.from(state.views).map(v => v.limit));
        }

        // Traverse deeper
        const v = (obj as any)[field];
        if (Array.isArray(v)) {
          for (let j = 0; j < (v as any[]).length; j++) {
            const x = (v as any[])[j];
            if (x && typeof x === "object") stack.push({ obj: x, parentTypename: pt || null });
          }
        } else if (v && typeof v === "object") {
          stack.push({ obj: v, parentTypename: pt || null });
        }
      }
    }
  };

  /* ───────────────────────────────────────────────────────────────────────────
   * Collect non-Relay entities
   * ────────────────────────────────────────────────────────────────────────── */
  function collectEntities(root: any) {
    const touchedKeys = new Set<EntityKey>();
    const visited = new WeakSet<object>();
    const stack = [root];

    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== "object") continue;
      if (visited.has(current as object)) continue;
      visited.add(current as object);

      const typename = (current as any)[internals.TYPENAME_KEY];

      if (typename) {
        const ek = graph.identify(current);
        if (ek) {
          graph.putEntity(current);
          if (trackNonRelayResults) views.registerEntityView(ek, current);
          touchedKeys.add(ek);
        }
      }

      const keys = Object.keys(current as any);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const value = (current as any)[k];

        if (!value || typeof value !== "object") continue;

        const opts = getRelayOptionsByType(typename || null, k);
        if (opts) {
          const edges = readPathValue(value, opts.segs.edges);
          if (Array.isArray(edges)) {
            const hasPath = opts.hasNodePath;
            const nodeField = opts.names.nodeField;

            for (let j = 0; j < edges.length; j++) {
              const edge = edges[j];
              if (!edge || typeof edge !== "object") continue;

              const node = hasPath ? readPathValue(edge, opts.segs.node) : (edge as any)[nodeField];
              if (!node || typeof node !== "object") continue;

              const key = graph.idOf(node);
              if (!key) continue;

              graph.putEntity(node);
              touchedKeys.add(key);
            }
          }
          continue;
        }

        stack.push(value);
      }
    }

    touchedKeys.forEach((key) => {
      views.markEntityDirty(key);
      views.touchConnectionsForEntityKey(key);
    });
  }

  // SSR features
  const ssr = createSSRFeatures({
    entityStore: graph.entityStore,
    connectionStore: graph.connectionStore,
    operationCache: graph.operationCache,
    ensureConnectionState: graph.getOrCreateConnection,
    linkEntityToConnection: views.linkEntityToConnection,
    shallowReactive,
    registerViewsFromResult,
    resetRuntime: views.resetRuntime,
    applyResolversOnGraph,
    collectEntities,
    materializeResult: views.materializeResult,
  });

  // Build plugin
  const instance = (buildCachebayPlugin(internals, {
    shouldAddTypename,
    isHydrating: ssr.isHydrating,
    hydrateOperationTicket: ssr.hydrateOperationTicket,
    applyResolversOnGraph,
    registerViewsFromResult,
    collectEntities,
  }) as unknown) as CachebayInstance;

  // Create fragments
  const fragments = createFragments({}, {
    entityStore: graph.entityStore,
    identify: graph.identify,
    resolveEntityKey: graph.resolveEntityKey,
    materializeEntity: graph.materializeEntity,
    bumpEntitiesTick: graph.bumpEntitiesTick,
    isInterfaceType: graph.isInterfaceType,
    getInterfaceTypes: graph.getInterfaceTypes,
    proxyForEntityKey: views.proxyForEntityKey,
    markEntityDirty: views.markEntityDirty,
    touchConnectionsForEntityKey: views.touchConnectionsForEntityKey,
  });

  // Create optimistic features
  const modifyOptimistic = createModifyOptimistic({
    entityStore: graph.entityStore,
    connectionStore: graph.connectionStore,
    materializeEntity: graph.materializeEntity,
    bumpEntitiesTick: graph.bumpEntitiesTick,
    touchConnectionsForEntityKey: views.touchConnectionsForEntityKey,
    markEntityDirty: views.markEntityDirty,
  });

  // Create debug/inspect features
  const inspect = createInspect({
    entityStore: graph.entityStore,
    connectionStore: graph.connectionStore,
    operationCache: graph.operationStore,
    ensureConnectionState: graph.ensureReactiveConnection,
    materializeEntity: graph.materializeEntity,
    areEntityKeysEqual: graph.areEntityKeysEqual,
    isInterfaceType: graph.isInterfaceType,
    getInterfaceTypes: graph.getInterfaceTypes,
    stableIdentityExcluding,
  });

  // Attach additional methods to instance
  (instance as any).identify = fragments.identify;
  (instance as any).readFragment = fragments.readFragment;
  (instance as any).hasFragment = fragments.hasFragment;
  (instance as any).writeFragment = fragments.writeFragment;
  (instance as any).modifyOptimistic = modifyOptimistic;
  (instance as any).inspect = inspect;

  (instance as any).listEntityKeys = (selector: string | string[]) => {
    const patterns = Array.isArray(selector) ? selector : [selector];
    const keys = new Set<string>();
    for (const [key] of Array.from(graph.entityStore)) {
      for (const pattern of patterns) {
        if (key.startsWith(pattern)) {
          keys.add(key);
          break;
        }
      }
    }
    return Array.from(keys);
  };

  (instance as any).listEntities = (selector: string | string[], materialized = true) => {
    const keys = (instance as any).listEntityKeys(selector) as string[];
    if (!materialized) {
      return keys.map((k) => {
        const resolved = graph.resolveEntityKey(k) || k;
        return graph.entityStore.get(resolved);
      });
    }
    return keys.map((k) => graph.materializeEntity(k));
  };

  (instance as any).__entitiesTick = graph.entitiesTick;

  (instance as any).gc = {
    connections(predicate?: (key: string, state: ConnectionState) => boolean) {
      views.gcConnections(predicate);
    },
  };

  return instance;
}
