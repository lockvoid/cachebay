// src/core/internals.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin } from "villus";

import { createPlugin, provideCachebay } from "./plugin";
import { createGraph, type GraphAPI } from "./graph";
import { createSelections } from "./selections";
import { createResolvers } from "./resolvers";
import { createFragments } from "./fragments";
import { createSSR } from "../features/ssr";
import { createModifyOptimistic } from "../features/optimistic";
import { createInspect } from "../features/inspect";

export type CachebayInstance = ClientPlugin & {
  // SSR
  dehydrate: () => any;
  hydrate: (
    input: any | ((hydrate: (snapshot: any) => void) => void),
    opts?: { materialize?: boolean; rabbit?: boolean }
  ) => void;

  // Identity
  identify: (obj: any) => string | null;

  // Fragments
  readFragment: (args: { id: string; fragment: string; variables?: Record<string, any> }) => any;
  writeFragment: (args: { id: string; fragment: string; data: any; variables?: Record<string, any> }) => void;

  // Optimistic (selection-first)
  modifyOptimistic: ReturnType<typeof createModifyOptimistic>;

  // Debug
  inspect: ReturnType<typeof createInspect>;

  // Vue plugin
  install: (app: App) => void;

  // internals for tests/debug
  __internals: {
    graph: GraphAPI;
    selections: ReturnType<typeof createSelections>;
    resolvers: ReturnType<typeof createResolvers>;
    fragments: ReturnType<typeof createFragments>;
    ssr: ReturnType<typeof createSSR>;
    inspect: ReturnType<typeof createInspect>;
  };
};

export type CachebayOptions = {
  addTypename?: boolean;
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
  resolvers?: Record<string, Record<string, any>>;
};

export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Graph (selection-first)
  const graph = createGraph({
    reactiveMode: "shallow",
    keys: options.keys || {},
    interfaces: options.interfaces || {},
  });

  // Selections helpers (stable keys, heuristic compiler)
  const selections = createSelections({ dependencies: { graph } });

  // Resolvers (field resolvers over plain objects / materialized trees)
  const resolvers = createResolvers({ resolvers: options.resolvers }, { graph });

  // Fragments (GraphQL fragment read/write using graph + selections)
  const fragments = createFragments({ dependencies: { graph, selections } });

  // SSR for entities + selections
  const ssr = createSSR({ graph, resolvers });

  // Optimistic (selection skeleton operations)
  const modifyOptimistic = createModifyOptimistic({ graph });

  // Plugin (cache policies & subscriptions)
  const plugin = createPlugin(
    { addTypename: options.addTypename ?? true },
    { graph, selections, resolvers, ssr }
  ) as unknown as CachebayInstance;

  // Vue install
  (plugin as any).install = (app: App) => {
    provideCachebay(app, plugin);
  };

  // Public identity
  (plugin as any).identify = graph.identify;

  // Fragments API
  (plugin as any).readFragment = fragments.readFragment;
  (plugin as any).writeFragment = fragments.writeFragment;

  // Optimistic API
  (plugin as any).modifyOptimistic = modifyOptimistic;

  // Inspect (debug)
  const inspect = createInspect({ graph });
  (plugin as any).inspect = inspect;

  // SSR API
  (plugin as any).dehydrate = ssr.dehydrate;
  (plugin as any).hydrate = ssr.hydrate;

  // Internals for tests
  (plugin as any).__internals = {
    graph,
    selections,
    resolvers,
    fragments,
    ssr,
    inspect,
  };

  return plugin as CachebayInstance;
}
