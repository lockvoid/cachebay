import { shallowReactive } from "vue";
import { hasTypename } from "./utils";
import { ID_FIELD, TYPENAME_FIELD, IDENTITY_FIELDS } from "./constants";

export type GraphOptions = {
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
};

export type GraphInstance = ReturnType<typeof createGraph>;

const RECORD_PROXY_VERSION = Symbol("graph:record-proxy-version");

/**
 * Update proxy with only changed fields for optimal performance
 * @private
 */
const overlayRecordDiff = (recordProxy: any, recordSnapshot: Record<string, any>, changedFields: string[], removedFields: string[], typenameChanged: boolean, idChanged: boolean, targetVersion: number) => {
  if (recordProxy[RECORD_PROXY_VERSION] === targetVersion) {
    return;
  }

  if (typenameChanged) {
    recordProxy[TYPENAME_FIELD] = recordSnapshot[TYPENAME_FIELD];
  }

  if (idChanged) {
    if (recordSnapshot[ID_FIELD] != null) {
      recordProxy[ID_FIELD] = recordSnapshot[ID_FIELD];
    } else {
      delete recordProxy[ID_FIELD];
    }
  }

  for (let i = 0; i < removedFields.length; i++) {
    delete recordProxy[removedFields[i]];
  }

  for (let i = 0; i < changedFields.length; i++) {
    const field = changedFields[i];

    if (!IDENTITY_FIELDS.has(field)) {
      recordProxy[field] = recordSnapshot[field];
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
const overlayRecordFull = (recordProxy: any, recordSnapshot: Record<string, any>, targetVersion: number) => {
  if (recordSnapshot[TYPENAME_FIELD]) {
    recordProxy[TYPENAME_FIELD] = recordSnapshot[TYPENAME_FIELD];
  }

  if (ID_FIELD in recordSnapshot) {
    if (recordSnapshot[ID_FIELD] != null) {
      recordProxy[ID_FIELD] = recordSnapshot[ID_FIELD];
    } else {
      delete recordProxy[ID_FIELD];
    }
  }

  for (let i = 0, fields = Object.keys(recordProxy); i < fields.length; i++) {
    const field = fields[i];

    if (!(field in recordSnapshot)) {
      delete recordProxy[field];
    }
  }

  for (let i = 0, fields = Object.keys(recordSnapshot); i < fields.length; i++) {
    const field = fields[i];

    if (!IDENTITY_FIELDS.has(field)) {
      recordProxy[field] = recordSnapshot[field];
    }
  }

  if (recordProxy[RECORD_PROXY_VERSION] !== undefined) {
    recordProxy[RECORD_PROXY_VERSION] = targetVersion;
  } else {
    Object.defineProperty(recordProxy, RECORD_PROXY_VERSION, { value: targetVersion, writable: true, configurable: true, enumerable: false });
  }
};

/**
 * Unified identity manager handling key parsing, interface resolution, and keyer functions
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
    const typename = this.getCanonicalTypename(object[TYPENAME_FIELD]) || object[TYPENAME_FIELD];

    if (!typename) {
      return null;
    }

    const id = this.keyers.get(typename)?.(object) ?? object[ID_FIELD];

    if (!id) {
      return null;
    }

    return `${typename}:${id}`;
  }

  clear(): void {
    this.keyStore.clear();
  }
}

export const createGraph = (options: GraphOptions) => {
  const identityManager = new IdentityManager({ keys: options.keys, interfaces: options.interfaces });

  const recordStore = new Map<string, Record<string, any>>();
  const recordProxyStore = new Map<string, WeakRef<any>>();
  const recordVersionStore = new Map<string, number>();

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
   * Update record with partial data, undefined values delete fields
   */
  const putRecord = (recordId: string, partialSnapshot: Record<string, any>): void => {
    const existingSnapshot = recordStore.get(recordId);
    const currentSnapshot = existingSnapshot || {};
    const changedFields: string[] = [];
    const removedFields: string[] = [];

    let typenameChanged = false;
    let idChanged = false;

    // Process incoming changes
    const incomingFields = Object.keys(partialSnapshot);
    for (let i = 0; i < incomingFields.length; i++) {
      const fieldName = incomingFields[i];
      const incomingValue = partialSnapshot[fieldName];

      if (incomingValue === undefined) {
        // Handle deletions
        if (fieldName in currentSnapshot) {
          if (fieldName === TYPENAME_FIELD) {
            typenameChanged = true;
          } else if (fieldName === ID_FIELD) {
            idChanged = true;
          } else {
            removedFields.push(fieldName);
          }
          delete currentSnapshot[fieldName];
        }
        continue;
      }

      // Handle __typename
      if (fieldName === TYPENAME_FIELD) {
        if (currentSnapshot[TYPENAME_FIELD] !== incomingValue) {
          currentSnapshot[TYPENAME_FIELD] = incomingValue;
          typenameChanged = true;
        }
        continue;
      }

      // Handle id with normalization
      if (fieldName === ID_FIELD) {
        const normalizedId = incomingValue != null ? String(incomingValue) : incomingValue;
        if (currentSnapshot[ID_FIELD] !== normalizedId) {
          if (normalizedId != null) {
            currentSnapshot[ID_FIELD] = normalizedId;
          } else {
            delete currentSnapshot[ID_FIELD];
          }
          idChanged = true;
        }
        continue;
      }

      // Handle regular fields
      if (currentSnapshot[fieldName] !== incomingValue) {
        currentSnapshot[fieldName] = incomingValue;
        changedFields.push(fieldName);
      }
    }

    const hadChanges = typenameChanged || idChanged ||
      changedFields.length > 0 || removedFields.length > 0;

    if (!existingSnapshot && !hadChanges) {
      // New empty record
      recordStore.set(recordId, { ...currentSnapshot });
      recordVersionStore.set(recordId, (recordVersionStore.get(recordId) || 0) + 1);
    } else if (hadChanges) {
      // Commit changes
      if (!existingSnapshot) {
        recordStore.set(recordId, { ...currentSnapshot });
      }
      const nextVersion = (recordVersionStore.get(recordId) || 0) + 1;
      recordStore.set(recordId, currentSnapshot);
      recordVersionStore.set(recordId, nextVersion);

      // Update proxy if it exists
      const weakReference = recordProxyStore.get(recordId);
      const recordProxy = weakReference?.deref?.();

      if (recordProxy) {
        overlayRecordDiff(
          recordProxy,
          currentSnapshot,
          changedFields,
          removedFields,
          typenameChanged,
          idChanged,
          nextVersion
        );
      } else if (weakReference) {
        recordProxyStore.delete(recordId);
      }
    }
  };

  /**
   * Delete record and clear its proxy
   */
  const removeRecord = (recordId: string): void => {
    recordStore.delete(recordId);
    recordVersionStore.delete(recordId);

    const weakReference = recordProxyStore.get(recordId);
    const recordProxy = weakReference?.deref?.();

    if (recordProxy) {
      const proxyKeys = Object.keys(recordProxy);
      for (let i = 0; i < proxyKeys.length; i++) {
        delete recordProxy[proxyKeys[i]];
      }
    }

    recordProxyStore.delete(recordId);
  };

  /**
   * Get or create reactive proxy for record
   */
  const materializeRecord = (recordId: string): any | undefined => {
    const recordSnapshot = recordStore.get(recordId);
    if (!recordSnapshot) return undefined;

    const currentVersion = recordVersionStore.get(recordId) || 0;
    const weakReference = recordProxyStore.get(recordId);
    const cachedProxy = weakReference?.deref?.();

    if (cachedProxy) {
      const proxyVersion = cachedProxy[RECORD_PROXY_VERSION];
      if (proxyVersion === currentVersion) {
        return cachedProxy;
      }
      // Sync proxy with current version
      overlayRecordFull(cachedProxy, recordSnapshot, currentVersion);
      return cachedProxy;
    } else if (weakReference) {
      recordProxyStore.delete(recordId);
    }

    // Create new proxy
    const recordProxy = shallowReactive({} as any);
    overlayRecordFull(recordProxy, recordSnapshot, currentVersion);
    recordProxyStore.set(recordId, new WeakRef(recordProxy));

    return recordProxy;
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
        for (const key in proxy) {
          delete proxy[key];
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

    for (const [recordId, recordSnapshot] of recordStore.entries()) {
      records[recordId] = recordSnapshot;
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
    materializeRecord,
    keys,
    clear,
    inspect,
  };
};
