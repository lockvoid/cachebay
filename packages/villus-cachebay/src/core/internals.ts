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
import { createSSR } from "../features/ssr";
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
    trackNonRelayResults,
  }, {
    graph,
    typenameKey: "__typename",
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
    operationCache: graph.operationStore,
    putEntity: graph.putEntity,
    materializeEntity: graph.materializeEntity,
    ensureConnectionState: graph.ensureReactiveConnection,
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


  // SSR features
  const ssr = createSSR({
    graph,
    views,
    shallowReactive,
    applyResolversOnGraph,
  });

  // Build plugin
  const instance = (buildCachebayPlugin(internals, {
    shouldAddTypename,
    isHydrating: ssr.isHydrating,
    hydrateOperationTicket: ssr.hydrateOperationTicket,
    applyResolversOnGraph,
    registerViewsFromResult: views.registerViewsFromResult,
    collectEntities: views.collectEntities,
    opCacheMax: options.opCacheMax || 25,
  }) as unknown) as CachebayInstance;

  // Create fragments
  const fragments = createFragments({}, { graph, views });

  // Create optimistic features
  const modifyOptimistic = createModifyOptimistic({
    graph,
    views,
    getRelayOptionsByType,
  });

  // Create debug/inspect features
  const inspect = createInspect({
    graph,
    views,
  });

  // Attach additional methods to instance
  (instance as any).identify = fragments.identify;
  (instance as any).readFragment = fragments.readFragment;
  (instance as any).hasFragment = fragments.hasFragment;
  (instance as any).writeFragment = fragments.writeFragment;
  (instance as any).modifyOptimistic = modifyOptimistic;
  (instance as any).inspect = inspect;

  (instance as any).listEntityKeys = graph.getEntityKeys;
  (instance as any).listEntities = (selector: string | string[], materialized = true) => {
    return materialized ? graph.materializeEntities(selector) : graph.getEntities(selector);
  };

  (instance as any).__entitiesTick = graph.entitiesTick;

  (instance as any).gc = {
    connections(predicate?: (key: string, state: ConnectionState) => boolean) {
      views.gcConnections(predicate);
    },
  };

  // Attach SSR methods
  (instance as any).dehydrate = ssr.dehydrate;
  (instance as any).hydrate = ssr.hydrate;

  return instance;
}
