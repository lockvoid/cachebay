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

/**
 * Checks if a value has a __typename property.
 * @private
 */
const hasTypename = (value: any): boolean =>
  !!(value && typeof value === "object" && typeof value.__typename === "string");

/**
 * Checks if an object has fields beyond __typename and id.
 * @private
 */
const hasNonIdentityFields = (value: any): boolean => {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!IDENTITY_FIELDS.has(key) && value[key] !== undefined) return true;
  }
  return false;
};

/**
 * Proxy cache manager (WeakRef-backed)
 * @private
 */
class ProxyManager {
  private proxies = new Map<string, WeakRef<any>>();

  /**
   * Gets a proxy from the cache if it still exists.
   */
  get(key: string): any | undefined {
    return this.proxies.get(key)?.deref?.();
  }

  /**
   * Stores a proxy in the cache using WeakRef.
   */
  set(key: string, proxy: any): void {
    this.proxies.set(key, new WeakRef(proxy));
  }

  /**
   * Removes a proxy from the cache.
   */
  delete(key: string): void {
    this.proxies.delete(key);
  }

  /**
   * Remove entries whose referent was garbage collected.
   */
  prune(): void {
    for (const [key, weakRef] of this.proxies.entries()) {
      if (!weakRef.deref()) this.proxies.delete(key);
    }
  }

  /**
   * Wipe the entire cache.
   */
  clear(): void {
    this.proxies.clear();
  }
}

/**
 * Key manager (parse "Type:id" once, with memoization)
 * @private
 */
class KeyManager {
  private cache = new Map<string, [string, string | undefined]>();

  /**
   * Parses a cache key into typename and id components.
   * @param key - Cache key like "User:123"
   * @returns Tuple of [typename, id] where id may be undefined
   */
  parse(key: string): [typename: string, id?: string] {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const colonIndex = key.indexOf(":");
    const result: [string, string | undefined] =
      colonIndex >= 0 ? [key.slice(0, colonIndex), key.slice(colonIndex + 1)] : [key, undefined];
    this.cache.set(key, result);
    return result;
  }
}

/**
 * Interface manager (implementor -> canonical interface)
 * @private
 */
class InterfaceManager {
  private canonicalByImplementor = new Map<string, string>();

  constructor(interfaceMap?: Record<string, string[]>) {
    if (interfaceMap) {
      const interfaces = Object.keys(interfaceMap);
      for (let i = 0; i < interfaces.length; i++) {
        const interfaceName = interfaces[i];
        const implementors = interfaceMap[interfaceName] || [];
        for (let j = 0; j < implementors.length; j++) {
          this.canonicalByImplementor.set(implementors[j], interfaceName);
        }
      }
    }
  }

  /**
   * Gets the canonical interface name for a typename.
   * @param typename - The concrete or interface typename
   * @returns The canonical interface name, or the original typename if no mapping exists
   */
  canonicalOf(typename: string): string {
    return this.canonicalByImplementor.get(typename) || typename;
  }
}

/**
 * Creates normalization utilities with closure access to putEntity and identify.
 * @private
 */
