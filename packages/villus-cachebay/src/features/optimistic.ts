import type { EntityKey, ConnectionState } from "../core/types";
import {
  normalizeParentKeyInput,
  parseVariablesFromConnectionKey,
} from "../core/utils";

/**
 * Create the modifyOptimistic() API.
 * All mutations are snapshotted and can be reverted.
 */
type Deps = {
  entityStore: Map<EntityKey, any>;
  connectionStore: Map<string, ConnectionState>;

  parseEntityKey: (key: string) => { typename: string | null; id: string | null };
  resolveConcreteEntityKey: (key: EntityKey) => EntityKey | null;
  doesEntityKeyMatch: (maybeAbstract: EntityKey, candidate: EntityKey) => boolean;

  linkEntityToConnection: (key: EntityKey, state: ConnectionState) => void;
  unlinkEntityFromConnection: (key: EntityKey, state: ConnectionState) => void;

  putEntity: (obj: any) => EntityKey | null;
  idOf: (obj: any) => EntityKey | null;

  markConnectionDirty: (state: ConnectionState) => void;
  touchConnectionsForEntityKey: (key: EntityKey) => void;
  markEntityDirty: (key: EntityKey) => void;
  bumpEntitiesTick: () => void;

  isInterfaceTypename: (t: string | null) => boolean;
  getImplementationsFor: (t: string) => string[];

  stableIdentityExcluding: (vars: Record<string, any>, remove: string[]) => string;
};

type FragApi = {
  identify: (obj: any) => string | null;
  readFragment: (refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, materialized?: boolean) => any;
  hasFragment: (refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }) => boolean;
  writeFragment: (obj: any) => { commit(): void; revert(): void };
};

