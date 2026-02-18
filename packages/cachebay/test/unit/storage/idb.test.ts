import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { createStorage } from "@/src/storage/idb";
import type { StorageAdapter, StorageContext } from "@/src/storage/types";
import { delay } from "@/test/helpers";

/**
 * Helper: open the raw IDB database to inspect contents directly.
 */
const openRawDB = (dbName = "cachebay"): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/**
 * Helper: read all records from the "records" store.
 */
const readAllRecords = async (dbName = "cachebay"): Promise<Map<string, unknown>> => {
  const db = await openRawDB(dbName);
  const tx = db.transaction("records", "readonly");
  const store = tx.objectStore("records");

  const keys: IDBValidKey[] = await new Promise((res, rej) => {
    const r = store.getAllKeys();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const values: unknown[] = await new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  db.close();

  const map = new Map<string, unknown>();
  for (let i = 0; i < keys.length; i++) {
    map.set(keys[i] as string, values[i]);
  }
  return map;
};

/**
 * Helper: read all journal entries from the "journal" store.
 */
const readAllJournal = async (dbName = "cachebay"): Promise<Array<{ key: number; value: any }>> => {
  const db = await openRawDB(dbName);
  const tx = db.transaction("journal", "readonly");
  const store = tx.objectStore("journal");

  const entries: Array<{ key: number; value: any }> = [];

  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        entries.push({ key: cursor.key as number, value: cursor.value });
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });

  db.close();
  return entries;
};

/**
 * Helper: delete the test database between tests.
 */
const deleteDB = (dbName = "cachebay"): Promise<void> => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

