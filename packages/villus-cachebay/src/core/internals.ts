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
    get: (key: string) => any;
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
export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Config
  const writePolicy = options.writePolicy || "replace";
  const keys =
    typeof options.keys === "function" ? options.keys() : options.keys ? options.keys : ({} as NonNullable<KeysConfig>);
  const addTypename = options.addTypename ?? true;

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
  });

  /* ───────────────────────────────────────────────────────────────────────────
   * Resolvers preparation
   * ────────────────────────────────────────────────────────────────────────── */

  // Prepare resolvers
  const boundResolvers = createResolvers({ resolvers: options.resolvers as ResolversDict }, {
    graph,
    views,
    relay,
    relayResolverIndex,
    relayResolverIndexByType,
    getRelayOptionsByType,
    setRelayOptionsByType,
  });

  const { applyResolversOnGraph } = boundResolvers;


  // SSR features
  const ssr = createSSR({
    graph,
    views,
    resolvers: boundResolvers,
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
      resolvers: boundResolvers,
    }
  ) as unknown) as CachebayInstance;

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
  (instance as any).readFragments = fragments.readFragments;
  (instance as any).hasFragment = fragments.hasFragment;
  (instance as any).writeFragment = fragments.writeFragment;
  (instance as any).modifyOptimistic = modifyOptimistic;
  (instance as any).inspect = inspect;
  (instance as any).listEntityKeys = graph.getEntityKeys;
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
