import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { createCachebay } from "@/src/core/client";
import type { StorageAdapterFactory, StorageContext } from "@/src/storage/types";
import type { Transport } from "@/src/core/operations";
import { delay } from "@/test/helpers";

const mockTransport: Transport = {
  http: vi.fn().mockResolvedValue({ data: null, error: null }),
};

const storageStubs = () => ({
  flushJournal: vi.fn().mockResolvedValue(undefined),
  evictJournal: vi.fn().mockResolvedValue(undefined),
  evictAll: vi.fn().mockResolvedValue(undefined),
  inspect: vi.fn().mockResolvedValue({ recordCount: 0, journalCount: 0, lastSeenEpoch: 0, instanceId: "mock" }),
});

describe("cache.evictAll()", () => {
  it("clears all graph data", async () => {
    const cache = createCachebay({ transport: mockTransport });

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "Hello" });
    cache.__internals.graph.flush();

    await cache.evictAll();

    expect(cache.__internals.graph.keys().length).toBe(0);
    expect(cache.__internals.graph.getRecord("User:1")).toBeUndefined();
    expect(cache.__internals.graph.getRecord("Post:1")).toBeUndefined();
  });

  it("works without storage adapter", async () => {
    const cache = createCachebay({ transport: mockTransport });

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();

    // Should not throw even without storage
    await cache.evictAll();

    expect(cache.__internals.graph.keys().length).toBe(0);
  });

  it("clears storage when adapter is present", async () => {
    const evictAllSpy = vi.fn().mockResolvedValue(undefined);

    const mockStorage: StorageAdapterFactory = () => ({
      put: vi.fn(),
      remove: vi.fn(),
      load: () => Promise.resolve([]),
      ...storageStubs(),
      evictAll: evictAllSpy,
      dispose: vi.fn(),
    });

    const cache = createCachebay({
      transport: mockTransport,
      storage: mockStorage,
    });

    await delay(10);

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();

    await cache.evictAll();

    expect(evictAllSpy).toHaveBeenCalledTimes(1);
    expect(cache.__internals.graph.keys().length).toBe(0);

    cache.dispose();
  });

  it("clears optimistic layers", async () => {
    const cache = createCachebay({ transport: mockTransport });

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();

    cache.modifyOptimistic((tx) => {
      tx.patch("User:1", { name: "Optimistic" });
    });

    expect(cache.__internals.optimistic.inspect().total).toBe(1);

    await cache.evictAll();

    expect(cache.__internals.optimistic.inspect().total).toBe(0);
  });

  it("does not trigger storage.put (no re-persistence loop)", async () => {
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

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();
    putSpy.mockClear();

    await cache.evictAll();

    // evictAll should NOT have triggered storage.put
    // because we notify watchers directly, not through graph.onChange
    expect(putSpy).not.toHaveBeenCalled();

    cache.dispose();
  });

  it("clears materialization cache", async () => {
    const cache = createCachebay({ transport: mockTransport });

    cache.__internals.graph.putRecord("@", { __typename: "@", id: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
    cache.__internals.graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Alice" });
    cache.__internals.graph.flush();

    await cache.evictAll();

    // Graph should be completely empty
    expect(cache.__internals.graph.keys().length).toBe(0);
  });
});
