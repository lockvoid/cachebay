// plugin.ts
import { CombinedError } from "villus";
import { markRaw } from "vue";
import { CACHEBAY_KEY } from "./constants";
import type { QueriesInstance } from "./queries";
import type { PlannerInstance } from "./planner";
import type { SSRInstance } from "../features/ssr";
import type { DocumentNode } from "graphql";
import type { ClientPlugin, ClientPluginContext, OperationResult } from "villus";
import type { App } from "vue";

type PluginDependencies = {
  planner: PlannerInstance;
  queries: QueriesInstance;
  ssr: SSRInstance;
};

type CachePolicy = "cache-and-network" | "cache-first" | "network-only" | "cache-only";
type DecisionMode = "strict" | "canonical";

export type PluginOptions = {
  /** collapse duplicate cache→network re-emits within this window (ms) */
  suspensionTimeout?: number;
};

export function createPlugin(options: PluginOptions, deps: PluginDependencies): ClientPlugin {
  const { planner, queries, ssr } = deps;
  const { suspensionTimeout = 1000 } = options ?? {};

  // ----------------------------------------------------------------------------
  // Watcher hub: one shared watchQuery per (plan.id | mode | masked vars)
  // ----------------------------------------------------------------------------
  type Listener = (data: any) => void;
  type HubEntry = {
    handle: ReturnType<typeof queries.watchQuery>;
    subs: Set<Listener>;
    refcount: number;
  };
  const hubBySig = new Map<string, HubEntry>();

  const acquireHub = (
    sig: string,
    args: { query: DocumentNode; variables: Record<string, any>; mode: DecisionMode }
  ) => {
    let hub = hubBySig.get(sig);
    if (!hub) {
      const handle = queries.watchQuery({
        query: args.query,
        variables: args.variables,
        decisionMode: args.mode,
        skipInitialEmit: true,
        onData: (data) => {
          const h = hubBySig.get(sig);
          if (!h) return;
          for (const fn of h.subs) fn(markRaw(data));
        },
      });
      hub = { handle, subs: new Set(), refcount: 0 };
      hubBySig.set(sig, hub);
    }
    hub.refcount++;
    return hub;
  };

  const releaseHub = (sig: string, listener?: Listener) => {
    const hub = hubBySig.get(sig);
    if (!hub) return;
    if (listener) hub.subs.delete(listener);
    hub.refcount--;
    if (hub.refcount <= 0) {
      hub.handle.unsubscribe();
      hubBySig.delete(sig);
    }
  };

  // ----------------------------------------------------------------------------
  // Per-operation bookkeeping
  // ----------------------------------------------------------------------------
  type OpState = { sig?: string; listener?: Listener };
  const ops = new Map<number, OpState>();

  // Last **terminal** emit time per signature (for “within window” checks)
  const lastEmitBySig = new Map<string, number>();

  // NEW: mark watcher emissions that are echoes of **our own** network write
  const networkEcho = new Set<string>();

  const firstReadMode = (policy: CachePolicy): DecisionMode =>
    policy === "cache-first" || policy === "cache-only" ? "strict" : "canonical";

  const isWithinSuspension = (sig: string) => {
    const last = lastEmitBySig.get(sig);
    return last != null && performance.now() - last <= suspensionTimeout;
  };

  const attachToSig = (
    opKey: number,
    sig: string,
    args: { query: DocumentNode; variables: Record<string, any>; mode: DecisionMode },
    emit: (data: any, terminal: boolean) => void
  ) => {
    const prev = ops.get(opKey);
    if (prev?.sig && prev.sig !== sig && prev.listener) {
      releaseHub(prev.sig, prev.listener);
      prev.sig = undefined;
      prev.listener = undefined;
    }

    const state = ops.get(opKey) ?? ({} as OpState);
    const hub = acquireHub(sig, args);

    const listener: Listener = (data) => {
      // Only suppress the echo caused by our own network write.
      if (networkEcho.has(sig)) return;
      emit(data, false);
      // Note: we *don’t* update lastEmitBySig here; the window is only for terminal de-dupe.
    };

    hub.subs.add(listener);
    state.sig = sig;
    state.listener = listener;
    ops.set(opKey, state);
  };

  // ----------------------------------------------------------------------------
  // Plugin
  // ----------------------------------------------------------------------------
  return (ctx: ClientPluginContext) => {
    const op = ctx.operation;
    const variables: Record<string, any> = op.variables || {};
    const document: DocumentNode = op.query as DocumentNode;
    const plan = planner.getPlan(document);

    // Always swap to network-safe query (adds __typename, strips @connection)
    op.query = plan.networkQuery;

    const policy: CachePolicy =
      ((op as any).cachePolicy ?? (ctx as any).cachePolicy ?? "cache-and-network") as CachePolicy;

    const downstreamUseResult = ctx.useResult;
    const opKey = op.key as number;

    const modeForQuery = firstReadMode(policy);
    const canonicalSig = plan.makeSignature("canonical", variables);
    const readSig = plan.makeSignature(modeForQuery, variables);

    // ---------------- MUTATION ----------------
    if (plan.operation === "mutation") {
      ctx.useResult = (incoming: OperationResult) => {
        if (incoming?.error) {
          return downstreamUseResult(incoming, true);
        }

        queries.writeQuery({ query: document, variables, data: incoming.data });

        return downstreamUseResult({ data: markRaw(incoming.data), error: null }, true);
      };

      return;
    }

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
                  // Write to cache (triggers reactive updates automatically)
                  queries.writeQuery({ query: document, variables, data: frame.data });
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

    const emit = (payload: { data?: any; error?: any }, terminal: boolean) => {
      downstreamUseResult(payload as any, terminal);
      if (terminal) {
        lastEmitBySig.set(readSig, performance.now());
      }
    };

    // Always attach a canonical watcher (all policies) so optimistic/mutations flow
    attachToSig(
      opKey,
      canonicalSig,
      { query: document, variables, mode: "canonical" },
      (data, terminal) => emit({ data }, terminal)
    );

    // ---------------- SSR hydration quick path (prefer strict cache) -----------
    if (ssr?.isHydrating?.() && policy !== "network-only") {
      const result = queries.readQuery({ query: document, variables, decisionMode: "strict" });
      if (result.data) {
        emit({ data: markRaw(result.data), error: null }, true);
        return;
      }
    }

    // ---------------- “suspension window” cache serve --------------------------
    if (isWithinSuspension(readSig)) {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        if (policy === "network-only") {
          // terminal to avoid duplicate fetches
          emit({ data: markRaw(result.data), error: null }, true);
          return;
        }
        if (policy === "cache-and-network") {
          // non-terminal cached hit; do NOT return — still install network handler
          emit({ data: markRaw(result.data), error: null }, false);
        }
        // cache-first / cache-only fall through to normal handling below
      }
    }

    // ---------------- cache-only ----------------
    if (policy === "cache-only") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        emit({ data: markRaw(result.data), error: null }, true);
      } else {
        const error = new CombinedError({
          networkError: Object.assign(new Error("CacheOnlyMiss"), { name: "CacheOnlyMiss" }),
          graphqlErrors: [],
          response: undefined,
        });
        emit({ error, data: undefined }, true);
      }
      return;
    }

    // ---------------- cache-first ----------------
    if (policy === "cache-first") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        emit({ data: markRaw(result.data), error: null }, true);
        return; // no network
      }
      // miss → proceed to network; watcher will surface optimistic writes
    }

    // ---------------- cache-and-network ----------------
    if (policy === "cache-and-network") {
      const result = queries.readQuery({ query: document, variables, decisionMode: modeForQuery });
      if (result.data) {
        emit({ data: markRaw(result.data), error: null }, false);
        // continue to network
      }
    }

    // ---------------- network-only ----------------
    // No special casing; watcher already attached for optimistic writes

    // Network path (queries)
    ctx.useResult = (incoming: OperationResult) => {
      if (incoming?.error) {
        emit(incoming as any, true);
        return;
      }

      // Mark as a network echo so the watcher doesn’t double-emit the same state
      networkEcho.add(canonicalSig);
      try {
        queries.writeQuery({ query: document, variables, data: incoming.data });
      } finally {
        // Clear the echo mark on microtask to be safe with nested writes
        queueMicrotask(() => networkEcho.delete(canonicalSig));
      }

      // Authoritative terminal read (canonical)
      const result = queries.readQuery({ query: document, variables, decisionMode: "canonical" });
      if (result.data) {
        emit({ data: markRaw(result.data), error: null }, true);
      } else {
        emit({ data: markRaw(incoming.data), error: null }, true);
      }
    };
  };
}

export function provideCachebay(app: App, instance: unknown): void {
  app.provide(CACHEBAY_KEY, instance);
}
