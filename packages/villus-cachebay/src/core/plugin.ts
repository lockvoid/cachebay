/* src/core/plugin.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import type { DocumentNode } from "graphql";

import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";

import { CACHEBAY_KEY } from "./constants";
import { ROOT_ID } from "./constants";
import { buildConnectionCanonicalKey } from "./utils";

type PluginOptions = { addTypename?: boolean };

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr?: { isHydrating?: () => boolean };
};

// shallow copy to avoid mutating caller payloads
const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Decide if we must prewarm (rebuild canonical from concrete page)
 * for the current operation's **root** @connection fields.
 * If all root canonicals already exist, we should NOT prewarm — this preserves
 * any cached union (e.g., leader+after) for the first cache-and-network emission.
 */
function shouldPrewarmRootConnections(
  graph: GraphInstance,
  planner: PlannerInstance,
  document: DocumentNode,
  variables: Record<string, any>
): boolean {
  const plan = planner.getPlan(document);
  // If the op has no root @connection, nothing to prewarm.
  let sawAnyConnection = false;

  for (let i = 0; i < plan.root.length; i++) {
    const field = plan.root[i];
    if (!field.isConnection) continue;
    sawAnyConnection = true;

    const canKey = buildConnectionCanonicalKey(field, ROOT_ID, variables);
    const exists = !!graph.getRecord(canKey);
    // If any root canonical is missing, we should prewarm.
    if (!exists) return true;
  }
  // No root @connection? Then prewarm is unnecessary for this op.
  if (!sawAnyConnection) return false;

  // All root @connection canonicals are present → no prewarm.
  return false;
}

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = false } = options;
  const { graph, documents, planner } = deps;

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

    const buildCachedFrame = () => {

      // We need the document present (links/pages/canonicals) to build a view
      if (!documents.hasDocument({ document, variables: vars })) {
        //   console.log('Graphql document not found', graph.inspect());
        return null;
      }

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

    // cache-and-network: publish cached (non-terminal) if present, then do network
    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();


      if (cached) {
        console.log("Publishing cached frame", ctx, JSON.stringify(cached));
        publish(cached, false);
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
      const mutable = deepCopy(incoming.data);
      documents.normalizeDocument({ document, variables: vars, data: mutable });

      // 2) Materialize from CANONICAL (ensures stable views)
      const view = documents.materializeDocument({ document, variables: vars });

      return originalUseResult({ data: view }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
