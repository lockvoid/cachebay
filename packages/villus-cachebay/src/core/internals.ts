// internals.ts - entry point

import {
  reactive,
  shallowReactive,
  isReactive,
  ref,
  type App,
} from "vue";
import type { ClientPlugin } from "villus";

import { buildCachebayPlugin, provideCachebay } from "./plugin";
import { createModifyOptimistic } from "../features/optimistic";
import { createSSR } from "../features/ssr";
import { createInspect } from "../features/inspect";

import type {
  CachebayOptions,
  WritePolicy,
  ReactiveMode,
  InterfacesConfig,
  KeysConfig,
  ResolversDict,
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
  applyResolversOnGraph as applyResolversOnGraphImpl,
  getRelayOptionsByType,
  setRelayOptionsByType,
  relayResolverIndex,
  relayResolverIndexByType,
  relay,
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
    entity: (key: string) => any;
    connections: () => string[];
    connection: (
      parent: "Query" | { __typename: string; id?: any; _id?: any },
      field: string,
      variables?: Record<string, any>,
    ) => any;
    operations?: () => Array<{ key: string; variables: Record<string, any>; data: any }>;
  };

  readFragments: (pattern: string | string[], opts?: { materialized?: boolean }) => any[];
  __entitiesTick: ReturnType<typeof ref<number>>;

  gc?: { connections: (predicate?: (key: string, state: ConnectionState) => boolean) => void };

  install: (app: App) => void;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */
export function createCache(options: CachebayOptions = {}) {
  // Config
  const addTypename = options.addTypename ?? true;

  const trackNonRelayResults = options.trackNonRelayResults !== false;

  // Build raw graph (stores + helpers)
  const graph = createGraph({
    writePolicy: options.writePolicy || "replace",
    reactiveMode: options.reactiveMode || "shallow",
    interfaces: options.interfaces || {},
    keys: options.keys || {},
  });

  // Views (entity/connection views & proxy registration)
  const views = createViews({
    trackNonRelayResults,
  }, {
    graph,
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * Resolvers preparation
   * ────────────────────────────────────────────────────────────────────────── */

  // Prepare resolvers
  const resolvers = createResolvers({ resolvers: options.resolvers }, {
    graph,
    views,
  });

  // SSR features
  const ssr = createSSR({
    graph,
    views,
    resolvers,
  });

  // Build plugin
  const instance = (buildCachebayPlugin(
    {
      addTypename,
    },
    {
      graph,
      views,
      ssr,
      resolvers,
    }
  ) as unknown) as CachebayInstance;

  // Create fragments
  const fragments = createFragments({}, { graph, views });

  // Create optimistic features
  const modifyOptimistic = createModifyOptimistic({
    graph,
    views,
    resolvers,
  });

  // Create debug/inspect features
  const inspect = createInspect({
    graph,
    views,
  });

  // Attach additional methods to instance
  (instance as any).identify = fragments.identify;
  (instance as any).readFragment = fragments.readFragment;
  (instance as any).readFragments = fragments.readFragments;
  (instance as any).hasFragment = fragments.hasFragment;
  (instance as any).writeFragment = fragments.writeFragment;
  (instance as any).modifyOptimistic = modifyOptimistic;
  (instance as any).inspect = inspect;

  (instance as any).gc = {
    connections(predicate?: (key: string, state: ConnectionState) => boolean) {
      views.gcConnections(predicate);
    },
  };

  // Attach cache instance methods
  (instance as any).__entitiesTick = graph.entitiesTick;

  // Attach SSR methods
  (instance as any).dehydrate = ssr.dehydrate;
  (instance as any).hydrate = ssr.hydrate;

  return instance;
}
