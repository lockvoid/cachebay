import { ID_FIELD, TYPENAME_FIELD, IDENTITY_FIELDS, ROOT_ID } from "./constants";
import { isObject } from "./utils";

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

// Removed: proxy-related code (RECORD_PROXY_VERSION, overlayRecordDiff, overlayRecordFull)
// Graph now returns plain objects, not reactive proxies

/**
 * Diff field changes and track what changed
 * @private
 */
const applyFieldChanges = (currentSnapshot: Record<string, any>, partialSnapshot: Record<string, any>): [string[], boolean, boolean, boolean] => {
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
    }

    if (currentSnapshot[fieldName] !== incomingValue) {
      currentSnapshot[fieldName] = incomingValue;
      hasChanges = true;
    }
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
  const { onChange = () => {} } = options;

  const identityManager = new IdentityManager({ keys: options.keys || {}, interfaces: options.interfaces || {} });
  const recordStore = new Map<string, Record<string, any>>();
  const recordVersionStore = new Map<string, number>();
  const pendingChanges = new Set<string>();

  const notifyChange = (recordId: string) => {
    const shouldSchedule = pendingChanges.size === 0;

    pendingChanges.add(recordId);

    if (shouldSchedule) {
      queueMicrotask(flush);
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

    const hasChanges = applyFieldChanges(currentSnapshot, partialSnapshot); // NOTE: Don't destructure for performance

    if (!hasChanges) {
      return;
    }

    const nextVersion = (recordVersionStore.get(recordId) || 0) + 1;

    recordStore.set(recordId, currentSnapshot);
    recordVersionStore.set(recordId, nextVersion);

    // Notify subscribers of change (batched in microtask)
    // For ROOT_ID, also notify field-level changes for granular dependency tracking
    if (recordId === ROOT_ID) {
      const keys = Object.keys(partialSnapshot);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = partialSnapshot[key];
        // Skip metadata fields (id/typename that equal ROOT_ID) but track actual query fields
        if (value === ROOT_ID) continue;
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
    if (pendingChanges.size === 0) {
      return;
    }

    onChange(pendingChanges);

    pendingChanges.clear();
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
