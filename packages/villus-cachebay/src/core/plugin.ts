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

  // Active queries registry + reverse dependency index
  type ActiveEntry = {
    document: DocumentNode;
    variables: Record<string, any>;
    emit: (payload: OperationResult, terminal?: boolean) => void;
    deps: Set<string>;
  };

  const activeQueries = new Map<number, ActiveEntry>();
  const depIndex = new Map<string, Set<number>>(); // depId -> opKeys
  const lastResultAtMs = new Map<number, number>();

  const addDepsForQuery = (opKey: number, newDeps: Iterable<string>) => {
    const entry = activeQueries.get(opKey);
    if (!entry) return;

    // Remove old deps from index
    for (const d of entry.deps) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(opKey);
        if (set.size === 0) depIndex.delete(d);
      }
    }

    // Set new deps
    entry.deps = new Set(newDeps);

    // Add to index
    for (const d of entry.deps) {
      let set = depIndex.get(d);
      if (!set) {
        set = new Set();
        depIndex.set(d, set);
      }
      set.add(opKey);
    }
  };

  const broadcastTouched = (touched?: Set<string>) => {
    if (!touched || touched.size === 0) return;

    // Collect affected queries via depIndex
    const affected = new Set<number>();
    for (const id of touched) {
      const qs = depIndex.get(id);
      if (qs) for (const k of qs) affected.add(k);
    }
    if (affected.size === 0) return;

    const now = performance.now();
    for (const k of affected) {
      const entry = activeQueries.get(k);
      if (!entry) continue;

      // Non-terminal refreshes always use CANONICAL for best-effort UI
      const r = documents.materializeDocument({
        document: entry.document,
        variables: entry.variables,
        decisionMode: "canonical",
      }) as any;

      if (!r || r.status !== "FULFILLED") continue;

      // Update deps (graph shape may have shifted)
      addDepsForQuery(k, Array.isArray(r.deps) ? r.deps : []);

      entry.emit({ data: r.data, error: null }, false);
      lastResultAtMs.set(k, now);
    }
  };

  // Map cache policy to decision mode for the FIRST cache read
  const firstReadMode = (policy: CachePolicy): "strict" | "canonical" => {
    switch (policy) {
      case "cache-first":
      case "cache-only":
        return "strict";
      case "cache-and-network":
      case "network-only":
      default:
        return "canonical";
    }
  };

  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const variables: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // Use compiled network query
    op.query = plan.networkQuery;

    const policy: CachePolicy = ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as CachePolicy;

    const downstreamUseResult = ctx.useResult;

    const readCacheFrame = (
      mode: "strict" | "canonical",
    ): { frame: OperationResult<any> | null; deps: string[] } => {
      const r = documents.materializeDocument({ document, variables, decisionMode: mode }) as any;
      if (!r || r.status !== "FULFILLED") return { frame: null, deps: [] };
      return { frame: { data: r.data, error: null }, deps: Array.isArray(r.deps) ? r.deps : [] };
    };

    // ---- MUTATION ----
    if (plan.operation === "mutation") {
      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return downstreamUseResult(incoming, true);
        }
        const res: any = documents.normalizeDocument({ document, variables, data: incoming.data });

        // Re-materialize impacted queries (non-terminal)
        broadcastTouched(res?.touched);

        // Return mutation payload to caller (terminal)
        return downstreamUseResult({ data: incoming.data, error: null }, true);
      };
      return;
    }

    // ---- SUBSCRIPTION ----
    if (plan.operation === "subscription") {
      ctx.useResult = (incoming, terminal) => {
        if (typeof incoming?.subscribe !== "function") {
          return downstreamUseResult(incoming, terminal);
        }
        const interceptor = {
          subscribe(observer: any) {
            return incoming.subscribe({
              next: (frame: any) => {
                if (frame?.data) {
                  const res: any = documents.normalizeDocument({ document, variables, data: frame.data });
                  broadcastTouched(res?.touched);
                }
                observer.next(frame);
              },
              error: (error: any) => observer.error?.(error),
              complete: () => observer.complete?.(),
            });
          },
        };
        return downstreamUseResult(interceptor as any, terminal);
      };
      return;
    }

    // ---- QUERY ----
    const opKey = op.key as number;

    // Register active query
    activeQueries.set(opKey, {
      document,
      variables,
      emit: (payload, terminal) => downstreamUseResult(payload, terminal),
      deps: new Set(),
    });

    // SSR hydration: prefer STRICT so we don't accidentally accept only-canonical cache
    if (ssr?.isHydrating?.() && policy !== "network-only") {
      const { frame, deps } = readCacheFrame("strict");
      if (frame) {
        addDepsForQuery(opKey, deps);
        return downstreamUseResult(frame, true);
      }
    }

    const last = lastResultAtMs.get(opKey);
    const isWithinSuspensionWindow = last != null && performance.now() - last <= suspensionTimeout;

    // CACHE-ONLY
    if (policy === "cache-only") {
      const { frame, deps } = readCacheFrame(firstReadMode(policy));
      if (frame) {
        addDepsForQuery(opKey, deps);
        return downstreamUseResult(frame, true);
      }
      const error = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      return downstreamUseResult({ error, data: undefined }, true);
    }

    // CACHE-FIRST
    if (policy === "cache-first") {
      const { frame, deps } = readCacheFrame(firstReadMode(policy)); // STRICT
      if (frame) {
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        return;
      }
      lastResultAtMs.set(opKey, performance.now());
    }

    // CACHE-AND-NETWORK
    if (policy === "cache-and-network") {
      const { frame, deps } = readCacheFrame(firstReadMode(policy)); // CANONICAL
      if (frame) {
        if (isWithinSuspensionWindow) {
          addDepsForQuery(opKey, deps);
          downstreamUseResult(frame, true);
          return;
        }
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, false); // non-terminal, allow network to arrive
        lastResultAtMs.set(opKey, performance.now());
      }
    }

    // NETWORK-ONLY: short-circuit with recent cached result (use CANONICAL for best-effort)
    if (policy === "network-only" && isWithinSuspensionWindow) {
      const { frame, deps } = readCacheFrame("canonical");
      if (frame) {
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        return;
      }
    }

    // Handle network result
    ctx.useResult = (incoming: OperationResult) => {
      lastResultAtMs.set(opKey, performance.now());

      if (incoming?.error) {
        return downstreamUseResult(incoming, true);
      }

      const res: any = documents.normalizeDocument({ document, variables, data: incoming.data });

      // Re-materialize THIS query terminally using CANONICAL (ensures unions for pagination)
      const r = documents.materializeDocument({
        document,
        variables,
        decisionMode: "canonical",
      }) as any;

      if (r && r.status === "FULFILLED") {
        addDepsForQuery(opKey, Array.isArray(r.deps) ? r.deps : []);
        downstreamUseResult({ data: r.data, error: null }, true);
      } else {
        // Fallback: return raw payload if materialization fails
        downstreamUseResult({ data: incoming.data, error: null }, true);
      }

      // Notify only impacted OTHER queries
      broadcastTouched(res?.touched);
    };
  };
}

export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
