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
    applyResolversOnGraph,
    registerViewsFromResult,
    collectEntities,
  } = args;

  // Per-opKey (+scope) → dedup: followers await leader’s real {data|error}
  const operationDeferred = new Map<string, ReturnType<typeof createDeferred<ResultShape>>>();

  // Family ticket: latest ticket wins (take-latest across variables within a family)
  const familyCounter = new Map<string, number>();

  // If a dedup follower exists for an opKey, allow that leader to publish even if not latest ticket.
  const allowLeaderByOp = new Set<string>();

  // Suppress redundant cached reveals by family (pointer identity)
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();

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

    const famKey = getFamilyKey(operation); // must include concurrencyScope
    const baseOpKey = getOperationKey(operation);
    const scope = (operation.context as any)?.concurrencyScope ?? (operation.context as any)?.cachebayScope ?? "";
    const scopedOpKey = scope ? `${baseOpKey}::scope=${scope}` : baseOpKey;

    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    const cachePolicy =
      operation.cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // ── CACHE-ONLY
    if (cachePolicy === "cache-only") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
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

    // ── CACHE-FIRST
    if (cachePolicy === "cache-first") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const vars = operation.variables || cached.variables || {};
        applyResolversOnGraph(cached.data, vars, { stale: false });
        collectEntities(cached.data);
        registerViewsFromResult(cached.data, vars);
        originalUseResult({ data: cached.data }, true);
        return;
      }
    }

    // ── DEDUP (opKey + scope): followers await leader; returning Promise halts fetch
    if (operationDeferred.has(scopedOpKey)) {
      // a follower exists → mark its leader allowed to publish even if not latest ticket
      allowLeaderByOp.add(scopedOpKey);

      const d = operationDeferred.get(scopedOpKey)!;
      return d.promise.then((winner) => {
        // Route via the follower's ctx.useResult (original; we returned before overriding)
        ctx.useResult(winner, true);
      });
    } else {
      operationDeferred.set(scopedOpKey, createDeferred<ResultShape>());
    }

    // ── Elect family ticket ONLY for leaders (after dedup)
    const myTicket = (familyCounter.get(famKey) ?? 0) + 1;
    familyCounter.set(famKey, myTicket);

    // ── CACHE-AND-NETWORK: immediate cached reveal (non-terminating) if not already on screen
    if (cachePolicy === "cache-and-network") {
      const cached = internals.operationCache.get(baseOpKey);
      if (cached) {
        const last = lastPublishedByFam.get(famKey);
        const alreadyOnScreen = last && last.data === cached.data;
        if (!alreadyOnScreen) {
          const vars = operation.variables || cached.variables || {};
          applyResolversOnGraph(cached.data, vars, { stale: false });
          collectEntities(cached.data);
          registerViewsFromResult(cached.data, vars);
          originalUseResult({ data: cached.data }, false); // non-terminating
          lastPublishedByFam.set(famKey, { data: cached.data, variables: vars });
        }
      }
    }

    // ── Unified result path (network)
    ctx.useResult = (incoming: OperationResult, terminate?: boolean) => {
      const res: ResultShape =
        (incoming as any)?.error
          ? { error: (incoming as any).error }
          : { data: (incoming as any).data };

      const vars = operation.variables || {};
      const isCursorPage = vars && (vars.after != null || vars.before != null);

      // Resolve per-opKey followers with the REAL result
      const opDef = operationDeferred.get(scopedOpKey);
      if (opDef) {
        opDef.resolve(res);
        operationDeferred.delete(scopedOpKey);
      }

      // Non-terminating cached reveal path
      if (terminate === false && res.data) {
        return originalUseResult(res, false);
      }

      // Winner vs loser by ticket
      const latestTicket = familyCounter.get(famKey) ?? myTicket;
      const iAmWinner = myTicket === latestTicket;

      // Cursor-page exception
      if (!iAmWinner && isCursorPage && res.data) {
        applyResolversOnGraph(res.data, vars, { stale: true });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
        return originalUseResult(res, true);
      }

      // Stale loser (non-cursor)
      if (!iAmWinner && !isCursorPage) {
        // EXCEPTION: if this leader has a dedup follower for the same opKey, allow it to publish once.
        if (allowLeaderByOp.has(scopedOpKey)) {
          allowLeaderByOp.delete(scopedOpKey);
          if (res.data) {
            applyResolversOnGraph(res.data, vars, { stale: false });
            collectEntities(res.data);
            registerViewsFromResult(res.data, vars);
            setOpCache(baseOpKey, { data: res.data, variables: vars });
            lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
          }
          return originalUseResult(res, true);
        }

        // normal stale loser: warm stores only; no publish
        if (res.data) {
          applyResolversOnGraph(res.data, vars, { stale: true });
          collectEntities(res.data);
          setOpCache(baseOpKey, { data: res.data, variables: vars });
        }
        return; // wrapper ran → Villus satisfied
      }

      // Winner: publish once
      if (res.data) {
        applyResolversOnGraph(res.data, vars, { stale: false });
        collectEntities(res.data);
        registerViewsFromResult(res.data, vars);
        setOpCache(baseOpKey, { data: res.data, variables: vars });
        lastPublishedByFam.set(famKey, { data: res.data, variables: vars });
      }
      return originalUseResult(res, true);
    };

    ctx.afterQuery = () => {
      originalAfterQuery();
    };
  };

  return plugin;
}

// ----------------------------------------
// Vue provide/inject helper
// ----------------------------------------
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
