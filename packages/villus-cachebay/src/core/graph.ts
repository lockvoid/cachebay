import { shallowReactive } from "vue";
import { ID_FIELD, TYPENAME_FIELD, IDENTITY_FIELDS } from "./constants";
import { isObject } from "./utils";

/**
 * Configuration options for graph store
 */
export type GraphOptions = {
  /** Custom key functions for entity identification by typename */
  keys?: Record<string, (obj: Record<string, unknown>) => string | null>;
  /** Interface to implementation mappings */
  interfaces?: Record<string, string[]>;
  /** Callback fired when records change (for cache invalidation) */
  onChange?: (recordIds: Set<string>) => void;
};

/**
 * Graph store instance type
 */
export type GraphInstance = ReturnType<typeof createGraph>;

const RECORD_PROXY_VERSION = Symbol("graph:record-proxy-version");

/**
 * Update proxy with only changed fields for optimal performance
 * @private
 */
const overlayRecordDiff = (recordProxy: any, currentSnapshot: Record<string, any>, changedFields: string[], typenameChanged: boolean, idChanged: boolean, targetVersion: number) => {
  if (recordProxy[RECORD_PROXY_VERSION] === targetVersion) {
    return;
  }

  if (typenameChanged) {
    recordProxy[TYPENAME_FIELD] = currentSnapshot[TYPENAME_FIELD];
  }

  if (idChanged) {
    if (ID_FIELD in currentSnapshot) {
      recordProxy[ID_FIELD] = currentSnapshot[ID_FIELD];
    } else {
      delete recordProxy[ID_FIELD];
    }
  }

  for (let i = 0; i < changedFields.length; i++) {
    const field = changedFields[i];

    if (!IDENTITY_FIELDS.has(field)) {
      recordProxy[field] = currentSnapshot[field];
    }
  }

  if (recordProxy[RECORD_PROXY_VERSION] !== undefined) {
    recordProxy[RECORD_PROXY_VERSION] = targetVersion;
  } else {
    Object.defineProperty(recordProxy, RECORD_PROXY_VERSION, { value: targetVersion, writable: true, configurable: true, enumerable: false });
  }
};

/**
 * Full proxy overlay for initialization or version drift recovery
 * @private
 */
const overlayRecordFull = (recordProxy: any, currentSnapshot: Record<string, any>, targetVersion: number) => {
  if (currentSnapshot[TYPENAME_FIELD]) {
    recordProxy[TYPENAME_FIELD] = currentSnapshot[TYPENAME_FIELD];
  }

  if (ID_FIELD in currentSnapshot) {
    recordProxy[ID_FIELD] = currentSnapshot[ID_FIELD];
  } else {
    delete recordProxy[ID_FIELD];
  }

  for (let i = 0, fields = Object.keys(recordProxy); i < fields.length; i++) {
    const field = fields[i];

    if (!(field in currentSnapshot)) {
      delete recordProxy[field];
    }
  }

  for (let i = 0, fields = Object.keys(currentSnapshot); i < fields.length; i++) {
    const field = fields[i];

    if (!IDENTITY_FIELDS.has(field)) {
      recordProxy[field] = currentSnapshot[field];
    }
  }

  if (recordProxy[RECORD_PROXY_VERSION] !== undefined) {
    recordProxy[RECORD_PROXY_VERSION] = targetVersion;
  } else {
    Object.defineProperty(recordProxy, RECORD_PROXY_VERSION, { value: targetVersion, writable: true, configurable: true, enumerable: false });
  }
};

/**
 * Diff field changes and track what changed
 * @private
 */
