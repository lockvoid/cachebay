// src/core/sessions.ts
import type { GraphInstance } from "./graph";
import type { ViewsInstance } from "./views";
import { buildConnectionKey, buildConnectionIdentity } from "./utils";
import { ROOT_ID } from "./constants";

export type SessionsDependencies = {
  graph: GraphInstance;
  views: ViewsInstance;
};

export type DedupeStrategy = "cursor" | "node" | "edgeRef";

export type MountConnectionOptions = {
  identityKey: string;               // filters-only identity (parent + field)
  mode?: "infinite" | "page";        // default "infinite"
  dedupeBy?: DedupeStrategy;         // default "cursor"
};

export type ConnectionComposer = {
  addPage: (pageKey: string) => void;
  removePage: (pageKey: string) => void;
  setPage: (pageKey: string | null) => void; // select page for mode:"page" (null -> last)
  clear: () => void;
  getView: () => any;                          // reactive connection view (Proxy)
  inspect: () => { pages: string[]; mode: string; dedupeBy: string; activePage: string | null };
};

export type Session = {
  mount: (entityId: string) => any; // retain & return reactive entity proxy
  mountConnection: (opts: MountConnectionOptions) => ConnectionComposer;
  getConnection: (identityKey: string) => ConnectionComposer | undefined;
  inspect: () => { connections: string[]; retained: string[] };
  destroy: () => void;
};

export type SessionsInstance = ReturnType<typeof createSessions>;

