import { describe, it, expect, vi } from "vitest";
import { gql } from "graphql-tag";
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

  it("query watchers emit undefined after evictAll", async () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const httpSpy = vi.fn().mockResolvedValue({
      data: { user: { __typename: "User", id: "1", name: "Alice" } },
      error: null,
    });

    const cache = createCachebay({ transport: { http: httpSpy } });

    const emissions: any[] = [];
    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: (data) => emissions.push(data),
      immediate: false,
    });

    // Initial fetch to populate cache and watcher
    await cache.executeQuery({
      query: QUERY,
      variables: { id: "1" },
      cachePolicy: "network-only",
    });

    await delay(10);

    // Watcher should have received initial data
    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(emissions[emissions.length - 1]?.user?.name).toBe("Alice");

    emissions.length = 0;

    await cache.evictAll();

    // Watcher should have emitted undefined to clear the UI
    expect(emissions[0]).toBeUndefined();
  });

  it("triggers re-fetch for active query watchers", async () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const httpSpy = vi.fn()
      .mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice Refetched" } },
        error: null,
      });

    const cache = createCachebay({ transport: { http: httpSpy } });

    const emissions: any[] = [];
    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: (data) => emissions.push(data),
      immediate: false,
    });

    // Initial fetch
    await cache.executeQuery({
      query: QUERY,
      variables: { id: "1" },
      cachePolicy: "network-only",
    });

    await delay(10);
    expect(httpSpy).toHaveBeenCalledTimes(1);
    emissions.length = 0;

    // evictAll should trigger a re-fetch
    await cache.evictAll();
    await delay(50);

    // Transport should have been called again
    expect(httpSpy).toHaveBeenCalledTimes(2);

    // Watcher should have received undefined first, then refetched data
    expect(emissions[0]).toBeUndefined();
    const lastEmission = emissions[emissions.length - 1];
    expect(lastEmission?.user?.name).toBe("Alice Refetched");
  });

  it("fragment watchers emit undefined but do not trigger re-fetch", async () => {
    const FRAGMENT = gql`
      fragment UserFragment on User { id name }
    `;

    const httpSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const cache = createCachebay({ transport: { http: httpSpy } });

    // Seed data
    cache.writeFragment({
      id: "User:1",
      fragment: FRAGMENT,
      data: { __typename: "User", id: "1", name: "Alice" },
    });

    const emissions: any[] = [];
    const handle = cache.watchFragment({
      id: "User:1",
      fragment: FRAGMENT,
      onData: (data) => emissions.push(data),
    });

    // Should have received initial data
    expect(emissions.length).toBe(1);
    expect(emissions[0]?.name).toBe("Alice");

    const callsBefore = httpSpy.mock.calls.length;
    emissions.length = 0;

    await cache.evictAll();
    await delay(10);

    // Fragment watcher should have emitted undefined
    expect(emissions[0]).toBeUndefined();

    // No additional network calls for fragments
    expect(httpSpy.mock.calls.length).toBe(callsBefore);

    handle.unsubscribe();
  });

  it("deduplicates re-fetches for watchers with same signature", async () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const httpSpy = vi.fn().mockResolvedValue({
      data: { user: { __typename: "User", id: "1", name: "Alice" } },
      error: null,
    });

    const cache = createCachebay({ transport: { http: httpSpy } });

    // Create two watchers for the same query+variables
    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: () => {},
      immediate: false,
    });

    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: () => {},
      immediate: false,
    });

    // Initial fetch
    await cache.executeQuery({
      query: QUERY,
      variables: { id: "1" },
      cachePolicy: "network-only",
    });

    await delay(10);
    httpSpy.mockClear();

    await cache.evictAll();
    await delay(50);

    // Should only have been called once (deduplicated by signature)
    expect(httpSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches multiple distinct queries after evictAll", async () => {
    const USER_QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const POST_QUERY = gql`
      query GetPost($id: ID!) {
        post(id: $id) { id title }
      }
    `;

    const httpSpy = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });

    const cache = createCachebay({ transport: { http: httpSpy } });

    // Create watchers for two different queries
    cache.watchQuery({
      query: USER_QUERY,
      variables: { id: "1" },
      onData: () => {},
      immediate: false,
    });

    cache.watchQuery({
      query: POST_QUERY,
      variables: { id: "1" },
      onData: () => {},
      immediate: false,
    });

    httpSpy.mockClear();

    await cache.evictAll();
    await delay(50);

    // Both queries should be re-fetched
    expect(httpSpy).toHaveBeenCalledTimes(2);
  });
});