describe("createStorage (IDB)", () => {
  let dbName: string;

  beforeEach(() => {
    // Use a unique DB name per test to avoid cross-contamination
    dbName = `cachebay-test-${Math.random().toString(36).slice(2, 10)}`;
  });

  afterEach(async () => {
    await deleteDB(dbName);
  });

  const createAdapter = (
    overrides?: Partial<StorageContext>,
    options?: Parameters<typeof createStorage>[0],
  ): StorageAdapter => {
    const factory = createStorage({ dbName, ...options });
    return factory({
      instanceId: "test-instance",
      onUpdate: vi.fn(),
      onRemove: vi.fn(),
      ...overrides,
    });
  };

  describe("put", () => {
    it("persists records to the IDB records store", async () => {
      const adapter = createAdapter();

      adapter.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
        ["User:2", { __typename: "User", id: "2", name: "Bob" }],
      ]);

      // Wait for async IDB write
      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(2);
      expect(records.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice" });
      expect(records.get("User:2")).toEqual({ __typename: "User", id: "2", name: "Bob" });

      adapter.dispose();
    });

    it("appends journal entries with correct metadata", async () => {
      const adapter = createAdapter({ instanceId: "tab-A" });

      adapter.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      await delay(50);

      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1);
      expect(journal[0].value.clientId).toBe("tab-A");
      expect(journal[0].value.type).toBe("put");
      expect(journal[0].value.recordId).toBe("User:1");
      expect(typeof journal[0].value.ts).toBe("number");

      adapter.dispose();
    });

    it("overwrites existing record with same key", async () => {
      const adapter = createAdapter();

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice Updated" }]]);
      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);
      expect(records.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice Updated" });

      // Both put operations produce journal entries
      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(2);

      adapter.dispose();
    });

    it("does nothing when records array is empty", async () => {
      const adapter = createAdapter();

      // First do a real put so the DB gets created
      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      // Now put empty — should not add anything
      adapter.put([]);
      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1); // only the initial put

      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1); // only the initial put

      adapter.dispose();
    });

    it("handles multiple records in a single put call", async () => {
      const adapter = createAdapter();

      adapter.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
        ["Post:1", { __typename: "Post", id: "1", title: "Hello" }],
        ["Comment:1", { __typename: "Comment", id: "1", body: "Nice" }],
      ]);

      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(3);

      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(3);
      // All entries in the same transaction share the same clientId
      expect(journal.every((e) => e.value.clientId === "test-instance")).toBe(true);

      adapter.dispose();
    });
  });

  describe("remove", () => {
    it("removes records from the IDB records store", async () => {
      const adapter = createAdapter();

      // First put, then remove
      adapter.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
        ["User:2", { __typename: "User", id: "2", name: "Bob" }],
      ]);
      await delay(50);

      adapter.remove(["User:1"]);
      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);
      expect(records.has("User:1")).toBe(false);
      expect(records.get("User:2")).toEqual({ __typename: "User", id: "2", name: "Bob" });

      adapter.dispose();
    });

    it("appends journal entries with type 'remove'", async () => {
      const adapter = createAdapter({ instanceId: "tab-B" });

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      adapter.remove(["User:1"]);
      await delay(50);

      const journal = await readAllJournal(dbName);
      // 1 put + 1 remove = 2 entries
      expect(journal.length).toBe(2);

      const removeEntry = journal[1];
      expect(removeEntry.value.clientId).toBe("tab-B");
      expect(removeEntry.value.type).toBe("remove");
      expect(removeEntry.value.recordId).toBe("User:1");

      adapter.dispose();
    });

    it("does nothing when recordIds array is empty", async () => {
      const adapter = createAdapter();

      // First do a real put so the DB gets created
      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      // Now remove empty — should not add any journal entries
      adapter.remove([]);
      await delay(50);

      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1); // only the initial put

      adapter.dispose();
    });

    it("silently handles removing non-existent keys", async () => {
      const adapter = createAdapter();

      // Should not throw
      adapter.remove(["NonExistent:1"]);
      await delay(50);

      // Journal still records the removal intent
      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1);
      expect(journal[0].value.type).toBe("remove");

      adapter.dispose();
    });
  });

  describe("load", () => {
    it("returns all stored records", async () => {
      const adapter = createAdapter();

      adapter.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
        ["User:2", { __typename: "User", id: "2", name: "Bob" }],
      ]);
      await delay(50);
      adapter.dispose();

      // Create a new adapter and load
      const adapter2 = createAdapter();
      const records = await adapter2.load();

      expect(records.length).toBe(2);

      const map = new Map(records);
      expect(map.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice" });
      expect(map.get("User:2")).toEqual({ __typename: "User", id: "2", name: "Bob" });

      adapter2.dispose();
    });

    it("returns empty array when database is empty", async () => {
      const adapter = createAdapter();
      const records = await adapter.load();

      expect(records).toEqual([]);

      adapter.dispose();
    });

    it("initializes lastSeenEpoch to the max journal key", async () => {
      const onUpdate = vi.fn();
      const adapter1 = createAdapter({ instanceId: "tab-A" });

      // Write some records
      adapter1.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);
      await delay(50);
      adapter1.dispose();

      // Create a new adapter (different instance) and load
      // This adapter should NOT replay the journal entries that existed before load
      const adapter2 = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 50 });
      await adapter2.load();

      // Wait for a couple poll cycles
      await delay(150);

      // onUpdate should NOT have been called because lastSeenEpoch was set to max journal key
      expect(onUpdate).not.toHaveBeenCalled();

      adapter2.dispose();
    });

    it("starts polling after load", async () => {
      const onUpdate = vi.fn();
      const adapter1 = createAdapter({ instanceId: "tab-A" });
      await adapter1.load();

      const adapter2 = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 50 });
      await adapter2.load();

      // Tab A writes AFTER both tabs have loaded
      adapter1.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      // Wait for adapter2 to poll
      await delay(150);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      adapter1.dispose();
      adapter2.dispose();
    });
  });

  describe("cross-tab sync (polling)", () => {
    it("picks up put entries from other clientIds", async () => {
      const onUpdate = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 50 });

      await adapterA.load();
      await adapterB.load();

      // Tab A writes
      adapterA.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      // Wait for tab B to poll
      await delay(150);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      adapterA.dispose();
      adapterB.dispose();
    });

    it("picks up remove entries from other clientIds", async () => {
      const onRemove = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onRemove }, { pollInterval: 50 });

      await adapterA.load();
      await adapterB.load();

      // Tab A writes then removes
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(150); // let B pick up the put first

      adapterA.remove(["User:1"]);
      await delay(150); // let B pick up the remove

      expect(onRemove).toHaveBeenCalledWith(["User:1"]);

      adapterA.dispose();
      adapterB.dispose();
    });

    it("ignores journal entries from own clientId", async () => {
      const onUpdate = vi.fn();
      const onRemove = vi.fn();

      const adapter = createAdapter(
        { instanceId: "tab-A", onUpdate, onRemove },
        { pollInterval: 50 },
      );

      await adapter.load();

      // Tab A writes to itself — should NOT trigger onUpdate
      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(150);

      expect(onUpdate).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();

      adapter.dispose();
    });

    it("handles multiple records in a single cross-tab sync batch", async () => {
      const onUpdate = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 50 });

      await adapterA.load();
      await adapterB.load();

      adapterA.put([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
        ["User:2", { __typename: "User", id: "2", name: "Bob" }],
        ["Post:1", { __typename: "Post", id: "1", title: "Hello" }],
      ]);

      await delay(150);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const receivedRecords = onUpdate.mock.calls[0][0] as Array<[string, unknown]>;
      expect(receivedRecords.length).toBe(3);

      const map = new Map(receivedRecords);
      expect(map.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice" });
      expect(map.get("User:2")).toEqual({ __typename: "User", id: "2", name: "Bob" });
      expect(map.get("Post:1")).toEqual({ __typename: "Post", id: "1", title: "Hello" });

      adapterA.dispose();
      adapterB.dispose();
    });

    it("deduplicates multiple puts to the same record in a single poll batch", async () => {
      const onUpdate = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 200 });

      await adapterA.load();
      await adapterB.load();

      // Tab A writes the same record multiple times quickly
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice v1" }]]);
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice v2" }]]);
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice v3" }]]);

      await delay(300);

      // Tab B should only get the latest value (deduplicated via Set)
      expect(onUpdate).toHaveBeenCalled();
      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as Array<[string, unknown]>;
      const map = new Map(lastCall);
      // The record value fetched from IDB should be the latest
      expect(map.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice v3" });

      adapterA.dispose();
      adapterB.dispose();
    });

    it("handles put + remove for the same record in a single poll batch (remove wins)", async () => {
      const onUpdate = vi.fn();
      const onRemove = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter(
        { instanceId: "tab-B", onUpdate, onRemove },
        { pollInterval: 200 },
      );

      await adapterA.load();
      await adapterB.load();

      // Tab A puts then removes the same record quickly
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(20); // small gap to ensure ordering
      adapterA.remove(["User:1"]);

      await delay(300);

      // The remove should win over the put for the same recordId
      expect(onRemove).toHaveBeenCalledWith(["User:1"]);

      adapterA.dispose();
      adapterB.dispose();
    });

    it("syncs between three tabs", async () => {
      const onUpdateB = vi.fn();
      const onUpdateC = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate: onUpdateB }, { pollInterval: 50 });
      const adapterC = createAdapter({ instanceId: "tab-C", onUpdate: onUpdateC }, { pollInterval: 50 });

      await adapterA.load();
      await adapterB.load();
      await adapterC.load();

      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(150);

      // Both B and C should receive the update
      expect(onUpdateB).toHaveBeenCalled();
      expect(onUpdateC).toHaveBeenCalled();

      adapterA.dispose();
      adapterB.dispose();
      adapterC.dispose();
    });

    it("flushJournal drains pending writes before polling", async () => {
      const onUpdateA = vi.fn();
      const onUpdateB = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A", onUpdate: onUpdateA }, { pollInterval: 999_999 }); // no auto-poll
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate: onUpdateB }, { pollInterval: 999_999 });

      await adapterA.load();
      await adapterB.load();

      // Tab A writes — fire-and-forget, no delay
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);

      // Immediately flush on same adapter — drains A's pending writes, then polls.
      // The put must be committed before the poll reads the journal.
      await adapterA.flushJournal();

      // A's own writes are filtered by clientId, so onUpdateA shouldn't fire.
      // But the data should be in IDB now.
      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);
      expect(records.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice" });

      // Tab B can now flush and see the write immediately (no delay needed)
      await adapterB.flushJournal();
      expect(onUpdateB).toHaveBeenCalledTimes(1);
      expect(onUpdateB).toHaveBeenCalledWith([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      adapterA.dispose();
      adapterB.dispose();
    });
  });

  describe("journal eviction", () => {
    it("evicts journal entries older than journalMaxAge", async () => {
      // Use a very short max age (50ms) for testing
      const adapter = createAdapter(
        { instanceId: "tab-A" },
        { pollInterval: 50, journalMaxAge: 50 },
      );

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(30);

      // Verify journal entry exists
      let journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1);

      // Load to initialize the db connection
      await adapter.load();

      // Wait for the entry to age past journalMaxAge
      await delay(100);

      // Manually trigger eviction
      await adapter.evictJournal();

      journal = await readAllJournal(dbName);
      expect(journal.length).toBe(0);

      adapter.dispose();
    });

    it("evicts stale journal entries on load", async () => {
      // Create adapter, write a record, dispose (simulates previous session)
      const adapter1 = createAdapter(
        { instanceId: "tab-A" },
        { pollInterval: 50, journalMaxAge: 50 },
      );

      adapter1.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(30);
      adapter1.dispose();

      // Wait for the entry to age past journalMaxAge
      await delay(100);

      // New adapter — load() should evict old entries
      const adapter2 = createAdapter(
        { instanceId: "tab-B" },
        { pollInterval: 50, journalMaxAge: 50 },
      );

      await adapter2.load();
      await delay(50); // let eviction tx complete

      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(0);

      // But records should still be there
      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);

      adapter2.dispose();
    });

    it("does not evict recent journal entries", async () => {
      const adapter = createAdapter(
        { instanceId: "tab-A" },
        { pollInterval: 50, journalMaxAge: 5000 }, // 5 second max age
      );

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(30);

      await adapter.load();

      // Manually trigger eviction — entry is only ~30ms old, max age is 5s
      await adapter.evictJournal();

      // Entry should still be there
      const journal = await readAllJournal(dbName);
      expect(journal.length).toBe(1);

      adapter.dispose();
    });
  });

  describe("dispose", () => {
    it("stops polling after dispose", async () => {
      const onUpdate = vi.fn();

      const adapterA = createAdapter({ instanceId: "tab-A" }, { pollInterval: 50 });
      const adapterB = createAdapter({ instanceId: "tab-B", onUpdate }, { pollInterval: 50 });

      await adapterA.load();
      await adapterB.load();

      // Dispose tab B
      adapterB.dispose();

      // Tab A writes after B is disposed
      adapterA.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(150);

      // Tab B should NOT receive the update
      expect(onUpdate).not.toHaveBeenCalled();

      adapterA.dispose();
    });

    it("ignores put/remove calls after dispose", async () => {
      const adapter = createAdapter();
      await adapter.load();

      adapter.dispose();

      // These should not throw
      adapter.put([["User:1", { __typename: "User", id: "1" }]]);
      adapter.remove(["User:1"]);

      // Verify nothing was written (db was closed)
      // We need a fresh connection since adapter closed its own
      const db = await openRawDB(dbName);
      const tx = db.transaction("records", "readonly");
      const store = tx.objectStore("records");
      const count = await new Promise<number>((res, rej) => {
        const r = store.count();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();

      expect(count).toBe(0);
    });

    it("load returns empty after dispose", async () => {
      const adapter = createAdapter();
      adapter.dispose();

      const records = await adapter.load();
      expect(records).toEqual([]);
    });
  });

  describe("custom dbName", () => {
    it("uses a custom database name", async () => {
      const customDbName = `custom-db-${Math.random().toString(36).slice(2, 10)}`;
      const adapter = createAdapter({}, { dbName: customDbName });

      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      const records = await readAllRecords(customDbName);
      expect(records.size).toBe(1);
      expect(records.get("User:1")).toEqual({ __typename: "User", id: "1", name: "Alice" });

      adapter.dispose();
      await deleteDB(customDbName);
    });
  });

  describe("lazy db open", () => {
    it("does not open database until first operation", async () => {
      // Creating the adapter should not open a database
      const factory = createStorage({ dbName });
      const adapter = factory({
        instanceId: "test",
        onUpdate: vi.fn(),
        onRemove: vi.fn(),
      });

      // At this point, no DB should exist yet
      // Call put to trigger lazy open
      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);

      adapter.dispose();
    });

    it("shares db connection across put and remove calls", async () => {
      const adapter = createAdapter();

      // These should all share the same DB connection
      adapter.put([["User:1", { __typename: "User", id: "1", name: "Alice" }]]);
      adapter.put([["User:2", { __typename: "User", id: "2", name: "Bob" }]]);
      adapter.remove(["User:1"]);

      await delay(50);

      const records = await readAllRecords(dbName);
      expect(records.size).toBe(1);
      expect(records.has("User:2")).toBe(true);

      adapter.dispose();
    });
  });
});