export const createSessions = (deps: SessionsDependencies) => {
  const { graph, views } = deps;

  const createSession = (): Session => {
    // retained entities (for lifetime of this session)
    const retained = new Set<string>();

    // identityKey -> composer
    const composers = new Map<string, ConnectionComposerImpl>();

    const mount = (entityId: string) => {
      retained.add(entityId);
      return graph.materializeRecord(entityId);
    };

    const getConnection = (identityKey: string) => composers.get(identityKey)?.public;

    const mountConnection = (opts: MountConnectionOptions): ConnectionComposer => {
      const identityKey = opts.identityKey;
      const existing = composers.get(identityKey);
      if (existing) return existing.public;

      const impl = new ConnectionComposerImpl(identityKey, {
        mode: opts.mode ?? "infinite",
        dedupeBy: opts.dedupeBy ?? "cursor",
      }, graph, views);

      composers.set(identityKey, impl);
      return impl.public;
    };

    const inspect = () => ({
      connections: Array.from(composers.keys()),
      retained: Array.from(retained.keys()),
    });

    const destroy = () => {
      retained.clear();
      composers.clear();
    };

    return { mount, mountConnection, getConnection, inspect, destroy };
  };

  return { createSession };
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: ConnectionComposerImpl
// ─────────────────────────────────────────────────────────────────────────────

class ConnectionComposerImpl {
  private identityKey: string;
  private mode: "infinite" | "page";
  private dedupeBy: DedupeStrategy;

  private graph: GraphInstance;
  private views: ViewsInstance;

  // concrete page keys in insertion order
  private pages: string[] = [];
  // currently selected page (mode:"page"); null -> use latest
  private activePageKey: string | null = null;

  // stable connection view proxy
  private viewProxy: any | null = null;

  public readonly public: ConnectionComposer;

  constructor(
    identityKey: string,
    opts: { mode: "infinite" | "page"; dedupeBy: DedupeStrategy },
    graph: GraphInstance,
    views: ViewsInstance
  ) {
    this.identityKey = identityKey;
    this.mode = opts.mode;
    this.dedupeBy = opts.dedupeBy;
    this.graph = graph;
    this.views = views;

    this.public = {
      addPage: (k) => this.addPage(k),
      removePage: (k) => this.removePage(k),
      setPage: (k) => this.setPage(k),
      clear: () => this.clear(),
      getView: () => this.getView(),
      inspect: () => ({
        pages: this.pages.slice(),
        mode: this.mode,
        dedupeBy: this.dedupeBy,
        activePage: this.activePageKey,
      }),
    };
  }

  private addPage(pageKey: string) {
    if (!pageKey) return;
    if (this.pages.indexOf(pageKey) !== -1) return;
    // only add if the page exists in cache; no-op otherwise
    if (this.graph.getRecord(pageKey)) {
      this.pages.push(pageKey);
      // do not eagerly rebuild; getView computes on demand
    }
  }

  private removePage(pageKey: string) {
    const idx = this.pages.indexOf(pageKey);
    if (idx === -1) return;
    this.pages.splice(idx, 1);
    if (this.activePageKey === pageKey) this.activePageKey = null;
  }

  private setPage(pageKey: string | null) {
    this.activePageKey = pageKey;
  }

  private clear() {
    this.pages.length = 0;
    this.activePageKey = null;
  }

  private getView() {
    if (this.viewProxy) return this.viewProxy;

    // a stable proxy that reads through to current pages
    const self = this;

    const handler: ProxyHandler<any> = {
      get(_t, prop) {
        if (prop === "__typename") {
          const chosen = self.choosePageKey();
          if (!chosen) return "Connection";
          const snap = self.graph.getRecord(chosen);
          return snap?.__typename ?? "Connection";
        }

        if (prop === "pageInfo") {
          // reflect chosen page's pageInfo as plain object (unchanged by composer)
          const chosen = self.choosePageKey();
          if (!chosen) return undefined;
          const snap = self.graph.getRecord(chosen);
          return snap?.pageInfo ? { ...snap.pageInfo } : undefined;
        }

        if (prop === "edges") {
          return self.composeEdges();
        }

        // expose extras (e.g., totalCount) off chosen page
        const chosen = self.choosePageKey();
        if (!chosen) return undefined;
        const snap = self.graph.getRecord(chosen);
        if (!snap) return undefined;
        return (snap as any)[prop as any];
      },

      has(_t, prop) {
        if (prop === "edges" || prop === "pageInfo" || prop === "__typename") return true;
        const chosen = self.choosePageKey();
        if (!chosen) return false;
        const snap = self.graph.getRecord(chosen);
        return snap ? Reflect.has(snap, prop) : false;
      },

      ownKeys() {
        const chosen = self.choosePageKey();
        if (!chosen) return ["__typename", "edges"];
        const snap = self.graph.getRecord(chosen) || {};
        const keys = new Set<string>(["__typename", "edges", ...Object.keys(snap)]);
        // pageInfo is enumerated when present
        if ((snap as any).pageInfo) keys.add("pageInfo");
        return Array.from(keys);
      },

      getOwnPropertyDescriptor(_t, prop) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: (self as any)[prop as any], // not used; get() returns values
        };
      },
    };

    this.viewProxy = new Proxy(Object.create(null), handler);
    return this.viewProxy;
  }

  /** pick the active page (mode:"page") or latest (mode:"infinite") */
  private choosePageKey(): string | null {
    if (this.pages.length === 0) return null;
    if (this.mode === "page") {
      if (this.activePageKey && this.pages.indexOf(this.activePageKey) !== -1) {
        return this.activePageKey;
      }
      return this.pages[this.pages.length - 1];
    }
    // infinite: pageInfo/extras reflect the latest page by default
    return this.pages[this.pages.length - 1];
  }

  /** compose deduped edge views from current pages */
  private composeEdges(): any[] {
    if (this.pages.length === 0) return [];

    // choose which pages to read
    const pageKeys = this.mode === "page"
      ? (() => {
        const single = this.choosePageKey();
        return single ? [single] : [];
      })()
      : this.pages;

    // Build flat list of edgeRef keys in order, deduping as requested
    const resultRefs: string[] = [];
    const seen = new Set<string>();

    for (let p = 0; p < pageKeys.length; p++) {
      const pageKey = pageKeys[p];
      const snap = this.graph.getRecord(pageKey);
      if (!snap || !Array.isArray((snap as any).edges)) continue;

      const edgeRefs = (snap as any).edges.map((r: any) => r?.__ref).filter(Boolean) as string[];
      for (let i = 0; i < edgeRefs.length; i++) {
        const ref = edgeRefs[i];
        const edgeRec = this.graph.getRecord(ref);
        if (!edgeRec) continue;

        let dedupeKey: string;
        switch (this.dedupeBy) {
          case "node": {
            const nodeRef = (edgeRec as any).node?.__ref || "";
            dedupeKey = `node:${nodeRef}`;
            break;
          }
          case "edgeRef":
            dedupeKey = `edge:${ref}`;
            break;
          case "cursor":
          default: {
            const cursor = (edgeRec as any).cursor ?? "";
            dedupeKey = `cursor:${String(cursor)}`;
            break;
          }
        }

        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        resultRefs.push(ref);
      }
    }

    // Map refs to reactive edge views (node is reactive via views)
    const edges = new Array(resultRefs.length);
    for (let i = 0; i < resultRefs.length; i++) {
      edges[i] = this.views.getEdgeView(resultRefs[i], /* nodeField */ undefined, /* vars */ {});
    }
    return edges;
  }
}
