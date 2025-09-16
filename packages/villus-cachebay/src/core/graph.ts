import { shallowReactive } from "vue";
import { hasTypename, isPureIdentity, isObject } from "./utils";
import { IDENTITY_FIELDS } from "./constants";

export type GraphOptions = {
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
};

export type GraphInstance = ReturnType<typeof createGraph>;

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
      if (!weakRef.deref()) {
        this.proxies.delete(key);
      }
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
 * Unified identity manager handling key parsing, interface resolution, and keyer functions
 * @private
 */
class IdentityManager {
  private keyStore = new Map<string, [string, string | undefined]>();
  private interfaceStore = new Map<string, string>();
  private idResolvers = new Map<string, (obj: any) => string | null>();

  constructor(config: { keys: Record<string, (obj: any) => string | null>; interfaces?: Record<string, string[]> }) {
    for (const [typename, keyFunction] of Object.entries(config.keys || {})) {
      this.idResolvers.set(typename, keyFunction);
    }

    if (config.interfaces) {
      const interfaces = Object.keys(config.interfaces);

      for (let i = 0; i < interfaces.length; i++) {
        const interfaceTypename = interfaces[i];
        const implementors = config.interfaces[interfaceTypename] || [];

        for (let j = 0; j < implementors.length; j++) {
          this.interfaceStore.set(implementors[j], interfaceTypename);
        }
      }
    }
  }

  getCanonicalTypename(typename: string): string {
    return this.interfaceStore.get(typename) || typename;
  }

  parseKey(key: string): [string, string | undefined] {
    const hit = this.keyStore.get(key);

    if (hit) {
      return hit;
    }

    const [typename, id] = key.split(":", 2);

    this.keyStore.set(key, [typename, id]);

    return [typename, id];
  }

  stringifyKey(object: any): string | null {
    if (!hasTypename(object)) {
      return null;
    }

    const typename = this.getCanonicalTypename(object.__typename);

    const id = this.idResolvers.has(typename) ? this.idResolvers.get(typename)(object) : null;

    return (id != null) ? `${typename}:${id}` : null;
  }

  clear(): void {
    this.keyStore.clear();
  }
}

