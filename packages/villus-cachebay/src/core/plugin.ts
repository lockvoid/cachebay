import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import {
  ensureDocumentHasTypenameSmart,
  getOperationKey,
  isObservableLike,
} from "./utils";

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

// Build a connection key that ignores cursor args (after/before/first/last)
function buildConnectionKey(parent: string, field: string, vars: Record<string, any>) {
  const filtered: Record<string, any> = { ...vars };
  delete filtered.after; delete filtered.before; delete filtered.first; delete filtered.last;
  const id = Object.keys(filtered).sort().map(k => `${k}:${JSON.stringify(filtered[k])}`).join("|");
  return `${parent}.${field}(${id})`;
}

// Strip undefined so alternate opKey stabilizes
function cleanVars(vars: Record<string, any> | undefined | null) {
  const out: Record<string, any> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of Object.keys(vars)) {
    const v = (vars as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Shallow root clone — we REPLACE connection nodes inside
function shallowClone(root: any) {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
}

type PluginOptions = {
  addTypename?: boolean;
};

type PluginDependencies = {
  graph: {
    operationStore: Map<string, any>;
    putOperation: (key: string, payload: { data: any; variables: Record<string, any> }) => void;
    getEntityParentKey: (typename: string, id?: any) => string | null;
    ensureConnection: (key: string) => any;
    identify?: (obj: any) => string | null;
  };
  views: {
    createConnectionView: (
      state: any,
      opts?: { edgesKey?: string; pageInfoKey?: string; limit?: number; root?: any; pinned?: boolean }
    ) => any;
    setViewLimit: (view: any, limit: number) => void;
    syncConnection: (state: any) => void;
  };
  resolvers: {
    applyResolversOnGraph: (root: any, vars: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
  ssr?: {
    hydrateOperationTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

/* ────────────────────────────────────────────────────────────────────────────
 * Plugin factory
 * ──────────────────────────────────────────────────────────────────────────── */
export function buildCachebayPlugin(
  options: PluginOptions,
  deps: PluginDependencies,
): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, views, resolvers, ssr } = deps;
  const opCache = graph.operationStore || new Map<string, any>();

  // Per-operation (per mounted useQuery) instance state: opKey → { connKey → view }
  const instanceViews: Map<string, Map<string, any>> = new Map();

  /** Traverse a post-resolver payload, create/reuse per-instance views, size & sync them. */
  function wireViewsForConnections(root: any, vars: Record<string, any>, opKey: string) {
    if (!root || typeof root !== "object") return;

    let viewMap = instanceViews.get(opKey);
    if (!viewMap) {
      viewMap = new Map();
      instanceViews.set(opKey, viewMap);
    }

    const stack: Array<{ node: any; parentType: string | null }> = [{ node: root, parentType: "Query" }];
    while (stack.length) {
      const { node, parentType } = stack.pop()!;
      if (!node || typeof node !== "object") continue;

      const t = (node as any).__typename ?? parentType;

      for (const field of Object.keys(node)) {
        const val = (node as any)[field];
        if (!val || typeof val !== "object") continue;

        // Canonical connection: edges[] + pageInfo{}
        const edges = (val as any).edges;
        const pageInfo = (val as any).pageInfo;
        if (Array.isArray(edges) && pageInfo && typeof pageInfo === "object") {
          const parentKey = graph.getEntityParentKey(t!, graph.identify?.(node)) ?? "Query";
          const connKey = buildConnectionKey(parentKey, field, vars);
          const state = graph.ensureConnection(connKey);

          // create or reuse per-instance view
          let view = viewMap.get(connKey);
          if (!view) {
            view = views.createConnectionView(state, {
              edgesKey: "edges",
              pageInfoKey: "pageInfo",
              root: val,
              limit: 0,
              pinned: true,
            });
            viewMap.set(connKey, view);
          }

          // attach the view’s reactive containers to the payload
          (val as any).edges = view.edges;
          (val as any).pageInfo = view.pageInfo;

          // size per instance: baseline → page size; cursor page → union size
          const hasAfter = vars.after != null;
          const hasBefore = vars.before != null;
          if (!hasAfter && !hasBefore) {
            // Baseline: reflect exactly what this payload shows right now
            views.setViewLimit(view, edges.length);
          } else {
            // Cursor pages: reveal the union we’ve merged so far
            views.setViewLimit(view, state.list.length);
          }

          // sync now so UI displays immediately
          views.syncConnection(state);
        }

        // traverse deeper
        if (Array.isArray(val)) {
          for (const it of val) if (it && typeof it === "object") stack.push({ node: it, parentType: t });
        } else {
          stack.push({ node: val, parentType: t });
        }
      }
    }
  }

  /** Lookup cached entry by exact opKey and by cleaned-var variant. */
  function lookupCached(operation: any) {
    const baseKey = getOperationKey(operation);
    const byBase = opCache.get(baseKey);
    if (byBase) return { key: baseKey, entry: byBase };

    // Try a "cleaned variables" alt key (undefined stripped)
    const cleaned = cleanVars(operation.variables);
    const sameShape =
      operation.variables &&
      Object.keys(operation.variables).every((k) => operation.variables![k] !== undefined);
    if (sameShape) return null;

    const altKey = getOperationKey({
      type: operation.type,
      query: operation.query,
      variables: cleaned,
      context: operation.context,
    } as any);
    const byAlt = opCache.get(altKey);
    return byAlt ? { key: altKey, entry: byAlt } : null;
  }

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    const publish = (payload: OperationResult, terminate: boolean) => ctx.useResult(payload, terminate);

    // SUBSCRIPTIONS: apply resolvers and wire views; pass through
    if (operation.type === "subscription") {
      const original = ctx.useResult;
      ctx.useResult = (incoming: any, terminate?: boolean) => {
        if (isObservableLike(incoming)) return original(incoming, true);
        const r = incoming as OperationResult<any>;
        if (r && r.data) {
          const data = shallowClone(r.data);
          const vars = operation.variables || {};
          resolvers.applyResolversOnGraph(data, vars, { stale: false });
          graph.putOperation(getOperationKey(operation), { data, variables: vars });
          wireViewsForConnections(data, vars, getOperationKey(operation));
          return original({ data }, Boolean(terminate));
        }
        return original(r, Boolean(terminate));
      };
      return;
    }

    // CACHE POLICIES
    const policy = (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // CACHE-ONLY
    if (policy === "cache-only") {
      const hit = lookupCached(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        wireViewsForConnections(data, vars, hit.key);
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
      const hit = lookupCached(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });
        wireViewsForConnections(data, vars, hit.key);
        return publish({ data }, true);
      }
      // miss → transport will deliver later
    }

    // CACHE-AND-NETWORK
    if (policy === "cache-and-network") {
      const hit = lookupCached(operation);
      if (hit) {
        const vars = operation.variables || hit.entry.variables || {};
        const data = shallowClone(hit.entry.data);
        resolvers.applyResolversOnGraph(data, vars, { stale: false });

        // SSR hydration logic
        const key = hit.key;
        const hadTicket = !!ssr?.hydrateOperationTicket?.has(key);
        const hydrating = !!ssr?.isHydrating?.();

        if (hadTicket) ssr!.hydrateOperationTicket!.delete(key);

        // If hydrating or ticketed: publish terminal cached to resolve Suspense
        if (hadTicket || hydrating) {
          wireViewsForConnections(data, vars, key);
          return publish({ data }, false); // allow network to follow, but cached resolves suspense
        }

        // Normal CN: publish non-terminal cached now; network will follow
        wireViewsForConnections(data, vars, key);
        publish({ data }, false);
      }
      // No cached hit → transport will deliver later
    }

    // NETWORK RESULT PATH
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      // Pass through placeholders/non-data frames
      if (!hasData && !hasError) {
        return originalUseResult(incoming, false);
      }

      if (hasError) {
        return originalUseResult(incoming, true);
      }

      // Terminal publish: apply resolvers, store post-resolver raw, wire views
      const vars = operation.variables || {};
      const data = shallowClone(r.data);

      // Apply write-time resolvers (relay merges into ConnectionState)
      resolvers.applyResolversOnGraph(data, vars, { stale: false });

      // Store post-resolver raw into op-cache
      const key = getOperationKey(operation);
      graph.putOperation(key, { data, variables: vars });

      // Wire views
      wireViewsForConnections(data, vars, key);

      return originalUseResult({ data }, true);
    };
  };

  return plugin;
}

/* ----------------------------------------------------------------------------
 * Vue provide/inject helper (unchanged)
 * ---------------------------------------------------------------------------- */
import type { App } from "vue";
export const CACHEBAY_KEY: symbol = Symbol("villus-cachebay");

export function provideCachebay(app: App, instance: any) {
  const api: any = {
    readFragment: instance.readFragment,
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    hasFragment: (instance as any).hasFragment,
    inspect: (instance as any).inspect,
    entitiesTick: (instance as any).entitiesTick,
  };
  app.provide(CACHEBAY_KEY, api);
}
