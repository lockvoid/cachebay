// Performance counters (module-level for vi.mock access)
let normalizeCount = 0;
let materializeHotCount = 0;
let materializeColdCount = 0;
let invalidateSpy: any = null;

// Mock documents to inject performance counters
vi.mock("@/src/core/documents", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/documents")>("@/src/core/documents");

  return {
    ...actual,
    createDocuments: (deps: any) => {
      const documents = actual.createDocuments(deps);

      // Wrap normalize to count calls
      const origNormalize = documents.normalize;
      documents.normalize = ((...args: any[]) => {
        normalizeCount++;
        return origNormalize.apply(documents, args);
      }) as any;

      // Wrap materialize to count calls and track HOT vs COLD
      const origMaterialize = documents.materialize;
      documents.materialize = ((...args: any[]) => {
        const result = origMaterialize.apply(documents, args);

        // Track HOT vs COLD based on the hot field
        if (result.hot) {
          materializeHotCount++;
        } else {
          materializeColdCount++;
        }

        return result;
      }) as any;

      // Spy on invalidate
      const origInvalidate = documents.invalidate;
      invalidateSpy = vi.fn((options) => {
        return origInvalidate.call(documents, options);
      });
      documents.invalidate = invalidateSpy;

      return documents;
    },
  };
});

import { gql } from "graphql-tag";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCachebay } from "@/src/core/client";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

/**
 * Operations Performance Tests
 *
 * These tests track normalize/materialize call counts for executeQuery and executeMutation
 * to ensure we're not doing redundant work.
 *
 * KEY PRINCIPLES:
 * - network-only: materialize before (cache check) + after (read-back) = 2x
 * - cache-first (hit): materialize once (cache only) = 1x
 * - cache-first (miss): materialize before + after = 2x
 * - cache-and-network: materialize cache + after network = 2x
 * - cache-only: materialize once (cache only) = 1x
 * - mutations: normalize only (no materialize) = 0x materialize
 */
