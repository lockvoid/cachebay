// src/core/graph.ts
import { shallowReactive } from "vue";

export type GraphConfig = {
  reactiveMode?: "shallow" | "deep"; // currently using shallow for all
  keys: Record<string, (obj: any) => string | null>;
  /**
   * Interface map: interfaceName -> concrete implementors.
   * Example: { Post: ['AudioPost', 'VideoPost'] }
   * Entities of those implementors are keyed under the interface, e.g. AudioPost{id:1} → "Post:1".
   */
  interfaces?: Record<string, string[]>;
};

export type GraphAPI = ReturnType<typeof createGraph>;

const TYPENAME = "__typename";
const ID = "id";
const REF = "__ref";
const identityProps = new Set([TYPENAME, ID]);

const hasTypename = (o: any) => !!(o && typeof o === "object" && typeof o[TYPENAME] === "string");

function hasNonIdentityFields(o: any): boolean {
  for (const k of Object.keys(o)) {
    if (!identityProps.has(k) && o[k] !== undefined) return true;
  }
  return false;
}

function denormalizeValue(v: any, materializeEntity: (key: string) => any): any {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    const out = shallowReactive(new Array(v.length));
    for (let i = 0; i < v.length; i++) out[i] = denormalizeValue(v[i], materializeEntity);
    return out;
  }
  if (REF in v && typeof v[REF] === "string") {
    return materializeEntity(v[REF]);
  }
  const obj = shallowReactive({} as Record<string, any>);
  for (const k of Object.keys(v)) obj[k] = denormalizeValue(v[k], materializeEntity);
  return obj;
}

function overlayEntitySnapshotInto(
  proxy: any,
  snap: any,
  materializeEntity: (key: string) => any
) {
  // Remove stale fields
  for (const k of Object.keys(proxy)) {
    if (!identityProps.has(k) && !(k in snap)) delete proxy[k];
  }
  // Sync identity (typename & id)
  if (snap[TYPENAME] && proxy[TYPENAME] !== snap[TYPENAME]) proxy[TYPENAME] = snap[TYPENAME];
  if (snap[ID] != null) {
    const sid = String(snap[ID]);
    if (proxy[ID] !== sid) proxy[ID] = sid;
  } else if (ID in proxy) {
    delete proxy[ID];
  }
  // Overlay fields
  for (const k of Object.keys(snap)) {
    if (!identityProps.has(k)) proxy[k] = denormalizeValue(snap[k], materializeEntity);
  }
}