export const createGraph = (options: GraphOptions) => {
  const identityManager = new IdentityManager({ keys: options.keys, interfaces: options.interfaces });
  const entityStore = new Map<string, Record<string, any>>();
  const selectionStore = new Map<string, any>();
  const entityProxyManager = new ProxyManager();
  const selectionProxyManager = new ProxyManager();
  const entityReferences = new Map<string, Set<string>>();

  /**
   * Generates a stable cache key for an object based on its type and configured key function.
   *
   * @param object - The object to identify (must have __typename)
   * @return A stable key like "User:123" or null if not identifiable
   */
  const identify = (object: any): string | null => {
    return identityManager.stringifyKey(object);
  };

  /**
   * Creates or retrieves a reactive proxy for an entity.
   *
   * @param key - The entity cache key
   * @return A reactive proxy object for the entity
   */
  const materializeEntity = (key: string): any => {
    const hit = entityProxyManager.get(key);
    const snapshot = entityStore.get(key);
    const [typename, id] = identityManager.parseKey(key);
    const concreteTypename = snapshot?.__typename ?? typename;
    const concreteId = snapshot?.id ?? id;

    if (hit) {
      if (hit.__typename !== concreteTypename) {
        hit.__typename = concreteTypename;
      }

      if (concreteId != null) {
        const stableId = String(concreteId);

        if (hit.id !== stableId) {
          hit.id = stableId;
        }
      } else if ("id" in hit) {
        delete hit.id;
      }

      if (snapshot) {
        overlayEntity(hit, snapshot);
      }

      return hit;
    }

    const proxy = shallowReactive({} as any);

    proxy.__typename = concreteTypename;

    if (concreteId != null) {
      proxy.id = String(concreteId);
    }

    if (snapshot) {
      overlayEntity(proxy, snapshot);
    }

    entityProxyManager.set(key, proxy);

    return proxy;
  };

  /**
   * Recursively denormalizes a normalized value by resolving entity references.
   * @private
   */
  const denormalizeValue = (value: any): any => {
    if (!isObject(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      const result = shallowReactive(new Array(value.length));

      for (let i = 0; i < value.length; i++) {
        result[i] = denormalizeValue(value[i]);
      }

      return result;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return materializeEntity(value.__ref);
    }

    const result = shallowReactive({} as Record<string, any>);

    for (let i = 0, keys = Object.keys(value); i < keys.length; i++) {
      result[keys[i]] = denormalizeValue(value[keys[i]]);
    }

    return result;
  };

  /**
   * Recursively normalizes a value by extracting entities and creating references.
   * @private
   */
  const normalizeValue = (value: any): any => {
    if (!isObject(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      const output = new Array(value.length);

      for (let i = 0; i < value.length; i++) {
        output[i] = normalizeValue(value[i]);
      }

      return output;
    }

    if ("__ref" in value && typeof value.__ref === "string") {
      return value;
    }

    if (hasTypename(value)) {
      const key = identify(value);

      if (!key) {
        const result: any = {};

        for (let i = 0, keys = Object.keys(value); i < keys.length; i++) {
          result[keys[i]] = normalizeValue(value[keys[i]]);
        }

        return result;
      }

      if (!isPureIdentity(value)) {
        return { __ref: key };
      }

      putEntity(value);

      return { __ref: key };
    }

    const result: any = {};

    for (let i = 0, keys = Object.keys(value); i < keys.length; i++) {
      result[keys[i]] = normalizeValue(value[keys[i]]);
    }

    return result;
  };

  /**
   * Updates an entity proxy with the latest snapshot data.
   * @private
   */
  const overlayEntity = (entityProxy: any, snapshot: any) => {
    for (let i = 0, keys = Object.keys(entityProxy); i < keys.length; i++) {
      const field = keys[i];

      if (!IDENTITY_FIELDS.has(field) && !(field in snapshot)) {
        delete entityProxy[field];
      }
    }

    if ("__typename" in snapshot && snapshot.__typename) {
      entityProxy.__typename = snapshot.__typename;
    }

    if ("id" in snapshot) {
      if (snapshot.id != null) {
        entityProxy.id = String(snapshot.id);
      } else {
        delete entityProxy.id;
      }
    }

    for (let i = 0, keys = Object.keys(snapshot); i < keys.length; i++) {
      const field = keys[i];

      if (!IDENTITY_FIELDS.has(field)) {
        entityProxy[field] = denormalizeValue(snapshot[field]);
      }
    }
  };

  /**
   * Creates a reactive wrapper from a normalized skeleton.
   * @private
   */
  const materializeFromSkeleton = (skeleton: any): any => {
    if (!isObject(skeleton)) {
      return skeleton;
    }

    if ("__ref" in skeleton) {
      const wrapper = shallowReactive({} as Record<string, any>);

      overlaySelection(wrapper, skeleton);

      return wrapper;
    }

    if (Array.isArray(skeleton)) {
      const output = shallowReactive(new Array(skeleton.length));

      for (let i = 0; i < skeleton.length; i++) {
        output[i] = materializeFromSkeleton(skeleton[i]);
      }

      return output;
    }

    const result = shallowReactive({} as Record<string, any>);

    for (let i = 0, keys = Object.keys(skeleton); i < keys.length; i++) {
      result[keys[i]] = materializeFromSkeleton(skeleton[keys[i]]);
    }

    return result;
  };

  /**
   * Updates a selection wrapper with the latest skeleton data.
   * @private
   */
  const overlaySelection = (target: any, skeleton: any) => {
    if (!isObject(skeleton)) {
      return;
    }

    if ("__ref" in skeleton && typeof skeleton.__ref === "string") {
      const entity = materializeEntity(skeleton.__ref);

      for (let i = 0, keys = Object.keys(target); i < keys.length; i++) {
        delete target[keys[i]];
      }

      for (let i = 0, keys = Object.keys(entity); i < keys.length; i++) {
        target[keys[i]] = entity[keys[i]];
      }

      return;
    }

    if (Array.isArray(skeleton)) {
      if (!Array.isArray(target)) {
        return;
      }

      if (target.length > skeleton.length) {
        target.splice(skeleton.length);
      }

      for (let i = 0; i < skeleton.length; i++) {
        const skeletonValue = skeleton[i];
        const targetValue = target[i];

        if (isObject(targetValue)) {
          overlaySelection(targetValue, skeletonValue);
        } else {
          target[i] = materializeFromSkeleton(skeletonValue);
        }
      }

      return;
    }

    for (let i = 0, keys = Object.keys(target); i < keys.length; i++) {
      const field = keys[i];

      if (!(field in skeleton)) {
        delete target[field];
      }
    }

    for (let i = 0, keys = Object.keys(skeleton); i < keys.length; i++) {
      const field = keys[i];
      const skeletonValue = skeleton[field];
      const targetValue = target[field];

      if (!isObject(skeletonValue)) {
        target[field] = skeletonValue;

        continue;
      }

      if (!isObject(targetValue)) {
        target[field] = materializeFromSkeleton(skeletonValue);
      } else {
        overlaySelection(targetValue, skeletonValue);
      }
    }
  };

  /**
   * Indexes or unindexes __ref usage inside a selection skeleton.
   * @private
   */
  const indexSelectionRefs = (selectionKey: string, node: any, add: boolean) => {
    if (!isObject(node)) {
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        indexSelectionRefs(selectionKey, node[i], add);
      }

      return;
    }

    if ("__ref" in node && typeof node.__ref === "string") {
      const entityKey = node.__ref;

      if (add) {
        let bucket = entityReferences.get(entityKey);

        if (!bucket) {
          bucket = new Set();

          entityReferences.set(entityKey, bucket);
        }

        bucket.add(selectionKey);
      } else {
        const bucket = entityReferences.get(entityKey);

        if (bucket) {
          bucket.delete(selectionKey);

          if (bucket.size === 0) {
            entityReferences.delete(entityKey);
          }
        }
      }

      return;
    }

    for (let i = 0, keys = Object.keys(node); i < keys.length; i++) {
      indexSelectionRefs(selectionKey, node[keys[i]], add);
    }
  };

  /**
   * Reconciles all mounted selections that reference an entity.
   * @private
   */
  const syncSelections = (entityKey: string) => {
    const keys = entityReferences.get(entityKey);

    if (!keys) {
      return;
    }

    for (const selectionKey of keys) {
      const skeleton = selectionStore.get(selectionKey);

      if (!skeleton) {
        continue;
      }

      const proxy = selectionProxyManager.get(`selection:${selectionKey}`);

      if (proxy) {
        overlaySelection(proxy, skeleton);
      }
    }
  };

  /**
   * Stores an entity in the normalized cache and updates related selections.
   *
   * @param object - The entity object to store
   * @return The generated cache key or null if not identifiable
   */
  const putEntity = (object: any): string | null => {
    const key = identify(object);

    if (!key) {
      return null;
    }

    const [, id] = identityManager.parseKey(key);

    const snapshot = { __typename: object.__typename, id: object.id != null ? String(object.id) : id };

    for (let i = 0, fields = Object.keys(object); i < fields.length; i++) {
      const field = fields[i];

      if (!IDENTITY_FIELDS.has(field)) {
        snapshot[field] = normalizeValue(object[field]);
      }
    }

    const previous = entityStore.get(key);

    if (previous) {
      Object.assign(previous, snapshot);
    } else {
      entityStore.set(key, snapshot);
    }

    const proxy = entityProxyManager.get(key);

    if (proxy) {
      overlayEntity(proxy, entityStore.get(key)!);
    }

    syncSelections(key);

    return key;
  };

  /**
   * Retrieves the raw normalized snapshot of an entity.
   *
   * @param key - The entity cache key
   * @return The entity snapshot or undefined if not found
   */
  const getEntity = (key: string): Record<string, any> | undefined => {
    return entityStore.get(key);
  };

  /**
   * Removes an entity from the cache and clears related proxies.
   *
   * @param key - The entity cache key to remove
   */
  const removeEntity = (key: string): void => {
    entityStore.delete(key);

    const proxy = entityProxyManager.get(key);

    if (proxy) {
      for (let i = 0, keys = Object.keys(proxy); i < keys.length; i++) {
        delete proxy[keys[i]];
      }
    }

    syncSelections(key);
  };

  /**
   * Stores a selection skeleton and updates the reference index.
   *
   * @param selectionKey - The selection cache key
   * @param subtree - The selection data to normalize and store
   */
  const putSelection = (selectionKey: string, subtree: any): void => {
    const previous = selectionStore.get(selectionKey);

    if (previous) {
      indexSelectionRefs(selectionKey, previous, false);
    }

    const result = normalizeValue(subtree);

    selectionStore.set(selectionKey, result);

    indexSelectionRefs(selectionKey, result, true);

    const proxy = selectionProxyManager.get(`selection:${selectionKey}`);

    if (proxy) {
      overlaySelection(proxy, result);
    }
  };

  /**
   * Retrieves the raw normalized skeleton of a selection.
   *
   * @param selectionKey - The selection cache key
   * @return The selection skeleton or undefined if not found
   */
  const getSelection = (selectionKey: string): any | undefined => {
    return selectionStore.get(selectionKey);
  };

  /**
   * Removes a selection from the cache and clears related proxies.
   *
   * @param selectionKey - The selection cache key to remove
   */
  const removeSelection = (selectionKey: string): void => {
    const skeleton = selectionStore.get(selectionKey);

    selectionStore.delete(selectionKey);

    if (skeleton) {
      indexSelectionRefs(selectionKey, skeleton, false);
    }

    const proxy = selectionProxyManager.get(`selection:${selectionKey}`);

    if (proxy) {
      for (let i = 0, keys = Object.keys(proxy); i < keys.length; i++) {
        delete proxy[keys[i]];
      }
    }
  };

  /**
   * Creates or retrieves a reactive proxy for a selection.
   *
   * @param selectionKey - The selection cache key
   * @return A reactive proxy object for the selection or undefined if not found
   */
  const materializeSelection = (selectionKey: string): any => {
    const skeleton = selectionStore.get(selectionKey);

    if (!skeleton) {
      return undefined;
    }

    const hit = selectionProxyManager.get(`selection:${selectionKey}`);

    if (hit) {
      overlaySelection(hit, skeleton);

      return hit;
    }

    const result = materializeFromSkeleton(skeleton);

    if (isObject(result)) {
      selectionProxyManager.set(`selection:${selectionKey}`, result);
    }

    return result;
  };

  /**
   * Returns all entity cache keys currently stored.
   *
   * @return Array of entity keys like ["User:1", "Post:123"]
   */
  const listEntityKeys = () => {
    return Array.from(entityStore.keys());
  };

  /**
   * Returns all selection cache keys currently stored.
   *
   * @return Array of selection keys like ["user({})", "User:1.posts({first:10})"]
   */
  const listSelectionKeys = () => {
    return Array.from(selectionStore.keys());
  };

  /**
   * Clears all entities and selections from the cache.
   */
  const clear = () => {
    for (const key of selectionStore.keys()) {
      removeSelection(key);
    }

    selectionProxyManager.clear();

    for (const key of entityStore.keys()) {
      removeEntity(key);
    }

    entityProxyManager.clear();
  };

  /**
   * Provides a debug view of the cache contents.
   *
   * @return Object containing entities, selections, and config for inspection
   */
  const inspect = () => {
    const toObject = (map: Map<string, any>) => {
      const output: Record<string, any> = {};

      for (const [key, value] of map.entries()) {
        output[key] = value;
      }

      return output;
    };

    return {
      entities: toObject(entityStore),
      selections: toObject(selectionStore),

      options: {
        keys: options.keys || {},
        interfaces: options.interfaces || {},
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
    clear,
    inspect,
  };
};