const applyFieldChanges = (currentSnapshot: Record<string, any>, partialSnapshot: Record<string, any>): [string[], boolean, boolean, boolean] => {
  let idChanged = false;
  let typenameChanged = false;

  const changedFields: string[] = [];

  for (let i = 0, fields = Object.keys(partialSnapshot); i < fields.length; i++) {
    const fieldName = fields[i];
    const incomingValue = partialSnapshot[fieldName];

    // IMPORTANT: Ignore undefined patches (do NOT delete existing fields).
    // Normalization may include keys with `undefined` when the server omits them.
    if (incomingValue === undefined) {
      continue;
    }

    if (fieldName === ID_FIELD) {
      const normalizedId = incomingValue ? String(incomingValue) : null;

      if (currentSnapshot[ID_FIELD] !== normalizedId) {
        currentSnapshot[ID_FIELD] = normalizedId;
        idChanged = true;
      }

      continue;
    }

    if (fieldName === TYPENAME_FIELD) {
      if (currentSnapshot[TYPENAME_FIELD] !== incomingValue) {
        currentSnapshot[TYPENAME_FIELD] = incomingValue;
        typenameChanged = true;
      }

      continue;
    }

    // Store all values including null (null is a valid GraphQL value)
    if (currentSnapshot[fieldName] !== incomingValue) {
      currentSnapshot[fieldName] = incomingValue;
      changedFields.push(fieldName);
    }
  }

  const hasChanges = idChanged || typenameChanged || changedFields.length > 0;

  return [changedFields, typenameChanged, idChanged, hasChanges];
};

/**
 * Identity manager for entity key generation and interface resolution
 * Handles typename mapping, key parsing, and custom key functions
 * @private
 */
class IdentityManager {
  private keyStore = new Map<string, [string, string | undefined]>();
  private interfaceStore = new Map<string, string>();
  private keyers = new Map<string, (obj: any) => string | null>();