const createNormalizer = (
  putEntity: (obj: any) => string | null,
  identify: (obj: any) => string | null,
) => {
  /**
   * Recursively normalizes a value by extracting entities and creating references.
   * @private
   */
  const normalizeValue = (value: any): any => {
    if (!value || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const output = new Array(value.length);
      for (let i = 0; i < value.length; i++) output[i] = normalizeValue(value[i]);
      return output;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return value;
    }

    if (hasTypename(value)) {
      const key = identify(value);
      if (!key) {
        // non-identifiable object: recurse
        const object: any = {};
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) object[keys[i]] = normalizeValue(value[keys[i]]);
        return object;
      }
      if (!hasNonIdentityFields(value)) return { __ref: key };
      // write and return ref
      putEntity(value);
      return { __ref: key };
    }

    // plain object
    const output: any = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) output[keys[i]] = normalizeValue(value[keys[i]]);
    return output;
  };

  /**
   * Recursively denormalizes a normalized value by resolving entity references.
   * @private
   */
  const denormalizeValue = (value: any, materializeEntity: (key: string) => any): any => {
    if (!value || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const output = shallowReactive(new Array(value.length));
      for (let i = 0; i < value.length; i++) output[i] = denormalizeValue(value[i], materializeEntity);
      return output;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return materializeEntity(value.__ref);
    }

    const proxy = shallowReactive({} as Record<string, any>);
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) proxy[keys[i]] = denormalizeValue(value[keys[i]], materializeEntity);
    return proxy;
  };

  return { normalizeValue, denormalizeValue };
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
  // Interface canonicalization
  const interfaceManager = new InterfaceManager(config.interfaces);

  // Stores
  const entityStore = new Map<string, Record<string, any>>();
  const selectionStore = new Map<string, any>();

  // Proxies
  const entityProxyManager = new ProxyManager();
  const selectionProxyManager = new ProxyManager();

  // Reverse index: entityKey -> Set<selectionKey>
  const referencesIndex = new Map<string, Set<string>>();

  // Keyers cache (typename -> keyer)
  const keyers = new Map<string, (obj: any) => string | null>();
  for (const [typename, keyFunction] of Object.entries(config.keys || {})) keyers.set(typename, keyFunction);

  // Managers
  const keyManager = new KeyManager();

  /**
   * Generates a stable cache key for an object based on its type and configured key function.
   *
   * @param objectValue - The object to identify (must have __typename)
   * @returns A stable key like "User:123" or null if not identifiable
   */
  const identify = (objectValue: any): string | null => {
    if (!hasTypename(objectValue)) return null;

    const implementor = objectValue.__typename as string;
    const canonical = interfaceManager.canonicalOf(implementor);

    const implementorKeyer = keyers.get(implementor);
    const interfaceKeyer = canonical !== implementor ? keyers.get(canonical) : undefined;

    const id =
      (implementorKeyer ? implementorKeyer(objectValue) : undefined) ??
      (interfaceKeyer ? interfaceKeyer(objectValue) : undefined) ??
      (objectValue.id ?? null);

    if (id == null) return null;
    return `${canonical}:${String(id)}`;
  };

  // Normalizer/denormalizer with closures into this graph
  // (We bind putEntity later, but types are fine since we hoist the declaration.)
  let normalizeValue!: (value: any) => any;
  let denormalizeValue!: (value: any, materializeEntity: (key: string) => any) => any;

  /**
   * Updates an entity proxy with the latest snapshot data.
   * @private
   */
  const overlayEntity = (entityProxy: any, snapshot: any) => {
    // drop stale fields (keep identity)
    const keys = Object.keys(entityProxy);
    for (let i = 0; i < keys.length; i++) {
      const field = keys[i];
      if (!IDENTITY_FIELDS.has(field) && !(field in snapshot)) delete entityProxy[field];
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
    const snapshotKeys = Object.keys(snapshot);
    for (let i = 0; i < snapshotKeys.length; i++) {
      const field = snapshotKeys[i];
      if (!IDENTITY_FIELDS.has(field)) entityProxy[field] = denormalizeValue(snapshot[field], materializeEntity);
    }
  };

  /**
   * Creates a reactive wrapper from a normalized skeleton.
   * @private
   */
  const materializeFromSkeleton = (skeleton: any): any => {
    if (!skeleton || typeof skeleton !== "object") return skeleton;
    if ("__ref" in skeleton) {
      const wrapper = shallowReactive({} as Record<string, any>);
      overlaySelection(wrapper, skeleton);
      return wrapper;
    }
    if (Array.isArray(skeleton)) {
      const output = shallowReactive(new Array(skeleton.length));
      for (let i = 0; i < skeleton.length; i++) output[i] = materializeFromSkeleton(skeleton[i]);
      return output;
    }
    const object = shallowReactive({} as Record<string, any>);
    const keys = Object.keys(skeleton);
    for (let i = 0; i < keys.length; i++) object[keys[i]] = materializeFromSkeleton(skeleton[keys[i]]);
    return object;
  };

  /**
   * Updates a selection wrapper with the latest skeleton data.
   * @private
   */
  const overlaySelection = (target: any, skeleton: any) => {
    if (!skeleton || typeof skeleton !== "object") return;

    if ("__ref" in skeleton && typeof skeleton.__ref === "string") {
      const entity = materializeEntity(skeleton.__ref);
      const existing = Object.keys(target);
      for (let i = 0; i < existing.length; i++) delete target[existing[i]];
      const entityKeys = Object.keys(entity);
      for (let i = 0; i < entityKeys.length; i++) target[entityKeys[i]] = entity[entityKeys[i]];
      return;
    }

    if (Array.isArray(skeleton)) {
      if (!Array.isArray(target)) return;
      if (target.length > skeleton.length) target.splice(skeleton.length);
      for (let i = 0; i < skeleton.length; i++) {
        const skeletonValue = skeleton[i];
        const targetValue = target[i];
        if (targetValue && typeof targetValue === "object") overlaySelection(targetValue, skeletonValue);
        else target[i] = materializeFromSkeleton(skeletonValue);
      }
      return;
    }

    // object
    const current = Object.keys(target);
    for (let i = 0; i < current.length; i++) {
      const field = current[i];
      if (!(field in skeleton)) delete target[field];
    }
    const keys = Object.keys(skeleton);
    for (let i = 0; i < keys.length; i++) {
      const field = keys[i];
      const skeletonValue = skeleton[field];
      const targetValue = target[field];
      if (skeletonValue && typeof skeletonValue === "object") {
        if (!targetValue || typeof targetValue !== "object") target[field] = materializeFromSkeleton(skeletonValue);
        else overlaySelection(targetValue, skeletonValue);
      } else {
        target[field] = skeletonValue;
      }
    }
  };

  /**
   * Indexes or unindexes __ref usage inside a selection skeleton.
   * @private
   */
  const indexSelectionRefs = (selectionKey: string, node: any, add: boolean) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) indexSelectionRefs(selectionKey, node[i], add);
      return;
    }

    if ("__ref" in node && typeof node.__ref === "string") {
      const entityKey = node.__ref;
      if (add) {
        let bucket = referencesIndex.get(entityKey);
        if (!bucket) referencesIndex.set(entityKey, (bucket = new Set()));
        bucket.add(selectionKey);
      } else {
        const bucket = referencesIndex.get(entityKey);
        if (bucket) {
          bucket.delete(selectionKey);
          if (bucket.size === 0) referencesIndex.delete(entityKey);
        }
      }
      return;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) indexSelectionRefs(selectionKey, node[keys[i]], add);
  };

  /**
   * Reconciles all mounted selections that reference an entity.
   * @private
   */
  const syncSelections = (entityKey: string) => {
    const keys = referencesIndex.get(entityKey);
    if (!keys) return;
    for (const selectionKey of keys) {
      const skeleton = selectionStore.get(selectionKey);
      if (!skeleton) continue;
      const proxy = selectionProxyManager.get(`selection:${selectionKey}`);
      if (proxy) overlaySelection(proxy, skeleton);
    }
  };

  /**
   * Stores an entity in the normalized cache and updates related selections.
   *
   * @param object - The entity object to store
   * @returns The generated cache key or null if not identifiable
   */
  const putEntity = (object: any): string | null => {
    const key = identify(object);
    if (!key) return null;

    const snapshot: any = { __typename: object.__typename };
    const [, idFromKey] = keyManager.parse(key);
    snapshot.id = object.id != null ? String(object.id) : idFromKey;

    const fields = Object.keys(object);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!IDENTITY_FIELDS.has(field)) snapshot[field] = normalizeValue(object[field]);
    }

    const previous = entityStore.get(key);
    if (previous) Object.assign(previous, snapshot);
    else entityStore.set(key, snapshot);

    // live entity proxy refresh
    const proxy = entityProxyManager.get(`entity:${key}`);
    if (proxy) overlayEntity(proxy, entityStore.get(key)!);

    // reconcile selections that point to this entity
    syncSelections(key);

    return key;
  };

  /**
   * Retrieves the raw normalized snapshot of an entity.
   *
   * @param key - The entity cache key
   * @returns The entity snapshot or undefined if not found
   */
  const getEntity = (key: string): Record<string, any> | undefined => entityStore.get(key);

  /**
   * Removes an entity from the cache and clears related proxies.
   *
   * @param key - The entity cache key to remove
   * @returns True if the entity existed and was removed
   */
  const removeEntity = (key: string): boolean => {
    const existed = entityStore.delete(key);

    const proxy = entityProxyManager.get(`entity:${key}`);
    if (proxy) {
      const keys = Object.keys(proxy);
      for (let i = 0; i < keys.length; i++) delete proxy[keys[i]];
    }

    // selections shrink if they referenced this entity
    syncSelections(key);

    return existed;
  };

  /**
   * Creates or retrieves a reactive proxy for an entity.
   *
   * @param key - The entity cache key
   * @returns A reactive proxy object for the entity
   */
  const materializeEntity = (key: string): any => {
    const hit = entityProxyManager.get(`entity:${key}`);
    const snapshot = entityStore.get(key);
    const [typeFromKey, idFromKey] = keyManager.parse(key);
    const concreteType = snapshot?.__typename ?? typeFromKey;
    const concreteId = snapshot?.id ?? idFromKey;

    if (hit) {
      if (hit.__typename !== concreteType) hit.__typename = concreteType;
      if (concreteId != null) {
        const stableId = String(concreteId);
        if (hit.id !== stableId) hit.id = stableId;
      } else if ("id" in hit) {
        delete hit.id;
      }
      if (snapshot) overlayEntity(hit, snapshot);
      return hit;
    }

    const proxy = shallowReactive({} as any);
    proxy.__typename = concreteType;
    if (concreteId != null) proxy.id = String(concreteId);
    if (snapshot) overlayEntity(proxy, snapshot);

    entityProxyManager.set(`entity:${key}`, proxy);
    return proxy;
  };

  /**
   * Stores a selection skeleton and updates the reference index.
   *
   * @param selectionKey - The selection cache key
   * @param subtree - The selection data to normalize and store
   */
  const putSelection = (selectionKey: string, subtree: any): void => {
    const previous = selectionStore.get(selectionKey);
    if (previous) indexSelectionRefs(selectionKey, previous, false);

    const normalized = normalizeValue(subtree);
    selectionStore.set(selectionKey, normalized);

    indexSelectionRefs(selectionKey, normalized, true);

    const proxy = selectionProxyManager.get(`selection:${selectionKey}`);
    if (proxy) overlaySelection(proxy, normalized);
  };

  /**
   * Retrieves the raw normalized skeleton of a selection.
   *
   * @param selectionKey - The selection cache key
   * @returns The selection skeleton or undefined if not found
   */
  const getSelection = (selectionKey: string): any | undefined => selectionStore.get(selectionKey);

  /**
   * Removes a selection from the cache and clears related proxies.
   *
   * @param selectionKey - The selection cache key to remove
   * @returns True if the selection existed and was removed
   */
  const removeSelection = (selectionKey: string): boolean => {
    const skeleton = selectionStore.get(selectionKey);
    const existed = selectionStore.delete(selectionKey);

    if (skeleton) indexSelectionRefs(selectionKey, skeleton, false);

    const proxy = selectionProxyManager.get(`selection:${selectionKey}`);
    if (proxy) {
      const keys = Object.keys(proxy);
      for (let i = 0; i < keys.length; i++) delete proxy[keys[i]];
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
    if (!skeleton) return undefined;

    const hit = selectionProxyManager.get(`selection:${selectionKey}`);
    if (hit) {
      overlaySelection(hit, skeleton);
      return hit;
    }
    const wrapper = materializeFromSkeleton(skeleton);
    if (wrapper && typeof wrapper === "object") {
      selectionProxyManager.set(`selection:${selectionKey}`, wrapper);
    }
    return wrapper;
  };

  /**
   * Returns all entity cache keys currently stored.
   *
   * @returns Array of entity keys like ["User:1", "Post:123"]
   */
  const listEntityKeys = () => Array.from(entityStore.keys());

  /**
   * Returns all selection cache keys currently stored.
   *
   * @returns Array of selection keys like ["user({})", "User:1.posts({first:10})"]
   */
  const listSelectionKeys = () => Array.from(selectionStore.keys());

  /**
   * Clears entities and/or selections from the cache.
   *
   * @param options - Configuration for what to clear (defaults to clearing both)
   * @example
   * clear()                        // wipe both
   * clear({ entities: true })      // only entities
   * clear({ selections: true })    // only selections
   */
  const clear = (options?: { entities?: boolean; selections?: boolean }) => {
    const clearEntities = options?.entities ?? true;
    const clearSelections = options?.selections ?? true;

    if (clearSelections) {
      for (const key of selectionStore.keys()) removeSelection(key);
      selectionProxyManager.clear();
    }
    if (clearEntities) {
      for (const key of entityStore.keys()) removeEntity(key);
      entityProxyManager.clear();
    }
  };

  /**
   * Provides a debug view of the cache contents.
   *
   * @returns Object containing entities, selections, and config for inspection
   */
  const inspect = () => {
    const toObject = (map: Map<string, any>) => {
      const output: Record<string, any> = {};
      for (const [key, value] of map.entries()) output[key] = value;
      return output;
    };
    return {
      entities: toObject(entityStore),
      selections: toObject(selectionStore),
      config: {
        keys: config.keys || {},
        interfaces: config.interfaces || {},
      },
    };
  };

  // Install normalizer now (after putEntity/identify closures exist)
  {
    const normalizer = createNormalizer(putEntity, identify);
    normalizeValue = normalizer.normalizeValue;
    denormalizeValue = normalizer.denormalizeValue;
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
