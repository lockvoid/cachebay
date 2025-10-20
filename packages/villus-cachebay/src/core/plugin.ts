import { CombinedError } from "villus";
import { markRaw } from "vue";
import { CACHEBAY_KEY } from "./constants";
import type { QueriesInstance } from "./queries";
import type { PlannerInstance } from "./planner";
import type { SSRInstance } from "../features/ssr";
import type { DocumentNode } from "graphql";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import type { App } from "vue";

type PluginDependencies = {
  planner: PlannerInstance;
  queries: QueriesInstance;
  ssr: SSRInstance;
};

type CachePolicy = "cache-and-network" | "cache-first" | "network-only" | "cache-only";
type DecisionMode = "strict" | "canonical";

export type PluginOptions = {
  /** collapse network→cache duplicate re-emits for this many ms */
  suspensionTimeout?: number;
};

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { planner, queries, ssr } = deps;
  const { suspensionTimeout = 1000 } = options ?? {};

  // Track last emission time per opKey for suspension window
  const lastEmitMs = new Map<number, number>();

  // Track active watchers for reactive queries
  const activeWatchers = new Map<number, ReturnType<typeof queries.watchQuery>>();

  // ---------- helpers ----------
  const finalizeQuery = (opKey: number) => {
    lastEmitMs.delete(opKey);
    const watcher = activeWatchers.get(opKey);
    if (watcher) {
      watcher.unsubscribe();
      activeWatchers.delete(opKey);
    }
  };

  const firstReadMode = (policy: CachePolicy): DecisionMode => {
    switch (policy) {
      case "cache-first":
      case "cache-only":
        return "strict";
      case "cache-and-network":
      case "network-only":
      default:
        return "canonical";
    }
  };

  // ---------- suspension window tracking ----------
  const isWithinSuspensionWindow = (opKey: number): boolean => {
    const last = lastEmitMs.get(opKey);
    if (last == null) return false;
    return performance.now() - last <= suspensionTimeout;
  };

  // ---------- plugin ----------
  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const variables: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // Use compiled network query
    op.query = plan.networkQuery;

    const policy: CachePolicy = ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as CachePolicy;
    const downstreamUseResult = ctx.useResult;

    // ---------------- MUTATION ----------------
    if (plan.operation === "mutation") {
      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return downstreamUseResult(incoming, true);
        }
        // Write to cache (triggers reactive updates automatically)
        queries.writeQuery({ query: document, variables, data: incoming.data });
        return downstreamUseResult({ data: markRaw(incoming.data), error: null }, true);
      };
      return;
    }

    // ---------------- SUBSCRIPTION ----------------
    if (plan.operation === "subscription") {
      ctx.useResult = (incoming, terminal) => {
        if (typeof incoming?.subscribe !== "function") {
          return downstreamUseResult(incoming, terminal);
        }
        const interceptor = {
          subscribe(observer: any) {
            return incoming.subscribe({
              next: (frame: any) => {
                if (frame?.data) {
                  // Write to cache (triggers reactive updates automatically)
                  queries.writeQuery({ query: document, variables, data: frame.data });
                }
                observer.next(frame);
              },
              error: (error: any) => observer.error?.(error),
              complete: () => observer.complete?.(),
            });
          },
        };
        return downstreamUseResult(interceptor as any, terminal);
      };
      return;
    }

    // ---------------- QUERY ----------------
    const opKey = op.key as number;
    const modeForQuery = firstReadMode(policy);

    // SSR hydration: prefer STRICT cache if available
    if (ssr?.isHydrating?.() && policy !== "network-only") {
      const result = queries.readQuery({ query: document, variables, decisionMode: "strict" });
      if (result.data) {
        downstreamUseResult({ data: result.data, error: null }, true);
        return;
      }
    }

    // CACHE-ONLY
    if (policy === "cache-only") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        downstreamUseResult({ data: result.data, error: null }, true);
        return;
      }
      const error = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      downstreamUseResult({ error, data: undefined }, true);
      return;
    }

    // CACHE-FIRST
    if (policy === "cache-first") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        downstreamUseResult({ data: result.data, error: null }, true);
        lastEmitMs.set(opKey, performance.now());
        
        // Set up watcher for future updates (optimistic, etc.)
        const watcher = queries.watchQuery({
          query: document,
          variables,
          decisionMode: modeForQuery,
          skipInitialEmit: true,
          onData: (data) => {
            downstreamUseResult({ data, error: null }, false);
            lastEmitMs.set(opKey, performance.now());
          },
        });
        activeWatchers.set(opKey, watcher);
        return;
      }
    }

    // CACHE-AND-NETWORK
    if (policy === "cache-and-network") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        if (isWithinSuspensionWindow(opKey)) {
          downstreamUseResult({ data: result.data, error: null }, true);
          lastEmitMs.set(opKey, performance.now());
          return;
        }
        // Emit cached data, allow network to arrive later
        downstreamUseResult({ data: result.data, error: null }, false);
        lastEmitMs.set(opKey, performance.now());
        
        // Set up watcher for reactive updates (optimistic, etc.)
        const watcher = queries.watchQuery({
          query: document,
          variables,
          decisionMode: modeForQuery,
          skipInitialEmit: true, // We already emitted above
          onData: (data) => {
            downstreamUseResult({ data, error: null }, false);
            lastEmitMs.set(opKey, performance.now());
          },
        });
        activeWatchers.set(opKey, watcher);
      }
    }

    // NETWORK-ONLY: short-circuit with recent cached result
    if (policy === "network-only" && isWithinSuspensionWindow(opKey)) {
      const result = queries.readQuery({ query: document, variables, decisionMode: "canonical" });
      if (result.data) {
        downstreamUseResult({ data: result.data, error: null }, true);
        finalizeQuery(opKey);
        return;
      }
    }

    // Handle network result
    ctx.useResult = (incoming: OperationResult) => {
      if (incoming?.error) {
        downstreamUseResult(incoming, true);
        finalizeQuery(opKey);
        return;
      }

      // Clean up old watcher before writing to avoid triggering it
      const oldWatcher = activeWatchers.get(opKey);
      if (oldWatcher) {
        oldWatcher.unsubscribe();
        activeWatchers.delete(opKey);
      }

      // Write to cache (triggers reactive updates automatically)
      queries.writeQuery({ query: document, variables, data: incoming.data });

      // Read back canonical result for terminal emission
      const result = queries.readQuery({ query: document, variables, decisionMode: "canonical" });
      
      if (result.data) {
        downstreamUseResult({ data: result.data, error: null }, true);
      } else {
        // Fallback: deliver raw network payload
        downstreamUseResult({ data: markRaw(incoming.data), error: null }, true);
      }

      // Track emission time for suspension window
      lastEmitMs.set(opKey, performance.now());

      // Set up watcher for future updates (optimistic, subscriptions, etc.)
      if (policy === "cache-and-network" || policy === "cache-first") {
        const watcher = queries.watchQuery({
          query: document,
          variables,
          decisionMode: "canonical",
          skipInitialEmit: true,
          onData: (data) => {
            downstreamUseResult({ data, error: null }, false);
            lastEmitMs.set(opKey, performance.now());
          },
        });
        activeWatchers.set(opKey, watcher);
      }
    };
  };
}

export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
