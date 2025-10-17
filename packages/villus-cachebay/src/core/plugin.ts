import { CombinedError } from "villus";
import { markRaw } from "vue";
import { CACHEBAY_KEY } from "./constants";
import type { DocumentsInstance } from "./documents";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { SSRInstance } from "../features/ssr";
import type { DocumentNode } from "graphql";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import type { App } from "vue";

// bench //metrics (shared singleton in your bench project)
import { metrics } from "../../../benchmarks/src/ui/instrumentation";

type PluginDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  documents: DocumentsInstance;
  ssr: SSRInstance;
};

type CachePolicy = "cache-and-network" | "cache-first" | "network-only" | "cache-only";
type DecisionMode = "strict" | "canonical";

export type PluginOptions = {
  /** collapse network→cache duplicate re-emits for this many ms */
  suspensionTimeout?: number;
};

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { planner, documents, ssr } = deps;
  const { suspensionTimeout = 1000 } = options ?? {};

  type ActiveEntry = {
    document: DocumentNode;
    variables: Record<string, any>;
    emit: (payload: OperationResult, terminal?: boolean) => void;
    deps: Set<string>;
    mode: DecisionMode;
    lastData: any | undefined; // identity guard
  };

  const activeQueries = new Map<number, ActiveEntry>();
  const depIndex = new Map<string, Set<number>>();
  const lastResultAtMs = new Map<number, number>();

  // ---------- helpers ----------
  const finalizeQuery = (opKey: number) => {
    const entry = activeQueries.get(opKey);
    if (!entry) return;
    // remove from inverted dep index
    for (const d of entry.deps) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(opKey);
        if (set.size === 0) depIndex.delete(d);
      }
    }
    activeQueries.delete(opKey);
  };

  const addDepsForQuery = (opKey: number, newDeps: Iterable<string>) => {
    const entry = activeQueries.get(opKey);
    if (!entry) return;

    // remove old deps
    for (const d of entry.deps) {
      const set = depIndex.get(d);
      if (set) {
        set.delete(opKey);
        if (set.size === 0) depIndex.delete(d);
      }
    }

    // add new deps
    entry.deps = new Set(newDeps);
    for (const d of entry.deps) {
      let set = depIndex.get(d);
      if (!set) depIndex.set(d, (set = new Set()));
      set.add(opKey);
    }
  };

  const firstReadMode = (policy: CachePolicy): DecisionMode => {
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

  // ---------- batched broadcaster ----------
  const pendingTouched = new Set<string>();
  const excludedOpKeysForFlush = new Set<number>();
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    queueMicrotask(() => {
      flushScheduled = false;
      if (pendingTouched.size === 0) return;

      const flushStart = performance.now();

      // snapshot state for this flush
      const touched = Array.from(pendingTouched);
      pendingTouched.clear();
      const excluded = new Set(excludedOpKeysForFlush);
      excludedOpKeysForFlush.clear();

      // collect affected queries
      const affected = new Set<number>();
      for (const id of touched) {
        const qs = depIndex.get(id);
        if (qs) for (const k of qs) affected.add(k);
      }

      // //metrics
      //metrics.cachebay.broadcastRemats += affected.size;

      if (affected.size === 0) {
        //metrics.cachebay.broadcastFlushTime += performance.now() - flushStart;
        return;
      }

      // re-materialize each affected query once (skip excluded + identity guard)
      for (const k of affected) {
        if (excluded.has(k)) continue;

        const entry = activeQueries.get(k);
        if (!entry) continue;

        const t0 = performance.now();
        const r = documents.materializeDocument({
          document: entry.document,
          variables: entry.variables,
          decisionMode: entry.mode,
        }) as any;
        //metrics.cachebay.broadcastMaterializeTime += performance.now() - t0;

        if (!r || r.status !== "FULFILLED") continue;

        // update deps index
        const newDeps = Array.isArray(r.deps) ? r.deps : [];
        addDepsForQuery(k, newDeps);

        // emit only on identity change
        if (r.data !== entry.lastData) {
          entry.lastData = r.data;
          entry.emit({ data: markRaw(r.data), error: null }, false);
          lastResultAtMs.set(k, performance.now());
        } else {
          //metrics.cachebay.broadcastIdentitySkips += 1;
        }
      }

      //metrics.cachebay.broadcastFlushTime += performance.now() - flushStart;
    });
  };

  const enqueueTouched = (touched?: Set<string>, excludeOpKey?: number) => {
    if (!touched || touched.size === 0) return;
    for (const id of touched) pendingTouched.add(id);
    if (excludeOpKey != null) excludedOpKeysForFlush.add(excludeOpKey);
    scheduleFlush();
  };

  // ---------- cache reads (instrumented) ----------
  const readCacheFrame = (
    document: DocumentNode,
    variables: Record<string, any>,
    mode: DecisionMode
  ): { frame: OperationResult<any> | null; deps: string[]; dataRef: any | undefined } => {
    const t0 = performance.now();
    const r = documents.materializeDocument({ document, variables, decisionMode: mode }) as any;
    const dt = performance.now() - t0;

    //metrics.cachebay.readCacheFrames += 1;
    //if (mode === "canonical") //metrics.cachebay.readCanonicalTime += dt;
    //else metrics.cachebay.readStrictTime += dt;

    if (!r || r.status !== "FULFILLED") return { frame: null, deps: [], dataRef: undefined };
    return {
      frame: { data: markRaw(r.data), error: null },
      deps: Array.isArray(r.deps) ? r.deps : [],
      dataRef: r.data,
    };
  };

  // ---------- plugin ----------
  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const variables: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // Use compiled network query
    op.query = plan.networkQuery;

    const policy: CachePolicy = ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as CachePolicy;
    const downstreamUseResult = ctx.useResult;

    // ---------------- MUTATION ----------------
    if (plan.operation === "mutation") {
      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return downstreamUseResult(incoming, true);
        }
        const t1 = performance.now();
        const res: any = documents.normalizeDocument({ document, variables, data: incoming.data });
        //metrics.cachebay.normalizeDocumentTime += performance.now() - t1;

        enqueueTouched(res?.touched);
        return downstreamUseResult({ data: markRaw(incoming.data), error: null }, true);
      };
      return;
    }

    // ---------------- SUBSCRIPTION ----------------
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
                  const t1 = performance.now();
                  const res: any = documents.normalizeDocument({ document, variables, data: frame.data });
                  //metrics.cachebay.normalizeDocumentTime += performance.now() - t1;
                  enqueueTouched(res?.touched);
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

    // ---------------- QUERY ----------------
    const opKey = op.key as number;
    const modeForQuery = firstReadMode(policy);

    // register query upfront with its mode
    activeQueries.set(opKey, {
      document,
      variables,
      emit: (payload, terminal) => { downstreamUseResult(payload, terminal); },
      deps: new Set(),
      mode: modeForQuery,
      lastData: undefined,
    });

    // SSR hydration: prefer STRICT cache if available
    if (ssr?.isHydrating?.() && policy !== "network-only") {
      const { frame, deps, dataRef } = readCacheFrame(document, variables, "strict");
      if (frame) {
        const entry = activeQueries.get(opKey)!;
        entry.lastData = dataRef;
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        finalizeQuery(opKey);
        return;
      }
    }

    const last = lastResultAtMs.get(opKey);
    const isWithinSuspensionWindow = last != null && performance.now() - last <= suspensionTimeout;

    // CACHE-ONLY
    if (policy === "cache-only") {
      const { frame, deps, dataRef } = readCacheFrame(document, variables, modeForQuery);
      if (frame) {
        const entry = activeQueries.get(opKey)!;
        entry.lastData = dataRef;
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        finalizeQuery(opKey);
        return;
      }
      const error = new CombinedError({
        networkError: Object.assign(new Error("CACHE_ONLY_MISS"), { name: "CacheOnlyMiss" }),
        graphqlErrors: [],
        response: undefined,
      });
      downstreamUseResult({ error, data: undefined }, true);
      finalizeQuery(opKey);
      return;
    }

    // CACHE-FIRST
    if (policy === "cache-first") {
      const { frame, deps, dataRef } = readCacheFrame(document, variables, modeForQuery); // STRICT
      if (frame) {
        const entry = activeQueries.get(opKey)!;
        entry.lastData = dataRef;
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        finalizeQuery(opKey);
        return;
      }
      lastResultAtMs.set(opKey, performance.now());
    }

    // CACHE-AND-NETWORK
    if (policy === "cache-and-network") {
      const { frame, deps, dataRef } = readCacheFrame(document, variables, modeForQuery); // CANONICAL
      if (frame) {
        const entry = activeQueries.get(opKey)!;
        entry.lastData = dataRef;
        addDepsForQuery(opKey, deps);

        if (isWithinSuspensionWindow) {
          downstreamUseResult(frame, true);
          finalizeQuery(opKey);
          return;
        }
        downstreamUseResult(frame, false); // allow network to arrive later
        lastResultAtMs.set(opKey, performance.now());
      }
    }

    // NETWORK-ONLY: short-circuit with recent cached result (CANONICAL)
    if (policy === "network-only" && isWithinSuspensionWindow) {
      const { frame, deps, dataRef } = readCacheFrame(document, variables, "canonical");
      if (frame) {
        const entry = activeQueries.get(opKey)!;
        entry.lastData = dataRef;
        addDepsForQuery(opKey, deps);
        downstreamUseResult(frame, true);
        finalizeQuery(opKey);
        return;
      }
    }

    // Handle network result
    ctx.useResult = (incoming: OperationResult) => {
      lastResultAtMs.set(opKey, performance.now());

      if (incoming?.error) {
        downstreamUseResult(incoming, true);
        finalizeQuery(opKey);
        return;
      }

      // 1) write to cache
      const t1 = performance.now();
      const res: any = documents.normalizeDocument({ document, variables, data: incoming.data });
      //metrics.cachebay.normalizeDocumentTime += performance.now() - t1;

      // 2) materialize CANONICAL for terminal emission
      const t2 = performance.now();
      const r = documents.materializeDocument({
        document,
        variables,
        decisionMode: "canonical",
      }) as any;
      //metrics.cachebay.materializeDocumentTime += performance.now() - t2;

      if (r && r.status === "FULFILLED") {
        const entry = activeQueries.get(opKey)!;
        entry.mode = "canonical"; // keep canonical after a network success
        entry.lastData = r.data;
        addDepsForQuery(opKey, Array.isArray(r.deps) ? r.deps : []);
        downstreamUseResult({ data: markRaw(r.data), error: null }, true);
      } else {
        // Fallback: deliver the raw network payload
        downstreamUseResult({ data: markRaw(incoming.data), error: null }, true);
      }

      // Important: the op is done — clean it up so we don't keep N historical watchers alive
      finalizeQuery(opKey);

      // Batch-notify impacted OTHER queries; skip this op in the same flush
      enqueueTouched(res?.touched, opKey);
    };
  };
}

export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
