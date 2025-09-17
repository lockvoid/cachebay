import { shallowReactive } from "vue";
import { hasTypename } from "./utils";
import { IDENTITY_FIELDS, RECORD_PROXY_VERSION } from "./constants";

export type GraphOptions = {
  keys?: Record<string, (obj: any) => string | null>;
  interfaces?: Record<string, string[]>;
};

export type GraphInstance = ReturnType<typeof createGraph>;

/**
 * Update proxy with only changed fields for optimal performance
 * @private
 */
const overlayRecordDiff = (recordProxy: any, recordSnapshot: Record<string, any>, changedFields: string[], removedFields: string[], typenameChanged: boolean, idChanged: boolean, targetVersion: number) => {
  if (recordProxy[RECORD_PROXY_VERSION] === targetVersion) {
    return;
  }

  if (typenameChanged) {
    recordProxy.__typename = recordSnapshot.__typename;
  }

  if (idChanged) {
    if (recordSnapshot.id != null) {
      recordProxy.id = recordSnapshot.id;
    } else {
      delete recordProxy.id;
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
  if (recordSnapshot.__typename) {
    recordProxy.__typename = recordSnapshot.__typename;
  }

  if ("id" in recordSnapshot) {
    if (recordSnapshot.id != null) {
      recordProxy.id = recordSnapshot.id;
    } else {
      delete recordProxy.id;
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
 * Manages identity resolution and key parsing
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
    cosnt hit = this.keyStore.get(key);

    if (hit) {
      return hit;
    }

    const result = key.split(":", 2) as [string, string | undefined];

    this.keyStore.set(key, result);

    return result;
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
  const identityManager = new IdentityManager({
    keys: options.keys || {},
    interfaces: options.interfaces,
  });

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
          if (fieldName === "__typename") {
            typenameChanged = true;
          } else if (fieldName === "id") {
            idChanged = true;
          } else {
            removedFields.push(fieldName);
          }
          delete currentSnapshot[fieldName];
        }
        continue;
      }

      // Handle __typename
      if (fieldName === "__typename") {
        if (currentSnapshot.__typename !== incomingValue) {
          currentSnapshot.__typename = incomingValue;
          typenameChanged = true;
        }
        continue;
      }

      // Handle id with normalization
      if (fieldName === "id") {
        const normalizedId = incomingValue != null ? String(incomingValue) : incomingValue;
        if (currentSnapshot.id !== normalizedId) {
          if (normalizedId != null) {
            currentSnapshot.id = normalizedId;
          } else {
            delete currentSnapshot.id;
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
    for (const [, weakReference] of recordProxyStore.entries()) {
      const recordProxy = weakReference?.deref?.();
      if (recordProxy) {
        const proxyKeys = Object.keys(recordProxy);
        for (let i = 0; i < proxyKeys.length; i++) {
          delete recordProxy[proxyKeys[i]];
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
