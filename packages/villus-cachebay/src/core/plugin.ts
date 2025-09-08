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

  const operationDeferred = new Map<string, ReturnType<typeof createDeferred<ResultShape>>>();
  const familyCounter = new Map<string, number>();
  const allowLeaderByOp = new Set<string>();
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();

  // NEW: family-level deferred so losers can await the winner
  const familyDeferred = new Map<string, ReturnType<typeof createDeferred<ResultShape>>>();
  const ensureFamilyDeferred = (famKey: string) => {
    let d = familyDeferred.get(famKey);
    if (!d) {
      d = createDeferred<ResultShape>();
      familyDeferred.set(famKey, d);
    }
    return d;
  };

  // Signature-based duplicate suppression for CN winner
  const lastContentSigByFam = new Map<string, string>();
  const dataSig = (data: any) => { try { return JSON.stringify(data); } catch { return ""; } };

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
    const originalAfterQuery = ctx.afterQuery ?? (() => { });

    const famKey = getFamilyKey(operation);
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

    // CACHE-ONLY
    if (cachePolicy === "cache-only") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        // record raw sig BEFORE transforms
        lastContentSigByFam.set(famKey, dataSig(cached.data));
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
        internals.materializeResult?.(cached.data);
        lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
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

    // CACHE-FIRST
    if (cachePolicy === "cache-first") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        lastContentSigByFam.set(famKey, dataSig(cached.data));
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
        internals.materializeResult?.(cached.data);
        lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
        originalUseResult({ data: cached.data }, true);
        return;
      }
    }

    // DEDUP (per-opKey)
    const dedupKey = scopedOpKey;
    if (operationDeferred.has(dedupKey)) {
      allowLeaderByOp.add(dedupKey);
      const d = operationDeferred.get(dedupKey)!;
      return d.promise.then(winner => ctx.useResult(winner, true));
    } else {
      operationDeferred.set(dedupKey, createDeferred<ResultShape>());
    }

    // Elect family ticket
    const myTicket = (familyCounter.get(famKey) ?? 0) + 1;
    familyCounter.set(famKey, myTicket);

    // CACHE-AND-NETWORK cached path
    if (cachePolicy === "cache-and-network") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const hydratingNow = !!(isHydrating && isHydrating());
        const hadTicket = !!(hydrateOperationTicket && hydrateOperationTicket.has(baseOpKey));
        if (hadTicket) hydrateOperationTicket!.delete(baseOpKey);

        // If hydrated, emit cached and TERMINATE (suspense-friendly), store content sig
        if (hadTicket) {
          const vars = operation.variables || cached.variables || {};
          lastContentSigByFam.set(famKey, dataSig(cached.data));
          applyResolversOnGraph(cached.data, vars, { stale: false });
          collectEntities(cached.data);
          registerViewsFromResult(cached.data, vars);
          internals.materializeResult?.(cached.data);
          lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
          originalUseResult({ data: cached.data }, true);
          return;
        }

        // Normal CN: cached non-terminating unless already on screen
        if (!hydratingNow) {
          const vars = operation.variables || cached.variables || {};
          const last = lastPublishedByFam.get(famKey);
          const alreadyOnScreen = last && last.data === cached.data;

          if (!alreadyOnScreen) {
            lastContentSigByFam.set(famKey, dataSig(cached.data));
            applyResolversOnGraph(cached.data, vars, { stale: false });
            collectEntities(cached.data);
            registerViewsFromResult(cached.data, vars);
            internals.materializeResult?.(cached.data);
            lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
            originalUseResult({ data: cached.data }, false);
          }
        }
        // else (hydrating but no ticket): suppress cached emit
      }
    }

    // RESULT PATH
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const rawData = (incoming as any)?.error ? undefined : (incoming as any)?.data;
      const res: ResultShape = (incoming as any)?.error ? { error: (incoming as any).error } : { data: rawData };

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      // resolve op-level followers
      const opDef = operationDeferred.get(dedupKey);
      if (opDef) {
        opDef.resolve(res);
        operationDeferred.delete(dedupKey);
      }

      if (terminate === false && res.data) {
        return originalUseResult(res, false);
      }

      const latestTicket = familyCounter.get(famKey) ?? myTicket;
      const iAmWinner = myTicket === latestTicket;

      // HARD DROP: non-cursor losers never publish
      if (!iAmWinner && !isCursorPage && !allowLeaderByOp.has(dedupKey)) {
        const last = lastPublishedByFam.get(famKey);
        if (last?.data) {
          return originalUseResult({ data: last.data }, true);
        }
        // ✅ Instead of emitting {}, await the family winner and publish that when it arrives
        const famD = ensureFamilyDeferred(famKey);
        return famD.promise.then(winner => {
          originalUseResult(winner, true);
        });
      }

      // Cursor replay (older page allowed)
      if (!iAmWinner && isCursorPage && res.data) {
        applyResolversOnGraph(res.data, vars, { stale: true });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        internals.materializeResult?.(res.data);
        // resolve any family waiters too (they should show winner content eventually)
        const famD = familyDeferred.get(famKey);
        if (famD) { famD.resolve({ data: res.data }); familyDeferred.delete(famKey); }
        return originalUseResult(res, true);
      }

      // Stale loser with dedup-leader exception: allow publish once (with duplicate suppression)
      if (!iAmWinner && !isCursorPage) {
        if (allowLeaderByOp.has(dedupKey) && res.data) {
          const prevRawSig = lastContentSigByFam.get(famKey);
          const nextRawSig = dataSig(res.data);
          applyResolversOnGraph(res.data, vars, { stale: false });
          collectEntities(res.data);
          registerViewsFromResult(res.data, vars);

          if (prevRawSig && nextRawSig === prevRawSig) {
            setOpCache(baseOpKey, { data: res.data, variables: vars });
            return;
          }

          setOpCache(baseOpKey, { data: res.data, variables: vars });
          lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
          internals.materializeResult?.(res.data);
          lastContentSigByFam.set(famKey, nextRawSig);
          const famD = familyDeferred.get(famKey);
          if (famD) { famD.resolve({ data: res.data }); familyDeferred.delete(famKey); }
          return originalUseResult(res, true);
        }
        return;
      }

      // WINNER: publish once (suppress duplicate when raw content identical to cached)
      if (res.data) {
        const prevRawSig = lastContentSigByFam.get(famKey);
        const nextRawSig = dataSig(res.data);

        applyResolversOnGraph(res.data, vars, { stale: false });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);

        if (prevRawSig && nextRawSig === prevRawSig) {
          setOpCache(baseOpKey, { data: res.data, variables: vars });
          lastContentSigByFam.set(famKey, nextRawSig);
          // resolve family waiters with this data (even though we didn't re-render)
          const famD = familyDeferred.get(famKey);
          if (famD) { famD.resolve({ data: res.data }); familyDeferred.delete(famKey); }
          return;
        }

        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        internals.materializeResult?.(res.data);
        lastContentSigByFam.set(famKey, nextRawSig);
        // resolve family waiters
        const famD = familyDeferred.get(famKey);
        if (famD) { famD.resolve({ data: res.data }); familyDeferred.delete(famKey); }
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
