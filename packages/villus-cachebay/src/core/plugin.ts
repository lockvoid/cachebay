// src/core/plugin.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import { parse, Kind, type DocumentNode, type ValueNode, type FieldNode } from "graphql";

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

type PluginOptions = { addTypename?: boolean };

type PluginDependencies = {
  graph: {
    getSelection: (key: string) => any | undefined;
    putSelection: (key: string, subtree: any) => void;
  };
  selections: {
    buildQuerySelectionKey: (field: string, args?: Record<string, any>) => string;
  };
  views: {
    createSession: () => {
      mountSelection: (selectionKey: string) => any;
      destroy: () => void;
    };
  };
  resolvers: {
    applyOnObject: (root: any, vars?: Record<string, any>, hint?: { stale?: boolean }) => void;
  };
  ssr?: {
    /** optional: if present, allows CN to prefer cached-first immediately after hydrate */
    hydrateSelectionTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

// ---------- small helpers (AST → args/keys) ----------
const valueNodeToJS = (node: ValueNode, vars?: Record<string, any>): any => {
  switch (node.kind) {
    case Kind.NULL: return null;
    case Kind.INT:
    case Kind.FLOAT: return Number(node.value);
    case Kind.STRING: return node.value;
    case Kind.BOOLEAN: return node.value;
    case Kind.ENUM: return node.value;
    case Kind.LIST: return node.values.map(v => valueNodeToJS(v, vars));
    case Kind.OBJECT: {
      const o: Record<string, any> = {};
      for (const f of node.fields) o[f.name.value] = valueNodeToJS(f.value, vars);
      return o;
    }
    case Kind.VARIABLE: return vars ? vars[node.name.value] : undefined;
    default: return undefined;
  }
};

const argsToObject = (field: FieldNode, vars?: Record<string, any>): Record<string, any> | undefined => {
  if (!field.arguments || field.arguments.length === 0) return undefined;
  const out: Record<string, any> = {};
  for (const a of field.arguments) out[a.name.value] = valueNodeToJS(a.value, vars);
  return out;
};

type RootPick = {
  alias: string;
  name: string;
  args: Record<string, any> | undefined;
  keyArg: string;     // e.g. posts({"first":2})
  keyEmpty: string;   // e.g. posts({})
};

const rootPicksFromQuery = (
  doc: DocumentNode,
  variables: Record<string, any>,
  buildQuerySelectionKey: (field: string, args?: Record<string, any>) => string
): RootPick[] => {
  const def = doc.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
  if (!def || def.kind !== Kind.OPERATION_DEFINITION || !def.selectionSet) return [];
  const picks: RootPick[] = [];
  for (const sel of def.selectionSet.selections) {
    if (sel.kind !== Kind.FIELD) continue;
    const name = sel.name.value;
    const alias = sel.alias?.value ?? name;
    const args = argsToObject(sel, variables);
    const keyArg = buildQuerySelectionKey(name, args || {});
    const keyEmpty = buildQuerySelectionKey(name, {});
    picks.push({ alias, name, args, keyArg, keyEmpty });
  }
  return picks;
};

// ---------- deep copy helper (no proxies) ----------
const deepCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---------- main plugin ----------
export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, selections, views, resolvers, ssr } = deps;

  // one session (mountSelection/destroy) per operation.key
  const sessions = new Map<number, { mountSelection: (key: string) => any; destroy: () => void }>();

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;

    // if you have an add-typename pass, insert here (optional)
    if (addTypename && typeof op.query === "string") {
      // e.g. op.query = ensureDocumentHasTypenames(op.query as any);
    }

    // Normalize query to DocumentNode
    const doc: DocumentNode = typeof op.query === "string" ? parse(op.query) : (op.query as DocumentNode);
    const vars = op.variables || {};
    const picks = rootPicksFromQuery(doc, vars, selections.buildQuerySelectionKey);

    // Session per operation
    let session = sessions.get(op.key);
    if (!session) {
      const s = views.createSession();
      session = { mountSelection: s.mountSelection, destroy: s.destroy };
      sessions.set(op.key, session);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy: string = (op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    // ————————————————————————————————————————————————————————————————
    // Cached frame builder: tries arg-key first, then {} fallback
    // ————————————————————————————————————————————————————————————————
    const buildCachedFrame = () => {
      const out: any = { __typename: "Query" };
      let anyHit = false;

      for (const p of picks) {
        let hit = graph.getSelection(p.keyArg);
        if (!hit) hit = graph.getSelection(p.keyEmpty);
        if (hit) {
          anyHit = true;
          // prefer mounting arg key if present; else mount empty
          const chosenKey = graph.getSelection(p.keyArg) ? p.keyArg : p.keyEmpty;
          out[p.alias] = session!.mountSelection(chosenKey);
        }
      }

      return anyHit ? { data: out } : null;
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
      // fall through to network
    }

    // cache-and-network
    if (policy === "cache-and-network") {
      // SSR ticket (optional): treat first mount after hydrate as cached-first
      let usedTicket = false;
      if (ssr?.hydrateSelectionTicket) {
        for (const p of picks) {
          if (ssr.hydrateSelectionTicket.has(p.keyArg) || ssr.hydrateSelectionTicket.has(p.keyEmpty)) {
            usedTicket = true;
            ssr.hydrateSelectionTicket.delete(p.keyArg);
            ssr.hydrateSelectionTicket.delete(p.keyEmpty);
          }
        }
      }
      const cached = buildCachedFrame();
      if (cached) publish(cached, false);
      // network follows regardless; ticket only influences terminal flag on cached frame
    }

    // network-only or network follow-up
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      // 1) Apply resolvers (e.g., relay merge) on a deep copy
      const mutable = deepCopy(r.data);
      resolvers.applyOnObject(mutable, vars, { stale: false });

      // 2) For each root field: write BOTH selection keys (arg-shaped and empty)
      const out: any = { __typename: "Query" };
      for (const p of picks) {
        const subtree = (mutable as any)[p.alias]; // alias in response object
        if (subtree !== undefined) {
          // write arg-shaped key
          graph.putSelection(p.keyArg, subtree);
          // also write the empty-args variant so other code paths can hit it
          if (p.keyEmpty !== p.keyArg) {
            graph.putSelection(p.keyEmpty, subtree);
          }
          // mount (prefer arg-shaped key)
          out[p.alias] = session!.mountSelection(p.keyArg);
        }
      }

      // 3) Publish terminal frame
      return originalUseResult({ data: out }, true);
    };
  };
}

export function provideCachebay(app: App, instance: any) {
  app.provide(CACHEBAY_KEY, instance);
}
