// src/core/plugin.ts
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

// stable content signature for duplicate-winner suppression
const toSig = (data: any) => {
  try { return JSON.stringify(data); } catch { return ""; }
};

const cleanVars = (vars: Record<string, any> | undefined | null) => {
  const out: Record<string, any> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of Object.keys(vars)) {
    const v = (vars as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
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

  // family memos
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const lastContentSigByFam = new Map<string, string>();

  const setOpCache = (k: string, v: { data: any; variables: Record<string, any> }) => {
    internals.operationCache.set(k, v);
    if (internals.operationCache.size > opCacheMax) {
      const oldest = internals.operationCache.keys().next().value as string | undefined;
      if (oldest) internals.operationCache.delete(oldest);
    }
  };

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;
    const originalUseResult = ctx.useResult;
    const originalAfterQuery = ctx.afterQuery ?? (() => { });

    const famKey = getFamilyKey(operation);
    const baseOpKey = getOperationKey(operation);

    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    /* ────────────────────────────────────────────────────────────────────────
     * SUBSCRIPTIONS
     * - Observable-like → pass through as-is (terminate=true) so Villus subscribes
     * - Plain frames → apply resolvers, collect entities, register views, emit non-terminating
     * ──────────────────────────────────────────────────────────────────────── */
    if (operation.type === "subscription") {
      ctx.useResult = (incoming: any, _terminate?: boolean) => {
        // observable source → delegate to Villus
        if (isObservableLike(incoming)) return originalUseResult(incoming, true);

        const r = incoming as OperationResult<any>;
        if (!r) return;
        if ((r as any).error) return originalUseResult({ error: (r as any).error } as any, false);

        if (!("data" in r) || !r.data) return;

        const vars = operation.variables || {};
        applyResolversOnGraph((r as any).data, vars, { stale: false });
        collectEntities((r as any).data);
        registerViewsFromResult((r as any).data, vars);

        lastPublishedByFam.set(famKey, { data: (r as any).data, variables: vars });
        return originalUseResult({ data: (r as any).data }, false); // non-terminating frame
      };
      return;
    }

    /* ────────────────────────────────────────────────────────────────────────
     * QUERIES & MUTATIONS
     * ──────────────────────────────────────────────────────────────────────── */

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // Attempt lookup by base key; if not found, try a “cleaned” variables opKey
    const lookupCached = () => {
      const byBase = internals.operationCache.get(baseOpKey);
      if (byBase) return { key: baseOpKey, entry: byBase };

      const cleaned = cleanVars(operation.variables);
      // only compute an alt key if cleaning removed undefineds
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

    /* ------------------------------ CACHE-ONLY ------------------------------ */
    if (cachePolicy === "cache-only") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const vars = operation.variables || entry.variables || {};
        lastContentSigByFam.set(famKey, toSig(entry.data));
        applyResolversOnGraph(entry.data, vars, { stale: false });
        collectEntities(entry.data);
        registerViewsFromResult(entry.data, vars);
        lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
        originalUseResult({ data: entry.data }, true);
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
        lastContentSigByFam.set(famKey, toSig(entry.data));
        applyResolversOnGraph(entry.data, vars, { stale: false });
        collectEntities(entry.data);
        registerViewsFromResult(entry.data, vars);
        lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
        originalUseResult({ data: entry.data }, true);
        return;
      }
    }

    /* ------------------------- CACHE-AND-NETWORK HIT ------------------------ */
    if (cachePolicy === "cache-and-network") {
      const hit = lookupCached();
      if (hit) {
        const { entry } = hit;
        const hydratingNow = !!(isHydrating && isHydrating());
        const hadTicket = !!(hydrateOperationTicket && hydrateOperationTicket.has(hit.key));
        if (hadTicket) hydrateOperationTicket!.delete(hit.key);

        const vars = operation.variables || entry.variables || {};

        // SSR rabbit: cached + TERMINATE (suspense-friendly)
        if (hadTicket) {
          lastContentSigByFam.set(famKey, toSig(entry.data));
          applyResolversOnGraph(entry.data, vars, { stale: false });
          collectEntities(entry.data);
          registerViewsFromResult(entry.data, vars);
          lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
          originalUseResult({ data: entry.data }, true);
          return;
        }

        // During hydration (no ticket), still emit cached TERMINATING once
        // so Suspense resolves immediately from cache.
        if (hydratingNow) {
          lastContentSigByFam.set(famKey, toSig(entry.data));
          applyResolversOnGraph(entry.data, vars, { stale: false });
          collectEntities(entry.data);
          registerViewsFromResult(entry.data, vars);
          lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
          originalUseResult({ data: entry.data }, true);
          return;
        }

        // Normal CN cached hit: non-terminating unless already on screen
        const last = lastPublishedByFam.get(famKey);
        const alreadyOnScreen = last && last.data === entry.data;
        if (!alreadyOnScreen) {
          lastContentSigByFam.set(famKey, toSig(entry.data));
          applyResolversOnGraph(entry.data, vars, { stale: false });
          collectEntities(entry.data);
          registerViewsFromResult(entry.data, vars);
          lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
          originalUseResult({ data: entry.data }, false);
        }
      }
    }

    /* ----------------------------- RESULT PATH ------------------------------ */
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const res: ResultShape =
        (incoming as any)?.error ? { error: (incoming as any).error } : { data: (incoming as any).data };

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      if (terminate === false && res.data) {
        return originalUseResult(res, false);
      }

      // Cursor pages publish terminally
      if (isCursorPage && res.data) {
        applyResolversOnGraph(res.data, vars, { stale: true });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        return originalUseResult(res, true);
      }

      // Winner (non-cursor) with duplicate suppression vs cached content
      if (res.data) {
        const prevSig = lastContentSigByFam.get(famKey);
        const nextSig = toSig(res.data);

        applyResolversOnGraph(res.data, vars, { stale: false });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);

        if (prevSig && nextSig === prevSig) {
          setOpCache(baseOpKey, { data: res.data, variables: vars });
          lastContentSigByFam.set(famKey, nextSig);
          return;
        }

        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        lastContentSigByFam.set(famKey, nextSig);
      }

      return originalUseResult(res, true);
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
