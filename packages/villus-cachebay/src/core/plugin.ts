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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Shallow root clone (cheap) — we always REPLACE the connection node inside
const viewRootOf = (root: any) => {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
};

// NOTE: op-cache entries must be PLAIN (no Vue proxies). Network payloads are
// usually plain already; to be safe against accidental reactive wrapping upstream,
// normalize deeply only for JSON-safe trees via fast JSON fallback.
const toPlainDeep = (x: any) => {
  try { return JSON.parse(JSON.stringify(x)); } catch { return x; }
};

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

  // "what the UI is currently rendering" per family
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const lastContentSigByFam = new Map<string, string>();

  const setOpCache = (k: string, v: { data: any; variables: Record<string, any> }) => {
    // normalize to plain before storing — NO proxies in op-cache
    const plain = { data: toPlainDeep(v.data), variables: toPlainDeep(v.variables || {}) };
    internals.operationCache.set(k, plain);
    if (internals.operationCache.size > opCacheMax) {
      const oldest = internals.operationCache.keys().next().value as string | undefined;
      if (oldest) internals.operationCache.delete(oldest);
    }
  };

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;
    const originalUseResult = ctx.useResult;

    const famKey = getFamilyKey(operation);
    const baseOpKey = getOperationKey(operation);

    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    // -------------------------------------------------------------------------
    // SUBSCRIPTIONS
    // - Observable-like → pass through (terminate=true)
    // - Data frames → normalize + non-terminating emit
    // - Others → forward non-terminating
    // -------------------------------------------------------------------------
    if (operation.type === "subscription") {
      if (shouldAddTypename && operation.query) {
        operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
      }
      ctx.useResult = (incoming: any, _terminate?: boolean) => {
        if (isObservableLike(incoming)) return originalUseResult(incoming, true);

        const r = incoming as OperationResult<any>;
        if (r && "data" in r && r.data) {
          const vars = operation.variables || {};
          const viewRoot = viewRootOf(r.data);
          applyResolversOnGraph(viewRoot, vars, { stale: false });
          collectEntities(viewRoot);
          registerViewsFromResult(viewRoot, vars);
          lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
          return originalUseResult({ data: viewRoot }, false);
        }
        // still call, keep stream open
        return originalUseResult(incoming as any, false);
      };
      return;
    }

    // -------------------------------------------------------------------------
    // QUERIES / MUTATIONS
    // -------------------------------------------------------------------------

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

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
        context: operation.context
      } as any);
      const byAlt = internals.operationCache.get(altKey);
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

    // ------------------------------ CACHE-FIRST -----------------------------
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
      // miss → fetch plugin will call useResult later
    }

    // ------------------------- CACHE-AND-NETWORK HIT ------------------------
    if (cachePolicy === "cache-and-network") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};

        const hadTicket = !!(hydrateOperationTicket && hydrateOperationTicket.has(hit.key));
        const hydratingNow = !!(isHydrating && isHydrating());
        if (hadTicket) hydrateOperationTicket!.delete(hit.key);

        // SSR ticket / hydrating → terminal cached (resolve Suspense immediately)
        if (hadTicket || hydratingNow) {
          const viewRoot = viewRootOf(entry.data);
          lastContentSigByFam.set(famKey, toSig(viewRoot));
          applyResolversOnGraph(viewRoot, vars, { stale: false });
          collectEntities(viewRoot);
          registerViewsFromResult(viewRoot, vars);
          lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
          originalUseResult({ data: viewRoot }, true);
          return;
        }

        // Normal CN cached reveal: bind views on a view clone
        const viewRoot = viewRootOf(entry.data);
        lastContentSigByFam.set(famKey, toSig(viewRoot));
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
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
        // 1) RAW for op-cache
        const cacheRoot = toPlainDeep(r.data);
        applyResolversOnGraph(cacheRoot, vars, { stale: true });
        collectEntities(cacheRoot);
        setOpCache(baseOpKey, { data: cacheRoot, variables: vars });

        // 2) VIEW for publish
        const viewRoot = viewRootOf(r.data);
        applyResolversOnGraph(viewRoot, vars, { stale: true });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);
        lastPublishedByFam.set(famKey, { data: viewRoot, variables: vars });
        return originalUseResult({ data: viewRoot }, true);
      }

      // WINNER (baseline) with duplicate suppression
      if (hasData) {
        // Prepare RAW for op-cache and signature on its plain form
        const cacheRoot = toPlainDeep(r.data);
        applyResolversOnGraph(cacheRoot, vars, { stale: false });
        collectEntities(cacheRoot);

        const prevSig = lastContentSigByFam.get(famKey);
        const nextSig = toSig(cacheRoot);

        setOpCache(baseOpKey, { data: cacheRoot, variables: vars });
        lastContentSigByFam.set(famKey, nextSig);

        // VIEW for publish
        const viewRoot = viewRootOf(r.data);
        applyResolversOnGraph(viewRoot, vars, { stale: false });
        collectEntities(viewRoot);
        registerViewsFromResult(viewRoot, vars);

        if (prevSig && nextSig === prevSig) {
          // Same content — keep existing ref to avoid re-render; still satisfy Villus
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
    __entitiesTick: (instance as any).__entitiesTick,
  };
  app.provide(CACHEBAY_KEY, api);
}
