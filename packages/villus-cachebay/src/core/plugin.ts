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

type CachePolicy = "cache-and-network" | "cache-first" | "network-only" | "cache-only";

export type PluginOptions = {
  suspensionTimeout?: number;
};

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { planner, documents, ssr } = deps;
  const { suspensionTimeout = 1000 } = options ?? {};
  const lastResultAtMs = new Map<number, number>();

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const variables: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    op.query = plan.networkQuery;

    const policy: CachePolicy = ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as CachePolicy;

    const readCacheFrame = (): OperationResult<any> | null => {
      const r = documents.materializeDocument({ document, variables }) as any;
      if (!r || r.status !== "FULFILLED") return null;
      return { data: r.data, error: null };
    };

    if (plan.operation === "mutation") {
      const originalUseResult = ctx.useResult;
      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return originalUseResult(incoming, true);
        }
        documents.normalizeDocument({ document, variables, data: incoming.data });
        return originalUseResult({ data: incoming.data, error: null }, true);
      };
      return;
    }

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
                  documents.normalizeDocument({ document, variables, data: frame.data });
                }
                observer.next(frame);
              },
              error: (error: any) => {
                observer.error?.(error);
              },
              complete: () => {
                observer.complete?.();
              },
            });
          },
        };
        return originalUseResult(interceptor as any, terminal);
      };
      return;
    }

    if (ssr?.isHydrating?.() && policy !== "network-only") {
      const cached = readCacheFrame();
      if (cached) {
        return ctx.useResult(cached, true);
      }
    }

    const key = op.key as number;
    const last = lastResultAtMs.get(key);
    const isWithinSuspensionWindow = last != null && performance.now() - last <= suspensionTimeout;

    if (policy === "cache-only") {
      const cached = readCacheFrame();
      if (cached) {
        return ctx.useResult(cached, true);
      }
      const error = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return ctx.useResult({ error, data: undefined }, true);
    }

    if (policy === "cache-first") {
      const cached = readCacheFrame();
      if (cached) {
        ctx.useResult(cached, true);
        return;
      }
      lastResultAtMs.set(key, performance.now());
    }

    if (policy === "cache-and-network") {
      const cached = readCacheFrame();
      if (cached) {
        if (isWithinSuspensionWindow) {
          ctx.useResult(cached, true);
          return;
        }
        ctx.useResult(cached, false);
        lastResultAtMs.set(key, performance.now());
      }
    }

    if (policy === "network-only" && isWithinSuspensionWindow) {
      const cached = readCacheFrame();
      if (cached) {
        ctx.useResult(cached, true);
        return;
      }
    }

    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult) => {
      lastResultAtMs.set(key, performance.now());
      if (incoming?.error) {
        return originalUseResult(incoming, true);
      }
      documents.normalizeDocument({ document, variables, data: incoming.data });
      const r = documents.materializeDocument({ document, variables }) as any;
      return originalUseResult({ data: r?.data, error: null }, true);
    };
  };
}

export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
