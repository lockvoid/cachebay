// src/core/graph.ts
import { shallowReactive } from "vue";
import { stableStringify } from './utils';

/** Public config */
export type GraphConfig = {
  reactiveMode?: "shallow" | "deep"; // currently shallow used for all containers
  keys: Record<string, (obj: any) => string | null>;
  /**
   * Interface map: interfaceName -> concrete implementors.
   * Example: { Post: ['AudioPost', 'VideoPost'] }
   * Entities of those implementors will be keyed under the interface, e.g. AudioPost{id:1} → "Post:1".
   */
  interfaces?: Record<string, string[]>;
};

export type GraphAPI = ReturnType<typeof createGraph>;

/** Is object shaped like a GraphQL entity (typename+id)? */
function isEntityLike(o: any): boolean {
  return !!(o && typeof o === "object" && typeof o.__typename === "string" && o.id != null);
}

/** Recursively normalize value (entities -> {__ref}, arrays/objects walk) */
function normalizeValue(
  value: any,
  putEntity: (obj: any) => string | null
): any {
  if (Array.isArray(value)) {
    const out: any[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = normalizeValue(value[i], putEntity);
    return out;
  }
  if (value && typeof value === "object") {
    if ("__ref" in value && typeof value.__ref === "string") return value;
    if (isEntityLike(value)) {
      const k = putEntity(value);
      return k ? { __ref: k } : null;
    }
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = normalizeValue(value[k], putEntity);
    return out;
  }
  return value;
}

/** Overlay normalized snapshot into a shallow reactive proxy, resolving refs on the fly */
function overlayEntitySnapshotInto(
  proxy: any,
  snapshot: any,
  materializeEntity: (key: string) => any
) {
  // remove stale
  for (const k of Object.keys(proxy)) {
    if (k === "__typename" || k === "id") continue;
    if (!(k in snapshot)) delete proxy[k];
  }
  // overlay current
  for (const k of Object.keys(snapshot)) {
    const v = snapshot[k];
    proxy[k] = denormalizeValue(v, materializeEntity);
  }
}

function denormalizeValue(
  value: any,
  materializeEntity: (key: string) => any
): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const arr = shallowReactive([]) as any[];
    for (let i = 0; i < value.length; i++) arr[i] = denormalizeValue(value[i], materializeEntity);
    return arr;
  }
  if (value.__ref && typeof value.__ref === "string") {
    return materializeEntity(value.__ref);
  }
  // shallow object
  const obj = shallowReactive({} as Record<string, any>);
  for (const k of Object.keys(value)) {
    obj[k] = denormalizeValue(value[k], materializeEntity);
  }
  return obj;
}

