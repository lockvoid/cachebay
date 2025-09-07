import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import type { CachebayInternals } from "../core/types";
import { ensureDocumentHasTypenameSmart } from "../core/addTypename";
import {
  familyKeyForOperation,
  operationKey,
  stableIdentityExcluding,
  isObservableLike,
} from "../core/utils";

type BuildArgs = {
  shouldAddTypename: boolean;
  opCacheMax: number;

  isHydrating: () => boolean;
  hydrateOperationTicket: Set<string>;

  applyResolversOnGraph: (root: any, vars: Record<string, any>, hint: { stale?: boolean }) => void;
  registerViewsFromResult: (root: any, variables: Record<string, any>) => void;
  collectNonRelayEntities: (root: any) => void;
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
    collectNonRelayEntities,
  } = args;

  const inflightRequests = new Map<string, { listeners: Set<(res: { data?: any; error?: any }) => void> }>();
  const inflightByFam = new Map<string, string>();
  const baseByOpKey = new Map<string, string>();
  const latestSeqByFam = new Map<string, number>();
  const latestBaseByFam = new Map<string, string>();
  const lastPublishedByFam = new Map<string, { data: any; variables: Record<string, any> }>();
  const skipAfterQueryOnce = new Set<string>();
  const reentryGuard = new Set<string>();

  const RELAY_CURSOR_FIELDS = ["after", "before", "first", "last"] as const;
  const baseSig = (vars?: Record<string, any> | null) =>
    stableIdentityExcluding(vars || {}, RELAY_CURSOR_FIELDS as any);

  function setOpCache(k: string, v: { data: any; variables: Record<string, any> }) {
    internals.operationCache.set(k, v);
    if (internals.operationCache.size > opCacheMax) {
      const oldest = internals.operationCache.keys().next().value as string | undefined;
      if (oldest) internals.operationCache.delete(oldest);
    }
  }

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation, useResult, afterQuery } = ctx;
    const originalUseResult = useResult;

    // SUBSCRIPTION
    if (operation.type === "subscription") {
      if (shouldAddTypename && operation.query) {
        operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
      }

      const passThrough = originalUseResult;

      ctx.useResult = (incoming: any, _terminate?: boolean) => {
        if (isObservableLike(incoming)) return passThrough(incoming, true);

        const r = incoming as OperationResult<any>;
        if (!r) return;

        if ((r as any).error) return passThrough({ error: (r as any).error } as any, false);
        if (!("data" in r) || !r.data) return;

        const vars = operation.variables || {};

        applyResolversOnGraph((r as any).data, vars, { stale: false });

        collectNonRelayEntities((r as any).data);
        registerViewsFromResult((r as any).data, vars);

        lastPublishedByFam.set(familyKeyForOperation(operation), {
          data: (r as any).data,
          variables: vars,
        });

        return passThrough({ data: (r as any).data }, false);
      };

      return;
    }

    // QUERIES / MUTATIONS
    if (shouldAddTypename && operation.query) {
      operation.query = ensureDocumentHasTypenameSmart(operation.query as any);
    }

    const opKey = operationKey(operation);
    const famKey = familyKeyForOperation(operation);
    const curBase = baseSig(operation.variables);
    const cachedForKey = internals.operationCache.get(opKey);

    // Dedup 1: same opKey inflight
    if (inflightRequests.has(opKey)) {
      if (operation.cachePolicy !== "network-only" && cachedForKey) {
        registerViewsFromResult(cachedForKey.data, cachedForKey.variables);
        originalUseResult({ data: cachedForKey.data }, true);
      } else {
        originalUseResult({}, true);
      }

      inflightRequests.get(opKey)!.listeners.add((res) => {
        if (res && "error" in res && res.error) {
          originalUseResult({ error: res.error as any }, false);
          return;
        }
        if (res && "data" in res) {
          registerViewsFromResult(res.data, operation.variables || {});
          originalUseResult({ data: res.data }, false);
        }
      });

      return;
    }

    // Dedup 2: family-level, same baseSig inflight
    const famOp = inflightByFam.get(famKey);
    if (famOp && inflightRequests.has(famOp) && baseByOpKey.get(famOp) === curBase) {
      if (operation.cachePolicy !== "network-only" && cachedForKey) {
        registerViewsFromResult(cachedForKey.data, cachedForKey.variables);
        originalUseResult({ data: cachedForKey.data }, true);
      } else {
        originalUseResult({}, true);
      }

      inflightRequests.get(famOp)!.listeners.add((res) => {
        if (res && "error" in res && res.error) {
          originalUseResult({ error: res.error as any }, false);
          return;
        }
        if (res && "data" in res) {
          registerViewsFromResult(res.data, operation.variables || {});
          originalUseResult({ data: res.data }, false);
        }
      });

      return;
    }

    // New inflight
    inflightRequests.set(opKey, { listeners: new Set() });
    inflightByFam.set(famKey, opKey);
    baseByOpKey.set(opKey, curBase);

    // Cache-first publish (if allowed)
    if (operation.type === "query" && operation.cachePolicy !== "network-only") {
      if (cachedForKey) {
        const hasHydrateTicket = hydrateOperationTicket.has(opKey);
        const isReentry = reentryGuard.has(opKey);

        const shouldTerminate =
          operation.cachePolicy === "cache-first" ||
          operation.cachePolicy === "cache-only" ||
          isHydrating() ||
          hasHydrateTicket ||
          isReentry;

        if (hasHydrateTicket) reentryGuard.add(opKey);

        registerViewsFromResult(cachedForKey.data, cachedForKey.variables);
        originalUseResult({ data: cachedForKey.data }, shouldTerminate);

        if (hasHydrateTicket) hydrateOperationTicket.delete(opKey);

        if (shouldTerminate) {
          const e = inflightRequests.get(opKey);
          if (e) {
            e.listeners.forEach((fn) => fn({ data: cachedForKey.data }));
            inflightRequests.delete(opKey);
          }
          if (inflightByFam.get(famKey) === opKey) inflightByFam.delete(famKey);
          baseByOpKey.delete(opKey);
          return;
        }
      } else if (operation.cachePolicy === "cache-only") {
        originalUseResult({}, true);
        inflightRequests.delete(opKey);
        if (inflightByFam.get(famKey) === opKey) inflightByFam.delete(famKey);
        baseByOpKey.delete(opKey);
        return;
      }
    }

    // Concurrency tracking
    let mySeq = 0;
    if (operation.type === "query") {
      const prevSeq = latestSeqByFam.get(famKey) || 0;
      mySeq = prevSeq + 1;
      latestSeqByFam.set(famKey, mySeq);
      latestBaseByFam.set(famKey, curBase);
    }

    // Fulfillment flow
    const performAfterQuery = (res: OperationResult) => {
      reentryGuard.add(opKey);
      setTimeout(() => { reentryGuard.delete(opKey); }, 0);

      const notifyDedup = (payload: { data?: any; error?: any }) => {
        const entry = inflightRequests.get(opKey);
        if (entry) {
          entry.listeners.forEach((fn) => fn(payload));
          inflightRequests.delete(opKey);
        }
        if (inflightByFam.get(famKey) === opKey) inflightByFam.delete(famKey);
        baseByOpKey.delete(opKey);
      };

      const isStale = mySeq !== (latestSeqByFam.get(famKey) || 0);
      const vars = operation.variables || {};

      if (!res || (!("data" in res) && !(res as any).error)) {
        if (!isStale) originalUseResult({}, true);
        notifyDedup({});
        return;
      }

      if ((res as any)?.error) {
        if (!isStale) originalUseResult({ error: (res as any).error }, false);
        notifyDedup({ error: (res as any).error });
        return;
      }

      if (isStale) {
        const latestBase = latestBaseByFam.get(famKey) || "";
        const sameBase = curBase === latestBase;
        if (!sameBase) {
          setOpCache(opKey, { data: (res as any).data, variables: vars });
          originalUseResult({}, true);
          notifyDedup({});
          return;
        }
      }

      applyResolversOnGraph((res as any).data, vars, { stale: isStale });

      collectNonRelayEntities((res as any).data);
      setOpCache(opKey, { data: (res as any).data, variables: vars });
      lastPublishedByFam.set(famKey, { data: (res as any).data, variables: vars });

      registerViewsFromResult((res as any).data, vars);
      originalUseResult({ data: (res as any).data }, false);
      notifyDedup({ data: (res as any).data });
    };

    afterQuery((res) => {
      if (skipAfterQueryOnce.has(opKey)) {
        skipAfterQueryOnce.delete(opKey);
        return;
      }
      performAfterQuery(res);
    }, ctx);

    ctx.useResult = (result: any) => {
      skipAfterQueryOnce.add(opKey);
      performAfterQuery(result);
    };
  };

  return plugin;
}