  constructor(config: { keys: Record<string, (obj: any) => string | null>; interfaces?: Record<string, string[]> }) {
    for (const [typename, keyFunction] of Object.entries(config.keys || {})) {
      this.keyers.set(typename, keyFunction);
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
    const cached = this.keyStore.get(key);

    if (cached) {
      return cached;
    }

    const parsed = key.split(":", 2) as [string, string | undefined];

    this.keyStore.set(key, parsed);

    return parsed;
  }

  stringifyKey(object: any): string | null {
    if (!isObject(object)) {
      return null;
    }

    const typename = this.getCanonicalTypename(object[TYPENAME_FIELD]) || object[TYPENAME_FIELD];

    if (!typename) {
      return null;
    }

    const id = this.keyers.get(typename)?.(object) ?? object[ID_FIELD];

    if (id === undefined || id === null) {
      return null;
    }

    return `${typename}:${id}`;
  }

  clear(): void {
    this.keyStore.clear();
  }
}

/**
 * Create a normalized graph store with reactive proxies
 * @param options - Configuration for keys and interfaces
 * @returns Graph store instance with CRUD and materialization methods
 */
export const createGraph = (options?: GraphOptions) => {
  const identityManager = new IdentityManager({ keys: options?.keys || {}, interfaces: options?.interfaces || {} });
  const recordStore = new Map<string, Record<string, any>>();
  const recordProxyStore = new Map<string, WeakRef<any>>();
  const recordVersionStore = new Map<string, number>();
  
  // Support multiple onChange subscribers
  const onChangeListeners: Array<(recordIds: Set<string>) => void> = [];
  if (options?.onChange) {
    onChangeListeners.push(options.onChange);
  }

  // Batch onChange notifications in a microtask
  let pendingChanges: Set<string> | null = null;
  let flushScheduled = false;

  const flushChanges = () => {
    if (!pendingChanges || pendingChanges.size === 0) {
      flushScheduled = false;
      return;
    }
    const changes = pendingChanges;
    pendingChanges = null;
    flushScheduled = false;
    
    // Notify all listeners
    for (const listener of onChangeListeners) {
      listener(changes);
    }
  };

  const notifyChange = (recordId: string) => {
    if (onChangeListeners.length === 0) return;
    
    if (!pendingChanges) {
      pendingChanges = new Set();
    }
    pendingChanges.add(recordId);

    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushChanges);
    }
  };

  /**
   * Get stable key for object using configured resolvers
   */
  const identify = (object: any): string | null => {
    return identityManager.stringifyKey(object);
  };

  /**
   * Get raw record data by ID
   */
  const getRecord = (recordId: string): Record<string, any> | undefined => {
    return recordStore.get(recordId);
  };

  /**
   * Update record with partial data, undefined values are ignored
   */
  const putRecord = (recordId: string, partialSnapshot: Record<string, any>): void => {
    const currentSnapshot = recordStore.get(recordId) || {};

    const changes = applyFieldChanges(currentSnapshot, partialSnapshot); // NOTE: Don't destructure for performance

    if (!changes[3]) {
      return;
    }

    const nextVersion = (recordVersionStore.get(recordId) || 0) + 1;

    // Store next version

    recordStore.set(recordId, currentSnapshot);
    recordVersionStore.set(recordId, nextVersion);

    // Proxy next version

    const proxyRef = recordProxyStore.get(recordId);
    const proxy = proxyRef?.deref();

    if (proxy) {
      overlayRecordDiff(proxy, currentSnapshot, changes[0], changes[1], changes[2], nextVersion);
    }

    // Notify subscribers of change (batched in microtask)
    notifyChange(recordId);
  };

  /**
   * Delete record and clear its proxy
   */
  const removeRecord = (recordId: string): void => {
    const proxyRef = recordProxyStore.get(recordId);

    if (proxyRef) {
      const proxy = proxyRef.deref();

      if (proxy) {
        for (let i = 0, keys = Object.keys(proxy); i < keys.length; i++) {
          delete proxy[keys[i]];
        }
      }
    }

    recordStore.delete(recordId);
    recordProxyStore.delete(recordId);
    recordVersionStore.delete(recordId);
  };

  /**
   * Get or create reactive proxy for record
   */
  const materializeRecord = (recordId: string): any => {
    const currentSnapshot = recordStore.get(recordId) || {};
    const currentVersion = recordVersionStore.get(recordId) || 0;
    const proxyRef = recordProxyStore.get(recordId);
    const proxy = proxyRef?.deref();

    if (proxy && proxy[RECORD_PROXY_VERSION] === currentVersion) {
      return proxy;
    }

    const targetProxy = proxy || shallowReactive({} as any);

    overlayRecordFull(targetProxy, currentSnapshot, currentVersion);

    if (!proxy) {
      recordProxyStore.set(recordId, new WeakRef(targetProxy));
    }

    return targetProxy;
  };

  /**
  * Get version of record
  */
  const getVersion = (recordId: string): number => {
    return recordVersionStore.get(recordId) || 0;
  };

  /**
   * Get all record IDs
   */
  const keys = () => {
    return Array.from(recordStore.keys());
  };

  /**
   * Clear all data and proxies
   */
  const clear = () => {
    for (const [, weakRef] of recordProxyStore) {
      const proxy = weakRef.deref();

      if (proxy) {
        for (let i = 0, keys = Object.keys(proxy); i < keys.length; i++) {
          delete proxy[keys[i]];
        }
      }
    }

    recordStore.clear();
    recordProxyStore.clear();
    recordVersionStore.clear();
  };

  /**
   * Debug inspection of current state
   */
  const inspect = () => {
    const records: Record<string, any> = {};

    for (const [recordId, currentSnapshot] of recordStore.entries()) {
      records[recordId] = currentSnapshot;
    }

    return {
      records,

      options: {
        keys: options?.keys || {},
        interfaces: options?.interfaces || {},
      },
    };
  };

  /**
   * Add onChange listener (supports multiple subscribers)
   */
  const addOnChangeListener = (callback: (recordIds: Set<string>) => void) => {
    onChangeListeners.push(callback);
  };

  /**
   * Flush pending onChange notifications immediately (for sync reads after writes)
   */
  const flushPendingChanges = () => {
    if (flushScheduled) {
      flushChanges();
    }
  };

  return {
    identify,
    addOnChangeListener,
    flushPendingChanges,
    putRecord,
    getRecord,
    removeRecord,
    materializeRecord,
    getVersion,
    keys,
    clear,
    inspect,
  };
};
