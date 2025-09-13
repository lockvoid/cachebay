// src/core/plugin.ts
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import { ensureDocumentHasTypenames, getOperationKey } from "./utils";

type PluginOptions = { addTypename?: boolean };

type CachebayCtx = {
  viewKey?: string;
  paginationMode?: "auto" | "append" | "prepend" | "replace";
};

type PluginDependencies = {
  graph: {
    operationStore: Map<string, any>;
    putOperation: (key: string, payload: { data: any; variables: Record<string, any> }) => void;
    lookupOperation: (op: any) => { key: string; entry: { data: any; variables: any } } | null;
  };
  views: {
    createViewSession: () => {
      // now accepts optional cachebay options (viewKey/paginationMode)
      wireConnections: (root: any, vars: Record<string, any>, opts?: CachebayCtx) => void;
      destroy: () => void;
    };
  };
  resolvers: {
    // Used only for *network* results to normalize into the graph.
    // pass-through of cachebay hint is harmless if resolvers ignore it
    applyResolversOnGraph: (
      root: any,
      vars: Record<string, any>,
      hint?: { stale?: boolean; viewKey?: string; paginationMode?: CachebayCtx["paginationMode"] }
    ) => void;
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

/** Take a plain deep snapshot (no shared nested refs, proxy-free). */
function deepSnapshot<T = any>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

export function buildCachebayPlugin(
  options: PluginOptions,
  deps: PluginDependencies
): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, views, resolvers, ssr } = deps;

  // one session per mounted useQuery (operation.key)
  const sessionByOp = new Map<
    number,
    { wire: (root: any, vars: Record<string, any>, opts?: CachebayCtx) => void; destroy: () => void }
  >();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenames(operation.query as any);
    }

    let session = sessionByOp.get(operation.key);
    if (!session) {
      const s = views.createViewSession();
      session = { wire: s.wireConnections, destroy: s.destroy };
      sessionByOp.set(operation.key, session);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy = (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // pull per-op view/window hints from villus context
    const cachebay: CachebayCtx = ((operation as any).context?.cachebay) || {};

    // ─────────────────────────────────────────────────────────────────────
    // CACHE-ONLY
    // ─────────────────────────────────────────────────────────────────────
    if (policy === "cache-only") {
      const hit = graph.lookupOperation(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        // Publish a deep snapshot so nested refs don't get swapped by wiring.
        const toPublish = deepSnapshot(hit.entry.data);
        // Wire on a separate clone so views are attached/sized for this op.
        const forWiring = shallowClone(hit.entry.data);
        session.wire(forWiring, vars, cachebay);
        return publish({ data: toPublish }, true);
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
        const toPublish = deepSnapshot(hit.entry.data);
        const forWiring = shallowClone(hit.entry.data);
        session.wire(forWiring, vars, cachebay);
        return publish({ data: toPublish }, true);
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
        const toPublish = deepSnapshot(hit.entry.data);
        const forWiring = shallowClone(hit.entry.data);
        session.wire(forWiring, vars, cachebay);

        const hadTicket = !!ssr?.hydrateOperationTicket?.has(hit.key);
        if (hadTicket) ssr!.hydrateOperationTicket!.delete(hit.key);

        // non-terminal cache frame; network will follow
        publish({ data: toPublish }, false);
      }
      // network result handled below
    }

    // ─────────────────────────────────────────────────────────────────────
    // NETWORK RESULT PATH
    // ─────────────────────────────────────────────────────────────────────
    // Pin request signature now (avoid using a mutated ctx.operation later)
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

      // 1) Normalize into the graph (e.g., relay merges into canonical lists)
      const payload = shallowClone(r.data);
      resolvers.applyResolversOnGraph(payload, sentVars, { stale: false, ...cachebay });

      // 2) Wire views for *this* op so edges reflect the correct window
      session!.wire(payload, sentVars, cachebay);

      // 3) Store the normalized snapshot for this exact op signature
      graph.putOperation(sentKey, { data: deepSnapshot(payload), variables: sentVars });

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