describe("operations API - Performance", () => {
  let client: ReturnType<typeof createCachebay>;
  let mockTransport: any;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;

    // Create mock transport
    mockTransport = {
      http: vi.fn().mockResolvedValue({ data: null, error: null }),
      ws: vi.fn(),
    };

    // Create client with mock transport
    client = createCachebay({
      transport: mockTransport,
      keys: {
        User: (u: any) => u.id,
        Post: (p: any) => p.id,
      },
    });

    // Reset invalidate spy after client creation
    if (invalidateSpy) {
      invalidateSpy.mockClear();
    }
  });

  describe("executeQuery - cache policies", () => {
    it("network-only: should materialize 1 time (skip cache check, read-back after normalize)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const networkData = { user: { __typename: "User", id: "1", name: "Alice" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with network-only (default)
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "network-only",
      });

      // Should skip cache check, normalize once, materialize once (read-back)
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeColdCount).toBe(1); // COLD: read-back after normalize
      expect(materializeHotCount).toBe(0);
    });

    it("cache-first with cache hit: should materialize 1 time (cache only)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const cachedData = { user: { __typename: "User", id: "1", name: "Cached Alice" } };

      // Pre-populate cache
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: cachedData,
      });

      // Reset counts after cache population
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Execute query with cache-first
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      // Should materialize once (cache hit, no network)
      expect(normalizeCount).toBe(0); // No network request
      expect(materializeColdCount).toBe(1); // COLD: first read from cache
      expect(materializeHotCount).toBe(0);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });

    it("cache-first with cache miss: should materialize 2 times", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const networkData = { user: { __typename: "User", id: "1", name: "Alice" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with cache-first (cache miss)
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      // Should materialize twice: cache miss + after network
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeColdCount).toBe(2); // COLD: cache miss + read-back
      expect(materializeHotCount).toBe(0);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-and-network: should materialize 2 times (cache + network)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const cachedData = { user: { __typename: "User", id: "1", name: "Cached Alice" } };
      const networkData = { user: { __typename: "User", id: "1", name: "Network Alice" } };

      // Pre-populate cache
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: cachedData,
      });

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute query with cache-and-network
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-and-network",
      });

      await tick();

      // Should materialize twice: cache + after network
      expect(normalizeCount).toBe(1); // Write network response
      expect(materializeColdCount).toBe(2); // COLD: cache read + read-back
      expect(materializeHotCount).toBe(0);
      expect(mockTransport.http).toHaveBeenCalled();
    });

    it("cache-only: should materialize 1, normalize 0 (no network)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const cachedData = { user: { __typename: "User", id: "1", name: "Cached Alice" } };

      // Pre-populate cache
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: cachedData,
      });

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Execute query with cache-only
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-only",
      });

      // Should materialize once (cache only), no normalize
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1); // COLD: cache read
      expect(materializeHotCount).toBe(0);
      expect(mockTransport.http).not.toHaveBeenCalled();
    });
  });

  describe("bulk operations", () => {
    it("10 sequential queries (network-only): should normalize 10, materialize 10", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const networkData = { user: { __typename: "User", id: "1", name: "Alice" } };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: networkData,
        error: null,
      });

      // Execute 10 queries with different variables
      for (let i = 0; i < 10; i++) {
        await client.executeQuery({
          query: QUERY,
          variables: { id: String(i + 1) },
          cachePolicy: "network-only",
        });
      }

      // Should normalize 10 times, materialize 10 times (1 per query with network-only)
      expect(normalizeCount).toBe(10);
      expect(materializeColdCount).toBe(10); // COLD: 1 read-back per query
      expect(materializeHotCount).toBe(0);
    });

    it("pagination: 5 pages should normalize 5, materialize 5", async () => {
      const QUERY = gql`
        query GetPosts($after: String) {
          posts(after: $after) @connection(key: "posts") {
            edges {
              node {
                id
                __typename
              }
            }
          }
        }
      `;

      mockTransport.http = vi.fn().mockResolvedValue({
        data: {
          posts: {
            __typename: "PostConnection",
            edges: [{ node: { __typename: "Post", id: "1" } }],
          },
        },
        error: null,
      });

      // Load 5 pages
      for (let i = 0; i < 5; i++) {
        await client.executeQuery({
          query: QUERY,
          variables: { after: i === 0 ? null : `cursor${i}` },
          cachePolicy: "network-only",
        });
      }

      // Should normalize 5 times, materialize 5 times (1 per page with network-only)
      expect(normalizeCount).toBe(5);
      expect(materializeColdCount).toBe(5); // COLD: 1 read-back per page
      expect(materializeHotCount).toBe(0);
    });
  });

  describe("executeMutation", () => {
    it("should normalize 1, materialize 0 (no read-back) - TODO: fix gql mock issue", async () => {
      const MUTATION = gql`
        mutation CreateUser($name: String!) {
          createUser(name: $name) {
            id
            name
            __typename
          }
        }
      `;

      const mutationData = {
        createUser: { __typename: "User", id: "2", name: "Bob" },
      };

      mockTransport.http = vi.fn().mockResolvedValue({
        data: mutationData,
        error: null,
      });

      // Execute mutation
      await client.executeMutation({
        query: MUTATION,
        variables: { name: "Bob" },
      });

      // Should normalize once (write mutation result)
      // Mutations don't materialize - they just write and return the network data
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(0);
    });
  });

  describe("Invalidation - watcher prevents, no watcher triggers", () => {
    const QUERY = gql`
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          __typename
        }
      }
    `;

    const userData = { user: { __typename: "User", id: "1", name: "Alice" } };

    describe("network-only", () => {
      it("WITH watcher: invalidate NOT called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        // 2. Execute query - watcher catches result, no invalidation
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // 3. Verify invalidate was NOT called (watcher prevented it)
        expect(invalidateSpy).not.toHaveBeenCalled();

        handle.unsubscribe();
      });

      it("WITHOUT watcher: invalidate called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        // 2. Execute query with watcher - should NOT invalidate
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 3. Unsubscribe watcher
        handle.unsubscribe();

        // 4. Execute query without watcher - should invalidate
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // 5. Verify invalidate WAS called (no watcher to prevent it)
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("cache-first", () => {
      it("WITH watcher: invalidate NOT called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        // Populate cache
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Execute cache-first with watcher - no invalidation
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });

        // 3. Verify invalidate was NOT called
        expect(invalidateSpy).not.toHaveBeenCalled();

        handle.unsubscribe();
      });

      it("WITHOUT watcher: invalidate called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher and populate cache
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Unsubscribe watcher
        handle.unsubscribe();

        // 3. Execute cache-first without watcher - should invalidate
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-first",
        });

        // 4. Verify invalidate WAS called
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("cache-only", () => {
      it("WITH watcher: invalidate NOT called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher and populate cache
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Execute cache-only with watcher - no invalidation
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });

        // 3. Verify invalidate was NOT called
        expect(invalidateSpy).not.toHaveBeenCalled();

        handle.unsubscribe();
      });

      it("WITHOUT watcher: invalidate called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher and populate cache
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Unsubscribe watcher
        handle.unsubscribe();

        // 3. Execute cache-only without watcher - should invalidate
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-only",
        });

        // 4. Verify invalidate WAS called
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("cache-and-network", () => {
      it("WITH watcher: invalidate NOT called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher and populate cache
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Execute cache-and-network with watcher - no invalidation
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });

        // 3. Verify invalidate was NOT called
        expect(invalidateSpy).not.toHaveBeenCalled();

        handle.unsubscribe();
      });

      it("WITHOUT watcher: invalidate called", async () => {
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });

        // 1. Create watcher and populate cache
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: vi.fn(),
        });

        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "network-only",
        });

        // Verify no invalidation yet
        expect(invalidateSpy).not.toHaveBeenCalled();

        // 2. Unsubscribe watcher
        handle.unsubscribe();

        // 3. Execute cache-and-network without watcher - should invalidate
        mockTransport.http = vi.fn().mockResolvedValue({ data: userData, error: null });
        await client.executeQuery({
          query: QUERY,
          variables: { id: "1" },
          cachePolicy: "cache-and-network",
        });

        // 4. Verify invalidate WAS called (twice: cached data + network data)
        expect(invalidateSpy).toHaveBeenCalled();
      });
    });
  });
});