export function createModifyOptimistic(deps: Deps, frag: FragApi) {
  const {
    entityStore,
    connectionStore,
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
    isInterfaceTypename,
    getImplementationsFor,
    stableIdentityExcluding,
  } = deps;

  // Snapshots for revert()
  type ConnSnap = { list: Array<{ key: string; cursor: string | null; edge?: Record<string, any> }>; pageInfo: any; meta: any };
  const connectionSnapshots = new Map<ConnectionState, ConnSnap>();
  const entitySnapshots = new Map<EntityKey, any>();

  function snapshotConnection(state: ConnectionState) {
    if (!connectionSnapshots.has(state)) {
      connectionSnapshots.set(state, {
        list: state.list.slice(),
        pageInfo: { ...state.pageInfo },
        meta: { ...state.meta },
      });
    }
  }

  function snapshotEntity(key: EntityKey) {
    if (!entitySnapshots.has(key)) {
      entitySnapshots.set(key, entityStore.get(key) === undefined ? undefined : { ...(entityStore.get(key) || {}) });
    }
  }

  function toEntityKey(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }): EntityKey | null {
    if (typeof refOrKey === "string") return refOrKey;
    const t = (refOrKey as any).__typename;
    const id = (refOrKey as any).id ?? (refOrKey as any)._id;
    return t && id != null ? t + ":" + String(id) : null;
  }

  function findConnectionsMatching(
    parent: "Query" | { __typename: string; id?: any; _id?: any },
    field: string,
    variables?: Record<string, any>,
  ) {
    const parentKey = normalizeParentKeyInput(parent);
    const prefix = parentKey + "." + field + "(";
    const wantedId = variables ? stableIdentityExcluding(variables, ["after", "before", "first", "last"]) : null;

    const out: Array<{ key: string; state: ConnectionState }> = [];

    connectionStore.forEach((state, connectionKey) => {
      if (!connectionKey.startsWith(prefix)) return;

      if (wantedId == null) {
        out.push({ key: connectionKey, state });
        return;
      }

      const vars = parseVariablesFromConnectionKey(connectionKey, prefix);
      if (vars == null) return;

      if (stableIdentityExcluding(vars, ["after", "before", "first", "last"]) === wantedId) {
        out.push({ key: connectionKey, state });
      }
    });

    return out;
  }

  return function modifyOptimistic(
    build: (cache: {
      connections(sel: { parent: "Query" | { __typename: string; id?: any; _id?: any }; field: string; variables?: Record<string, any> }): Array<{
        key: string;
        addNodeByKey: (entityKeyStr: string, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: Record<string, any> }) => void;
        removeNodeByKey: (entityKeyStr: string) => void;
        addNode: (node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: Record<string, any> | ((node: any) => Record<string, any> | undefined) }) => void;
        removeNode: (node: any) => void;
        patch: (prop: string, updater: (current: any) => any) => void;
      }>;
      write: (obj: any) => void;
      patch: (refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, partial: Record<string, any>) => void;
      del: (refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }) => void;
      identify: typeof frag.identify;
      readFragment: typeof frag.readFragment;
      hasFragment: typeof frag.hasFragment;
      writeFragment: typeof frag.writeFragment;
    }) => void,
  ) {
    const api = {
      connections(sel: { parent: "Query" | { __typename: string; id?: any; _id?: any }; field: string; variables?: Record<string, any> }) {
        const found = findConnectionsMatching(sel.parent, sel.field, sel.variables);
        return found.map(({ key, state }) => ({
          key,
          removeNodeByKey(entityKeyStr: string) {
            snapshotConnection(state);
            const next: typeof state.list = [];
            for (let i = 0; i < state.list.length; i++) {
              const entry = state.list[i];
              if (!doesEntityKeyMatch(entityKeyStr, entry.key)) {
                next.push(entry);
              } else {
                unlinkEntityFromConnection(entry.key, state);
              }
            }
            (state.list as any) = next;
            state.keySet = new Set(next.map((e) => e.key));
            markConnectionDirty(state);
          },
          addNodeByKey(entityKeyStr: string, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: Record<string, any> }) {
            snapshotConnection(state);
            const resolved = resolveConcreteEntityKey(entityKeyStr) || entityKeyStr;
            const newEntry = { key: resolved, cursor: opts?.cursor ?? null, edge: opts?.edge } as typeof state.list[number];
            let idx = -1;
            for (let i = 0; i < state.list.length; i++) {
              if (doesEntityKeyMatch(entityKeyStr, state.list[i].key)) { idx = i; break; }
            }
            if (idx !== -1) {
              (state.list as any)[idx] = newEntry;
            } else if (opts?.position === "start") {
              (state.list as any).unshift(newEntry);
            } else {
              (state.list as any).push(newEntry);
            }
            state.keySet.add(resolved);
            linkEntityToConnection(resolved, state);
            markConnectionDirty(state);
          },
          addNode(node: any, opts?: { cursor?: string | null; position?: "start" | "end"; edge?: Record<string, any> | ((node: any) => Record<string, any> | undefined) }) {
            const ref = putEntity(node);
            if (!ref) return;
            snapshotConnection(state);
            const meta = typeof opts?.edge === "function" ? opts.edge(node) : opts?.edge;
            const newEntry = { key: ref, cursor: opts?.cursor ?? null, edge: meta } as typeof state.list[number];

            let idx = -1;
            for (let i = 0; i < state.list.length; i++) {
              if (state.list[i].key === ref) { idx = i; break; }
            }
            if (idx !== -1) {
              (state.list as any)[idx] = newEntry;
            } else if (opts?.position === "start") {
              (state.list as any).unshift(newEntry);
            } else {
              (state.list as any).push(newEntry);
            }
            state.keySet.add(ref);
            linkEntityToConnection(ref, state);
            markConnectionDirty(state);
          },
          removeNode(node: any) {
            const directKey = toEntityKey(node);
            if (!directKey) return;

            let entityKeyStr = directKey;
            const { typename, id } = parseEntityKey(directKey);
            if (isInterfaceTypename(typename) && id) {
              const resolved = resolveConcreteEntityKey(directKey);
              if (resolved) entityKeyStr = resolved;
            }

            snapshotConnection(state);
            const next: typeof state.list = [];
            for (let i = 0; i < state.list.length; i++) {
              const k = state.list[i].key;
              if (!doesEntityKeyMatch(entityKeyStr, k)) {
                next.push(state.list[i]);
              } else {
                unlinkEntityFromConnection(k, state);
              }
            }
            (state.list as any) = next;
            state.keySet = new Set(next.map((e) => e.key));
            markConnectionDirty(state);
          },
          patch(prop: string, updater: (current: any) => any) {
            snapshotConnection(state);
            if (prop in state.pageInfo) {
              (state.pageInfo as any)[prop] = updater((state.pageInfo as any)[prop]);
            } else {
              (state.meta as any)[prop] = updater((state.meta as any)[prop]);
            }
            markConnectionDirty(state);
          },
        }));
      },
      write(obj: any) {
        let key = idOf(obj);
        if (!key) return;
        const { typename } = parseEntityKey(key);
        if (isInterfaceTypename(typename)) {
          const resolved = resolveConcreteEntityKey(key);
          if (!resolved) return;
          key = resolved;
        }
        snapshotEntity(key);
        putEntity(obj);
        touchConnectionsForEntityKey(key);
        markEntityDirty(key);
      },
      patch(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }, partial: Record<string, any>) {
        const raw = toEntityKey(refOrKey);
        if (!raw) return;
        const { typename, id } = parseEntityKey(raw);

        if (isInterfaceTypename(typename) && id) {
          const impls = getImplementationsFor(typename!);
          for (let i = 0; i < impls.length; i++) {
            const k = (impls[i] + ":" + id) as EntityKey;
            if (!entityStore.has(k)) continue;
            snapshotEntity(k);
            const dst = entityStore.get(k) || Object.create(null);
            const pk = Object.keys(partial);
            for (let j = 0; j < pk.length; j++) (dst as any)[pk[j]] = (partial as any)[pk[j]];
            entityStore.set(k, dst);
            touchConnectionsForEntityKey(k);
            markEntityDirty(k);
          }
          return;
        }

        const k = raw as EntityKey;
        snapshotEntity(k);
        const dst = entityStore.get(k) || Object.create(null);
        const pk = Object.keys(partial);
        for (let j = 0; j < pk.length; j++) (dst as any)[pk[j]] = (partial as any)[pk[j]];
        entityStore.set(k, dst);
        touchConnectionsForEntityKey(k);
        markEntityDirty(k);
      },
      del(refOrKey: EntityKey | { __typename: string; id?: any; _id?: any }) {
        const raw = toEntityKey(refOrKey);
        if (!raw) return;
        const { typename, id } = parseEntityKey(raw);

        const keysToDelete: EntityKey[] = [];
        if (isInterfaceTypename(typename) && id) {
          const impls = getImplementationsFor(typename!);
          for (const impl of impls) {
            const key = (impl + ":" + id) as EntityKey;
            if (entityStore.has(key)) keysToDelete.push(key);
          }
        } else {
          keysToDelete.push(raw);
        }

        for (const k of keysToDelete) {
          const existed = entityStore.has(k);
          snapshotEntity(k);
          entityStore.delete(k);
          if (existed) bumpEntitiesTick();

          const set = (function () {
            // unlink from any connections referencing this entity
            const s = new Set<ConnectionState>();
            deps.connectionStore.forEach((state) => {
              for (let i = 0; i < state.list.length; i++) {
                if (doesEntityKeyMatch(k, state.list[i].key)) {
                  s.add(state);
                  break;
                }
              }
            });
            return s;
          })();

          set.forEach((state) => {
            let touched = false;
            const next: typeof state.list = [];
            for (let i = 0; i < state.list.length; i++) {
              const entry = state.list[i];
              if (!doesEntityKeyMatch(k, entry.key)) {
                next.push(entry);
              } else {
                touched = true;
                unlinkEntityFromConnection(entry.key, state);
              }
            }
            if (touched) {
              (state.list as any) = next;
              state.keySet = new Set(next.map((e) => e.key));
              markConnectionDirty(state);
            }
          });

          // Also notify connections from the index
          touchConnectionsForEntityKey(k);
          markEntityDirty(k);
        }
      },
      identify: frag.identify,
      readFragment: frag.readFragment,
      hasFragment: frag.hasFragment,
      writeFragment: frag.writeFragment,
    };

    // Execute user changes
    build(api);

    // Return reversible handle
    return {
      commit() { },
      revert() {
        // Entities
        entitySnapshots.forEach((prev, key) => {
          if (prev === undefined) {
            const existed = entityStore.has(key);
            entityStore.delete(key);
            if (existed) bumpEntitiesTick();
          } else {
            const existed = entityStore.has(key);
            entityStore.set(key, prev);
            if (!existed) bumpEntitiesTick();
          }
          touchConnectionsForEntityKey(key);
          markEntityDirty(key);
        });

        // Connections
        connectionSnapshots.forEach((snap, state) => {
          (state.list as any) = snap.list as any;
          state.keySet = new Set(state.list.map((e: any) => e.key));
          state.pageInfo = { ...snap.pageInfo };
          state.meta = { ...snap.meta };
          markConnectionDirty(state);
        });
      },
    };
  };
}
