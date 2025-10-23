import { ID_FIELD, TYPENAME_FIELD, IDENTITY_FIELDS, ROOT_ID } from "./constants";
import { isObject, isDataDeepEqual } from "./utils";

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Configuration options for graph store
 */
export type GraphOptions = {
  /** Custom key functions for entity identification by typename */
  keys?: Record<string, (obj: Record<string, unknown>) => string | null>;
  /** Interface to implementation mappings */
  interfaces?: Record<string, string[]>;
  /** Callback fired when records change (required for reactivity) */
  onChange: (recordIds: Set<string>) => void;
};

/**
 * Graph store instance type
 */
export type GraphInstance = ReturnType<typeof createGraph>;

/**
 * Diff field changes and track what changed
 * Uses deep equality for objects/arrays to avoid false positives from JSON.parse
 * @private
 */
const commitChanges = (currentSnapshot: Record<string, any>, partialSnapshot: Record<string, any>): boolean => {
  let hasChanges = false;

  for (let i = 0, fields = Object.keys(partialSnapshot); i < fields.length; i++) {
    const fieldName = fields[i];
    const incomingValue = partialSnapshot[fieldName];

    if (incomingValue === undefined) {
      continue;
    }

    if (fieldName === ID_FIELD) {
      const normalizedId = incomingValue ? String(incomingValue) : null;

      if (currentSnapshot[ID_FIELD] === normalizedId) {
        continue;
      }

      currentSnapshot[ID_FIELD] = normalizedId;
      hasChanges = true;
      continue;
    }

    const currentValue = currentSnapshot[fieldName];

    // Fast path: reference equality (handles primitives and same object references)
    if (currentValue === incomingValue) {
      continue;
    }

    // Only use deep equality for objects/arrays to avoid false positives from JSON.parse
    if (typeof incomingValue === 'object' && incomingValue !== null &&
      typeof currentValue === 'object' && currentValue !== null) {
      if (isDataDeepEqual(currentValue, incomingValue)) {
        continue;
      }
    }

    currentSnapshot[fieldName] = incomingValue;
    hasChanges = true;
  }

  return hasChanges;
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
 * Create a normalized graph store
 * @param options - Configuration for keys and interfaces
 * @returns Graph store instance with CRUD and read methods
 */
export const createGraph = (options: GraphOptions = {}) => {
  const { onChange = () => { } } = options;

  const identityManager = new IdentityManager({ keys: options.keys || {}, interfaces: options.interfaces || {} });
  const implementersMap = new Map<string, ReadonlySet<string>>();
  const recordStore = new Map<string, Record<string, any>>();
  const recordVersionStore = new Map<string, number>();
  const pendingChanges = new Set<string>();

  let isFlushing = false;
  let versionClock = 0;

  for (const name in options.interfaces) {
    const implementors = options.interfaces[name];

    if (Array.isArray(implementors) && implementors.length > 0) {
      implementersMap.set(name, new Set(implementors));
    } else {
      implementersMap.set(name, EMPTY_SET);
    }
  }

  const notifyChange = (recordId: string) => {
    const shouldSchedule = pendingChanges.size === 0;

    pendingChanges.add(recordId);

    if (shouldSchedule) {
      queueMicrotask(flush);
    }
  };

  /**
   * Get implementers for a given interface
   */
  const getImplementers = (interfaceName: string): ReadonlySet<string> => {
    return implementersMap.get(interfaceName) || EMPTY_SET;
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

    const hasChanges = commitChanges(currentSnapshot, partialSnapshot); // NOTE: Don't destructure for performance

    if (!hasChanges) {
      return;
    }

    versionClock++;

    recordStore.set(recordId, currentSnapshot);
    recordVersionStore.set(recordId, versionClock);

    if (recordId === ROOT_ID) {
      for (let i = 0, keys = Object.keys(partialSnapshot); i < keys.length; i++) {
        const key = keys[i];

        notifyChange(`${recordId}.${key}`);
      }
    }

    notifyChange(recordId);
  };

  /**
   * Delete record from store
   */
  const removeRecord = (recordId: string): void => {
    recordStore.delete(recordId);
    recordVersionStore.delete(recordId);

    notifyChange(recordId);
  };

  /**
  * Get version of record
  */
  const getVersion = (recordId: string): number => {
    return recordVersionStore.get(recordId) || 0;
  };

  /**
   * Flush pending onChange notifications immediately (for sync reads after writes)
   */

  const flush = () => {
    if (isFlushing) {
      return;
    }

    if (pendingChanges.size === 0) {
      return;
    }

    isFlushing = true;

    try {
      onChange(pendingChanges);
      pendingChanges.clear();
    } finally {
      isFlushing = false;
    }
  };

  /**
   * Get all record IDs
   */
  const keys = () => {
    return Array.from(recordStore.keys());
  };

  /**
   * Clear all data
   */
  const clear = () => {
    recordStore.clear();
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
        keys: options.keys || {},
        interfaces: options.interfaces || {},
      },
    };
  };

  return {
    getImplementers,
    identify,
    putRecord,
    getRecord,
    removeRecord,
    getVersion,
    flush,
    keys,
    clear,
    inspect,
  };
};
