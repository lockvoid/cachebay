// src/core/graph.ts
import { shallowReactive } from "vue";

/** Public config */
export type GraphConfig = {
  /** typename -> keyer */
  keys: Record<string, (obj: any) => string | null>;
  /**
   * Interface map: interfaceName -> concrete implementors.
   * Example: { Post: ['AudioPost', 'VideoPost'] }
   * Entities of those implementors are keyed under the interface, e.g. AudioPost{id:1} → "Post:1".
   */
  interfaces?: Record<string, string[]>;
};

export type GraphAPI = ReturnType<typeof createGraph>;

/** Identity field set */
const IDENTITY_FIELDS = new Set(["__typename", "id"]);

/** Tiny helpers */
const hasTypename = (v: any): boolean =>
  !!(v && typeof v === "object" && typeof v.__typename === "string");

const hasNonIdentityFields = (v: any): boolean => {
  if (!v || typeof v !== "object") return false;
  const ks = Object.keys(v);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    if (!IDENTITY_FIELDS.has(k) && v[k] !== undefined) return true;
  }
  return false;
};

/** --------------------------------------------------------------------------
 *  Proxy cache manager (WeakRef-backed)
 * -------------------------------------------------------------------------- */
class ProxyManager {
  private proxies = new Map<string, WeakRef<any>>();

  get(key: string): any | undefined {
    return this.proxies.get(key)?.deref?.();
  }
  set(key: string, proxy: any): void {
    this.proxies.set(key, new WeakRef(proxy));
  }
  delete(key: string): void {
    this.proxies.delete(key);
  }
  /** Remove entries whose referent was GC’d */
  prune(): void {
    for (const [key, wr] of this.proxies.entries()) {
      if (!wr.deref()) this.proxies.delete(key);
    }
  }
  /** Wipe the cache */
  clear(): void {
    this.proxies.clear();
  }
}

/** --------------------------------------------------------------------------
 *  Key manager (parse "Type:id" once, with memo)
 * -------------------------------------------------------------------------- */
class KeyManager {
  private cache = new Map<string, [string, string | undefined]>();
  parse(key: string): [typename: string, id?: string] {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const i = key.indexOf(":");
    const out: [string, string | undefined] =
      i >= 0 ? [key.slice(0, i), key.slice(i + 1)] : [key, undefined];
    this.cache.set(key, out);
    return out;
  }
}

/** --------------------------------------------------------------------------
 *  Interface manager (implementor -> canonical interface)
 * -------------------------------------------------------------------------- */
class InterfaceManager {
  private canonicalByImpl = new Map<string, string>();
  constructor(map?: Record<string, string[]>) {
    if (map) {
      const ifaces = Object.keys(map);
      for (let i = 0; i < ifaces.length; i++) {
        const iface = ifaces[i];
        const impls = map[iface] || [];
        for (let j = 0; j < impls.length; j++) {
          this.canonicalByImpl.set(impls[j], iface);
        }
      }
    }
  }
  canonicalOf(typename: string): string {
    return this.canonicalByImpl.get(typename) || typename;
  }
}

/** --------------------------------------------------------------------------
 *  Normalizer (closes over putEntity/identify)
 * -------------------------------------------------------------------------- */
const createNormalizer = (
  putEntity: (obj: any) => string | null,
  identify: (obj: any) => string | null,
) => {
  const normalizeValue = (value: any): any => {
    if (!value || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i++) out[i] = normalizeValue(value[i]);
      return out;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return value;
    }

    if (hasTypename(value)) {
      const key = identify(value);
      if (!key) {
        // non-identifiable object: recurse
        const obj: any = {};
        const ks = Object.keys(value);
        for (let i = 0; i < ks.length; i++) obj[ks[i]] = normalizeValue(value[ks[i]]);
        return obj;
      }
      if (!hasNonIdentityFields(value)) return { __ref: key };
      // write and return ref
      putEntity(value);
      return { __ref: key };
    }

    // plain object
    const o: any = {};
    const ks = Object.keys(value);
    for (let i = 0; i < ks.length; i++) o[ks[i]] = normalizeValue(value[ks[i]]);
    return o;
  };

  const denormalizeValue = (value: any, materializeEntity: (k: string) => any): any => {
    if (!value || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const out = shallowReactive(new Array(value.length));
      for (let i = 0; i < value.length; i++) out[i] = denormalizeValue(value[i], materializeEntity);
      return out;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return materializeEntity(value.__ref);
    }

    const proxy = shallowReactive({} as Record<string, any>);
    const ks = Object.keys(value);
    for (let i = 0; i < ks.length; i++) proxy[ks[i]] = denormalizeValue(value[ks[i]], materializeEntity);
    return proxy;
  };

  return { normalizeValue, denormalizeValue };
};

