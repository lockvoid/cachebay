import type { StorageAdapterFactory, StorageAdapter, StorageInspection } from "./types";

export type { StorageAdapterFactory, StorageAdapter, StorageContext, StorageInspection } from "./types";

/** Default cross-tab poll interval (ms) */
const DEFAULT_POLL_INTERVAL = 100;

/** Default max age for journal entries before eviction (ms) — 1 hour */
const DEFAULT_JOURNAL_MAX_AGE = 3_600_000;

/** Default interval between automatic journal eviction runs (ms) — 5 minutes */
const DEFAULT_EVICT_INTERVAL = 300_000;

/**
 * Options for the IndexedDB storage adapter.
 */
export type IDBStorageOptions = {
  /** IndexedDB database name (default: "cachebay") */
  dbName?: string;
  /** Poll interval in ms for cross-tab sync (default: 100) */
  pollInterval?: number;
  /** Max age in ms for journal entries before eviction (default: 3_600_000 = 1 hour) */
  journalMaxAge?: number;
  /** Interval in ms between automatic journal eviction runs (default: 300_000 = 5 min) */
  evictInterval?: number;
};

const RECORDS_STORE = "records";
const JOURNAL_STORE = "journal";

/**
 * Thin promise wrapper around IDB open.
 * @private
 */
