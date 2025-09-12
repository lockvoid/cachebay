// src/core/plugin.ts
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import { ensureDocumentHasTypenameSmart, getOperationKey } from "./utils";

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
    createViewSession: () => {
      wireConnections: (root: any, vars: Record<string, any>) => void;
      destroy: () => void;
    };
  };
  resolvers: {
    // IMPORTANT: runs BEFORE views wiring; merges relay pages into connection state
    applyResolversOnGraph: (root: any, vars: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
  ssr?: {
    hydrateOperationTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

// cheap shallow clone so we don't mutate op-cache payloads when wiring containers
function shallowClone<T>(root: T): T {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? (root.slice() as any) : ({ ...(root as any) } as any);
}

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

export function buildCachebayPlugin(
  options: PluginOptions,
  deps: PluginDependencies
): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, views, resolvers, ssr } = deps;

  // one view-session per mounted useQuery (ctx.operation.key)
  const sessionByOp = new Map<
    number,
    { wire: (root: any, vars: Record<string, any>) => void; destroy: () => void }
  >();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    // create/reuse session
    let session = sessionByOp.get(operation.key);
    if (!session) {
      const s = views.createViewSession();
      session = { wire: s.wireConnections, destroy: s.destroy };
      sessionByOp.set(operation.key, session);
    }

    const policy =
      (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // --------------------------- CACHE-ONLY ---------------------------
    if (policy === "cache-only") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        session.wire(data, vars);
        return ctx.useResult({ data }, true);
      }
      const err = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return ctx.useResult({ error: err }, true);
    }

    // -------------------------- CACHE-FIRST --------------------------
    if (policy === "cache-first") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        session.wire(data, vars);
        return ctx.useResult({ data }, true);
      }
      // miss -> let network continue, handled in overridden useResult
    }

    // ---------------------- CACHE-AND-NETWORK ------------------------
    if (policy === "cache-and-network") {
      const hit = graph.lookupOperation(operation);

      console.log('Check', JSON.stringify(operation));
      if (hit) {
        console.log("Cache hit!!!!", hit);
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        console.dir("CCHED DATA", graph.operationStore)
        console.log('///')
        resolvers.applyResolversOnGraph(data, vars, { stale: false });

        // SSR hydrate ticket gate (optional): still ctx.useResult as non-terminal
        const keyFromHit = hit.key;
        const hadTicket = !!ssr?.hydrateOperationTicket?.has(keyFromHit);
        if (hadTicket) ssr!.hydrateOperationTicket!.delete(keyFromHit);

        // CRITICAL: do NOT write op-cache on the cached path
        // (writing here can poison cursor-keys with baseline pages)

        session.wire(data, vars);
        ctx.useResult({ data }, false);
      }
      // network frame will be handled below
    }

    // ------------------------ NETWORK RESULT -------------------------
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      // keep op open for non-terminal placeholders
      if (!hasData && !hasError) return originalUseResult(incoming, false);

      if (hasError) return originalUseResult(incoming, true);

      // winner (or only) – write-time transforms first
      const vars = operation.variables || {};
      const data = shallowClone(r.data);

      resolvers.applyResolversOnGraph(data, vars, { stale: false });

      // Store post-resolver data under the exact op key
      const opKey = getOperationKey(operation);
      graph.putOperation(opKey, { data, variables: vars });

      // Wire this useQuery instance and ctx.useResult terminally
      session!.wire(data, vars);
      return originalUseResult({ data }, true);
    };
  };

  return plugin;
}

export function provideCachebay(app: App, instance: any) {
  const api: any = {
    readFragment: instance.readFragment,
    readFragments: instance.readFragments,
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    hasFragment: (instance as any).hasFragment,
    listEntityKeys: (instance as any).listEntityKeys,
    listEntities: (instance as any).listEntities,
    inspect: (instance as any).inspect,
    registerEntityWatcher: instance.registerEntityWatcher,
    unregisterEntityWatcher: instance.unregisterEntityWatcher,
    trackEntity: instance.trackEntity,
    registerTypeWatcher: instance.registerTypeWatcher,
    unregisterTypeWatcher: instance.unregisterTypeWatcher,
  };
  app.provide(CACHEBAY_KEY, api);
}
