/* src/core/plugin.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import type { DocumentNode } from "graphql";

import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";
import type { SSRInstance } from "./ssr";

import { CACHEBAY_KEY } from "./constants";
import { ROOT_ID } from "./constants";
import { buildConnectionCanonicalKey } from "./utils";

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr?: SSRInstance,
};

export function createPlugin(deps: PluginDependencies): ClientPlugin {
  const { graph, documents, planner, ssr } = deps;

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const vars: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // always use compiled networkQuery (strips @connection etc.)
    op.query = plan.networkQuery;

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);

    const policy: string =
      (op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    function buildCachedFrame() {
      // We need the document present (links/pages/canonicals) to build a view
      if (!documents.hasDocument({ document, variables: vars })) {
        return null;
      }

      const plan = planner.getPlan(document);
      const rootConnections = plan.root.filter((f) => f.isConnection);

      // If no root @connection, just materialize cached entities
      if (rootConnections.length === 0) {
        const view = documents.materializeDocument({ document, variables: vars });
        return { data: view };
      }

      // Helper: detect cursor role for this request
      const detectRole = (field: any) => {
        const req = field.buildArgs ? (field.buildArgs(vars) || {}) : (vars || {});
        const has = (k: string) =>
          req[k] != null ||
          Object.keys(vars || {}).some((n) => n.toLowerCase().includes(k) && vars[n] != null);
        return { hasAfter: has("after"), hasBefore: has("before") };
      };

      // If this request is AFTER/BEFORE, prewarm that page (so union grows immediately)
      let didPrewarm = false;
      for (const f of rootConnections) {
        const { hasAfter, hasBefore } = detectRole(f);
        if (hasAfter || hasBefore) {
          documents.prewarmDocument({ document, variables: vars });
          didPrewarm = true;
          break;
        }
      }

      // If leader request and canonicals already exist, DO NOT prewarm (preserve collapsed leader view)
      if (!didPrewarm) {
        const anyCanonicalReady = rootConnections.some((f) => {
          const canKey = buildConnectionCanonicalKey(f, ROOT_ID, vars);
          const can = graph.getRecord(canKey);
          return Array.isArray(can?.edges) && can.edges.length > 0;
        });

        // If no canonical edges yet, try to prewarm from concrete pages (if cached)
        if (!anyCanonicalReady) {
          documents.prewarmDocument({ document, variables: vars });
        }
      }

      const view = documents.materializeDocument({ document, variables: vars });

      // Only emit if at least one root connection has cached edges
      const hasEdges = rootConnections.some((f) => {
        const v = (view as any)?.[f.responseKey];
        return Array.isArray(v?.edges) && v.edges.length > 0;
      });

      return hasEdges ? { data: view } : null;
    }

    if (plan.operation === "mutation") {
      const originalUseResult = ctx.useResult;
      ctx.useResult = (incoming: OperationResult, _terminal?: boolean) => {
        if (incoming?.error) return originalUseResult(incoming, true);
        // Normalize side-effects into the graph
        documents.normalizeDocument({ document, variables: vars, data: incoming.data });
        // Forward original mutation payload (do NOT materialize)
        return originalUseResult({ data: incoming.data }, true);
      };
      return; // skip all cache/SSR paths (mutations are network-driven)
    }

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
      if (cached) return publish(cached, true);
      // else fall through to network
    }

    // cache-and-network: publish cached (non-terminal) if present, then do network
    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();

      if (cached) {
        publish(cached, ssr.isHydrating());
      }
    }

    // network-only or the network leg of cache-and-network
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const hasError = !!incoming?.error;

      if (hasError) {
        // On error we just pass it through; no graph writes
        return originalUseResult(incoming, true);
      }

      // 1) Normalize the network payload into the graph
      documents.normalizeDocument({ document, variables: vars, data: incoming.data });

      // 2) Materialize from CANONICAL (ensures stable views)
      const view = documents.materializeDocument({ document, variables: vars });

      return originalUseResult({ data: view }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
