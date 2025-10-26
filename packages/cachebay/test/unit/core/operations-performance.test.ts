// Performance counters (module-level for vi.mock access)
let normalizeCount = 0;
let materializeCount = 0;

// Mock documents to inject performance counters
vi.mock("@/src/core/documents", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/documents")>("@/src/core/documents");

  return {
    ...actual,
    createDocuments: (deps: any) => {
      const documents = actual.createDocuments(deps);

      // Wrap normalize to count calls
      const origNormalize = documents.normalizeDocument;
      documents.normalizeDocument = ((...args: any[]) => {
        normalizeCount++;
        return origNormalize.apply(documents, args);
      }) as any;

      // Wrap materialize to count calls
      const origMaterialize = documents.materializeDocument;
      documents.materializeDocument = ((...args: any[]) => {
        materializeCount++;
        return origMaterialize.apply(documents, args);
      }) as any;

      return documents;
    },
  };
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCachebay } from "@/src/core/client";
import { gql } from "graphql-tag";

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
    materializeCount = 0;

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
      expect(materializeCount).toBe(1); // Only read-back after normalize
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
      materializeCount = 0;

      // Execute query with cache-first
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-first",
      });

      // Should materialize once (cache hit, no network)
      expect(normalizeCount).toBe(0); // No network request
      expect(materializeCount).toBe(1); // Only cache read
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
      expect(materializeCount).toBe(2); // Cache check + after normalize
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
      materializeCount = 0;

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
      expect(materializeCount).toBe(2); // Cache read + after normalize
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
      materializeCount = 0;

      // Execute query with cache-only
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: "cache-only",
      });

      // Should materialize once (cache only), no normalize
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
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
      expect(materializeCount).toBe(10); // 1 per query (read-back only, no cache check)
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
      expect(materializeCount).toBe(5); // 1 per page (read-back only)
    });
  });

  describe("executeMutation", () => {
    it.skip("should normalize 1, materialize 0 (no read-back) - TODO: fix gql mock issue", async () => {
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
        mutation: MUTATION,
        variables: { name: "Bob" },
      });

      // Should normalize once (write mutation result)
      // Mutations don't materialize - they just write and return the network data
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(0);
    });
  });
});
