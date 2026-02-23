/**
 * Context passed to a storage adapter factory.
 * Contains the instance identity and callbacks for cross-tab sync.
 */
export type StorageContext = {
  /** Unique instance ID (random, non-crypto) to identify this tab/webview */
  instanceId: string;
  /** Called when a remote tab/instance has updated records */
  onUpdate: (records: Array<[string, Record<string, unknown>]>) => void;
  /** Called when a remote tab/instance has removed records */
  onRemove: (recordIds: string[]) => void;
};

/**
 * Debug inspection snapshot returned by `storage.inspect()`.
 */
export type StorageInspection = {
  /** Number of records persisted in storage */
  recordCount: number;
  /** Number of journal entries pending eviction */
  journalCount: number;
  /** The last seen journal epoch (sync cursor) */
  lastSeenEpoch: number;
  /** This instance's client ID */
  instanceId: string;
};

/**
 * Storage adapter instance returned by the factory.
 * Handles persistence and cross-tab synchronization.
 */
export type StorageAdapter = {
  /** Persist changed records to storage and journal the change for other tabs */
  put: (records: Array<[string, Record<string, unknown>]>) => void;
  /** Remove records from storage and journal the removal for other tabs */
  remove: (recordIds: string[]) => void;
  /** Load all persisted records (called once on init) */
  load: () => Promise<Array<[string, Record<string, unknown>]>>;
  /** Force an immediate journal poll (useful for testing and forced sync) */
  flushJournal: () => Promise<void>;
  /** Manually evict old journal entries */
  evictJournal: () => Promise<void>;
  /** Clear all persisted records and journal entries */
  evictAll: () => Promise<void>;
  /** Debug inspection of storage state */
  inspect: () => Promise<StorageInspection>;
  /** Cleanup: stop polling, close connections */
  dispose: () => void;
};

/**
 * Factory function that creates a storage adapter.
 * Passed as `storage` option to `createCachebay()`.
 *
 * @example
 * ```ts
 * import { createCachebay } from 'cachebay'
 * import { createStorage } from 'cachebay/idb'
 *
 * const cachebay = createCachebay({
 *   transport: { http },
 *   storage: createStorage(),
 * })
 * ```
 */
export type StorageAdapterFactory = (ctx: StorageContext) => StorageAdapter;
