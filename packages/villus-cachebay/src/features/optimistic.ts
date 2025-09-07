// src/features/optimistic.ts
// Proper optimistic layer for Cachebay.
// - Provides write/del and Relay connection mutation handles.
// - Uses resolver metadata for Relay when available; otherwise, a stable default cursors shape
//   so keying works correctly (object-hash via buildConnectionKey).
// - Records snapshots to support revert() safely.

import type { ConnectionState, RelayOptions } from "../core/types";

type EntityKey = string;

type Deps = {
  // stores
  entityStore: Map<EntityKey, Record<string, any>>;
  connectionStore: Map<string, ConnectionState>;

  // connection/core helpers
  ensureConnectionState: (key: string) => ConnectionState;
  buildConnectionKey: (
    parentKey: string,
    field: string,
    relay: RelayOptions,
    variables: Record<string, any>,
  ) => string;
  parentEntityKeyFor: (typename: string, id?: any) => string | null;
  getRelayOptionsByType: (parentTypename: string | null, field: string) => RelayOptions | undefined;

  // entity helpers
  parseEntityKey: (key: string) => { typename: string | null; id: string | null };
  resolveConcreteEntityKey: (abstractKey: string) => string | null;
  doesEntityKeyMatch: (a: string, b: string) => boolean;
  linkEntityToConnection: (key: string, state: ConnectionState) => void;
  unlinkEntityFromConnection: (key: string, state: ConnectionState) => void;
  putEntity: (obj: any, writePolicy?: "merge" | "replace") => EntityKey | null;
  idOf: (obj: any) => EntityKey | null;

  // mutation notifications
  markConnectionDirty: (state: ConnectionState) => void;
  touchConnectionsForEntityKey: (key: string) => void;
  markEntityDirty: (key: string) => void;
  bumpEntitiesTick: () => void;

  // interface + identity utils (not heavily used here but passed through intentionally)
  isInterfaceTypename: (t: string | null) => boolean;
  getImplementationsFor: (t: string) => string[];
  stableIdentityExcluding: (vars: Record<string, any>, remove: string[]) => string;
};

type PublicAPI = {
  identify: (obj: any) => string | null;
  readFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }, materialized?: boolean) => any;
  hasFragment: (refOrKey: string | { __typename: string; id?: any; _id?: any }) => boolean;
  writeFragment: (obj: any) => { commit(): void; revert(): void };
};

type ConnectionsArgs = {
  parent: "Query" | { __typename: string; id?: any; _id?: any } | string;
  field: string;
  variables?: Record<string, any>;
};

const OPTIMISTIC_RELAY_DEFAULT: RelayOptions = {
  edges: "edges",
  node: "node",
  pageInfo: "pageInfo",
  cursors: { after: "after", before: "before", first: "first", last: "last" },
  // The resolver normally augments more fields (paths/names/hasNodePath),
  // but optimistic mutations only need cursor names for keying.
} as any;

function normalizeParentKey(
  arg: "Query" | { __typename: string; id?: any; _id?: any } | string,
  parentEntityKeyFor: Deps["parentEntityKeyFor"],
): string {
  if (typeof arg === "string") {
    if (arg === "Query") return "Query";
    if (arg.includes(":")) return arg;
    // Treat unknown plain string as Query for safety
    return "Query";
  }
  const t = (arg as any)?.__typename;
  const id = (arg as any)?.id ?? (arg as any)?._id;
  return parentEntityKeyFor(t, id) || "Query";
}

function typenameFromEntityKey(parseEntityKey: Deps["parseEntityKey"], key: string): string | null {
  const { typename } = parseEntityKey(key);
  return typename;
}

function upsertEntry(state: ConnectionState, entry: { key: string; cursor: string | null; edge?: any }, position: "start" | "end") {
  const idx = state.list.findIndex((e) => e.key === entry.key);
  if (idx >= 0) {
    // Update in place (preserve edge meta that isn't provided again)
    const prev = state.list[idx];
    state.list[idx] = { ...prev, ...entry, edge: { ...(prev.edge || {}), ...(entry.edge || {}) } };
  } else {
    if (position === "start") {
      state.list.unshift(entry);
    } else {
      state.list.push(entry);
    }
  }
  state.keySet.add(entry.key);
}

