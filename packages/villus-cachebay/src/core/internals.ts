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
import { createFragments, type FragmentsDependencies } from "./fragments";
import { createViews, type ViewsDependencies } from "./views";
import { createGraph, type GraphAPI } from "./graph";
import { createResolvers, type ResolversDependencies, applyResolversOnGraph as applyResolversOnGraphImpl, getRelayOptionsByType, setRelayOptionsByType, relayResolverIndex, relayResolverIndexByType, relay } from "./resolvers";

/* ─────────────────────────────────────────────────────────────────────────────
 * Public instance type
 * ──────────────────────────────────────────────────────────────────────────── */
export type CachebayInstance = ClientPlugin & {
  // SSR
  dehydrate: () => any;
  hydrate: (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => void;

  // Identity
  identify: (obj: any) => string | null;

  // Fragment APIs
  readFragment: (
    refOrKey: string | { __typename: string; id?: any },
    opts?: { materialized?: boolean }
  ) => any;

  readFragments: (
    pattern: string | string[],
    opts?: { materialized?: boolean }
  ) => any[];

  hasFragment: (
    refOrKey: string | { __typename: string; id?: any }
  ) => boolean;

  writeFragment: (obj: any) => {
    commit(): void;
    revert(): void;
  };

  // Optimistic
  modifyOptimistic: (
    build: (c: {
      patch: (entity: any, policy?: "merge" | "replace") => void;
      delete: (key: string) => void;
      connections: (args: {
        parent: "Query" | { __typename: string; id?: any } | string;
        field: string;
        variables?: Record<string, any>;
      }) => Readonly<[
        {
          addNode: (
            node: any,
            opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }
          ) => void;
          removeNode: (ref: { __typename: string; id?: any }) => void;
          patch: (pi: Record<string, any>) => void;
          key: string;
        }
      ]>;
    }) => void
  ) => {
    commit(): void;
    revert(): void;
  };

  // Introspection
  inspect: {
    entities: (typename?: string) => string[];
    entity: (key: string) => any;
    connections: () => string[];
    connection: (
      parent: "Query" | { __typename: string; id?: any },
      field: string,
      variables?: Record<string, any>
    ) => any;
    operations?: () => Array<{ key: string; variables: Record<string, any>; data: any }>;
  };

  // Graph watchers (entity-level)
  registerEntityWatcher: (run: () => void) => number;
  unregisterEntityWatcher: (id: number) => void;
  trackEntity: (watcherId: number, entityKey: string) => void;

  // Type watchers (wildcard/membership-level)
  registerTypeWatcher: (typename: string, run: () => void) => number;
  unregisterTypeWatcher: (typename: string, id: number) => void;

  // Optional GC helpers
  gc?: { connections: (predicate?: (key: string, state: ConnectionState) => boolean) => void };

  // Vue plugin
  install: (app: App) => void;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */
export function createCache(options: CachebayOptions = {}): CachebayInstance {
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
  } satisfies ViewsDependencies);

  /* ───────────────────────────────────────────────────────────────────────────
   * Resolvers preparation
   * ────────────────────────────────────────────────────────────────────────── */

  // Prepare resolvers
  const resolvers = createResolvers({ resolvers: options.resolvers }, {
    graph,
    views,
  } satisfies ResolversDependencies);

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
  const fragments = createFragments({}, { graph, views } satisfies FragmentsDependencies);

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

  (instance as any).install = (app: App) => {
    provideCachebay(app, instance);
  };

  // Attach additional methods to instance
  (instance as any).identify = fragments.identify;
  (instance as any).readFragment = fragments.readFragment;
  (instance as any).readFragments = fragments.readFragments;
  (instance as any).hasFragment = fragments.hasFragment;
  (instance as any).writeFragment = fragments.writeFragment;
  (instance as any).modifyOptimistic = modifyOptimistic;
  (instance as any).inspect = inspect;
  (instance as any).registerEntityWatcher = graph.registerEntityWatcher;
  (instance as any).unregisterEntityWatcher = graph.unregisterEntityWatcher;
  (instance as any).trackEntity = graph.trackEntity;
  (instance as any).registerTypeWatcher = graph.registerTypeWatcher;
  (instance as any).unregisterTypeWatcher = graph.unregisterTypeWatcher;
  (instance as any).notifyTypeChanged = graph.notifyTypeChanged;

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

  // Attach internals for testing/debugging
  (instance as any).__internals = {
    graph,
    views,
    ssr,
    resolvers,
    fragments,
  };

  return instance;
}
