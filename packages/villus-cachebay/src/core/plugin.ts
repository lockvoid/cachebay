// core/plugin.ts
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import type { CachebayInternals } from "./types";
import {
  ensureDocumentHasTypenameSmart,
  getFamilyKey,
  getOperationKey,
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

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/* ----------------------------------------------------------------------------
 * Plugin
 * -------------------------------------------------------------------------- */
export function buildCachebayPlugin(
  internals: CachebayInternals, // expects internals.materializeResult?: (root:any)=>void
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

  // Per-opKey (+scope) → dedup followers await leader’s real {data|error}
  const operationDeferred = new Map<string, ReturnType<typeof createDeferred<ResultShape>>>();

  // Family ticket: latest ticket wins (take-latest across variables within a family)
  const familyCounter = new Map<string, number>();

  // If a dedup follower exists for an opKey, allow that leader to publish even if not latest ticket.
  const allowLeaderByOp = new Set<string>();

  // Suppress redundant cached reveals by family (pointer identity)
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();

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

    const famKey = getFamilyKey(operation); // includes concurrencyScope when present
    const baseOpKey = getOperationKey(operation);
    const scope =
      (operation.context as any)?.concurrencyScope ??
      (operation.context as any)?.cachebayScope ??
      "";
    const scopedOpKey = scope ? `${baseOpKey}::scope=${scope}` : baseOpKey;

    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    /* ------------------------------ CACHE-ONLY ------------------------------ */
    if (cachePolicy === "cache-only") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
        internals.materializeResult?.(cached.data);
        originalUseResult({ data: cached.data }, true);
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
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
        internals.materializeResult?.(cached.data);
        originalUseResult({ data: cached.data }, true);
        return;
      }
    }

    /* -------------------------------- DEDUP --------------------------------- */
    const dedupKey = scopedOpKey; // dedup is policy-agnostic
    if (operationDeferred.has(dedupKey)) {
      // follower exists → mark its leader allowed to publish even if not latest ticket
      allowLeaderByOp.add(dedupKey);
      const d = operationDeferred.get(dedupKey)!;
      return d.promise.then((winner) => {
        ctx.useResult(winner, true);
      });
    } else {
      operationDeferred.set(dedupKey, createDeferred<ResultShape>());
    }

    /* ------------------------- ELECT FAMILY TICKET -------------------------- */
    const myTicket = (familyCounter.get(famKey) ?? 0) + 1;
    familyCounter.set(famKey, myTicket);

    /* ------------------------- CACHE-AND-NETWORK HIT ------------------------ */
    if (cachePolicy === "cache-and-network") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const hydratingNow = !!(isHydrating && isHydrating());
        const hadTicket = !!(hydrateOperationTicket && hydrateOperationTicket.has(baseOpKey));
        if (hadTicket) hydrateOperationTicket!.delete(baseOpKey); // consume ticket

        // ✅ If this opKey came from hydrate, emit cached and TERMINATE (no initial refetch),
        // even if hydratingNow is already false (Suspense expects a terminating result).
        if (hadTicket) {
          const vars = operation.variables || cached.variables || {};
          applyResolversOnGraph(cached.data, vars, { stale: false });
          collectEntities(cached.data);
          registerViewsFromResult(cached.data, vars);
          internals.materializeResult?.(cached.data);
          originalUseResult({ data: cached.data }, true);
          lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
          return; // stop pipeline here
        }

        // Normal CN outside hydrate ticket path: emit cached non-terminating and revalidate (unless already on screen).
        if (!hydratingNow) {
          const vars = operation.variables || cached.variables || {};
          const last = lastPublishedByFam.get(famKey);
          const alreadyOnScreen = last && last.data === cached.data;

          if (!alreadyOnScreen) {
            applyResolversOnGraph(cached.data, vars, { stale: false });
            collectEntities(cached.data);
            registerViewsFromResult(cached.data, vars);
            internals.materializeResult?.(cached.data);
            originalUseResult({ data: cached.data }, false); // non-terminating
            lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
          }
        }
        // else (hydrating but no ticket): suppress cached emit
      }
    }

    /* ----------------------------- RESULT PATH ------------------------------ */
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const res: ResultShape =
        (incoming as any)?.error
          ? { error: (incoming as any).error }
          : { data: (incoming as any).data };

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      // resolve per-opKey followers
      const opDef = operationDeferred.get(dedupKey);
      if (opDef) {
        opDef.resolve(res);
        operationDeferred.delete(dedupKey);
      }

      // non-terminating cached reveal
      if (terminate === false && res.data) {
        return originalUseResult(res, false);
      }

      // winner vs loser by ticket
      const latestTicket = familyCounter.get(famKey) ?? myTicket;
      const iAmWinner = myTicket === latestTicket;

      // HARD DROP: non-cursor losers never publish unless dedup-leader exception
      if (!iAmWinner && !isCursorPage && !allowLeaderByOp.has(dedupKey)) {
        const last = lastPublishedByFam.get(famKey);
        if (last?.data) {
          return originalUseResult({ data: last.data }, true);
        }
        return originalUseResult(
          {
            error: new CombinedError({
              networkError: Object.assign(new Error("STALE_DROPPED"), { name: "StaleDropped" }),
              graphqlErrors: [],
              response: undefined,
            }),
          },
          true
        );
      }

      // cursor-page exception: allow publish
      if (!iAmWinner && isCursorPage && res.data) {
        applyResolversOnGraph(res.data, vars, { stale: true });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        internals.materializeResult?.(res.data);
        return originalUseResult(res, true);
      }

      // stale loser (non-cursor) with dedup follower exception: allow publish once
      if (!iAmWinner && !isCursorPage) {
        if (allowLeaderByOp.has(dedupKey)) {
          allowLeaderByOp.delete(dedupKey);
          if (res.data) {
            applyResolversOnGraph(res.data, vars, { stale: false });
            collectEntities(res.data);
            registerViewsFromResult(res.data, vars);
            setOpCache(baseOpKey, { data: res.data, variables: vars });
            lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
            internals.materializeResult?.(res.data);
          }
          return originalUseResult(res, true);
        }
        return; // normal stale loser already hard-dropped above
      }

      // winner: publish once
      if (res.data) {
        applyResolversOnGraph(res.data, vars, { stale: false });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        internals.materializeResult?.(res.data);
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