export function createModifyOptimistic(deps: Deps, api: PublicAPI) {
  const {
    entityStore,
    connectionStore,
    ensureConnectionState,
    buildConnectionKey,
    parentEntityKeyFor,
    getRelayOptionsByType,

    parseEntityKey,
    resolveConcreteEntityKey,
    doesEntityKeyMatch,
    linkEntityToConnection,
    unlinkEntityFromConnection,
    putEntity,
    idOf,

    markConnectionDirty,
    touchConnectionsForEntityKey,
    markEntityDirty,
    bumpEntitiesTick,

    stableIdentityExcluding,
  } = deps;

  return function modifyOptimistic(build: (c: {
    write: (entity: any, policy?: "merge" | "replace") => void;
    del: (key: string) => void;
    connections: (args: ConnectionsArgs) => Readonly<[{
      addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: any }) => void;
      removeNode: (ref: { __typename: string; id?: any; _id?: any }) => void;
      updatePageInfo: (pi: Record<string, any>) => void;
      state: ConnectionState;
      key: string;
    }]>;
  }) => void) {
    // Snapshots for revert
    const prevEntities = new Map<string, Record<string, any> | null>();
    const prevConnections = new Map<string, { list: Array<{ key: string; cursor: string | null; edge?: any }>; pageInfo: Record<string, any>; keySet: Set<string> }>();

    const recordEntity = (ek: string) => {
      if (!prevEntities.has(ek)) {
        prevEntities.set(ek, entityStore.has(ek) ? { ...entityStore.get(ek)! } : null);
      }
    };

    const recordConnection = (ckey: string, state: ConnectionState) => {
      if (!prevConnections.has(ckey)) {
        prevConnections.set(ckey, {
          list: state.list.map((e) => ({ ...e })),
          pageInfo: { ...state.pageInfo },
          keySet: new Set(Array.from(state.keySet)),
        });
      }
    };

    const apiForBuilder = {
      write(entity: any, policy: "merge" | "replace" = "merge") {
        const k = idOf(entity);
        if (!k) return;
        recordEntity(k);
        // strip typename/id in snapshot is handled by putEntity upstream
        putEntity(entity, policy);
        markEntityDirty(k);
        touchConnectionsForEntityKey(k);
      },

      del(key: string) {
        recordEntity(key);
        const existed = entityStore.has(key);
        if (existed) {
          entityStore.delete(key);
          bumpEntitiesTick();
        }
        markEntityDirty(key);
        touchConnectionsForEntityKey(key);
      },

      connections(args: ConnectionsArgs) {
        const parentKey = normalizeParentKey(args.parent, parentEntityKeyFor);
        const pTypename = parentKey === "Query" ? "Query" : (typenameFromEntityKey(parseEntityKey, parentKey) || "Query");
        const variables = args.variables || {};

        // Real resolver spec if available, else a sane default (only cursors are used for key)
        const relaySpec: RelayOptions = getRelayOptionsByType(pTypename, args.field) || OPTIMISTIC_RELAY_DEFAULT;

        const connKey = buildConnectionKey(parentKey, args.field, relaySpec, variables);
        const state = ensureConnectionState(connKey);
        recordConnection(connKey, state);

        const handle = {
          addNode: (node: any, opts: { cursor?: string | null; position?: "start" | "end"; edge?: any } = {}) => {
            if (!node || typeof node !== "object") return;
            const eKey = idOf(node);
            if (!eKey) return;

            // record and upsert entity
            recordEntity(eKey);
            putEntity(node, "merge");
            markEntityDirty(eKey);

            // upsert edge entry
            const entry = { key: eKey, cursor: opts.cursor ?? null, edge: opts.edge };
            upsertEntry(state, entry, opts.position === "start" ? "start" : "end");

            // link entity ↔ connection for later view syncs
            linkEntityToConnection(eKey, state);

            // schedule view sync
            markConnectionDirty(state);
          },

          removeNode: (ref: { __typename: string; id?: any; _id?: any }) => {
            if (!ref || typeof ref !== "object") return;
            const eKey = idOf(ref);
            if (!eKey) return;

            const idx = state.list.findIndex((e) => e.key === eKey);
            if (idx >= 0) {
              state.list.splice(idx, 1);
              state.keySet.delete(eKey);
              unlinkEntityFromConnection(eKey, state);
              markConnectionDirty(state);
            }
          },

          updatePageInfo: (pi: Record<string, any>) => {
            if (!pi || typeof pi !== "object") return;
            Object.assign(state.pageInfo, pi);
            markConnectionDirty(state);
          },

          state,
          key: connKey,
        } as const;

        return [handle] as const;
      },
    };

    // Execute builder immediately
    build(apiForBuilder);

    return {
      commit() {
        // already applied on the fly — nothing to do
      },
      revert() {
        // revert connections
        for (const [ckey, snap] of prevConnections) {
          const st = deps.ensureConnectionState(ckey);
          st.list = snap.list.map((e) => ({ ...e }));
          st.pageInfo = { ...snap.pageInfo };
          st.keySet = new Set(Array.from(snap.keySet));
          deps.markConnectionDirty(st);
        }

        // revert entities
        for (const [ek, snap] of prevEntities) {
          if (snap === null) {
            const existed = entityStore.has(ek);
            entityStore.delete(ek);
            if (existed) deps.bumpEntitiesTick();
            deps.markEntityDirty(ek);
            deps.touchConnectionsForEntityKey(ek);
          } else {
            entityStore.set(ek, snap);
            deps.markEntityDirty(ek);
            deps.touchConnectionsForEntityKey(ek);
          }
        }
      },
    };
  };
}