export function createGraph(config: GraphConfig) {
  // Implementor → canonical interface
  const canonicalByImpl = new Map<string, string>();
  if (config.interfaces) {
    for (const iface of Object.keys(config.interfaces)) {
      for (const impl of config.interfaces[iface] || []) {
        if (!canonicalByImpl.has(impl)) canonicalByImpl.set(impl, iface);
      }
    }
  }

  // ---- Stores ---------------------------------------------------------------
  const entityStore = new Map<string, Record<string, any>>();     // key -> snapshot (incl identity)
  const selectionStore = new Map<string, any>();                  // selectionKey -> skeleton

  // Two proxy caches (separate)
  const entityProxies = new Map<string, WeakRef<any>>();          // "entity:User:1" -> proxy
  const selectionProxies = new Map<string, WeakRef<any>>();       // "selection:user({...})" -> proxy

  // Reverse index: which selections reference which entities
  const refsIndex = new Map<string, Set<string>>();               // entityKey -> Set<selectionKeys>

  // Cache keyers
  const keyers = new Map<string, (obj: any) => string | null>();
  for (const [t, fn] of Object.entries(config.keys || {})) keyers.set(t, fn);

  function identify(obj: any): string | null {
    if (!hasTypename(obj)) return null;
    const impl = obj[TYPENAME] as string;
    const canonical = canonicalByImpl.get(impl) || impl;

    const kImpl = keyers.get(impl);
    const kCanon = canonical !== impl ? keyers.get(canonical) : undefined;
    const id =
      (kImpl ? kImpl(obj) : undefined) ??
      (kCanon ? kCanon(obj) : undefined) ??
      (obj[ID] ?? null);

    return id == null ? null : `${canonical}:${String(id)}`;
  }

  function normalizeValue(
    value: any,
    putEntityFn: (obj: any) => string | null
  ): any {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i++) out[i] = normalizeValue(value[i], putEntityFn);
      return out;
    }
    if (REF in value && typeof value[REF] === "string") return value;

    if (hasTypename(value)) {
      const key = identify(value);
      if (!key) {
        // not identifiable → recurse as plain object
        const o: any = {};
        for (const k of Object.keys(value)) o[k] = normalizeValue(value[k], putEntityFn);
        return o;
      }
      // identity-only?
      if (!hasNonIdentityFields(value)) {
        return { [REF]: key };
      }
      // full entity write + return ref
      putEntityFn(value);
      return { [REF]: key };
    }

    const o: any = {};
    for (const k of Object.keys(value)) o[k] = normalizeValue(value[k], putEntityFn);
    return o;
  }

  function updateSelectionsReferencing(entityKey: string) {
    const set = refsIndex.get(entityKey);
    if (!set) return;
    for (const selKey of set) {
      const skel = selectionStore.get(selKey);
      if (!skel) continue;
      const cacheKey = `selection:${selKey}`;
      const wr = selectionProxies.get(cacheKey);
      const proxy = wr?.deref?.();
      if (proxy) overlaySelection(proxy, skel);
    }
  }

  function putEntity(obj: any): string | null {
    const key = identify(obj);
    if (!key) return null;

    const incoming: any = { [TYPENAME]: obj[TYPENAME] };

    // id from payload or from key
    const colon = key.indexOf(":");
    const idFromKey = colon > -1 ? key.slice(colon + 1) : undefined;
    incoming[ID] = obj[ID] != null ? String(obj[ID]) : idFromKey;

    for (const k of Object.keys(obj)) {
      if (!identityProps.has(k)) {
        incoming[k] = normalizeValue(obj[k], putEntity);
      }
    }

    const existing = entityStore.get(key);
    if (existing) {
      // prune + merge
      for (const k of Object.keys(existing)) if (!(k in incoming)) delete existing[k];
      Object.assign(existing, incoming);
    } else {
      entityStore.set(key, incoming);
    }

    // update live entity proxy
    const eKey = `entity:${key}`;
    const wr = entityProxies.get(eKey);
    const proxy = wr?.deref?.();
    if (proxy) overlayEntitySnapshotInto(proxy, entityStore.get(key)!, materializeEntity);

    // refresh only selections that reference this entity
    updateSelectionsReferencing(key);

    return key;
  }

  function getEntity(key: string): Record<string, any> | undefined {
    return entityStore.get(key);
  }

  function removeEntity(key: string): boolean {
    const existed = entityStore.delete(key);
    const eKey = `entity:${key}`;
    const wr = entityProxies.get(eKey);
    const proxy = wr?.deref?.();
    if (proxy) {
      for (const k of Object.keys(proxy)) delete proxy[k];
    }
    // refresh selections (they’ll overlay back from empty entity → shrink)
    updateSelectionsReferencing(key);
    return existed;
  }

  function materializeEntity(key: string): any {
    const eKey = `entity:${key}`;
    const wr = entityProxies.get(eKey);
    const hit = wr?.deref?.();

    const snap = entityStore.get(key);
    const colon = key.indexOf(":");
    const typeFromKey = colon > -1 ? key.slice(0, colon) : key;
    const idFromKey = colon > -1 ? key.slice(colon + 1) : undefined;
    const concreteType = snap?.[TYPENAME] ?? typeFromKey;
    const concreteId = snap?.[ID] ?? idFromKey;

    if (hit) {
      if (hit[TYPENAME] !== concreteType) hit[TYPENAME] = concreteType;
      if (concreteId != null) {
        const sid = String(concreteId);
        if (hit[ID] !== sid) hit[ID] = sid;
      } else if (ID in hit) {
        delete hit[ID];
      }
      if (snap) overlayEntitySnapshotInto(hit, snap, materializeEntity);
      return hit;
    }

    const proxy = shallowReactive({}) as any;
    proxy[TYPENAME] = concreteType;
    if (concreteId != null) proxy[ID] = String(concreteId);
    if (snap) overlayEntitySnapshotInto(proxy, snap, materializeEntity);

    entityProxies.set(eKey, new WeakRef(proxy));
    return proxy;
  }

  // ---- Selections -----------------------------------------------------------

  function indexSelectionRefs(selKey: string, node: any, add: boolean) {
    // Walk the selection skeleton and index all {__ref}
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) indexSelectionRefs(selKey, node[i], add);
      return;
    }
    if (REF in node && typeof node[REF] === "string") {
      const ek = node[REF];
      if (add) {
        let set = refsIndex.get(ek);
        if (!set) refsIndex.set(ek, (set = new Set()));
        set.add(selKey);
      } else {
        const set = refsIndex.get(ek);
        if (set) {
          set.delete(selKey);
          if (set.size === 0) refsIndex.delete(ek);
        }
      }
      return;
    }
    for (const k of Object.keys(node)) indexSelectionRefs(selKey, node[k], add);
  }

  function putSelection(selectionKey: string, subtree: any): void {
    // If replacing existing selection, remove its refs from index first
    const prev = selectionStore.get(selectionKey);
    if (prev) indexSelectionRefs(selectionKey, prev, false);

    const normalized = normalizeValue(subtree, putEntity);
    selectionStore.set(selectionKey, normalized);

    // Add new refs to index
    indexSelectionRefs(selectionKey, normalized, true);

    const sKey = `selection:${selectionKey}`;
    const wr = selectionProxies.get(sKey);
    const proxy = wr?.deref?.();
    if (proxy) overlaySelection(proxy, normalized);
  }

  function getSelection(selectionKey: string): any | undefined {
    return selectionStore.get(selectionKey);
  }

  function removeSelection(selectionKey: string): boolean {
    const skel = selectionStore.get(selectionKey);
    const existed = selectionStore.delete(selectionKey);

    if (skel) indexSelectionRefs(selectionKey, skel, false);

    const sKey = `selection:${selectionKey}`;
    const wr = selectionProxies.get(sKey);
    const proxy = wr?.deref?.();
    if (proxy) {
      for (const k of Object.keys(proxy)) delete proxy[k];
    }
    return existed;
  }

  function materializeSelection(selectionKey: string): any {
    const skel = selectionStore.get(selectionKey);
    if (!skel) return undefined;

    const sKey = `selection:${selectionKey}`;
    const wr = selectionProxies.get(sKey);
    const hit = wr?.deref?.();
    if (hit) {
      overlaySelection(hit, skel);
      return hit;
    }

    const proxy = materializeFromSkeleton(skel);
    if (proxy && typeof proxy === "object") {
      selectionProxies.set(sKey, new WeakRef(proxy));
    }
    return proxy;
  }

  function materializeFromSkeleton(skel: any): any {
    if (!skel || typeof skel !== "object") return skel;
    if (REF in skel) {
      // Create a view wrapper that copies from the entity (not shared)
      const obj = shallowReactive({} as Record<string, any>);
      overlaySelection(obj, skel);
      return obj;
    }
    if (Array.isArray(skel)) {
      const out = shallowReactive(new Array(skel.length));
      for (let i = 0; i < skel.length; i++) out[i] = materializeFromSkeleton(skel[i]);
      return out;
    }
    const obj = shallowReactive({} as Record<string, any>);
    for (const k of Object.keys(skel)) obj[k] = materializeFromSkeleton(skel[k]);
    return obj;
  }

  function overlaySelection(target: any, skel: any) {
    if (!skel || typeof skel !== "object") return;

    if (REF in skel && typeof skel[REF] === "string") {
      const ent = materializeEntity(skel[REF]);
      // shallow copy entity proxy fields into the target
      for (const k of Object.keys(target)) delete target[k];
      for (const k of Object.keys(ent)) target[k] = ent[k];
      return;
    }

    if (Array.isArray(skel)) {
      if (!Array.isArray(target)) return;
      if (target.length > skel.length) target.splice(skel.length);
      for (let i = 0; i < skel.length; i++) {
        const tv = target[i];
        const sv = skel[i];
        if (tv && typeof tv === "object") overlaySelection(tv, sv);
        else target[i] = materializeFromSkeleton(sv);
      }
      return;
    }

    const tKeys = Object.keys(target);
    for (const k of tKeys) if (!(k in skel)) delete target[k];

    for (const k of Object.keys(skel)) {
      const sv = skel[k];
      const tv = target[k];
      if (sv && typeof sv === "object") {
        if (!tv || typeof tv !== "object") target[k] = materializeFromSkeleton(sv);
        else overlaySelection(tv, sv);
      } else {
        target[k] = sv;
      }
    }
  }

  function inspect() {
    const dump = (m: Map<string, any>) => {
      const o: Record<string, any> = {};
      for (const [k, v] of m.entries()) o[k] = v;
      return o;
    };
    return {
      entities: dump(entityStore),
      selections: dump(selectionStore),
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
