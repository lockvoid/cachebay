import type { App } from "vue";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import { CombinedError } from "villus";
import { parse, Kind, type ValueNode, type FieldNode, type OperationDefinitionNode } from "graphql";
import { ensureDocumentHasTypenames } from "./utils"; // your existing helper

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PluginOptions = { addTypename?: boolean };

type CachebayCtx = {
  viewKey?: string;
  paginationMode?: "auto" | "append" | "prepend" | "replace";
};

type PluginDependencies = {
  graph: {
    // selections/entities API (new graph.ts)
    putSelection: (key: string, subtree: any) => void;
    getSelection: (key: string) => any | undefined;
    materializeSelection: (key: string) => any;
  };
  selections: {
    buildRootSelectionKey: (field: string, args?: Record<string, any>) => string;
    compileSelections: (input: { data: any }) => Array<{ key: string; subtree: any }>;
  };
  resolvers: {
    // generic field resolvers (new resolvers.ts)
    applyOnObject: (
      root: any,
      variables: Record<string, any>,
      hint?: { stale?: boolean; viewKey?: string; paginationMode?: CachebayCtx["paginationMode"] }
    ) => void;
  };
  views: {
    createSession: () => {
      mountSelection: (selectionKey: string) => any;
      destroy: () => void;
    };
  };
  ssr?: {
    // retained for symmetry (not used to gate cache publish without op-cache)
    hydrateOperationTicket?: Set<string>;
    isHydrating?: () => boolean;
  };
};

export const CACHEBAY_KEY: unique symbol = Symbol("CACHEBAY_KEY");

// ─────────────────────────────────────────────────────────────────────────────
// Small GraphQL helpers (inline to avoid coupling)
// ─────────────────────────────────────────────────────────────────────────────

