import { shallowReactive } from "vue";

export type GraphConfig = {
  keys: Record<string, (obj: any) => string | null>;
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

/**
 * Creates a normalized GraphQL cache with reactive entity and selection stores.
 *
 * Provides entity normalization, selection tracking, and reactive materialization
 * for GraphQL responses. Entities are stored by stable keys and selections maintain
 * references to entities for efficient updates and cache invalidation.
 *
 * @param config - Configuration object with key generators and interface mappings
 * @returns Graph API with entity and selection management methods
 */
export const createGraph = (config: GraphConfig) => {
  // Canonicalization (implementor typename → interface typename)
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

  // Stores
  const entityStore = new Map<string, Record<string, any>>();
  const selectionStore = new Map<string, any>();

  // Separate proxy caches
  const entityProxies = new Map<string, WeakRef<any>>();
  const selectionProxies = new Map<string, WeakRef<any>>();

  // Reverse index: which selections reference which entities
  const refsIndex = new Map<string, Set<string>>();

  // Keyers cache (typename -> keyer)
  const keyers = new Map<string, (obj: any) => string | null>();
  const configKeyEntries = Object.entries(config.keys || {});
  for (let i = 0; i < configKeyEntries.length; i++) {
    keyers.set(configKeyEntries[i][0], configKeyEntries[i][1]);
  }

  /**
   * Generates a stable cache key for an object based on its type and configured key function.
   *
   * @param object - The object to identify (must have __typename)
   * @returns A stable key like "User:123" or null if not identifiable
   */
  const identify = (object: any): string | null => {
    if (!hasTypename(object)) {
      return null;
    }

    const implementor = object["__typename"] as string;
    const canonical = canonicalByImpl.get(implementor) || implementor;

    const keyerForImpl = keyers.get(implementor);
    const keyerForCanonical = canonical !== implementor ? keyers.get(canonical) : undefined;

    const id =
      (keyerForImpl ? keyerForImpl(object) : undefined) ??
      (keyerForCanonical ? keyerForCanonical(object) : undefined) ??
      (object["id"] ?? null);

    if (id == null) {
      return null;
    }

    return `${canonical}:${String(id)}`;
  };

  // ===========================================================================
  // Private helpers (depend on closures)
  // ===========================================================================

  /**
   * Recursively denormalizes a normalized value by resolving entity references.
   */
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

  /**
   * Updates an entity proxy with the latest snapshot data.
   */
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

  /**
   * Recursively normalizes a value by extracting entities and creating references.
   */
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

  /**
   * Updates all selections that reference a given entity.
   */
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

  /**
   * Indexes entity references within a selection for efficient invalidation.
   */
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

  /**
   * Creates a reactive wrapper from a normalized skeleton.
   */
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

  /**
   * Updates a selection wrapper with the latest skeleton data.
   */
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
      const skeletonValue = skeleton[field];
      const targetValue = targetWrapper[field];
      if (skeletonValue && typeof skeletonValue === "object") {
        if (!targetValue || typeof targetValue !== "object") {
          targetWrapper[field] = materializeFromSkeleton(skeletonValue);
        } else {
          overlaySelection(targetValue, skeletonValue);
        }
      } else {
        targetWrapper[field] = skeletonValue;
      }
    }
  };

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Stores an entity in the normalized cache and updates related selections.
   *
   * @param object - The entity object to store
   * @returns The generated cache key or null if not identifiable
   */
  const putEntity = (object: any): string | null => {
    const key = identify(object);
    if (!key) {
      return null;
    }

    // build snapshot (including identity)
    const incomingSnapshot: any = { ["__typename"]: object["__typename"] };
    const colonIdx = key.indexOf(":");
    const idFromKey = colonIdx > -1 ? key.slice(colonIdx + 1) : undefined;
    incomingSnapshot["id"] = object["id"] != null ? String(object["id"]) : idFromKey;

    const objectKeys = Object.keys(object);
    for (let i = 0; i < objectKeys.length; i++) {
      const field = objectKeys[i];
      if (!identityFieldSet.has(field)) {
        incomingSnapshot[field] = normalizeValue(object[field]);
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

  /**
   * Retrieves the raw normalized snapshot of an entity.
   *
   * @param key - The entity cache key
   * @returns The entity snapshot or undefined if not found
   */
  const getEntity = (key: string): Record<string, any> | undefined => {
    return entityStore.get(key);
  };

  /**
   * Removes an entity from the cache and clears related proxies.
   *
   * @param key - The entity cache key to remove
   * @returns True if the entity existed and was removed
   */
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

  /**
   * Creates or retrieves a reactive proxy for an entity.
   *
   * @param key - The entity cache key
   * @returns A reactive proxy object for the entity
   */
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

  /**
   * Stores a selection skeleton and updates the reference index.
   *
   * @param selectionKey - The selection cache key
   * @param subtree - The selection data to normalize and store
   */
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

  /**
   * Retrieves the raw normalized skeleton of a selection.
   *
   * @param selectionKey - The selection cache key
   * @returns The selection skeleton or undefined if not found
   */
  const getSelection = (selectionKey: string): any | undefined => {
    return selectionStore.get(selectionKey);
  };

  /**
   * Removes a selection from the cache and clears related proxies.
   *
   * @param selectionKey - The selection cache key to remove
   * @returns True if the selection existed and was removed
   */
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

  /**
   * Creates or retrieves a reactive proxy for a selection.
   *
   * @param selectionKey - The selection cache key
   * @returns A reactive proxy object for the selection or undefined if not found
   */
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

  /**
   * Returns all entity cache keys currently stored.
   *
   * @returns Array of entity keys like ["User:1", "Post:123"]
   */
  const listEntityKeys = () => {
    return Array.from(entityStore.keys());
  };

  /**
   * Returns all selection cache keys currently stored.
   *
   * @returns Array of selection keys like ["user({})", "User:1.posts({first:10})"]
   */
  const listSelectionKeys = () => {
    return Array.from(selectionStore.keys());
  };

  /**
   * Removes all entities from the cache and clears their proxies.
   */
  const clearEntities = () => {
    for (const key of entityStore.keys()) {
      removeEntity(key);
    }
  };

  /**
   * Removes all selections from the cache and clears their proxies.
   */
  const clearSelections = () => {
    for (const key of selectionStore.keys()) {
      removeSelection(key);
    }
  };

  /**
   * Provides a debug view of the cache contents.
   *
   * @returns Object containing entities, selections, and config for inspection
   */
  const inspect = () => {
    const toPlainObject = (object: Map<string, any>) => {
      const result: Record<string, any> = {};

      for (const [key, value] of object.entries()) {
        result[key] = value;
      }

      return result;
    };

    return {
      entities: toPlainObject(entityStore),
      selections: toPlainObject(selectionStore),

      config: {
        keys: config.keys || {},
        interfaces: config.interfaces || {},
      },
    };
  };

  return {
    identify,
    putEntity,
    getEntity,
    removeEntity,
    materializeEntity,
    putSelection,
    getSelection,
    removeSelection,
    materializeSelection,
    listEntityKeys,
    listSelectionKeys,
    clearEntities,
    clearSelections,
    inspect,
  };
};