describe("cross-tab evictAll (via storage onEvictAll)", () => {
  /** Creates a mock storage factory that captures the onEvictAll callback */
  const createMockStorageWithEvictAll = () => {
    let capturedCtx: StorageContext | null = null;

    const factory: StorageAdapterFactory = (ctx) => {
      capturedCtx = ctx;
      return {
        put: vi.fn(),
        remove: vi.fn(),
        load: () => Promise.resolve([]),
        ...storageStubs(),
        dispose: vi.fn(),
      };
    };

    return {
      factory,
      /** Simulate a remote tab calling evictAll (triggers onEvictAll callback) */
      triggerRemoteEvictAll: () => capturedCtx?.onEvictAll?.(),
    };
  };

  it("clears in-memory graph data when remote tab evicts", async () => {
    const { factory, triggerRemoteEvictAll } = createMockStorageWithEvictAll();

    const cache = createCachebay({
      transport: mockTransport,
      storage: factory,
    });

    await delay(10);

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "Hello" });
    cache.__internals.graph.flush();

    expect(cache.__internals.graph.keys().length).toBe(2);

    triggerRemoteEvictAll();

    expect(cache.__internals.graph.keys().length).toBe(0);

    cache.dispose();
  });

  it("clears optimistic layers when remote tab evicts", async () => {
    const { factory, triggerRemoteEvictAll } = createMockStorageWithEvictAll();

    const cache = createCachebay({
      transport: mockTransport,
      storage: factory,
    });

    await delay(10);

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();

    cache.modifyOptimistic((tx) => {
      tx.patch("User:1", { name: "Optimistic" });
    });

    expect(cache.__internals.optimistic.inspect().total).toBe(1);

    triggerRemoteEvictAll();

    expect(cache.__internals.optimistic.inspect().total).toBe(0);

    cache.dispose();
  });

  it("query watchers emit undefined when remote tab evicts", async () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const httpSpy = vi.fn().mockResolvedValue({
      data: { user: { __typename: "User", id: "1", name: "Alice" } },
      error: null,
    });

    const { factory, triggerRemoteEvictAll } = createMockStorageWithEvictAll();

    const cache = createCachebay({
      transport: { http: httpSpy },
      storage: factory,
    });

    await delay(10);

    const emissions: any[] = [];
    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: (data) => emissions.push(data),
      immediate: false,
    });

    await cache.executeQuery({
      query: QUERY,
      variables: { id: "1" },
      cachePolicy: "network-only",
    });

    await delay(10);
    expect(emissions.length).toBeGreaterThanOrEqual(1);
    emissions.length = 0;

    triggerRemoteEvictAll();

    // Watcher should have emitted undefined
    expect(emissions[0]).toBeUndefined();

    cache.dispose();
  });

  it("triggers re-fetch for active query watchers when remote tab evicts", async () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) { id name }
      }
    `;

    const httpSpy = vi.fn()
      .mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: { __typename: "User", id: "1", name: "Alice Refetched" } },
        error: null,
      });

    const { factory, triggerRemoteEvictAll } = createMockStorageWithEvictAll();

    const cache = createCachebay({
      transport: { http: httpSpy },
      storage: factory,
    });

    await delay(10);

    const emissions: any[] = [];
    cache.watchQuery({
      query: QUERY,
      variables: { id: "1" },
      onData: (data) => emissions.push(data),
      immediate: false,
    });

    await cache.executeQuery({
      query: QUERY,
      variables: { id: "1" },
      cachePolicy: "network-only",
    });

    await delay(10);
    expect(httpSpy).toHaveBeenCalledTimes(1);
    emissions.length = 0;

    triggerRemoteEvictAll();
    await delay(50);

    // Transport should have been called again for re-fetch
    expect(httpSpy).toHaveBeenCalledTimes(2);

    // Watcher should have emitted undefined first, then refetched data
    expect(emissions[0]).toBeUndefined();
    const lastEmission = emissions[emissions.length - 1];
    expect(lastEmission?.user?.name).toBe("Alice Refetched");

    cache.dispose();
  });

  it("fragment watchers emit undefined but do not re-fetch when remote tab evicts", async () => {
    const FRAGMENT = gql`
      fragment UserFragment on User { id name }
    `;

    const httpSpy = vi.fn().mockResolvedValue({ data: null, error: null });

    const { factory, triggerRemoteEvictAll } = createMockStorageWithEvictAll();

    const cache = createCachebay({
      transport: { http: httpSpy },
      storage: factory,
    });

    await delay(10);

    cache.writeFragment({
      id: "User:1",
      fragment: FRAGMENT,
      data: { __typename: "User", id: "1", name: "Alice" },
    });

    const emissions: any[] = [];
    const handle = cache.watchFragment({
      id: "User:1",
      fragment: FRAGMENT,
      onData: (data) => emissions.push(data),
    });

    expect(emissions.length).toBe(1);
    expect(emissions[0]?.name).toBe("Alice");

    const callsBefore = httpSpy.mock.calls.length;
    emissions.length = 0;

    triggerRemoteEvictAll();
    await delay(10);

    // Fragment watcher should have emitted undefined
    expect(emissions[0]).toBeUndefined();

    // No additional network calls for fragments
    expect(httpSpy.mock.calls.length).toBe(callsBefore);

    handle.unsubscribe();
    cache.dispose();
  });

  it("does not call storage.evictAll when triggered by remote onEvictAll", async () => {
    const evictAllSpy = vi.fn().mockResolvedValue(undefined);
    let capturedCtx: StorageContext | null = null;

    const mockStorage: StorageAdapterFactory = (ctx) => {
      capturedCtx = ctx;
      return {
        put: vi.fn(),
        remove: vi.fn(),
        load: () => Promise.resolve([]),
        ...storageStubs(),
        evictAll: evictAllSpy,
        dispose: vi.fn(),
      };
    };

    const cache = createCachebay({
      transport: mockTransport,
      storage: mockStorage,
    });

    await delay(10);

    cache.__internals.graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
    cache.__internals.graph.flush();

    evictAllSpy.mockClear();

    // Simulate remote tab evicting (not via cache.evictAll())
    capturedCtx?.onEvictAll?.();
    await delay(10);

    // Storage.evictAll should NOT have been called again (IDB already cleared by remote tab)
    expect(evictAllSpy).not.toHaveBeenCalled();

    // But in-memory cache should be cleared
    expect(cache.__internals.graph.keys().length).toBe(0);

    cache.dispose();
  });
});
