import { CombinedError } from "villus";
import { CACHEBAY_KEY } from "./constants";
import type { DocumentsInstance } from "./documents";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { SSRInstance } from "../features/ssr";
import type { DocumentNode } from "graphql";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import type { App } from "vue";

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr: SSRInstance;
};

/**
 * Configuration options for Cachebay plugin
 */
export type PluginOptions = {
  /** Time window (ms) after a successful result in which repeat Suspense re-execs are served from cache & do not refetch (default: 1000) */
  suspensionTimeout?: number;
};

/**
 * Create Villus client plugin for Cachebay
 * Handles query caching, normalization, and cache policies
 * @param options - Plugin configuration
 * @param deps - Required dependencies (graph, planner, documents, ssr)
 * @returns Villus ClientPlugin instance
 */
export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { planner, documents, ssr } = deps;
  const { suspensionTimeout = 1000 } = options ?? {};

  // After-result window per op key
  const lastResultAtMs = new Map<number, number>();

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const vars: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // Always use compiled networkQuery (strips @connection, adds __typename)
    op.query = plan.networkQuery;

    const publish = (payload: OperationResult, terminal: boolean) =>
      ctx.useResult(payload, terminal);

    const policy: "cache-and-network" | "cache-first" | "network-only" | "cache-only" =
      ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as any;

    const buildCachedFrame = (): OperationResult<any> | null => {
      if (!documents.hasDocument({ document, variables: vars })) {
        return null;
      }

      const data = documents.materializeDocument({ document, variables: vars });

      return { data, error: null };
    };

    // Mutations: normalize into cache, return server payload (unchanged shape)
    if (plan.operation === "mutation") {
      const originalUseResult = ctx.useResult;

      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return originalUseResult(incoming, true);
        }

        documents.normalizeDocument({ document, variables: vars, data: incoming.data });
        return originalUseResult({ data: incoming.data, error: null }, true);
      };

      return;
    }

    // Subscriptions: normalize each frame, pass-through frames
    if (plan.operation === "subscription") {
      const originalUseResult = ctx.useResult;

      ctx.useResult = (incoming, terminal) => {
        if (typeof incoming?.subscribe !== "function") {
          return originalUseResult(incoming, terminal);
        }

        const interceptor = {
          subscribe(observer: any) {
            return incoming.subscribe({
              next: (frame: any) => {
                if (frame?.data) {
                  documents.normalizeDocument({ document, variables: vars, data: frame.data });
                }
                observer.next(frame);
              },
              error: (error: any) => observer.error?.(error),
              complete: () => observer.complete?.(),
            });
          },
        };

        return originalUseResult(interceptor as any, terminal);
      };

      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────────────────

    // SSR: during hydrate, for non-network-only policies serve cached and stop.
    if (ssr?.isHydrating?.()) {
      if (policy !== "network-only") {
        const cached = buildCachedFrame();
        if (cached) {
          return publish(cached, true);
        }
      }
    }

    const key = op.key as number;
    const last = lastResultAtMs.get(key);
    const withinSuspension = last != null && performance.now() - last <= suspensionTimeout;

    // cache-only
    if (policy === "cache-only") {
      const cached = buildCachedFrame();
      if (cached) return publish(cached, true);

      const err = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return publish({ error: err, data: undefined }, true);
    }

    // cache-first
    if (policy === "cache-first") {
      const cached = buildCachedFrame();
      if (cached) {
        publish(cached, true);
        return;
      }
      // fall through to network
      lastResultAtMs.set(key, performance.now());
    }

    // cache-and-network
    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();

      if (cached) {
        if (withinSuspension) {
          // If we just finished a network result, treat this as terminal to avoid refetch loops
          publish(cached, true);
          return;
        }

        // Emit cached now (non-terminal), then proceed to network
        publish(cached, false);
        lastResultAtMs.set(key, performance.now());
      }
      // else: no cache, proceed to network
    }

    // network-only (and the network leg of cache-and-network)
    // If within suspension window, skip a duplicate fetch by serving cache if present
    if (policy === "network-only") {
      if (withinSuspension) {
        const cached = buildCachedFrame();
        if (cached) {
          publish(cached, true);
          return;
        }
      }
    }

    // Intercept network response to normalize then materialize (canonical-first model)
    const originalUseResult = ctx.useResult;

    ctx.useResult = (incoming: OperationResult) => {
      lastResultAtMs.set(key, performance.now());

      if (incoming?.error) {
        return originalUseResult(incoming, true);
      }

      documents.normalizeDocument({ document, variables: vars, data: incoming.data });

      const data = documents.materializeDocument({ document, variables: vars });

      return originalUseResult({ data, error: null }, true);
    };
  };
}

/**
 * Provide Cachebay instance to Vue app
 * Makes cache available via useCache() composable
 * @param app - Vue application instance
 * @param instance - Cachebay cache instance
 */
export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