/** --------------------------------------------------------------------------
 *  Graph
 * -------------------------------------------------------------------------- */
export const createGraph = (config: GraphConfig) => {
  // Interface canonicalization
  const ifaceMgr = new InterfaceManager(config.interfaces);

  // Stores
  const entityStore = new Map<string, Record<string, any>>();   // "Type:id" -> snapshot
  const selectionStore = new Map<string, any>();                // selectionKey -> skeleton

  // Proxies
  const entityProxyMgr = new ProxyManager();     // "entity:Type:id"
  const selectionProxyMgr = new ProxyManager();  // "selection:<selKey>"

  // Reverse index: entityKey -> Set<selectionKey>
  const refsIndex = new Map<string, Set<string>>();

  // Keyers cache (typename -> keyer)
  const keyers = new Map<string, (obj: any) => string | null>();
  for (const [tn, fn] of Object.entries(config.keys || {})) keyers.set(tn, fn);

  // Managers
  const keyMgr = new KeyManager();

  /** Identify an object → "CanonicalType:id" or null */
  const identify = (objectValue: any): string | null => {
    if (!hasTypename(objectValue)) return null;

    const impl = objectValue.__typename as string;
    const canonical = ifaceMgr.canonicalOf(impl);

    const implKeyer = keyers.get(impl);
    const ifaceKeyer = canonical !== impl ? keyers.get(canonical) : undefined;

    const id =
      (implKeyer ? implKeyer(objectValue) : undefined) ??
      (ifaceKeyer ? ifaceKeyer(objectValue) : undefined) ??
      (objectValue.id ?? null);

    if (id == null) return null;
    return `${canonical}:${String(id)}`;
  };

  // Normalizer/denormalizer with closures into this graph
  // (We bind putEntity later, but types are fine since we hoist the decl.)
  let normalizeValue!: (v: any) => any;
  let denormalizeValue!: (v: any, materializeEntity: (k: string) => any) => any;

  /** Overlay helpers */
  const overlayEntity = (entityProxy: any, snapshot: any) => {
    // drop stale fields (keep identity)
    const keys = Object.keys(entityProxy);
    for (let i = 0; i < keys.length; i++) {
      const f = keys[i];
      if (!IDENTITY_FIELDS.has(f) && !(f in snapshot)) delete entityProxy[f];
    }

    // identity
    if (snapshot.__typename && entityProxy.__typename !== snapshot.__typename) {
      entityProxy.__typename = snapshot.__typename;
    }
    if (snapshot.id != null) {
      const stableId = String(snapshot.id);
      if (entityProxy.id !== stableId) entityProxy.id = stableId;
    } else if ("id" in entityProxy) {
      delete entityProxy.id;
    }

    // fields
    const ks = Object.keys(snapshot);
    for (let i = 0; i < ks.length; i++) {
      const f = ks[i];
      if (!IDENTITY_FIELDS.has(f)) entityProxy[f] = denormalizeValue(snapshot[f], materializeEntity);
    }
  };

  const materializeFromSkeleton = (skel: any): any => {
    if (!skel || typeof skel !== "object") return skel;
    if ("__ref" in skel) {
      const wrapper = shallowReactive({} as Record<string, any>);
      overlaySelection(wrapper, skel);
      return wrapper;
    }
    if (Array.isArray(skel)) {
      const out = shallowReactive(new Array(skel.length));
      for (let i = 0; i < skel.length; i++) out[i] = materializeFromSkeleton(skel[i]);
      return out;
    }
    const obj = shallowReactive({} as Record<string, any>);
    const ks = Object.keys(skel);
    for (let i = 0; i < ks.length; i++) obj[ks[i]] = materializeFromSkeleton(skel[ks[i]]);
    return obj;
  };

  const overlaySelection = (target: any, skel: any) => {
    if (!skel || typeof skel !== "object") return;

    if ("__ref" in skel && typeof skel.__ref === "string") {
      const ent = materializeEntity(skel.__ref);
      const existing = Object.keys(target);
      for (let i = 0; i < existing.length; i++) delete target[existing[i]];
      const entKeys = Object.keys(ent);
      for (let i = 0; i < entKeys.length; i++) target[entKeys[i]] = ent[entKeys[i]];
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

    // object
    const current = Object.keys(target);
    for (let i = 0; i < current.length; i++) {
      const f = current[i];
      if (!(f in skel)) delete target[f];
    }
    const ks = Object.keys(skel);
    for (let i = 0; i < ks.length; i++) {
      const f = ks[i];
      const sv = skel[f];
      const tv = target[f];
      if (sv && typeof sv === "object") {
        if (!tv || typeof tv !== "object") target[f] = materializeFromSkeleton(sv);
        else overlaySelection(tv, sv);
      } else {
        target[f] = sv;
      }
    }
  };

  /** Index/unindex __ref usage inside a selection skeleton */
  const indexSelectionRefs = (selKey: string, node: any, add: boolean) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) indexSelectionRefs(selKey, node[i], add);
      return;
    }

    if ("__ref" in node && typeof node.__ref === "string") {
      const entKey = node.__ref;
      if (add) {
        let bucket = refsIndex.get(entKey);
        if (!bucket) refsIndex.set(entKey, (bucket = new Set()));
        bucket.add(selKey);
      } else {
        const bucket = refsIndex.get(entKey);
        if (bucket) {
          bucket.delete(selKey);
          if (bucket.size === 0) refsIndex.delete(entKey);
        }
      }
      return;
    }

    const ks = Object.keys(node);
    for (let i = 0; i < ks.length; i++) indexSelectionRefs(selKey, node[ks[i]], add);
  };

  /** Reconcile all mounted selections that reference an entity */
  const syncSelectionsFor = (entityKey: string) => {
    const keys = refsIndex.get(entityKey);
    if (!keys) return;
    for (const selKey of keys) {
      const skel = selectionStore.get(selKey);
      if (!skel) continue;
      const proxy = selectionProxyMgr.get(`selection:${selKey}`);
      if (proxy) overlaySelection(proxy, skel);
    }
  };

  /** Entities API */
  const putEntity = (obj: any): string | null => {
    const key = identify(obj);
    if (!key) return null;

    const snap: any = { __typename: obj.__typename };
    const [, idFromKey] = keyMgr.parse(key);
    snap.id = obj.id != null ? String(obj.id) : idFromKey;

    const fields = Object.keys(obj);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!IDENTITY_FIELDS.has(f)) snap[f] = normalizeValue(obj[f]);
    }

    const prev = entityStore.get(key);
    if (prev) Object.assign(prev, snap);
    else entityStore.set(key, snap);

    // live entity proxy refresh
    const p = entityProxyMgr.get(`entity:${key}`);
    if (p) overlayEntity(p, entityStore.get(key)!);

    // reconcile selections that point to this entity
    syncSelectionsFor(key);

    return key;
  };

  const getEntity = (key: string): Record<string, any> | undefined => entityStore.get(key);

  const removeEntity = (key: string): boolean => {
    const existed = entityStore.delete(key);

    const p = entityProxyMgr.get(`entity:${key}`);
    if (p) {
      const ks = Object.keys(p);
      for (let i = 0; i < ks.length; i++) delete p[ks[i]];
    }

    // selections shrink if they referenced this entity
    syncSelectionsFor(key);

    return existed;
  };

  const materializeEntity = (key: string): any => {
    const hit = entityProxyMgr.get(`entity:${key}`);
    const snap = entityStore.get(key);
    const [typeFromKey, idFromKey] = keyMgr.parse(key);
    const concreteType = snap?.__typename ?? typeFromKey;
    const concreteId = snap?.id ?? idFromKey;

    if (hit) {
      if (hit.__typename !== concreteType) hit.__typename = concreteType;
      if (concreteId != null) {
        const sid = String(concreteId);
        if (hit.id !== sid) hit.id = sid;
      } else if ("id" in hit) {
        delete hit.id;
      }
      if (snap) overlayEntity(hit, snap);
      return hit;
    }

    const proxy = shallowReactive({} as any);
    proxy.__typename = concreteType;
    if (concreteId != null) proxy.id = String(concreteId);
    if (snap) overlayEntity(proxy, snap);

    entityProxyMgr.set(`entity:${key}`, proxy);
    return proxy;
  };

  /** Selections API */
  const putSelection = (selKey: string, subtree: any): void => {
    const prev = selectionStore.get(selKey);
    if (prev) indexSelectionRefs(selKey, prev, false);

    const normalized = normalizeValue(subtree);
    selectionStore.set(selKey, normalized);

    indexSelectionRefs(selKey, normalized, true);

    const p = selectionProxyMgr.get(`selection:${selKey}`);
    if (p) overlaySelection(p, normalized);
  };

  const getSelection = (selKey: string): any | undefined => selectionStore.get(selKey);

  const removeSelection = (selKey: string): boolean => {
    const skel = selectionStore.get(selKey);
    const existed = selectionStore.delete(selKey);

    if (skel) indexSelectionRefs(selKey, skel, false);

    const p = selectionProxyMgr.get(`selection:${selKey}`);
    if (p) {
      const ks = Object.keys(p);
      for (let i = 0; i < ks.length; i++) delete p[ks[i]];
    }
    return existed;
  };

  const materializeSelection = (selKey: string): any => {
    const skel = selectionStore.get(selKey);
    if (!skel) return undefined;

    const hit = selectionProxyMgr.get(`selection:${selKey}`);
    if (hit) {
      overlaySelection(hit, skel);
      return hit;
    }
    const wrapper = materializeFromSkeleton(skel);
    if (wrapper && typeof wrapper === "object") {
      selectionProxyMgr.set(`selection:${selKey}`, wrapper);
    }
    return wrapper;
  };

  /** Listings & clear */
  const listEntityKeys = () => Array.from(entityStore.keys());
  const listSelectionKeys = () => Array.from(selectionStore.keys());

  /**
   * Clear entities and/or selections (defaults: both).
   * Example:
   *   clear()                // wipe both
   *   clear({ entities: true }) // only entities
   *   clear({ selections: true }) // only selections
   */
  const clear = (opts?: { entities?: boolean; selections?: boolean }) => {
    const doEntities = opts?.entities ?? true;
    const doSelections = opts?.selections ?? true;

    if (doSelections) {
      for (const k of selectionStore.keys()) removeSelection(k);
      selectionProxyMgr.clear();
    }
    if (doEntities) {
      for (const k of entityStore.keys()) removeEntity(k);
      entityProxyMgr.clear();
    }
  };

  /** Inspect snapshot for debugging/tests */
  const inspect = () => {
    const toObj = (m: Map<string, any>) => {
      const out: Record<string, any> = {};
      for (const [k, v] of m.entries()) out[k] = v;
      return out;
    };
    return {
      entities: toObj(entityStore),
      selections: toObj(selectionStore),
      config: {
        keys: config.keys || {},
        interfaces: config.interfaces || {},
      },
    };
  };

  // Install normalizer now (after putEntity/identify closures exist)
  {
    const n = createNormalizer(putEntity, identify);
    normalizeValue = n.normalizeValue;
    denormalizeValue = n.denormalizeValue;
  }

  return {
    // identity
    identify,

    // entities
    putEntity,
    getEntity,
    removeEntity,
    materializeEntity,

    // selections
    putSelection,
    getSelection,
    removeSelection,
    materializeSelection,

    // listings & maintenance
    listEntityKeys,
    listSelectionKeys,
    clear,

    // debug
    inspect,
  };
};
