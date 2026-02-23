import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { createCachebay } from "@/src/core/client";
import { createStorage } from "@/src/storage/idb";
import type { StorageAdapterFactory, StorageAdapter, StorageContext } from "@/src/storage/types";
import type { Transport } from "@/src/core/operations";
import { delay } from "@/test/helpers";

const mockTransport: Transport = {
  http: vi.fn().mockResolvedValue({ data: null, error: null }),
};

/** Stub methods required on every StorageAdapter mock */
const storageStubs = () => ({
  flushJournal: vi.fn().mockResolvedValue(undefined),
  evictJournal: vi.fn().mockResolvedValue(undefined),
  evictAll: vi.fn().mockResolvedValue(undefined),
  inspect: vi.fn().mockResolvedValue({ recordCount: 0, journalCount: 0, lastSeenEpoch: 0, instanceId: "mock" }),
});

/**
 * Helper: delete the test database.
 */
const deleteDB = (dbName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

describe("client + storage integration", () => {
  let dbName: string;

  beforeEach(() => {
    dbName = `cachebay-integration-${Math.random().toString(36).slice(2, 10)}`;
  });

  afterEach(async () => {
    await deleteDB(dbName);
  });

  describe("writes flow through to storage adapter", () => {
    it("graph.putRecord triggers storage.put via onChange", async () => {
      const putSpy = vi.fn();
      const removeSpy = vi.fn();

      const mockStorage: StorageAdapterFactory = (ctx) => ({
        put: putSpy,
        remove: removeSpy,
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: vi.fn(),
      });

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      // Wait for async load to complete
      await delay(10);

      // Write a record directly to graph
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();

      expect(putSpy).toHaveBeenCalledTimes(1);
      const records = putSpy.mock.calls[0][0] as Array<[string, Record<string, unknown>]>;
      expect(records.length).toBe(1);
      expect(records[0][0]).toBe("User:1");
      expect(records[0][1]).toMatchObject({ __typename: "User", id: "1", name: "Alice" });

      cache.dispose();
    });

    it("graph.removeRecord triggers storage.remove via onChange", async () => {
      const putSpy = vi.fn();
      const removeSpy = vi.fn();

      const mockStorage: StorageAdapterFactory = (ctx) => ({
        put: putSpy,
        remove: removeSpy,
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: vi.fn(),
      });

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // Put then remove
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();

      cache.__internals.graph.removeRecord("User:1");
      cache.__internals.graph.flush();

      expect(removeSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy.mock.calls[0][0]).toEqual(["User:1"]);

      cache.dispose();
    });

    it("writeFragment triggers storage.put", async () => {
      const putSpy = vi.fn();

      const mockStorage: StorageAdapterFactory = (ctx) => ({
        put: putSpy,
        remove: vi.fn(),
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: vi.fn(),
      });

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // Use the public writeFragment API
      const { gql } = await import("graphql-tag");
      const FRAGMENT = gql`
        fragment UserFields on User {
          id
          name
          email
        }
      `;

      cache.writeFragment({
        id: "User:1",
        fragment: FRAGMENT,
        data: { __typename: "User", id: "1", name: "Alice", email: "alice@test.com" },
      });

      // writeFragment → normalize → putRecord → microtask flush → onChange
      await delay(0);

      expect(putSpy).toHaveBeenCalled();
      // The put call should include the User:1 record
      const allPuts = putSpy.mock.calls.flatMap((c: any[]) => c[0] as Array<[string, unknown]>);
      const userRecord = allPuts.find(([id]: [string, unknown]) => id === "User:1");
      expect(userRecord).toBeDefined();

      cache.dispose();
    });
  });

  describe("IDB load fills gaps (does not overwrite existing graph records)", () => {
    it("load only fills records that don't exist in the graph", async () => {
      // Step 1: Create a cache, write data, and dispose (persists to IDB)
      const cache1 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      cache1.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice from IDB" });
      cache1.__internals.graph.putRecord("User:2", { __typename: "User", id: "2", name: "Bob from IDB" });
      cache1.__internals.graph.flush();

      // Wait for IDB writes to complete
      await delay(100);
      cache1.dispose();

      // Step 2: Create a new cache with SSR-hydrated data for User:1 only
      const cache2 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      // Simulate SSR hydrate before IDB load resolves
      // hydrate is synchronous, IDB load is async
      cache2.hydrate({
        records: [
          ["User:1", { __typename: "User", id: "1", name: "Alice from SSR" }],
        ],
      });

      // Verify SSR data is in graph before IDB load
      expect(cache2.__internals.graph.getRecord("User:1")?.name).toBe("Alice from SSR");

      // Wait for IDB load to complete
      await delay(200);

      // User:1 should still have SSR data (not overwritten by IDB)
      expect(cache2.__internals.graph.getRecord("User:1")?.name).toBe("Alice from SSR");

      // User:2 should be filled from IDB (gap filled)
      expect(cache2.__internals.graph.getRecord("User:2")?.name).toBe("Bob from IDB");

      cache2.dispose();
    });
  });

  describe("SSR hydrate + IDB load ordering", () => {
    it("SSR hydrate runs synchronously, IDB load arrives later without overwriting", async () => {
      // Pre-populate IDB with old data
      const cache1 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      cache1.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Stale IDB" });
      cache1.__internals.graph.flush();
      await delay(100);
      cache1.dispose();

      // New cache: hydrate with fresh SSR data
      const cache2 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      cache2.hydrate({
        records: [
          ["User:1", { __typename: "User", id: "1", name: "Fresh SSR" }],
        ],
      });

      // SSR data should be there immediately
      expect(cache2.__internals.graph.getRecord("User:1")?.name).toBe("Fresh SSR");

      // Wait for IDB load
      await delay(200);

      // SSR data should NOT be overwritten by stale IDB data
      expect(cache2.__internals.graph.getRecord("User:1")?.name).toBe("Fresh SSR");

      cache2.dispose();
    });

    it("hydrate merges without clearing (no graph.clear)", async () => {
      const cache = createCachebay({
        transport: mockTransport,
      });

      // Write some data before hydrate
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Pre-existing" });
      cache.__internals.graph.flush();

      // Hydrate with different data
      cache.hydrate({
        records: [
          ["User:2", { __typename: "User", id: "2", name: "From SSR" }],
        ],
      });

      // Both records should exist (hydrate is a merge, not replace)
      expect(cache.__internals.graph.getRecord("User:1")?.name).toBe("Pre-existing");
      expect(cache.__internals.graph.getRecord("User:2")?.name).toBe("From SSR");

      cache.dispose();
    });
  });

  describe("remote updates trigger watcher notifications", () => {
    it("cross-tab updates via storage onUpdate notify fragment watchers", async () => {
      let capturedOnUpdate: StorageContext["onUpdate"] | null = null;

      const mockStorage: StorageAdapterFactory = (ctx) => {
        capturedOnUpdate = ctx.onUpdate;
        return {
          put: vi.fn(),
          remove: vi.fn(),
          load: () => Promise.resolve([]),
          ...storageStubs(),
          dispose: vi.fn(),
        };
      };

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // First seed the record so the watcher has data
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();

      // Set up a fragment watcher
      const { gql } = await import("graphql-tag");
      const FRAGMENT = gql`
        fragment UserFields on User {
          id
          name
        }
      `;

      const onData = vi.fn();
      const handle = cache.watchFragment({
        id: "User:1",
        fragment: FRAGMENT,
        onData,
      });

      // Clear initial emission
      onData.mockClear();

      // Simulate a remote update arriving via storage
      capturedOnUpdate!([
        ["User:1", { __typename: "User", id: "1", name: "Alice Updated from Remote" }],
      ]);

      // Wait for microtask flush (fragment watcher batching)
      await delay(0);

      // The watcher should have been notified
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData.mock.calls[0][0]).toMatchObject({
        id: "1",
        name: "Alice Updated from Remote",
      });

      handle.unsubscribe();
      cache.dispose();
    });

    it("cross-tab removes via storage onRemove update graph state", async () => {
      let capturedOnRemove: StorageContext["onRemove"] | null = null;

      const mockStorage: StorageAdapterFactory = (ctx) => {
        capturedOnRemove = ctx.onRemove;
        return {
          put: vi.fn(),
          remove: vi.fn(),
          load: () => Promise.resolve([]),
          ...storageStubs(),
          dispose: vi.fn(),
        };
      };

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // Seed the record
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();

      expect(cache.__internals.graph.getRecord("User:1")).toBeDefined();

      // Simulate a remote remove
      capturedOnRemove!(["User:1"]);

      // The record should be gone from the graph
      expect(cache.__internals.graph.getRecord("User:1")).toBeUndefined();

      // readFragment should return null for the removed entity
      const { gql } = await import("graphql-tag");
      const FRAGMENT = gql`
        fragment UserRemoveFields on User {
          id
          name
        }
      `;

      const result = cache.readFragment({
        id: "User:1",
        fragment: FRAGMENT,
      });
      expect(result).toBeNull();

      cache.dispose();
    });
  });

  describe("isApplyingRemote prevents re-persistence", () => {
    it("remote updates via onUpdate do NOT trigger storage.put", async () => {
      const putSpy = vi.fn();
      let capturedOnUpdate: StorageContext["onUpdate"] | null = null;

      const mockStorage: StorageAdapterFactory = (ctx) => {
        capturedOnUpdate = ctx.onUpdate;
        return {
          put: putSpy,
          remove: vi.fn(),
          load: () => Promise.resolve([]),
          ...storageStubs(),
          dispose: vi.fn(),
        };
      };

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // Clear any initial calls from load
      putSpy.mockClear();

      // Simulate a remote update
      capturedOnUpdate!([
        ["User:1", { __typename: "User", id: "1", name: "Remote Alice" }],
      ]);

      // storage.put should NOT have been called (isApplyingRemote = true during onUpdate)
      expect(putSpy).not.toHaveBeenCalled();

      // But the record should be in the graph
      expect(cache.__internals.graph.getRecord("User:1")?.name).toBe("Remote Alice");

      cache.dispose();
    });

    it("remote removes via onRemove do NOT trigger storage.remove", async () => {
      const removeSpy = vi.fn();
      let capturedOnUpdate: StorageContext["onUpdate"] | null = null;
      let capturedOnRemove: StorageContext["onRemove"] | null = null;

      const mockStorage: StorageAdapterFactory = (ctx) => {
        capturedOnUpdate = ctx.onUpdate;
        capturedOnRemove = ctx.onRemove;
        return {
          put: vi.fn(),
          remove: removeSpy,
          load: () => Promise.resolve([]),
          ...storageStubs(),
          dispose: vi.fn(),
        };
      };

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // First add a record via remote update
      capturedOnUpdate!([
        ["User:1", { __typename: "User", id: "1", name: "Alice" }],
      ]);

      removeSpy.mockClear();

      // Now remove it via remote
      capturedOnRemove!(["User:1"]);

      // storage.remove should NOT have been called
      expect(removeSpy).not.toHaveBeenCalled();

      // But the record should be gone from the graph
      expect(cache.__internals.graph.getRecord("User:1")).toBeUndefined();

      cache.dispose();
    });

    it("local writes after remote updates DO persist to storage", async () => {
      const putSpy = vi.fn();
      let capturedOnUpdate: StorageContext["onUpdate"] | null = null;

      const mockStorage: StorageAdapterFactory = (ctx) => {
        capturedOnUpdate = ctx.onUpdate;
        return {
          put: putSpy,
          remove: vi.fn(),
          load: () => Promise.resolve([]),
          ...storageStubs(),
          dispose: vi.fn(),
        };
      };

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);

      // Remote update
      capturedOnUpdate!([
        ["User:1", { __typename: "User", id: "1", name: "Remote Alice" }],
      ]);

      putSpy.mockClear();

      // Now a local write
      cache.__internals.graph.putRecord("User:1", { name: "Local Alice" });
      cache.__internals.graph.flush();

      // This local write SHOULD persist
      expect(putSpy).toHaveBeenCalledTimes(1);

      cache.dispose();
    });
  });

  describe("end-to-end with real IDB", () => {
    it("full cycle: write → persist → reload → read", async () => {
      // Tab 1: write and persist
      const cache1 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      cache1.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache1.__internals.graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "Hello World" });
      cache1.__internals.graph.flush();

      await delay(100);
      cache1.dispose();

      // Tab 2: reload from IDB
      const cache2 = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      // Wait for IDB load
      await delay(200);

      expect(cache2.__internals.graph.getRecord("User:1")).toMatchObject({
        __typename: "User", id: "1", name: "Alice",
      });
      expect(cache2.__internals.graph.getRecord("Post:1")).toMatchObject({
        __typename: "Post", id: "1", title: "Hello World",
      });

      cache2.dispose();
    });

    it("cross-tab sync: Tab A writes, Tab B receives via journal polling", async () => {
      const cacheA = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      const cacheB = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      // Wait for both to load
      await delay(200);

      // Tab A writes
      cacheA.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Written by Tab A" });
      cacheA.__internals.graph.flush();

      // Wait for IDB write + Tab B poll
      await delay(300);

      // Tab B should have the record
      expect(cacheB.__internals.graph.getRecord("User:1")?.name).toBe("Written by Tab A");

      cacheA.dispose();
      cacheB.dispose();
    });
  });

  describe("dispose", () => {
    it("cache.dispose calls storageAdapter.dispose", async () => {
      const disposeSpy = vi.fn();

      const mockStorage: StorageAdapterFactory = () => ({
        put: vi.fn(),
        remove: vi.fn(),
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: disposeSpy,
      });

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      cache.dispose();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it("storage.put is not called after dispose", async () => {
      const putSpy = vi.fn();

      const mockStorage: StorageAdapterFactory = () => ({
        put: putSpy,
        remove: vi.fn(),
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: vi.fn(),
      });

      const cache = createCachebay({
        transport: mockTransport,
        storage: mockStorage,
      });

      await delay(10);
      cache.dispose();
      putSpy.mockClear();

      // Write after dispose — should NOT trigger storage.put
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1" });
      cache.__internals.graph.flush();

      expect(putSpy).not.toHaveBeenCalled();
    });
  });

  describe("no storage option", () => {
    it("createCachebay works without storage option (backwards compatible)", () => {
      const cache = createCachebay({ transport: mockTransport });

      // Should work normally
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();

      expect(cache.__internals.graph.getRecord("User:1")?.name).toBe("Alice");

      // storage should be null
      expect(cache.storage).toBeNull();

      // dispose should not throw even without storage
      expect(() => cache.dispose()).not.toThrow();
    });
  });

  describe("cache.storage API", () => {
    it("exposes storage when storage option is provided", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      // Wait for async load to complete before asserting/disposing
      await delay(100);

      expect(cache.storage).not.toBeNull();
      expect(typeof cache.storage!.inspect).toBe("function");
      expect(typeof cache.storage!.evictJournal).toBe("function");
      expect(typeof cache.storage!.flushJournal).toBe("function");

      cache.dispose();
    });

    it("inspect returns storage state", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50 }),
      });

      // Wait for load
      await delay(100);

      // Write some records
      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.putRecord("User:2", { __typename: "User", id: "2", name: "Bob" });
      cache.__internals.graph.flush();

      await delay(100);

      const info = await cache.storage!.inspect();
      expect(info.recordCount).toBe(2);
      expect(info.journalCount).toBe(2);
      expect(typeof info.lastSeenEpoch).toBe("number");
      expect(typeof info.instanceId).toBe("string");
      expect(info.instanceId.length).toBeGreaterThan(0);

      cache.dispose();
    });

    it("flushJournal forces immediate poll", async () => {
      const cacheA = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 10_000 }), // very slow poll
      });

      const cacheB = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 10_000 }), // very slow poll
      });

      await delay(100); // wait for load

      // Tab A writes
      cacheA.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cacheA.__internals.graph.flush();
      await delay(50); // wait for IDB write

      // Tab B wouldn't normally see this for 10s, but flushJournal forces it
      await cacheB.storage!.flushJournal();

      expect(cacheB.__internals.graph.getRecord("User:1")?.name).toBe("Alice");

      cacheA.dispose();
      cacheB.dispose();
    });

    it("evictJournal manually cleans old entries", async () => {
      const cache = createCachebay({
        transport: mockTransport,
        storage: createStorage({ dbName, pollInterval: 50, journalMaxAge: 50 }),
      });

      await delay(100);

      cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      cache.__internals.graph.flush();
      await delay(100); // let entry age past 50ms

      // Manually evict
      await cache.storage!.evictJournal();

      const info = await cache.storage!.inspect();
      expect(info.journalCount).toBe(0);
      // Records should still be there
      expect(info.recordCount).toBe(1);

      cache.dispose();
    });
  });
});
