// src/core/plugin.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus"; // ✅ import CombinedError
import type { DocumentNode } from "graphql";

import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { DocumentsInstance } from "./documents";
import type { SessionsInstance } from "./sessions";

import { ROOT_ID } from "./constants";
import { buildFieldKey, buildConnectionKey, buildConnectionIdentity } from "./utils";

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

type PluginOptions = { addTypename?: boolean };

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  sessions: SessionsInstance;
  ssr?: { isHydrating?: () => boolean };
};

const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function mountConnectionsForOperation(
  deps: { graph: GraphInstance; planner: PlannerInstance; sessions: SessionsInstance },
  session: ReturnType<SessionsInstance["createSession"]>,
  docOrPlan: DocumentNode | any,
  variables: Record<string, any>
) {
  const { graph, planner } = deps;
  const plan = planner.getPlan(docOrPlan);

  // 1) Root connections
  for (let i = 0; i < plan.root.length; i++) {
    const field = plan.root[i];
    if (!field.isConnection) continue;

    const identityKey = buildConnectionIdentity(field, ROOT_ID, variables);
    const pageKey = buildConnectionKey(field, ROOT_ID, variables);

    if (graph.getRecord(pageKey)) {
      const composer = session.mountConnection({
        identityKey,
        mode: field.connectionMode ?? "infinite",
        dedupeBy: "cursor",
      });
      composer.addPage(pageKey);
    }

    // 3) Multi-parent nested under root connection nodes
    const edgesField = field.selectionMap?.get("edges");
    const nodeField = edgesField?.selectionMap?.get("node");
    if (nodeField?.selectionMap) {
      const nodeChildMap = nodeField.selectionMap;
      const page = graph.getRecord(pageKey);
      if (page && Array.isArray(page.edges)) {
        for (let e = 0; e < page.edges.length; e++) {
          const edgeRef = page.edges[e]?.__ref;
          if (!edgeRef) continue;
          const edgeRec = graph.getRecord(edgeRef);
          const parentRef = edgeRec?.node?.__ref;
          if (!parentRef) continue;

          for (const [, childField] of nodeChildMap) {
            if (!childField.isConnection) continue;

            // ✅ only mount if child page exists
            const childPageKey = buildConnectionKey(childField, parentRef, variables);
            if (!graph.getRecord(childPageKey)) continue;

            const childIdentity = buildConnectionIdentity(childField, parentRef, variables);
            const childComposer = session.mountConnection({
              identityKey: childIdentity,
              mode: childField.connectionMode ?? "infinite",
              dedupeBy: "cursor",
            });
            childComposer.addPage(childPageKey);
          }
        }
      }
    }
  }

  // 2) Nested single-parent under root entity fields
  for (let i = 0; i < plan.root.length; i++) {
    const parentField = plan.root[i];
    if (parentField.isConnection) continue;

    const childMap: Map<string, any> | undefined = parentField.selectionMap;
    if (!childMap) continue;

    const linkKey = buildFieldKey(parentField, variables);
    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const parentRef: string | undefined = rootSnap?.[linkKey]?.__ref;
    if (!parentRef) continue;

    for (const [, childField] of childMap) {
      if (!childField.isConnection) continue;

      const pageKey = buildConnectionKey(childField, parentRef, variables);
      if (!graph.getRecord(pageKey)) continue; // ✅ skip empty

      const identityKey = buildConnectionIdentity(childField, parentRef, variables);
      const composer = session.mountConnection({
        identityKey,
        mode: childField.connectionMode ?? "infinite",
        dedupeBy: "cursor",
      });
      composer.addPage(pageKey);
    }
  }
}

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = false } = options;
  const { graph, planner, documents, sessions } = deps;

  const sessionByOpKey = new Map<number, ReturnType<SessionsInstance["createSession"]>>();

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const vars: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;

    if (addTypename && typeof op.query === "string") {
      // optional hook
    }

    let session = sessionByOpKey.get(op.key);
    if (!session) {
      session = sessions.createSession();
      sessionByOpKey.set(op.key, session);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy: string =
      (op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    const buildCachedFrame = () => {
      if (!documents.hasDocument({ document, variables: vars })) return null;
      mountConnectionsForOperation({ graph, planner, sessions }, session!, document, vars);
      const view = documents.materializeDocument({ document, variables: vars });
      return { data: view };
    };

    if (policy === "cache-only") {
      const cached = buildCachedFrame();
      if (cached) return publish(cached, true);
      const err = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return publish({ error: err }, true);
    }

    if (policy === "cache-first") {
      const cached = buildCachedFrame();
      if (cached) return publish(cached, true);
    }

    if (policy === "cache-and-network") {
      const cached = buildCachedFrame();
      if (cached) publish(cached, false);
    }

    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const hasData = !!incoming?.data;
      const hasError = !!incoming?.error;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      const mutable = deepCopy(incoming.data);
      documents.normalizeDocument({ document, variables: vars, data: mutable });

      mountConnectionsForOperation({ graph, planner, sessions }, session!, document, vars);

      const view = documents.materializeDocument({ document, variables: vars });
      return originalUseResult({ data: view }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