const valueNodeToJS = (node: ValueNode, vars?: Record<string, any>): any => {
  switch (node.kind) {
    case Kind.NULL: return null;
    case Kind.INT: return Number(node.value);
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

const fieldArgsObject = (field: FieldNode, vars?: Record<string, any>): Record<string, any> | undefined => {
  if (!field.arguments || field.arguments.length === 0) return undefined;
  const out: Record<string, any> = {};
  for (const arg of field.arguments) out[arg.name.value] = valueNodeToJS(arg.value, vars);
  return out;
};

const topLevelFieldsFromQuery = (document: any): FieldNode[] => {
  const doc = typeof document === "string" ? parse(document) : document;
  const op = doc.definitions.find(
    (d: any): d is OperationDefinitionNode =>
      d.kind === Kind.OPERATION_DEFINITION && d.operation === "query"
  );
  if (!op || !op.selectionSet) return [];
  return op.selectionSet.selections.filter((s): s is FieldNode => s.kind === Kind.FIELD);
};

// ─────────────────────────────────────────────────────────────────────────────
// Core helpers
// ─────────────────────────────────────────────────────────────────────────────

const shallowClone = <T,>(value: T): T => {
  if (!value || typeof value !== "object") return value;
  return Array.isArray(value) ? (value.slice() as any) : ({ ...(value as any) } as any);
};

const deepSnapshot = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * Try to materialize a cache result for the given query/variables.
 * We only look at top-level fields of the query:
 *  - build root selection keys with selections.buildRootSelectionKey
 *  - if ALL requested root fields have selection skeletons in graph, we assemble an object
 *    with those materialized selections and return it (else return null).
 */
function tryReadFromCache(
  deps: Pick<PluginDependencies, "graph" | "selections">,
  queryDoc: any,
  variables: Record<string, any>
): any | null {
  const fields = topLevelFieldsFromQuery(queryDoc);
  if (fields.length === 0) return null;

  const wanted: Array<{ outKey: string; selKey: string }> = [];

  for (const f of fields) {
    const outKey = f.alias?.value ?? f.name.value;
    const argsObj = fieldArgsObject(f, variables) || {};
    const selKey = deps.selections.buildRootSelectionKey(f.name.value, argsObj);
    // if any top-level field is missing in cache → miss the whole op
    if (!deps.graph.getSelection(selKey)) return null;
    wanted.push({ outKey, selKey });
  }

  const result: Record<string, any> = { __typename: "Query" };
  for (const { outKey, selKey } of wanted) {
    result[outKey] = deps.graph.materializeSelection(selKey);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin factory
// ─────────────────────────────────────────────────────────────────────────────

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { addTypename = true } = options;
  const { graph, selections, resolvers, views } = deps;

  // one session per villus-operation
  const sessionByOp = new Map<number, { mountSelection: (k: string) => any; destroy: () => void }>();

  const plugin: ClientPlugin = (ctx: ClientPluginContext) => {
    const { operation } = ctx;
    if (addTypename && operation.query) {
      operation.query = ensureDocumentHasTypenames(operation.query as any);
    }

    // per-op session
    let session = sessionByOp.get(operation.key);
    if (!session) {
      const s = views.createSession();
      session = { mountSelection: s.mountSelection, destroy: s.destroy };
      sessionByOp.set(operation.key, session);
    }

    const publish = (payload: OperationResult, terminal: boolean) => ctx.useResult(payload, terminal);
    const policy =
      (operation as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network";

    const cachebay: CachebayCtx = ((operation as any).context?.cachebay) || {};
    const vars = operation.variables || {};

    // Cache-pre-pass (for cache-first/cache-only/cache-and-network)
    const cachedHit = tryReadFromCache({ graph, selections }, operation.query, vars);

    if (policy === "cache-only") {
      if (cachedHit) {
        return publish({ data: deepSnapshot(cachedHit) }, true);
      }
      const err = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return publish({ error: err }, true);
    }

    if (policy === "cache-first" && cachedHit) {
      return publish({ data: deepSnapshot(cachedHit) }, true);
    }

    if (policy === "cache-and-network" && cachedHit) {
      publish({ data: deepSnapshot(cachedHit) }, false); // non-terminal cached
      // continue to network path
    }

    // Wrap network publishing: normalize + write selections + materialize
    const originalUseResult = ctx.useResult;
    ctx.useResult = (incoming: OperationResult, terminal?: boolean) => {
      const r: any = incoming;
      const hasData = r && "data" in r && r.data != null;
      const hasError = r && "error" in r && r.error != null;

      if (!hasData && !hasError) return originalUseResult(incoming, false);
      if (hasError) return originalUseResult(incoming, true);

      // 1) apply resolvers (relay etc.) on a shallow clone
      const payload = shallowClone(r.data);
      resolvers.applyOnObject(payload, vars, { stale: false, ...cachebay });

      // 2) derive & write selection skeletons
      const entries = selections.compileSelections({ data: payload });
      for (let i = 0; i < entries.length; i++) {
        graph.putSelection(entries[i].key, entries[i].subtree);
      }

      // 3) materialize root for publish: for each top-level field, if we have a selection key,
      //    replace that subtree with the materialized selection proxy; otherwise leave as-is.
      const fields = topLevelFieldsFromQuery(operation.query);
      const out: Record<string, any> = { __typename: "Query" };
      for (const f of fields) {
        const outKey = f.alias?.value ?? f.name.value;
        const argsObj = fieldArgsObject(f, vars) || {};
        const selKey = selections.buildRootSelectionKey(f.name.value, argsObj);
        const skel = graph.getSelection(selKey);
        if (skel) {
          const proxy = graph.materializeSelection(selKey);
          session!.mountSelection(selKey); // keep mounted in this session
          out[outKey] = proxy;
        } else {
          // fallback: publish the resolved subtree (rare: non-connection simple objects)
          out[outKey] = (payload as any)[outKey];
        }
      }

      return originalUseResult({ data: out }, true);
    };
  };
  return plugin;
}

// Back-compat name used by your tests previously
export const buildCachebayPlugin = createPlugin;

// Provide minimal public API for Vue apps (unchanged)
export function provideCachebay(app: App, instance: any) {
  const api: any = {
    hasFragment: (instance as any).hasFragment,
    readFragment: instance.readFragment,
    writeFragment: instance.writeFragment,
    identify: instance.identify,
    modifyOptimistic: instance.modifyOptimistic,
    inspect: (instance as any).inspect,
  };
  app.provide(CACHEBAY_KEY, api);
}
