import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import {
  ensureDocumentHasTypenameSmart,
  getFamilyKey,
  getOperationKey,
  isObservableLike,
} from "./utils";
import type { App } from "vue";

type PluginOptions = {
  addTypename: boolean;
};

type PluginDependencies = {
  graph: any;
  views: any;
  ssr: any;
  resolvers: any;
};

type ResultShape = { data?: any; error?: any };

// Signature for duplicate suppression
const toSig = (data: any) => {
  try { return JSON.stringify(data); } catch { return ""; }
};

// Strip undefined so opKey stabilizes
const cleanVars = (vars: Record<string, any> | undefined | null) => {
  const out: Record<string, any> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of Object.keys(vars)) {
    const v = (vars as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
};

// Shallow root clone — we always REPLACE the connection node inside
const viewRootOf = (root: any) => {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
};

export function buildCachebayPlugin(
  options: PluginOptions,
  dependencies: PluginDependencies,
): ClientPlugin {
  const {
    addTypename = true,
  } = options;

  const { graph, views, ssr, resolvers } = dependencies;
  const operationCache = graph.operationStore || new Map<string, any>();

  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const lastContentSigByFam = new Map<string, string>();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;
    const originalUseResult = ctx.useResult;

    const famKey = getFamilyKey(operation);
    const baseOpKey = getOperationKey(operation);

    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUBSCRIPTIONS
    // ─────────────────────────────────────────────────────────────────────────
    if (operation.type === "subscription") {
      if (addTypename && operation.query) {
        operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
      }
      ctx.useResult = (incoming: any, _terminate?: boolean) => {
        if (isObservableLike(incoming)) return originalUseResult(incoming, true);

        const r = incoming as OperationResult<any>;
        if (r && "data" in r && r.data) {
          const vars = operation.variables || {};
          const view = viewRootOf(r.data);
          resolvers.applyResolversOnGraph(view, vars, { stale: false });
          views.registerViewsFromResult(view, vars);
          views.collectEntities(r.data);
          originalUseResult(r, false);
        } else {
          originalUseResult(r, false);
        }
      };
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // QUERIES / MUTATIONS
    // ─────────────────────────────────────────────────────────────────────────

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    const lookupCached = () => {
      const byBase = operationCache.get(baseOpKey);
      if (byBase) return { key: baseOpKey, entry: byBase };

      const cleaned = cleanVars(operation.variables);
      const sameShape =
        operation.variables &&
        Object.keys(operation.variables).every(k => operation.variables![k] !== undefined);
      if (sameShape) return null;

      const altKey = getOperationKey({
        type: operation.type,
        query: operation.query,
        variables: cleaned,
        context: operation.context
      } as any);
      const byAlt = operationCache.get(altKey);
      return byAlt ? { key: altKey, entry: byAlt } : null;
    };

    // ------------------------------ CACHE-ONLY ------------------------------
    if (cachePolicy === "cache-only") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        resolvers.applyResolversOnGraph(viewRoot, vars, { stale: false });
        views.collectEntities(viewRoot);
        views.registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        originalUseResult({ data: viewRoot }, true);
      } else {
        const error = new CombinedError({
          networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
          graphqlErrors: [],
          response: undefined,
        });
        originalUseResult({ error }, true);
      }
      return;
    }

    // ------------------------------ CACHE-FIRST -----------------------------
    if (cachePolicy === "cache-first") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        resolvers.applyResolversOnGraph(viewRoot, vars, { stale: false });
        views.collectEntities(viewRoot); // Collect entities AFTER resolvers
        views.registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        originalUseResult({ data: viewRoot }, true);
        return;
      }
      // miss → fetch plugin will call useResult later
    }

    // ------------------------- CACHE-AND-NETWORK HIT ------------------------
    if (cachePolicy === "cache-and-network") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};

        const hadTicket = !!(ssr.hydrateOperationTicket && ssr.hydrateOperationTicket.has(hit.key));
        const hydratingNow = !!(ssr.isHydrating && ssr.isHydrating());
        if (hadTicket) ssr.hydrateOperationTicket!.delete(hit.key);

        // SSR ticket / hydrating → terminal cached (resolve Suspense immediately)
        if (hadTicket || hydratingNow) {
          const viewRoot = viewRootOf(entry.data);
          lastContentSigByFam.set(famKey, toSig(viewRoot));
          resolvers.applyResolversOnGraph(viewRoot, vars, { stale: false });
          views.collectEntities(viewRoot);
          views.registerViewsFromResult(viewRoot, vars);
          lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
          originalUseResult({ data: viewRoot }, false);
          return;
        }

        // Normal CN cached reveal: bind views on a view clone
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        resolvers.applyResolversOnGraph(viewRoot, vars, { stale: false });
        views.collectEntities(viewRoot);
        views.registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });

        // Non-terminating: UI updates instantly; fetch still runs
        originalUseResult({ data: viewRoot }, false);
      }
      // no cached hit → fetch plugin will emit later
    }

    // ----------------------------- RESULT PATH ------------------------------
    ctx.useResult = (result: OperationResult, terminate?: boolean) => {
      const r: any = result;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      // Placeholder frames: forward, but keep op open
      if (!hasData && !hasError) {
        return originalUseResult(result as any, false);
      }

      // Non-terminating frames: pass through
      if (terminate === false && hasData) {
        return originalUseResult(result, false);
      }

      // CURSOR PAGES — terminal publish; keep op-cache RAW & PLAIN
      if (isCursorPage && hasData) {
        const cacheRoot = r.data; // already plain enough for writeOpCache; it sanitizes shallowly
        resolvers.applyResolversOnGraph(cacheRoot, vars, { stale: true });
        views.collectEntities(cacheRoot);
        graph.putOperation(baseOpKey, { data: cacheRoot, variables: vars });

        const viewRoot = viewRootOf(r.data);
        resolvers.applyResolversOnGraph(viewRoot, vars, { stale: true });
        views.collectEntities(viewRoot);
        views.registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, true);
      }

      // WINNER (baseline) with duplicate suppression
      if (hasData) {
        const cacheRoot = r.data;
        resolvers.applyResolversOnGraph(cacheRoot, vars, { stale: false });
        views.collectEntities(cacheRoot);

        const prevSig = lastContentSigByFam.get(famKey);
        const nextSig = toSig(cacheRoot);

        graph.putOperation(baseOpKey, { data: cacheRoot, variables: vars });
        lastContentSigByFam.set(famKey, nextSig);

        const viewRoot = viewRootOf(r.data);
        resolvers.applyResolversOnGraph(viewRoot, vars, { stale: false });
        views.collectEntities(viewRoot);
        views.registerViewsFromResult(viewRoot, vars);

        if (prevSig && nextSig === prevSig) {
          const last = lastPublishedByFam.get(famKey);
          const sameRef = last?.data ?? viewRoot;
          lastPublishedByFam.set(famKey, { data: sameRef, variables: vars });
          return originalUseResult({ data: sameRef }, true);
        }

        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, true);
      }

      // Errors: forward terminally
      if (hasError) {
        return originalUseResult(result, true);
      }

      // Fallback
      return originalUseResult(result, terminate);
    };
  };

  return plugin;
}

/* ----------------------------------------------------------------------------
 * Vue provide/inject helper
 * ---------------------------------------------------------------------------- */
export const CACHEBAY_KEY: symbol = Symbol("villus-cachebay");

export function provideCachebay(app: App, instance: any) {
  const api: any = {
    readFragment: instance.readFragment,
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    hasFragment: (instance as any).hasFragment,
    listEntityKeys: (instance as any).listEntityKeys,
    listEntities: (instance as any).listEntities,
    inspect: (instance as any).inspect,
    entitiesTick: (instance as any).entitiesTick,
  };
  app.provide(CACHEBAY_KEY, api);
}