const openDatabase = (dbName: string): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        db.createObjectStore(RECORDS_STORE);
      }

      if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
        db.createObjectStore(JOURNAL_STORE, { autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Run a readwrite transaction on the given stores.
 * Returns the transaction and the stores.
 * @private
 */
const writeTx = (db: IDBDatabase, storeNames: string[]): { tx: IDBTransaction; stores: IDBObjectStore[] } => {
  const tx = db.transaction(storeNames, "readwrite");
  const stores = storeNames.map((name) => tx.objectStore(name));

  return { tx, stores };
};

/**
 * Wrap an IDB request in a promise.
 * @private
 */
const promisify = <T>(request: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Wait for a transaction to complete.
 * @private
 */
const txDone = (tx: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
};

/**
 * Create an IndexedDB storage adapter with journal-based cross-tab sync.
 *
 * Uses two IDB object stores:
 * - `records` — key=recordId, value=snapshot (the persisted cache data)
 * - `journal` — autoIncrement key (epoch), value={ clientId, type, recordId }
 *
 * Cross-tab sync works by polling the journal every `pollInterval` ms.
 * Each tab filters out its own writes (by clientId) and applies remote changes.
 *
 * @param options - Configuration options
 * @returns StorageAdapterFactory to pass as `storage` option to `createCachebay()`
 *
 * @example
 * ```ts
 * import { createCachebay } from 'cachebay'
 * import { createStorage } from 'cachebay/idb'
 *
 * const cachebay = createCachebay({
 *   transport: { http },
 *   storage: createStorage({ dbName: 'my-app-cache' }),
 * })
 * ```
 */
export const createStorage = (options?: IDBStorageOptions): StorageAdapterFactory => {
  const dbName = options?.dbName ?? "cachebay";
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const journalMaxAge = options?.journalMaxAge ?? DEFAULT_JOURNAL_MAX_AGE;
  const evictInterval = options?.evictInterval ?? DEFAULT_EVICT_INTERVAL;

  return (ctx): StorageAdapter => {
    const { instanceId, onUpdate, onRemove } = ctx;

    let db: IDBDatabase | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let evictTimer: ReturnType<typeof setInterval> | null = null;
    let lastSeenEpoch = 0;
    let disposed = false;

    // Lazy db open — shared promise so multiple callers don't open multiple connections
    let dbPromise: Promise<IDBDatabase> | null = null;

    // Pending write promises — flushJournal drains these before polling.
    // Self-cleaning: each promise removes itself on settlement.
    const pendingWrites: Promise<void>[] = [];

    const trackWrite = (p: Promise<void>): void => {
      const tracked = p.finally(() => {
        const i = pendingWrites.indexOf(tracked);
        if (i !== -1) pendingWrites.splice(i, 1);
      });
      pendingWrites.push(tracked);
    };

    const getDB = (): Promise<IDBDatabase> => {
      if (db) return Promise.resolve(db);

      if (!dbPromise) {
        dbPromise = openDatabase(dbName).then((opened) => {
          db = opened;
          return opened;
        });
      }

      return dbPromise;
    };

    /**
     * Persist records and journal the changes.
     */
    const put = (records: Array<[string, Record<string, unknown>]>): void => {
      if (disposed || records.length === 0) return;

      const p = getDB().then((database) => {
        const { tx, stores } = writeTx(database, [RECORDS_STORE, JOURNAL_STORE]);
        const [recordsStore, journalStore] = stores;

        for (let i = 0; i < records.length; i++) {
          const [id, snap] = records[i];

          recordsStore.put(snap, id);

          journalStore.add({
            clientId: instanceId,
            type: "put",
            recordId: id,
            ts: Date.now(),
          });
        }

        return txDone(tx);
      }).catch(() => {
        // IDB write failed (quota, closed tab, etc.) — swallow silently
      });

      trackWrite(p);
    };

    /**
     * Remove records and journal the removals.
     */
    const remove = (recordIds: string[]): void => {
      if (disposed || recordIds.length === 0) return;

      const p = getDB().then((database) => {
        const { tx, stores } = writeTx(database, [RECORDS_STORE, JOURNAL_STORE]);
        const [recordsStore, journalStore] = stores;

        for (let i = 0; i < recordIds.length; i++) {
          const id = recordIds[i];

          recordsStore.delete(id);

          journalStore.add({
            clientId: instanceId,
            type: "remove",
            recordId: id,
            ts: Date.now(),
          });
        }

        return txDone(tx);
      }).catch(() => {
        // IDB write failed — swallow silently
      });

      trackWrite(p);
    };

    /**
     * Load all persisted records and initialize lastSeenEpoch.
     */
    const load = async (): Promise<Array<[string, Record<string, unknown>]>> => {
      if (disposed) return [];

      const database = await getDB();

      // Read all records
      const recordsTx = database.transaction(RECORDS_STORE, "readonly");
      const recordsStore = recordsTx.objectStore(RECORDS_STORE);

      const keys = await promisify(recordsStore.getAllKeys());
      const values = await promisify(recordsStore.getAll());

      const result: Array<[string, Record<string, unknown>]> = new Array(keys.length);

      for (let i = 0; i < keys.length; i++) {
        result[i] = [keys[i] as string, values[i]];
      }

      // Initialize lastSeenEpoch to the max journal key so we don't replay
      // entries that are already reflected in the records we just loaded
      const journalTx = database.transaction(JOURNAL_STORE, "readonly");
      const journalStore = journalTx.objectStore(JOURNAL_STORE);
      const cursorReq = journalStore.openCursor(null, "prev"); // last entry

      lastSeenEpoch = await new Promise<number>((resolve) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;

          resolve(cursor ? (cursor.key as number) : 0);
        };

        cursorReq.onerror = () => resolve(0);
      });

      // Evict stale journal entries from previous sessions
      await evictJournal();

      // Start polling for cross-tab sync + periodic eviction
      startPolling();

      return result;
    };

    /**
     * Poll journal for changes from other tabs.
     * @private
     */
    const poll = async (): Promise<void> => {
      if (disposed || !db) return;

      const tx = db.transaction([JOURNAL_STORE, RECORDS_STORE], "readonly");
      const journalStore = tx.objectStore(JOURNAL_STORE);
      const recordsStore = tx.objectStore(RECORDS_STORE);

      // Read journal entries after our last seen epoch
      const range = IDBKeyRange.lowerBound(lastSeenEpoch, true); // exclusive
      const entriesReq = journalStore.getAll(range);
      const keysReq = journalStore.getAllKeys(range);

      const [entries, journalKeys] = await Promise.all([
        promisify(entriesReq),
        promisify(keysReq),
      ]);

      if (entries.length === 0) return;

      // Update lastSeenEpoch to the max key we saw
      lastSeenEpoch = journalKeys[journalKeys.length - 1] as number;

      // Collect remote changes (filter out our own writes)
      const updates: Array<[string, Record<string, unknown>]> = [];
      const removes: string[] = [];
      const recordIdsToFetch = new Set<string>();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as { clientId: string; type: string; recordId: string };

        if (entry.clientId === instanceId) continue;

        if (entry.type === "put") {
          recordIdsToFetch.add(entry.recordId);
        } else if (entry.type === "remove") {
          recordIdsToFetch.delete(entry.recordId); // if put+remove in same batch, remove wins
          removes.push(entry.recordId);
        }
      }

      // Fetch the actual record data for updates
      if (recordIdsToFetch.size > 0) {
        const fetchPromises: Promise<void>[] = [];

        for (const recordId of recordIdsToFetch) {
          fetchPromises.push(
            promisify(recordsStore.get(recordId)).then((value) => {
              if (value != null) {
                updates.push([recordId, value as Record<string, unknown>]);
              }
            }),
          );
        }

        await Promise.all(fetchPromises);
      }

      // Notify client
      if (updates.length > 0) onUpdate(updates);
      if (removes.length > 0) onRemove(removes);
    };

    /**
     * Evict old journal entries.
     * @private
     */
    const evictJournal = (): Promise<void> => {
      if (disposed || !db) return Promise.resolve();

      const tx = db.transaction(JOURNAL_STORE, "readwrite");
      const store = tx.objectStore(JOURNAL_STORE);
      const cursorReq = store.openCursor();

      const now = Date.now();

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;

        if (!cursor) return;

        const entry = cursor.value as { ts: number };

        if (now - entry.ts > journalMaxAge) {
          cursor.delete();
          cursor.continue();
        }
        // Stop at first non-expired entry (journal is ordered by epoch)
      };

      return txDone(tx);
    };

    /**
     * Start the poll loop and periodic eviction timer.
     * @private
     */
    const startPolling = (): void => {
      if (disposed || pollTimer !== null) return;

      pollTimer = setInterval(() => {
        poll().catch(() => {
          // Poll failed — swallow silently (tab might be closing)
        });
      }, pollInterval);

      evictTimer = setInterval(() => {
        evictJournal().catch(() => {
          // Eviction failed — swallow silently
        });
      }, evictInterval);
    };

    /**
     * Drain all pending put/remove writes.
     * @private
     */
    const drainWrites = (): Promise<void> => {
      return Promise.all(pendingWrites).then(() => {});
    };

    /**
     * Force an immediate journal poll (useful for testing and forced sync).
     * Drains pending writes first so all prior put/remove calls are committed.
     */
    const flushJournal = async (): Promise<void> => {
      await drainWrites();
      return poll();
    };

    /**
     * Debug inspection of storage state.
     */
    const inspectStorage = async (): Promise<StorageInspection> => {
      if (disposed || !db) {
        return { recordCount: 0, journalCount: 0, lastSeenEpoch, instanceId };
      }

      const tx = db.transaction([RECORDS_STORE, JOURNAL_STORE], "readonly");
      const recordsStore = tx.objectStore(RECORDS_STORE);
      const journalStore = tx.objectStore(JOURNAL_STORE);

      const [recordCount, journalCount] = await Promise.all([
        promisify(recordsStore.count()),
        promisify(journalStore.count()),
      ]);

      return { recordCount, journalCount, lastSeenEpoch, instanceId };
    };

    /**
     * Cleanup: stop polling, close db connection.
     */
    const dispose = (): void => {
      disposed = true;

      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      if (evictTimer !== null) {
        clearInterval(evictTimer);
        evictTimer = null;
      }

      if (db) {
        db.close();
        db = null;
      }

      dbPromise = null;
    };

    return { put, remove, load, flushJournal, evictJournal, inspect: inspectStorage, dispose };
  };
};
