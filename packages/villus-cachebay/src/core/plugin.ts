/* src/core/plugin.ts */
 
import { CombinedError } from "villus";

import { CACHEBAY_KEY, ROOT_ID } from "./constants";
import { buildConnectionCanonicalKey } from "./utils";
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

export type PluginOptions = {
  /** Time window (ms) after a successful result in which repeat Suspense re-execs are served from cache & do not refetch */
  suspensionTimeout?: number;
};

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { graph, documents, planner, ssr } = deps;
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

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy: "cache-and-network" | "cache-first" | "network-only" | "cache-only" =
      ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as any;

    const buildCachedFrame = (): OperationResult<any> | null => {
      if (!documents.hasDocument({ document, variables: vars })) return null;

      const rootConnections = plan.root.filter((f) => f.isConnection);

      // No root @connection → just materialize entities
      if (rootConnections.length === 0) {
        const data = documents.materializeDocument({ document, variables: vars });
        return { data, error: null };
      }

      // Determine cursor role
      const detectRole = (field: any) => {
        const req = field.buildArgs ? (field.buildArgs(vars) || {}) : (vars || {});
        const has = (k: string) =>
          req[k] != null || Object.keys(vars || {}).some((n) => n.toLowerCase().includes(k) && vars[n] != null);
        return { hasAfter: has("after"), hasBefore: has("before") };
      };

      // Prewarm AFTER/BEFORE so the union grows immediately
      let didPrewarm = false;
      for (const f of rootConnections) {
        const { hasAfter, hasBefore } = detectRole(f);
        if (hasAfter || hasBefore) {
          documents.prewarmDocument({ document, variables: vars });
          didPrewarm = true;
          break;
        }
      }

      // Leader request: prewarm only if canonical is empty
      if (!didPrewarm) {
        const anyCanonicalReady = rootConnections.some((f) => {
          const canKey = buildConnectionCanonicalKey(f, ROOT_ID, vars);
          const can = graph.getRecord(canKey);
          return Array.isArray(can?.edges) && can.edges.length > 0;
        });
        if (!anyCanonicalReady) {
          documents.prewarmDocument({ document, variables: vars });
        }
      }

      const data = documents.materializeDocument({ document, variables: vars });

      // Emit only if at least one root connection has edges
      const hasEdges = rootConnections.some((f) => {
        const v = (data as any)?.[f.responseKey];
        return Array.isArray(v?.edges) && v.edges.length > 0;
      });

      return hasEdges ? { data, error: null } as OperationResult<any> : null;
    };

    if (plan.operation === "mutation") {
      const originalUseResult = ctx.useResult;
      ctx.useResult = (incoming: OperationResult, _terminal?: boolean) => {
        if (incoming?.error) return originalUseResult(incoming, true);
        documents.normalizeDocument({ document, variables: vars, data: incoming.data });
        return originalUseResult({ data: incoming.data, error: null }, true);
      };
      return;
    }

    if (plan.operation === "subscription") {
      const originalUseResult = ctx.useResult;
      ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
        if (incoming?.error) return originalUseResult(incoming, true);

        if (incoming?.data) {
          documents.normalizeDocument({ document, variables: vars, data: incoming.data });
        }

        // Do not force terminal; let the source control it
        return originalUseResult({ data: incoming.data, error: null }, !!terminal);
      };
      return;
    }

    // SSR: during hydrate, for non-network-only policies serve cached and stop; for network-only allow network
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

      lastResultAtMs.set(key, performance.now());
    }

    // cache-and-network
    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();

      if (cached) {
        if (withinSuspension) {
          publish(cached, true);

          return;
        }

        publish(cached, false);

        lastResultAtMs.set(key, performance.now());
      }
    }

    // network-only (and the network leg of cache-and-network)
    // If within suspension window, skip a duplicate fetch (prior result just landed)
    if (policy === "network-only") {
      if (withinSuspension) {
        const cached = buildCachedFrame();

        if (cached) {
          publish(cached, true);

          return;
        }
      }
    }

    const originalUseResult = ctx.useResult;

    ctx.useResult = (incoming: OperationResult, _terminal?: boolean) => {
      lastResultAtMs.set(key, performance.now());

      if (incoming?.error) {
        return originalUseResult(incoming, true);
      }

      // Normalize & materialize for queries
      documents.normalizeDocument({ document, variables: vars, data: incoming.data });
      const data = documents.materializeDocument({ document, variables: vars });

      // Stamp completion time for the suspension window

      return originalUseResult({ data, error: null }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
