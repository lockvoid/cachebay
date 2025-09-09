import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import type { CachebayInternals } from "./types";
import {
  ensureDocumentHasTypenameSmart,
  getFamilyKey,
  getOperationKey,
  isObservableLike,
} from "./utils";
import type { App } from "vue";

/* ----------------------------------------------------------------------------
 * Build args (deps from cache core)
 * -------------------------------------------------------------------------- */
type BuildArgs = {
  shouldAddTypename: boolean;
  opCacheMax: number;

  // Hydration (optional)
  isHydrating?: () => boolean;
  hydrateOperationTicket?: Set<string>;

  // Core graph/materialization
  applyResolversOnGraph: (root: any, vars: Record<string, any>, hint: { stale?: boolean }) => void;
  registerViewsFromResult: (root: any, variables: Record<string, any>) => void;
  collectEntities: (root: any) => void;
};

type ResultShape = { data?: any; error?: any };

/* ----------------------------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------------------------- */

// Signature for duplicate suppression
const toSig = (data: any) => {
  try { return JSON.stringify(data); } catch { return ""; }
};

// Remove undefined to stabilize opKey across equivalent shapes
const cleanVars = (vars: Record<string, any> | undefined | null) => {
  const out: Record<string, any> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of Object.keys(vars)) {
    const v = (vars as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
};

// Cheap view container (never hand out op-cache references)
const viewRootOf = (root: any) => {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
};

/* ----------------------------------------------------------------------------
 * Plugin
 * -------------------------------------------------------------------------- */
export function buildCachebayPlugin(
  internals: CachebayInternals,
  args: BuildArgs,
): ClientPlugin {
  const {
    shouldAddTypename,
    opCacheMax,
    isHydrating,
    hydrateOperationTicket,
    applyResolversOnGraph,
    registerViewsFromResult,
    collectEntities,
  } = args;

  // Track "what the UI is currently rendering" by family (for duplicate-winner suppression)
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const lastContentSigByFam = new Map<string, string>();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;
    const originalUseResult = ctx.useResult;
    const originalAfterQuery = ctx.afterQuery ?? (() => { });

    const famKey = getFamilyKey(operation);
    const baseOpKey = getOperationKey(operation);

    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    /* ------------------------------- SUBSCRIPTIONS ------------------------------- */
    if (operation.type === "subscription") {
      ctx.useResult = (incoming: any, _terminate?: boolean) => {
        // Observable source -> let Villus subscribe
        if (isObservableLike(incoming)) return originalUseResult(incoming, true);

        const r = incoming as OperationResult<any>;
        if (!r) return originalUseResult(incoming as any, false);

        if ((r as any).error) {
          // Forward non-terminating error frame to keep the stream alive
          return originalUseResult({ error: (r as any).error } as any, false);
        }

        if (!("data" in r) || !r.data) {
          // Keep stream open (heartbeat/keepalive frames)
          return originalUseResult(incoming as any, false);
        }

        // Normalize and stream as non-terminating
        const vars = operation.variables || {};
        const viewRoot = viewRootOf((r as any).data);
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, false);
      };
      return;
    }

    /* --------------------------- QUERIES / MUTATIONS --------------------------- */

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // Try base key, else a "cleaned" variables key (undefined-removed)
    const lookupCached = () => {
      const byBase = internals.operationCache.get(baseOpKey);
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
        context: operation.context,
      } as any);

      const byAlt = internals.operationCache.get(altKey);
      return byAlt ? { key: altKey, entry: byAlt } : null;
    };

    /* ------------------------------ CACHE-ONLY ------------------------------ */
    if (cachePolicy === "cache-only") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
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

    /* ------------------------------ CACHE-FIRST ----------------------------- */
    if (cachePolicy === "cache-first") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        originalUseResult({ data: viewRoot }, true);
        return;
      }
      // miss -> fetch plugin will call useResult later
    }

    /* ------------------------- CACHE-AND-NETWORK HIT ------------------------ */
    if (cachePolicy === "cache-and-network") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};

        const hasTicket = !!(hydrateOperationTicket && hydrateOperationTicket.has(hit.key));
        const hydratingNow = !!(isHydrating && isHydrating());
        if (hasTicket) hydrateOperationTicket!.delete(hit.key);

        // SSR ticket or in-flight hydration: deliver TERMINAL cached to resolve Suspense
        if (hasTicket || hydratingNow) {
          const viewRoot = viewRootOf(entry.data);
          lastContentSigByFam.set(famKey, toSig(viewRoot));
          applyResolversOnGraph(viewRoot, vars, { stale: false });
          collectEntities(viewRoot);
          registerViewsFromResult(viewRoot, vars);
          lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
          originalUseResult({ data: viewRoot }, true);
          return;
        }

        // Normal CN cached reveal: non-terminating, fetch continues
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        originalUseResult({ data: viewRoot }, false);
      }
      // no cached hit -> fetch plugin will publish
    }

    /* ----------------------------- RESULT PATH ------------------------------ */
    ctx.useResult = (result: OperationResult, terminate?: boolean) => {
      const r: any = result;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      // Placeholder frame: forward non-terminating
      if (!hasData && !hasError) return originalUseResult(result as any, false);

      // Non-terminating data frame: pass through
      if (terminate === false && hasData) return originalUseResult(result, false);

      // Cursor pages: terminal publish + keep op-cache fresh (RAW), UI via view clone
      if (isCursorPage && hasData) {
        const cacheRoot = r.data; // raw result
        args.applyResolversOnGraph(cacheRoot, vars, { stale: true });
        args.collectEntities(cacheRoot);
        internals.writeOpCache(baseOpKey, { data: cacheRoot, variables: vars });

        const viewRoot = viewRootOf(r.data);
        args.applyResolversOnGraph(viewRoot, vars, { stale: true });
        args.collectEntities(viewRoot);
        args.registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, true);
      }

      // Winner (baseline) with duplicate suppression
      if (hasData) {
        // RAW for op-cache (fast sanitizer lives inside internals.writeOpCache)
        const cacheRoot = r.data;
        args.applyResolversOnGraph(cacheRoot, vars, { stale: false });
        args.collectEntities(cacheRoot);
        internals.writeOpCache(baseOpKey, { data: cacheRoot, variables: vars });

        const nextSig = toSig(cacheRoot);
        const prevSig = lastContentSigByFam.get(famKey);
        lastContentSigByFam.set(famKey, nextSig);

        // VIEW for publish
        const viewRoot = viewRootOf(r.data);
        args.applyResolversOnGraph(viewRoot, vars, { stale: false });
        args.collectEntities(viewRoot);
        args.registerViewsFromResult(viewRoot, vars);

        if (prevSig && nextSig === prevSig) {
          // Same content -> keep the existing ref to avoid churn; still satisfy Villus
          const last = lastPublishedByFam.get(famKey);
          const sameRef = last?.data ?? viewRoot;
          lastPublishedByFam.set(famKey, { data: sameRef, variables: vars });
          return originalUseResult({ data: sameRef }, true);
        }

        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, true);
      }

      // Error: terminal forward
      if (hasError) return originalUseResult(result, true);

      // Fallback
      return originalUseResult(result, terminate);
    };

    ctx.afterQuery = () => {
      originalAfterQuery();
    };
  };

  return plugin;
}

/* ----------------------------------------------------------------------------
 * Vue provide/inject helper
 * -------------------------------------------------------------------------- */
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
    __entitiesTick: (instance as any).__entitiesTick,
  };

  app.provide(CACHEBAY_KEY, api);
}
