import { shallowReactive } from "vue";
import { ID_FIELD, TYPENAME_FIELD, IDENTITY_FIELDS } from "./constants";
import { isObject } from "./utils";

export type GraphOptions = {
  keys?: Record<string, (obj: Record<string, unknown>) => string | null>;
  interfaces?: Record<string, string[]>;
};

export type GraphInstance = ReturnType<typeof createGraph>;

const RECORD_PROXY_VERSION = Symbol("graph:record-proxy-version");

const overlayRecordDiff = (
  recordProxy: any,
  currentSnapshot: Record<string, any>,
  changedFields: string[],
  typenameChanged: boolean,
  idChanged: boolean,
  targetVersion: number,
) => {
  if (recordProxy[RECORD_PROXY_VERSION] === targetVersion) return;

  if (typenameChanged) {
    recordProxy[TYPENAME_FIELD] = currentSnapshot[TYPENAME_FIELD];
  }

  if (idChanged) {
    if (ID_FIELD in currentSnapshot) recordProxy[ID_FIELD] = currentSnapshot[ID_FIELD];
    else delete recordProxy[ID_FIELD];
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
    Object.defineProperty(recordProxy, RECORD_PROXY_VERSION, {
      value: targetVersion,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
};

const overlayRecordFull = (
  recordProxy: any,
  currentSnapshot: Record<string, any>,
  targetVersion: number,
) => {
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
    Object.defineProperty(recordProxy, RECORD_PROXY_VERSION, {
      value: targetVersion,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
};

const applyFieldChanges = (
  currentSnapshot: Record<string, any>,
  partialSnapshot: Record<string, any>,
): [string[], boolean, boolean, boolean] => {
  let idChanged = false;
  let typenameChanged = false;
  const changedFields: string[] = [];

  for (let i = 0, fields = Object.keys(partialSnapshot); i < fields.length; i++) {
    const fieldName = fields[i];
    const incomingValue = partialSnapshot[fieldName];

    // Ignore undefined patches (don’t delete existing fields)
    if (incomingValue === undefined) continue;

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

    // Store all values including null
    if (currentSnapshot[fieldName] !== incomingValue) {
      currentSnapshot[fieldName] = incomingValue;
      changedFields.push(fieldName);
    }
  }

  const hasChanges = idChanged || typenameChanged || changedFields.length > 0;
  return [changedFields, typenameChanged, idChanged, hasChanges];
};

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
    if (cached) return cached;
    const parsed = key.split(":", 2) as [string, string | undefined];
    this.keyStore.set(key, parsed);
    return parsed;
  }

  stringifyKey(object: any): string | null {
    if (!isObject(object)) return null;
    const rawTypename = (object as any)[TYPENAME_FIELD];
    if (!rawTypename) return null;
    const typename = this.getCanonicalTypename(rawTypename);
    const id = this.keyers.get(typename)?.(object) ?? (object as any)[ID_FIELD];
    if (id === undefined || id === null) return null;
    return `${typename}:${id}`;
  }

  clear(): void {
    this.keyStore.clear();
  }
}

export const createGraph = (options?: GraphOptions) => {
  const identityManager = new IdentityManager({
    keys: options?.keys || {},
    interfaces: options?.interfaces || {},
  });

  const recordStore = new Map<string, Record<string, any>>();
  const recordProxyStore = new Map<string, WeakRef<any>>();
  const recordVersionStore = new Map<string, number>();

  // 🔹 Global epoch clock (monotonic). Bumped on any *real* write/delete/clear.
  let epochClock = 0;

  const bumpClock = () => {
    epochClock = (epochClock + 1) | 0; // keep it as a small int
  };

  const identify = (object: any): string | null => {
    return identityManager.stringifyKey(object);
  };

  const getRecord = (recordId: string): Record<string, any> | undefined => {
    return recordStore.get(recordId);
  };

  const putRecord = (recordId: string, partialSnapshot: Record<string, any>): void => {
    const currentSnapshot = recordStore.get(recordId) || {};
    const [changedFields, typenameChanged, idChanged, hasChanges] = applyFieldChanges(
      currentSnapshot,
      partialSnapshot,
    );

    if (!hasChanges) return;

    const nextVersion = (recordVersionStore.get(recordId) || 0) + 1;

    // Store next version
    recordStore.set(recordId, currentSnapshot);
    recordVersionStore.set(recordId, nextVersion);

    // Proxy next version (apply diff)
    const proxyRef = recordProxyStore.get(recordId);
    const proxy = proxyRef?.deref();
    if (proxy) {
      overlayRecordDiff(proxy, currentSnapshot, changedFields, typenameChanged, idChanged, nextVersion);
    }

    // Bump global epoch after a real change
    bumpClock();
  };

  const removeRecord = (recordId: string): void => {
    const hadRecord = recordStore.has(recordId) || recordProxyStore.has(recordId) || recordVersionStore.has(recordId);

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

    if (hadRecord) {
      bumpClock();
    }
  };

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

  const keys = () => Array.from(recordStore.keys());

  const clear = () => {
    let hadAnything = recordStore.size > 0 || recordProxyStore.size > 0 || recordVersionStore.size > 0;

    for (const [, weakRef] of recordProxyStore) {
      const proxy = weakRef.deref();
      if (proxy) {
        for (let i = 0, k = Object.keys(proxy); i < k.length; i++) delete proxy[k[i]];
      }
    }
    recordStore.clear();
    recordProxyStore.clear();
    recordVersionStore.clear();

    identityManager.clear();

    if (hadAnything) {
      bumpClock();
    }
  };

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
      clock: epochClock,
    };
  };

  // 🔹 Expose versions so documents.ts can compute stamps
  const getVersion = (recordId: string): number => {
    return recordVersionStore.get(recordId) || 0;
  };

  // 🔹 Expose a global epoch for O(1) hot-cache confirmation
  const getClock = (): number => epochClock;

  // 🔹 Expose interface map for subtype checks
  const interfaces = options?.interfaces || {};

  return {
    identify,
    putRecord,
    getRecord,
    removeRecord,
    materializeRecord,
    keys,
    clear,
    inspect,
    getVersion,
    getClock,
    interfaces,
  };
};
