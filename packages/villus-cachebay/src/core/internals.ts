/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin } from "villus";

import { createPlugin, provideCachebay } from "./plugin";
import { createGraph } from "./graph";
import { createViews } from "./views";
import { createPlanner } from "./planner";
import { createSessions } from "./sessions";
import { createDocuments } from "./documents";
import { createFragments } from "./fragments";

import { createSSR } from "@/src/features/ssr";
import { createModifyOptimistic } from "@/src/features/optimistic";
import { createInspect } from "@/src/features/inspect";

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
    sessions: ReturnType<typeof createSessions>;
    documents: ReturnType<typeof createDocuments>;
    fragments: ReturnType<typeof createFragments>;
    ssr: ReturnType<typeof createSSR>;
    inspect: ReturnType<typeof createInspect>;
  };
};

export type CachebayOptions = {
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
};

export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Core
  const graph = createGraph({ keys: options.keys || {}, interfaces: options.interfaces || {} });
  const views = createViews({ graph });
  const planner = createPlanner(); // @connection/@paginate driven; configless by default
  const sessions = createSessions({ graph, views });
  const documents = createDocuments({ graph, views, planner });
  const fragments = createFragments({}, { graph, views });

  // Features
  const ssr = createSSR({ graph });
  const modifyOptimistic = createModifyOptimistic({ graph });
  const inspect = createInspect({ graph });

  // Villus plugin (ClientPlugin)
  const plugin = createPlugin({}, { graph, planner, documents, sessions });

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
  (plugin as any).inspect = inspect;

  // SSR API
  (plugin as any).dehydrate = ssr.dehydrate;
  (plugin as any).hydrate = ssr.hydrate;

  // Internals for tests
  (plugin as any).__internals = {
    graph,
    views,
    planner,
    sessions,
    documents,
    fragments,
    ssr,
    inspect,
  };

  return plugin as CachebayInstance;
}
