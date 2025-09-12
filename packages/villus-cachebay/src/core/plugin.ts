// src/core/plugin.ts
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import { ensureDocumentHasTypenameSmart, getOperationKey } from "./utils";

type PluginOptions = { addTypename?: boolean };

type PluginDependencies = {
  graph: {
    operationStore: Map<string, any>;
    putOperation: (key: string, payload: { data: any; variables: Record<string, any> }) => void;
    lookupOperation: (op: any) => { key: string; entry: { data: any; variables: any } } | null;
  };
  views: {
    createViewSession: () => {
      wireConnections: (root: any, vars: Record<string, any>) => void;
      destroy: () => void;
    };
  };
  resolvers: {
    // Used only for *network* results to normalize into the graph.
    applyResolversOnGraph: (root: any, vars: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
  ssr?: {
    hydrateOperationTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

function shallowClone<T>(root: T): T {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? (root.slice() as any) : ({ ...(root as any) } as any);
}

/** Take a plain snapshot of the wired payload (remove reactivity/proxies). */
function snapshotForOpCache<T = any>(wired: T): T {
  // Payload is JSON-safe (edges/node/pageInfo), so this is sufficient and fast.
  return JSON.parse(JSON.stringify(wired));
}

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

export function buildCachebayPlugin(
  options: PluginOptions,
  deps: PluginDependencies
): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, views, resolvers, ssr } = deps;

  // one session per mounted useQuery (operation.key)
  const sessionByOp = new Map<number, { wire: (root: any, vars: Record<string, any>) => void; destroy: () => void }>();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    let session = sessionByOp.get(operation.key);
    if (!session) {
      const s = views.createViewSession();
      session = { wire: s.wireConnections, destroy: s.destroy };
      sessionByOp.set(operation.key, session);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy = (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // ─────────────────────────────────────────────────────────────────────
    // CACHE-ONLY
    // ─────────────────────────────────────────────────────────────────────
    if (policy === "cache-only") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const normalized = shallowClone(hit.entry.data);
        (normalized as any).__fromCache = true;     // hint for view sizing
        session.wire(normalized, vars);
        delete (normalized as any).__fromCache;     // keep user payload clean
        return publish({ data: normalized }, true);
      }
      const err = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return publish({ error: err }, true);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CACHE-FIRST
    // ─────────────────────────────────────────────────────────────────────
    if (policy === "cache-first") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const normalized = shallowClone(hit.entry.data);
        (normalized as any).__fromCache = true;
        session.wire(normalized, vars);
        delete (normalized as any).__fromCache;
        return publish({ data: normalized }, true);
      }
      // miss → fallthrough to network
    }

    // ─────────────────────────────────────────────────────────────────────
    // CACHE-AND-NETWORK
    // ─────────────────────────────────────────────────────────────────────
    if (policy === "cache-and-network") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const normalized = shallowClone(hit.entry.data);

        //console.log('Cache hit', normalized);

        (normalized as any).__fromCache = true;
        // No resolvers here: we *trust* the stored normalized snapshot.
        session.wire(normalized, vars);
        delete (normalized as any).__fromCache;

        // SSR gating (optional)
        const hadTicket = !!ssr?.hydrateOperationTicket?.has(hit.key);
        if (hadTicket) ssr!.hydrateOperationTicket!.delete(hit.key);

        // Non-terminal cached publish; network will arrive later.
        publish({ data: normalized }, false);
      }
      // network result handled below
    }

    // ─────────────────────────────────────────────────────────────────────
    // NETWORK RESULT PATH
    // ─────────────────────────────────────────────────────────────────────
    // Pin the request signature now (avoid using live ctx.operation later).
    const sentQuery = operation.query;
    const sentVars = operation.variables || {};
    const sentKey = getOperationKey({ query: sentQuery, variables: sentVars } as any);

    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      // 1) Normalize into the graph (relay resolver merges into canonical lists)
      const payload = shallowClone(r.data);
      resolvers.applyResolversOnGraph(payload, sentVars, { stale: false });

      // 2) Wire views for *this* op (so edges show the correct window)
      session!.wire(payload, sentVars);

      // 3) Store the *normalized snapshot for this operation signature*
      //    (edges limited to the window that was just wired for this op)
      const opSnapshot = snapshotForOpCache(payload);
      graph.putOperation(sentKey, { data: opSnapshot, variables: sentVars });

      // 4) Publish terminal frame
      return originalUseResult({ data: payload }, true);
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
