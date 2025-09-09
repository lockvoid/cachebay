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

  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const lastContentSigByFam = new Map<string, string>();

  const setOpCache = (k: string, v: { data: any; variables: Record<string, any> }) => {
    internals.operationCache.set(k, v);
    if (internals.operationCache.size > args.opCacheMax) {
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

    /* ────────────────────────────────────────────────────────────────────────
     * SUBSCRIPTIONS
     * - Observable-like → pass through (terminate=true) so Villus subscribes
     * - Plain frames → normalize & emit non-terminating; even if empty, still call once
     * ──────────────────────────────────────────────────────────────────────── */
    if (operation.type === "subscription") {
      if (shouldAddTypename && operation.query) {
        operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
      }

      ctx.useResult = (result: any, terminate?: boolean) => {
        if (isObservableLike(result)) {
          return originalUseResult(result, true);
        }

        if (result?.data) {
          const variables = operation.variables || {};

          applyResolversOnGraph(result.data, variables, { stale: false });
          collectEntities(result.data);
          registerViewsFromResult(result.data, variables);
          lastPublishedByFam.set(famKey, { data: result.data, variables: variables });

          return originalUseResult(result, false);
        }

        return originalUseResult(result, false);
      };

      return;
    }

    /* ────────────────────────────────────────────────────────────────────────
     * QUERIES & MUTATIONS
     * ──────────────────────────────────────────────────────────────────────── */

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
      // miss → fetch plugin will call useResult later
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

        // SSR ticket: cached + TERMINATE (Suspense-friendly)
        if (hadTicket) {
          lastContentSigByFam.set(famKey, toSig(entry.data));
          applyResolversOnGraph(entry.data, vars, { stale: false });
          collectEntities(entry.data);
          registerViewsFromResult(entry.data, vars);
          lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
          originalUseResult({ data: entry.data }, true);
          return;
        }

        // During hydrate (no ticket): cached + TERMINATE to satisfy Suspense
        if (hydratingNow) {
          lastContentSigByFam.set(famKey, toSig(entry.data));
          applyResolversOnGraph(entry.data, vars, { stale: false });
          collectEntities(entry.data);
          registerViewsFromResult(entry.data, vars);
          lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
          originalUseResult({ data: entry.data }, true);
          return;
        }

        hit.entry.data.legoColors.edges.forEach((edge) => {
          console.log("edge", edge.node.name);
        });

        // Normal CN cached reveal: always emit non-terminating cached
        lastContentSigByFam.set(famKey, toSig(entry.data));
        applyResolversOnGraph(entry.data, vars, { stale: false });
        collectEntities(entry.data);
        registerViewsFromResult(entry.data, vars);
        lastPublishedByFam.set(famKey, { data: entry.data, variables: vars });
        originalUseResult({ data: entry.data }, false);
      }
      // no cached hit → fetch plugin will call useResult later
    }

    /* ----------------------------- RESULT PATH ------------------------------ */
    ctx.useResult = (result: OperationResult, terminate?: boolean) => {
      const res: ResultShape =
        (result as any)?.error ? { error: (result as any).error } : { data: (result as any).data };

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
          // keep op-cache fresh; ALWAYS call useResult with the exact same ref on screen
          setOpCache(baseOpKey, { data: res.data, variables: vars });
          lastContentSigByFam.set(famKey, nextSig);

          const last = lastPublishedByFam.get(famKey);
          const sameRef = last?.data ?? res.data;
          return originalUseResult({ data: sameRef }, true);
        }

        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        lastContentSigByFam.set(famKey, nextSig);
        return originalUseResult({ data: res.data }, true);
      }

      return originalUseResult(result, terminate);
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
