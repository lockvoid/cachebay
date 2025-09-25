/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin } from "villus";

import { createPlugin, provideCachebay } from "./plugin";
import { createGraph } from "./graph";
import { createViews } from "./views";
import { createPlanner } from "./planner";
import { createCanonical } from "./canonical";
import { createDocuments } from "./documents";
import { createFragments } from "./fragments";

import { createSSR } from "../features/ssr";
import { createOptimistic } from "./optimistic";
import { createInspect } from "../features/inspect";

export type CachebayInstance = ClientPlugin & {
  // SSR
  dehydrate: () => any;
  hydrate: (input: any | ((emit: (snapshot: any) => void) => void)) => void;

  // Identity
  identify: (obj: any) => string | null;

  // Fragments
  readFragment: (args: { id: string; fragment: any; variables?: Record<string, any> }) => any;
  writeFragment: (args: { id: string; fragment: any; data: any; variables?: Record<string, any> }) => void;

  // Optimistic
  modifyOptimistic: ReturnType<typeof createModifyOptimistic>;

  // Debug
  inspect: ReturnType<typeof createInspect>;

  // Vue plugin
  install: (app: App) => void;

  // internals for tests/debug
  __internals: {
    graph: ReturnType<typeof createGraph>;
    views: ReturnType<typeof createViews>;
    planner: ReturnType<typeof createPlanner>;
    canonical: ReturnType<typeof createCanonical>;
    documents: ReturnType<typeof createDocuments>;
    fragments: ReturnType<typeof createFragments>;
    ssr: ReturnType<typeof createSSR>;
    inspect: ReturnType<typeof createInspect>;
  };
};

export type CachebayOptions = {
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
  hydrationTimeout?: number;
};

export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Core
  const graph = createGraph({ keys: options.keys || {}, interfaces: options.interfaces || {} });
  const optimistic = createOptimistic({ graph });
  const ssr = createSSR({ hydrationTimeout: options.hydrationTimeout }, { graph });
  const views = createViews({ graph });
  const planner = createPlanner();
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, views, planner, canonical });
  const fragments = createFragments({}, { graph, views, planner });

  // Features
  const inspect = createInspect({ graph });

  // Villus plugin (ClientPlugin)
  const plugin = createPlugin({ graph, planner, documents, ssr });

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
  (plugin as any).modifyOptimistic = optimistic.modifyOptimistic;

  // Inspect (debug)
  (plugin as any).inspect = inspect;

  // SSR API
  (plugin as any).dehydrate = ssr.dehydrate;
  (plugin as any).hydrate = ssr.hydrate;

  // Internals for tests
  (plugin as any).__internals = {
    graph,
    optimistic,
    views,
    planner,
    canonical,
    documents,
    fragments,
    ssr,
    inspect,
  };

  return plugin as CachebayInstance;
}