export function createGraph(config: GraphConfig) {
  // interface implementor → interface (canonical)
  const canonicalByImpl = new Map<string, string>();
  if (config.interfaces) {
    for (const iface of Object.keys(config.interfaces)) {
      for (const impl of config.interfaces[iface] || []) {
        if (!canonicalByImpl.has(impl)) canonicalByImpl.set(impl, iface);
      }
    }
  }

  /** Entities: key -> snapshot (fields only; refs stored as {__ref}) */
  const entityStore = new Map<string, Record<string, any>>();
  /** Last seen concrete typename for a canonical entity key */
  const entityConcreteTypename = new Map<string, string>();
  /** Selections (query skeletons): selectionKey -> skeleton with {__ref} */
  const selectionStore = new Map<string, any>();

  /** Weak caches for materialized shallow-reactive objects */
  const materializedEntity = new Map<string, WeakRef<any>>();
  const materializedSelection = new Map<string, WeakRef<any>>();

  function identify(obj: any): string | null {
    if (!obj || typeof obj !== "object") return null;
    const typename = obj.__typename;
    if (!typename) return null;

    const keyer = config.keys?.[typename];
    const id = keyer ? keyer(obj) : obj.id ?? null;
    if (id == null) return null;

    // canonicalize implementors into interface key
    const canonical = canonicalByImpl.get(typename) || typename;
    return `${canonical}:${String(id)}`;
  }

  function putEntity(obj: any): string | null {
    const key = identify(obj);
    if (!key) return null;

    // remember concrete typename for materialization
    if (obj.__typename) entityConcreteTypename.set(key, obj.__typename);

    // build normalized snapshot
    const snap: any = {};
    for (const k of Object.keys(obj)) {
      if (k === "__typename" || k === "id") continue;
      snap[k] = normalizeValue(obj[k], putEntity);
    }

    const existing = entityStore.get(key);
    if (existing) {
      // merge & prune
      for (const k of Object.keys(snap)) existing[k] = snap[k];
      for (const k of Object.keys(existing)) if (!(k in snap)) delete existing[k];
    } else {
      entityStore.set(key, snap);
    }

    // overlay into existing proxy
    const wr = materializedEntity.get(key);
    const proxy = wr?.deref?.();
    if (proxy) overlayEntitySnapshotInto(proxy, entityStore.get(key)!, materializeEntity);

    return key;
  }

  function getEntity(key: string): Record<string, any> | undefined {
    return entityStore.get(key);
  }

  function removeEntity(key: string): boolean {
    const existed = entityStore.delete(key);
    entityConcreteTypename.delete(key);
    const wr = materializedEntity.get(key);
    const proxy = wr?.deref?.();
    if (proxy) {
      for (const k of Object.keys(proxy)) {
        if (k !== "__typename" && k !== "id") delete proxy[k];
      }
    }
    return existed;
  }

  function materializeEntity(key: string): any {
    const wr = materializedEntity.get(key);
    const hit = wr?.deref?.();
    const [typeFromKey, idFromKey] = key.split(":");
    const concrete = entityConcreteTypename.get(key) || typeFromKey;

    if (hit) {
      const snap = entityStore.get(key);
      if (snap) overlayEntitySnapshotInto(hit, snap, materializeEntity);

      // 🔧 Ensure identity is refreshed when implementor changes (AudioPost → VideoPost)
      if (hit.__typename !== concrete) hit.__typename = concrete;
      if (idFromKey != null) {
        const sid = String(idFromKey);
        if (hit.id !== sid) hit.id = sid;
      } else if ("id" in hit) {
        delete hit.id;
      }
      return hit;
    }

    // create new proxy path (unchanged)
    const proxy = shallowReactive({}) as any;
    proxy.__typename = concrete;
    if (idFromKey != null) proxy.id = String(idFromKey);

    const snap = entityStore.get(key);
    if (snap) overlayEntitySnapshotInto(proxy, snap, materializeEntity);

    materializedEntity.set(key, new WeakRef(proxy));
    return proxy;
  }

  // Selections (skeletons)
  function putSelection(selectionKey: string, subtree: any): void {
    const normalized = normalizeValue(subtree, putEntity);
    selectionStore.set(selectionKey, normalized);

    const wr = materializedSelection.get(selectionKey);
    const proxy = wr?.deref?.();
    if (proxy) overlaySelection(proxy, normalized);
  }

  function getSelection(selectionKey: string): any | undefined {
    return selectionStore.get(selectionKey);
  }

  function removeSelection(selectionKey: string): boolean {
    const existed = selectionStore.delete(selectionKey);
    const wr = materializedSelection.get(selectionKey);
    const proxy = wr?.deref?.();
    if (proxy) {
      for (const k of Object.keys(proxy)) delete proxy[k];
    }
    return existed;
  }

  function materializeSelection(selectionKey: string): any {
    const wr = materializedSelection.get(selectionKey);
    const hit = wr?.deref?.();
    const skel = selectionStore.get(selectionKey);
    if (!skel) return undefined;

    if (hit) {
      overlaySelection(hit, skel);
      return hit;
    }

    const proxy = materializeFromSkeleton(skel);
    materializedSelection.set(selectionKey, new WeakRef(proxy));
    return proxy;
  }

  function materializeFromSkeleton(skel: any): any {
    if (skel && typeof skel === "object" && skel.__ref) {
      return materializeEntity(skel.__ref);
    }
    if (Array.isArray(skel)) {
      const arr = shallowReactive([]) as any[];
      for (let i = 0; i < skel.length; i++) arr[i] = materializeFromSkeleton(skel[i]);
      return arr;
    }
    if (skel && typeof skel === "object") {
      const obj = shallowReactive({} as Record<string, any>);
      for (const k of Object.keys(skel)) {
        const v = skel[k];
        if (k === "edges" && Array.isArray(v)) {
          const edges = shallowReactive([]) as any[];
          for (let i = 0; i < v.length; i++) {
            const edgeSkel = v[i];
            const edge = shallowReactive({} as Record<string, any>);
            for (const ek of Object.keys(edgeSkel)) {
              const ev = edgeSkel[ek];
              if (ek === "node" && ev?.__ref) edge.node = materializeEntity(ev.__ref);
              else edge[ek] = materializeFromSkeleton(ev);
            }
            edges[i] = edge;
          }
          obj[k] = edges;
        } else {
          obj[k] = materializeFromSkeleton(v);
        }
      }
      return obj;
    }
    return skel;
  }

  function overlaySelection(target: any, skel: any) {
    if (skel && skel.__ref) {
      const ent = materializeEntity(skel.__ref);
      if (target !== ent) {
        for (const k of Object.keys(target)) delete target[k];
        for (const k of Object.keys(ent)) target[k] = ent[k];
      }
      return;
    }

    if (Array.isArray(skel)) {
      if (!Array.isArray(target)) return;
      if (target.length > skel.length) target.splice(skel.length);
      for (let i = 0; i < skel.length; i++) {
        const sv = skel[i];
        const tv = target[i];
        if (tv && typeof tv === "object") overlaySelection(tv, sv);
        else target[i] = materializeFromSkeleton(sv);
      }
      return;
    }

    if (skel && typeof skel === "object") {
      for (const k of Object.keys(target)) if (!(k in skel)) delete target[k];
      for (const k of Object.keys(skel)) {
        const sv = skel[k];
        const tv = target[k];
        if (k === "edges" && Array.isArray(sv)) {
          if (!Array.isArray(tv)) target[k] = materializeFromSkeleton(sv);
          else {
            if (tv.length > sv.length) tv.splice(sv.length);
            for (let i = 0; i < sv.length; i++) {
              const se = sv[i];
              const te = tv[i];
              if (!te || typeof te !== "object") tv[i] = materializeFromSkeleton(se);
              else {
                for (const ek of Object.keys(se)) {
                  const sev = se[ek];
                  if (ek === "node" && sev?.__ref) te.node = materializeEntity(sev.__ref);
                  else if (typeof sev === "object") {
                    if (!te[ek] || typeof te[ek] !== "object") te[ek] = materializeFromSkeleton(sev);
                    else overlaySelection(te[ek], sev);
                  } else te[ek] = sev;
                }
                for (const ek of Object.keys(te)) if (!(ek in se)) delete te[ek];
              }
            }
          }
        } else if (sv && typeof sv === "object") {
          if (!tv || typeof tv !== "object") target[k] = materializeFromSkeleton(sv);
          else overlaySelection(tv, sv);
        } else {
          target[k] = sv;
        }
      }
      return;
    }
    // primitive leaf
  }

  function inspect() {
    return {
      entities: Object.fromEntries(entityStore),
      selections: Object.fromEntries(selectionStore),
      config: {
        keys: Object.keys(config.keys || {}),
        interfaces: config.interfaces || {},
      },
    };
  }

  return {
    // identity
    identify,

    // entity-level
    putEntity,
    getEntity,
    removeEntity,
    materializeEntity,

    // selections
    putSelection,
    getSelection,
    removeSelection,
    materializeSelection,

    // helpers
    inspect,
  };
}
