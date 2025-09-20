/* src/core/plugin.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import type { DocumentNode } from "graphql";

import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

type PluginOptions = { addTypename?: boolean };

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr?: { isHydrating?: () => boolean };
};

const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = false } = options;
  const { documents, planner } = deps;

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const vars: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;

    // Optional addTypename hook (left as a no-op placeholder)
    if (addTypename && typeof op.query === "string") {
      // e.g. op.query = ensureDocumentHasTypenames(op.query as any);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy: string =
      (op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    const buildCachedFrame = () => {
      if (!documents.hasDocument({ document, variables: vars })) return null;

      documents.prewarmDocument({ document, variables: vars });

      const view = documents.materializeDocument({ document, variables: vars });

      return { data: view };
    };

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

    // cache-and-network: publish cached if present, then network
    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();

      if (cached) publish(cached, false);
    }

    // network-only or network follow-up
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const hasError = !!incoming?.error;

      if (hasError) {
        return originalUseResult(incoming, true);
      }

      // 1) Normalize into the graph
      const mutable = deepCopy(incoming.data);
      documents.normalizeDocument({ document, variables: vars, data: mutable });

      // 2) Materialize directly (reads canonical @connection views)
      const view = documents.materializeDocument({ document, variables: vars });

      return originalUseResult({ data: view }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
