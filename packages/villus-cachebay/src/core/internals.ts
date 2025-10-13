import { createInspect } from "../features/inspect";
import { createSSR } from "../features/ssr";
import { createCanonical } from "./canonical";
import { createDocuments } from "./documents";
import { createFragments } from "./fragments";
import { createGraph } from "./graph";
import { createOptimistic } from "./optimistic";
import { createPlanner } from "./planner";
import { createPlugin, provideCachebay } from "./plugin";
import { createViews } from "./views";
import type { CachebayOptions } from "./types";
import type { ClientPlugin } from "villus";
import type { App } from "vue";

/**
 * Main Cachebay instance type
 * Extends Villus ClientPlugin with cache-specific methods
 */
export type CachebayInstance = ClientPlugin & {
  /**
   * Serialize cache state for SSR
   * @returns Serializable snapshot of the cache
   */
  dehydrate: () => Record<string, unknown>;

  /**
   * Restore cache state from SSR snapshot
   * @param input - Snapshot object or function that emits snapshot
   */
  hydrate: (input: Record<string, unknown> | ((emit: (snapshot: Record<string, unknown>) => void) => void)) => void;

  /**
   * Generate stable cache key for an object
   * @param obj - GraphQL object with __typename and id
   * @returns Cache key string (typename:id) or null if not identifiable
   */
  identify: (obj: Record<string, unknown>) => string | null;

  /**
   * Read fragment data from cache reactively
   * @template TData - Expected fragment data type
   * @param args - Fragment read arguments
   * @returns Reactive fragment data or undefined
   */
  readFragment: <TData = unknown>(args: {
    id: string;
    fragment: unknown;
    fragmentName?: string;
    variables?: Record<string, unknown>;
  }) => TData | undefined;

  /**
   * Write fragment data into cache
   * @template TData - Fragment data type
   * @param args - Fragment write arguments
   */
  writeFragment: <TData = unknown>(args: {
    id: string;
    fragment: unknown;
    fragmentName?: string;
    data: TData;
    variables?: Record<string, unknown>;
  }) => void;

  /**
   * Apply optimistic updates with transaction support
   */
  modifyOptimistic: ReturnType<typeof createOptimistic>["modifyOptimistic"];

  /**
   * Debug inspection API for cache internals
   */
  inspect: ReturnType<typeof createInspect>;

  /**
   * Vue plugin install method
   * @param app - Vue application instance
   */
  install: (app: App) => void;

  /**
   * Internal APIs for testing and debugging
   * @internal
   */
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

/**
 * Create a new Cachebay cache instance
 * @param options - Configuration options for the cache
 * @returns Configured cache instance with Villus plugin interface
 */
export function createCache(options: CachebayOptions = {}): CachebayInstance {
  // Core
  const graph = createGraph({ keys: options.keys || {}, interfaces: options.interfaces || {} });
  const optimistic = createOptimistic({ graph });
  const ssr = createSSR({ hydrationTimeout: options.hydrationTimeout }, { graph });
  const views = createViews({ graph });
  const planner = createPlanner();
  const canonical = createCanonical({ graph, optimistic });
  const documents = createDocuments({ graph, views, planner, canonical });
  const fragments = createFragments({ graph, views, planner });

  // Features
  const inspect = createInspect({ graph, optimistic });

  // Villus plugin (ClientPlugin)
  const plugin = createPlugin({ suspensionTimeout: options.suspensionTimeout }, { graph, planner, documents, ssr });

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
