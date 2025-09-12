import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import {
  ensureDocumentHasTypenameSmart,
  getOperationKey,
} from "./utils";

type PluginOptions = {
  addTypename?: boolean;
};

type PluginDependencies = {
  graph: {
    operationStore: Map<string, any>;
    putOperation: (key: string, payload: { data: any; variables: Record<string, any> }) => void;
    lookupOperation: (op: any) => { key: string; entry: { data: any; variables: any } } | null;
    getEntityParentKey: (typename: string, id?: any) => string | null;
    ensureConnection: (key: string) => any;
    identify?: (obj: any) => string | null;
  };
  views: {
    createViewSession: () => { wireConnections: (root: any, vars: Record<string, any>) => void; destroy: () => void };
  };
  resolvers: {
    applyResolversOnGraph: (root: any, vars: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
  ssr?: {
    hydrateOperationTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

// Shallow root clone; the plugin returns the same data shape but with
// connection fields replaced by the view’s reactive containers.
function shallowClone(root: any) {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
}

export const CACHEBAY_KEY = Symbol("CACHEBAY_KEY");

export function buildCachebayPlugin(
  options: PluginOptions,
  deps: PluginDependencies,
): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, views, resolvers, ssr } = deps;

  // Per-operation (per mounted useQuery) session: operation.key -> session
  const sessionByOp = new Map<number, { wire: (root: any, vars: any) => void; destroy: () => void }>();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    // Create/reuse a per-op view session
    let session = sessionByOp.get(operation.key);
    if (!session) {
      const s = views.createViewSession();
      session = { wire: s.wireConnections, destroy: s.destroy };
      sessionByOp.set(operation.key, session);
    }

    // Publish helper
    const publish = (payload: OperationResult, term: boolean) => ctx.useResult(payload, term);

    // Cache policies
    const policy = (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // CACHE-ONLY
    if (policy === "cache-only") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        session.wire(data, vars);
        return publish({ data }, true);
      } else {
        const error = new CombinedError({
          networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
          graphqlErrors: [],
          response: undefined,
        });
        return publish({ error }, true);
      }
    }

    // CACHE-FIRST
    if (policy === "cache-first") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        session.wire(data, vars);
        return publish({ data }, true);
      }
      // miss → fallthrough to network
    }

    // CACHE-AND-NETWORK
    if (policy === "cache-and-network") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });

        const key = hit.key;
        const hadTicket = !!ssr?.hydrateOperationTicket?.has(key);
        const hydrating = !!ssr?.isHydrating?.();
        if (hadTicket) ssr!.hydrateOperationTicket!.delete(key);

        // Wire views and publish non-terminal cached frame
        session.wire(data, vars);
        publish({ data }, false);
      }
      // transport will deliver the network frame, handled below
    }

    // NETWORK RESULT PATH
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      const vars = operation.variables || {};
      const data = shallowClone(r.data);

      // Apply write-time resolvers (relay merges into ConnectionState)
      resolvers.applyResolversOnGraph(data, vars, { stale: false });

      // Store post-resolver raw into op-cache
      const key = getOperationKey(operation);
      graph.putOperation(key, { data, variables: vars });

      // Wire views on this instance and publish terminal
      session!.wire(data, vars);
      return originalUseResult({ data }, true);
    };
  };

  return plugin;
}

export function provideCachebay(app: App, instance: any) {
  const api: any = {
    readFragment: instance.readFragment,
    readFragments: instance.readFragments,      // make sure it’s here too
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    hasFragment: (instance as any).hasFragment,
    listEntityKeys: (instance as any).listEntityKeys,
    listEntities: (instance as any).listEntities,
    inspect: (instance as any).inspect,

    // NEW: watcher API used by useFragment/useFragments
    registerWatcher: instance.registerWatcher,
    unregisterWatcher: instance.unregisterWatcher,
    trackEntityDependency: instance.trackEntityDependency,
  };
  app.provide(CACHEBAY_KEY, api);
}
