// src/core/plugin.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
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

/**
 * Mount all connection composers for the given operation+variables — only for pages
 * that already exist in the graph.
 */
function mountConnectionsForOperation(
  deps: { graph: GraphInstance; planner: PlannerInstance },
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

    // 1a) Multi-parent nested under root connection nodes (users.edges[].node.childConn)
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

            const childPageKey = buildConnectionKey(childField, parentRef, variables);
            if (!graph.getRecord(childPageKey)) continue; // mount only if present

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

    const rootSnap = graph.getRecord(ROOT_ID) || {};
    const linkKey = buildFieldKey(parentField, variables);
    const parentRef: string | undefined = rootSnap?.[linkKey]?.__ref;
    if (!parentRef) continue;

    for (const [, childField] of childMap) {
      if (!childField.isConnection) continue;

      const pageKey = buildConnectionKey(childField, parentRef, variables);
      if (!graph.getRecord(pageKey)) continue;

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

/**
 * Overlay composer views into the materialized operation result so the UI sees
 * unified/deduped edges instead of per-page snapshots. Works recursively via plan.
 */
function overlayConnections(
  view: any,
  plan: any, // CachePlanV1
  session: ReturnType<SessionsInstance["createSession"]>, // ✅ use session, not sessions
  graph: GraphInstance,
  planner: PlannerInstance,
  variables: Record<string, any>
) {
  if (!view || typeof view !== "object") return;

  const applyAt = (parentValue: any, parentFields: any[] | null | undefined, parentRecordId: string) => {
    if (!parentValue || typeof parentValue !== "object" || !parentFields) return;

    for (let i = 0; i < parentFields.length; i++) {
      const field = parentFields[i];

      // Connection field → swap with composer view if available
      if (field.isConnection) {
        const identityKey = buildConnectionIdentity(field, parentRecordId, variables);
        const composer = session.getConnection(identityKey);
        if (composer) {
          parentValue[field.responseKey] = composer.getView();
        }
        continue;
      }

      // Recurse into nested fields if selection exists
      if (field.selectionSet && field.selectionSet.length > 0) {
        const child = parentValue[field.responseKey];
        if (!child) continue;

        // Single entity (materialized with __typename/id)
        if (child && typeof child === "object" && child.__typename && child.id != null) {
          const nextParentId = `${child.__typename}:${child.id}`;
          applyAt(child, field.selectionSet, nextParentId);
          continue;
        }

        // Arrays of entities
        if (Array.isArray(child)) {
          for (let k = 0; k < child.length; k++) {
            const item = child[k];
            if (item && typeof item === "object" && item.__typename && item.id != null) {
              const nextParentId = `${item.__typename}:${item.id}`;
              applyAt(item, field.selectionSet, nextParentId);
            }
          }
        }
      }
    }
  };

  applyAt(view, plan.root, ROOT_ID);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Main plugin
 * ────────────────────────────────────────────────────────────────────────── */

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = false } = options;
  const { graph, planner, documents, sessions } = deps;

  // one session per operation.key
  const sessionByOpKey = new Map<number, ReturnType<SessionsInstance["createSession"]>>();

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const vars: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;

    // optional addTypename hook if you have a pass (left as no-op)
    if (addTypename && typeof op.query === "string") {
      // e.g., op.query = ensureDocumentHasTypenames(op.query as any);
    }

    // per-op session
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
      // mount composers for whatever pages already exist
      mountConnectionsForOperation({ graph, planner }, session!, document, vars);

      const view = documents.materializeDocument({ document, variables: vars });
      const plan = planner.getPlan(document);
      overlayConnections(view, plan, session!, graph, planner, vars);

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
      return publish({ error: err }, true);
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
      const hasData = !!incoming?.data;
      const hasError = !!incoming?.error;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      // 1) normalize result into graph
      const mutable = deepCopy(incoming.data);
      documents.normalizeDocument({ document, variables: vars, data: mutable });

      // 2) mount composers for any pages now present
      mountConnectionsForOperation({ graph, planner }, session!, document, vars);

      // 3) materialize + overlay (connection views via composers)
      const view = documents.materializeDocument({ document, variables: vars });
      const plan = planner.getPlan(document);
      overlayConnections(view, plan, session!, graph, planner, vars);

      return originalUseResult({ data: view }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
