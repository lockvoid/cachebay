// src/core/graph.ts
import { shallowReactive } from "vue";

/** Public config */
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

/** Shared identity field set (no string constants exported) */
const identityFieldSet = new Set(["__typename", "id"]);

/** Helpers */
const hasTypename = (value: any): boolean => {
  return !!(value && typeof value === "object" && typeof value["__typename"] === "string");
};

const hasNonIdentityFields = (value: any): boolean => {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const field = keys[i];
    if (!identityFieldSet.has(field) && value[field] !== undefined) {
      return true;
    }
  }
  return false;
};

export const createGraph = (config: GraphConfig) => {
  // ────────────────────────────────────────────────────────────────────────────
  // Canonicalization (implementor typename → interface typename)
  // ────────────────────────────────────────────────────────────────────────────
  const canonicalByImpl = new Map<string, string>();
  if (config.interfaces) {
    const interfaces = Object.keys(config.interfaces);
    for (let i = 0; i < interfaces.length; i++) {
      const interfaceName = interfaces[i];
      const implementors = config.interfaces[interfaceName] || [];
      for (let j = 0; j < implementors.length; j++) {
        canonicalByImpl.set(implementors[j], interfaceName);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Stores
  // ────────────────────────────────────────────────────────────────────────────
  const entityStore = new Map<string, Record<string, any>>(); // key -> normalized snapshot (includes identity)
  const selectionStore = new Map<string, any>();              // selectionKey -> skeleton (objects/arrays with {__ref})

  // Separate proxy caches
  const entityProxies = new Map<string, WeakRef<any>>();      // "entity:User:1" -> reactive proxy
  const selectionProxies = new Map<string, WeakRef<any>>();   // "selection:user({})" -> reactive proxy

  // Reverse index: which selections reference which entities
  const refsIndex = new Map<string, Set<string>>();           // entityKey -> Set<selectionKey>

  // Keyers cache (typename -> keyer)
  const keyers = new Map<string, (obj: any) => string | null>();
  const configKeyEntries = Object.entries(config.keys || {});
  for (let i = 0; i < configKeyEntries.length; i++) {
    keyers.set(configKeyEntries[i][0], configKeyEntries[i][1]);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public: identity
  // ────────────────────────────────────────────────────────────────────────────
  const identify = (objectValue: any): string | null => {
    if (!hasTypename(objectValue)) {
      return null;
    }

    const implementor = objectValue["__typename"] as string;
    const canonical = canonicalByImpl.get(implementor) || implementor;

    const keyerForImpl = keyers.get(implementor);
    const keyerForCanonical = canonical !== implementor ? keyers.get(canonical) : undefined;

    const id =
      (keyerForImpl ? keyerForImpl(objectValue) : undefined) ??
      (keyerForCanonical ? keyerForCanonical(objectValue) : undefined) ??
      (objectValue["id"] ?? null);

    if (id == null) {
      return null;
    }

    return `${canonical}:${String(id)}`;
  };

  // ===========================================================================
  // Private helpers (depend on closures)
  // ===========================================================================

  // ——— Entity denormalization overlay ——————————————————————————————————————
  const denormalizeValue = (value: any): any => {
    // primitives
    if (!value || typeof value !== "object") {
      return value;
    }

    // arrays
    if (Array.isArray(value)) {
      const out = shallowReactive(new Array(value.length));
      for (let i = 0; i < value.length; i++) {
        out[i] = denormalizeValue(value[i]);
      }
      return out;
    }

    // entity reference
    if ("__ref" in value && typeof value["__ref"] === "string") {
      return materializeEntity(value["__ref"]);
    }

    // plain object
    const proxyObject = shallowReactive({} as Record<string, any>);
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const field = keys[i];
      proxyObject[field] = denormalizeValue(value[field]);
    }
    return proxyObject;
  };

  const overlayEntity = (entityProxy: any, entitySnapshot: any) => {
    // remove stale fields
    const proxyKeys = Object.keys(entityProxy);
    for (let i = 0; i < proxyKeys.length; i++) {
      const field = proxyKeys[i];
      if (!identityFieldSet.has(field) && !(field in entitySnapshot)) {
        delete entityProxy[field];
      }
    }

    // identity (typename & id)
    if (entitySnapshot["__typename"] && entityProxy["__typename"] !== entitySnapshot["__typename"]) {
      entityProxy["__typename"] = entitySnapshot["__typename"];
    }
    if (entitySnapshot["id"] != null) {
      const stableId = String(entitySnapshot["id"]);
      if (entityProxy["id"] !== stableId) {
        entityProxy["id"] = stableId;
      }
    } else if ("id" in entityProxy) {
      delete entityProxy["id"];
    }

    // overlay fields
    const snapshotKeys = Object.keys(entitySnapshot);
    for (let i = 0; i < snapshotKeys.length; i++) {
      const field = snapshotKeys[i];
      if (!identityFieldSet.has(field)) {
        entityProxy[field] = denormalizeValue(entitySnapshot[field]);
      }
    }
  };

  // ——— Normalization (writes entities & returns refs in skeletons) ——————————
  const normalizeValue = (value: any): any => {
    // primitives
    if (!value || typeof value !== "object") {
      return value;
    }

    // arrays
    if (Array.isArray(value)) {
      const normalized = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        normalized[i] = normalizeValue(value[i]);
      }
      return normalized;
    }

    // passthrough existing refs
    if ("__ref" in value && typeof value["__ref"] === "string") {
      return value;
    }

    // entity?
    if (hasTypename(value)) {
      const key = identify(value);

      if (!key) {
        // not identifiable → recurse as a plain object
        const outObject: any = {};
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
          const field = keys[i];
          outObject[field] = normalizeValue(value[field]);
        }
        return outObject;
      }

      // identity-only → just a ref
      if (!hasNonIdentityFields(value)) {
        return { __ref: key };
      }

      // full entity write, then ref
      putEntity(value);
      return { __ref: key };
    }

    // plain object
    const outPlain: any = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const field = keys[i];
      outPlain[field] = normalizeValue(value[field]);
    }
    return outPlain;
  };

  // ——— Selection-overlay helpers ————————————————————————————————————————————
  const updateSelectionsReferencing = (entityKey: string) => {
    const selectionKeys = refsIndex.get(entityKey);
    if (!selectionKeys) {
      return;
    }
    for (const selectionKey of selectionKeys) {
      const skeleton = selectionStore.get(selectionKey);
      if (!skeleton) {
        continue;
      }
      const cacheKey = `selection:${selectionKey}`;
      const weakRef = selectionProxies.get(cacheKey);
      const selectionProxy = weakRef?.deref?.();
      if (selectionProxy) {
        overlaySelection(selectionProxy, skeleton);
      }
    }
  };

  const indexSelectionRefs = (selectionKey: string, node: any, add: boolean) => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        indexSelectionRefs(selectionKey, node[i], add);
      }
      return;
    }

    if ("__ref" in node && typeof node["__ref"] === "string") {
      const entityKey = node["__ref"];
      if (add) {
        let set = refsIndex.get(entityKey);
        if (!set) {
          refsIndex.set(entityKey, (set = new Set()));
        }
        set.add(selectionKey);
      } else {
        const set = refsIndex.get(entityKey);
        if (set) {
          set.delete(selectionKey);
          if (set.size === 0) {
            refsIndex.delete(entityKey);
          }
        }
      }
      return;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      indexSelectionRefs(selectionKey, node[keys[i]], add);
    }
  };

  const materializeFromSkeleton = (skeleton: any): any => {
    if (!skeleton || typeof skeleton !== "object") {
      return skeleton;
    }

    if ("__ref" in skeleton) {
      const wrapper = shallowReactive({} as Record<string, any>);
      overlaySelection(wrapper, skeleton);
      return wrapper;
    }

    if (Array.isArray(skeleton)) {
      const out = shallowReactive(new Array(skeleton.length));
      for (let i = 0; i < skeleton.length; i++) {
        out[i] = materializeFromSkeleton(skeleton[i]);
      }
      return out;
    }

    const wrapper = shallowReactive({} as Record<string, any>);
    const keys = Object.keys(skeleton);
    for (let i = 0; i < keys.length; i++) {
      const field = keys[i];
      wrapper[field] = materializeFromSkeleton(skeleton[field]);
    }
    return wrapper;
  };

  const overlaySelection = (targetWrapper: any, skeleton: any) => {
    if (!skeleton || typeof skeleton !== "object") {
      return;
    }

    if ("__ref" in skeleton && typeof skeleton["__ref"] === "string") {
      const entityProxy = materializeEntity(skeleton["__ref"]);
      const currentKeys = Object.keys(targetWrapper);
      for (let i = 0; i < currentKeys.length; i++) {
        delete targetWrapper[currentKeys[i]];
      }
      const entityKeys = Object.keys(entityProxy);
      for (let i = 0; i < entityKeys.length; i++) {
        const field = entityKeys[i];
        targetWrapper[field] = entityProxy[field];
      }
      return;
    }

    if (Array.isArray(skeleton)) {
      if (!Array.isArray(targetWrapper)) {
        return;
      }
      if (targetWrapper.length > skeleton.length) {
        targetWrapper.splice(skeleton.length);
      }
      for (let i = 0; i < skeleton.length; i++) {
        const sourceNode = skeleton[i];
        const targetNode = targetWrapper[i];
        if (targetNode && typeof targetNode === "object") {
          overlaySelection(targetNode, sourceNode);
        } else {
          targetWrapper[i] = materializeFromSkeleton(sourceNode);
        }
      }
      return;
    }

    // object
    const existingKeys = Object.keys(targetWrapper);
    for (let i = 0; i < existingKeys.length; i++) {
      const field = existingKeys[i];
      if (!(field in skeleton)) {
        delete targetWrapper[field];
      }
    }
    const skeletonKeys = Object.keys(skeleton);
    for (let i = 0; i < skeletonKeys.length; i++) {
      const field = skeletonKeys[i];
      const sv = skeleton[field];
      const tv = targetWrapper[field];
      if (sv && typeof sv === "object") {
        if (!tv || typeof tv !== "object") {
          targetWrapper[field] = materializeFromSkeleton(sv);
        } else {
          overlaySelection(tv, sv);
        }
      } else {
        targetWrapper[field] = sv;
      }
    }
  };

  // ===========================================================================
  // Public API
  // ===========================================================================

  // ────────────────────────────────────────────────────────────────────────────
  // Entities
  // ────────────────────────────────────────────────────────────────────────────
  const putEntity = (objectValue: any): string | null => {
    const key = identify(objectValue);
    if (!key) {
      return null;
    }

    // build snapshot (including identity)
    const incomingSnapshot: any = { ["__typename"]: objectValue["__typename"] };
    const colonIdx = key.indexOf(":");
    const idFromKey = colonIdx > -1 ? key.slice(colonIdx + 1) : undefined;
    incomingSnapshot["id"] = objectValue["id"] != null ? String(objectValue["id"]) : idFromKey;

    const objectKeys = Object.keys(objectValue);
    for (let i = 0; i < objectKeys.length; i++) {
      const field = objectKeys[i];
      if (!identityFieldSet.has(field)) {
        incomingSnapshot[field] = normalizeValue(objectValue[field]);
      }
    }

    const existingSnapshot = entityStore.get(key);
    if (existingSnapshot) {
      // MERGE ONLY — do not prune fields that aren't present in the incoming fragment
      Object.assign(existingSnapshot, incomingSnapshot);
    } else {
      entityStore.set(key, incomingSnapshot);
    }

    // refresh any live entity proxy
    const entityCacheKey = `entity:${key}`;
    const entityWeakRef = entityProxies.get(entityCacheKey);
    const entityProxy = entityWeakRef?.deref?.();
    if (entityProxy) {
      overlayEntity(entityProxy, entityStore.get(key)!);
    }

    // refresh selections that reference this entity
    updateSelectionsReferencing(key);

    return key;
  };

  const getEntity = (key: string): Record<string, any> | undefined => {
    return entityStore.get(key);
  };

  const removeEntity = (key: string): boolean => {
    const existed = entityStore.delete(key);

    const entityCacheKey = `entity:${key}`;
    const entityWeakRef = entityProxies.get(entityCacheKey);
    const entityProxy = entityWeakRef?.deref?.();
    if (entityProxy) {
      const keys = Object.keys(entityProxy);
      for (let i = 0; i < keys.length; i++) {
        delete entityProxy[keys[i]];
      }
    }

    // shrink any selections that referenced it
    updateSelectionsReferencing(key);

    return existed;
  };

  const materializeEntity = (key: string): any => {
    const entityCacheKey = `entity:${key}`;
    const entityWeakRef = entityProxies.get(entityCacheKey);
    const hit = entityWeakRef?.deref?.();

    const snapshot = entityStore.get(key);
    const colonIdx = key.indexOf(":");
    const typeFromKey = colonIdx > -1 ? key.slice(0, colonIdx) : key;
    const idFromKey = colonIdx > -1 ? key.slice(colonIdx + 1) : undefined;

    const concreteType = snapshot?.["__typename"] ?? typeFromKey;
    const concreteId = snapshot?.["id"] ?? idFromKey;

    if (hit) {
      if (hit["__typename"] !== concreteType) {
        hit["__typename"] = concreteType;
      }
      if (concreteId != null) {
        const stableId = String(concreteId);
        if (hit["id"] !== stableId) {
          hit["id"] = stableId;
        }
      } else if ("id" in hit) {
        delete hit["id"];
      }
      if (snapshot) {
        overlayEntity(hit, snapshot);
      }
      return hit;
    }

    const proxy = shallowReactive({} as any);
    proxy["__typename"] = concreteType;
    if (concreteId != null) {
      proxy["id"] = String(concreteId);
    }
    if (snapshot) {
      overlayEntity(proxy, snapshot);
    }

    entityProxies.set(entityCacheKey, new WeakRef(proxy));
    return proxy;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Selections
  // ────────────────────────────────────────────────────────────────────────────
  const putSelection = (selectionKey: string, subtree: any): void => {
    // un-index old refs if rewriting
    const previousSkeleton = selectionStore.get(selectionKey);
    if (previousSkeleton) {
      indexSelectionRefs(selectionKey, previousSkeleton, false);
    }

    const normalizedSkeleton = normalizeValue(subtree);
    selectionStore.set(selectionKey, normalizedSkeleton);

    // index new refs
    indexSelectionRefs(selectionKey, normalizedSkeleton, true);

    // refresh live selection proxy if present
    const selectionCacheKey = `selection:${selectionKey}`;
    const selectionWeakRef = selectionProxies.get(selectionCacheKey);
    const selectionProxy = selectionWeakRef?.deref?.();
    if (selectionProxy) {
      overlaySelection(selectionProxy, normalizedSkeleton);
    }
  };

  const getSelection = (selectionKey: string): any | undefined => {
    return selectionStore.get(selectionKey);
  };

  const removeSelection = (selectionKey: string): boolean => {
    const skeleton = selectionStore.get(selectionKey);
    const existed = selectionStore.delete(selectionKey);

    if (skeleton) {
      indexSelectionRefs(selectionKey, skeleton, false);
    }

    const selectionCacheKey = `selection:${selectionKey}`;
    const selectionWeakRef = selectionProxies.get(selectionCacheKey);
    const selectionProxy = selectionWeakRef?.deref?.();
    if (selectionProxy) {
      const keys = Object.keys(selectionProxy);
      for (let i = 0; i < keys.length; i++) {
        delete selectionProxy[keys[i]];
      }
    }

    return existed;
  };

  const materializeSelection = (selectionKey: string): any => {
    const skeleton = selectionStore.get(selectionKey);
    if (!skeleton) {
      return undefined;
    }

    const selectionCacheKey = `selection:${selectionKey}`;
    const selectionWeakRef = selectionProxies.get(selectionCacheKey);
    const hit = selectionWeakRef?.deref?.();
    if (hit) {
      overlaySelection(hit, skeleton);
      return hit;
    }

    const wrapper = materializeFromSkeleton(skeleton);
    if (wrapper && typeof wrapper === "object") {
      selectionProxies.set(selectionCacheKey, new WeakRef(wrapper));
    }
    return wrapper;
  };

  const inspect = () => {
    const toPlainObject = (m: Map<string, any>) => {
      const result: Record<string, any> = {};
      for (const [k, v] of m.entries()) {
        result[k] = v;
      }
      return result;
    };
    return {
      entities: toPlainObject(entityStore),
      selections: toPlainObject(selectionStore),
      config: {
        keys: Object.keys(config.keys || {}),
        interfaces: config.interfaces || {},
      },
    };
  };

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

    listEntityKeys: () => Array.from(entityStore.keys()),
    listSelectionKeys: () => Array.from(selectionStore.keys()),
    clearAllEntities: () => { for (const k of entityStore.keys()) removeEntity(k); },
    clearAllSelections: () => { for (const k of selectionStore.keys()) removeSelection(k); },

    // helpers
    inspect,
  };
};
