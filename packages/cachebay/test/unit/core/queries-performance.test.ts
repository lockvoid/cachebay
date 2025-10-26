// Mock documents module to inject performance counters
let normalizeCount = 0;
let materializeCount = 0;

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
 * Performance Tests - Optimization Goals
 *
 * These tests track normalize/materialize call counts to ensure we're not doing redundant work.
 *
 * OPTIMIZATION TARGETS:
 * 1. watchQuery initial load: Should materialize ONCE (currently: 2x - NEEDS FIX)
 * 2. watchQuery + writeQuery: Should materialize 2x total (initial + update) (currently: 3x - NEEDS FIX)
 * 3. Multiple watchers: Each watcher should materialize once per update (currently: OK)
 * 4. Pagination: Each update should materialize once per watcher (currently: OK)
 *
 * KEY PRINCIPLE: Avoid redundant materializations
 * - writeQuery: normalize only (no materialize)
 * - readQuery: materialize only (no normalize)
 * - watchQuery: materialize once on initial load, once per update
 * - No double-materialize from propagateData when data hasn't changed
 */
describe("client API - Performance", () => {
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
        Profile: (p: any) => p.id,
      },
    });
  });

  describe("writeQuery", () => {
    it("should normalize 1, materialize 0 (write only - no read)", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });

      // writeQuery only normalizes, doesn't materialize
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(0);
    });

    it("pagination: 5 writeQuery calls should normalize 5, materialize 0", () => {
      const POSTS_QUERY = gql`
        query GetPosts($first: Int!, $after: String) {
          posts(first: $first, after: $after) {
            edges {
              node {
                id
                title
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      `;

      // Load 5 pages
      for (let i = 0; i < 5; i++) {
        client.writeQuery({
          query: POSTS_QUERY,
          variables: { first: 2, after: i === 0 ? null : `cursor${i}` },
          data: {
            posts: {
              __typename: "PostConnection",
              edges: [
                { __typename: "PostEdge", node: { __typename: "Post", id: `${i * 2 + 1}`, title: `Post ${i * 2 + 1}` } },
                { __typename: "PostEdge", node: { __typename: "Post", id: `${i * 2 + 2}`, title: `Post ${i * 2 + 2}` } },
              ],
              pageInfo: {
                __typename: "PageInfo",
                endCursor: `cursor${i + 1}`,
                hasNextPage: i < 4,
              },
            },
          },
        });
      }

      // writeQuery only normalizes, doesn't materialize
      expect(normalizeCount).toBe(5);
      expect(materializeCount).toBe(0);
    });
  });

  describe("readQuery", () => {
    it("should materialize 1, normalize 0", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Setup: write data first
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });

      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      // Read the data
      client.readQuery({
        query: QUERY,
        variables: { id: "1" },
      });

      // readQuery only materializes, doesn't normalize
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
    });
  });

  describe("watchQuery", () => {
    it("should materialize 1 on initial load", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Setup: write data first
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });
      await tick();

      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      const emissions: any[] = [];
      const handle = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions.push(data),
      });

      await tick();

      // OPTIMIZED: Only 1 materialize (watchQuery with immediate: true)
      // No redundant materialize from propagateData or other sources
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("should rematerialize 1 on cache update", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      const emissions: any[] = [];
      const handle = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions.push(data),
      });

      await tick();

      // OPTIMIZED: Only 1 materialize (watchQuery with immediate: true)
      // No redundant materialize from propagateData or other sources
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
      expect(emissions).toHaveLength(0);

      // Setup: write data first
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });
      await tick();

      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(2);
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("should rematerialize 1 on operation execute", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Mock transport to return user data
      mockTransport.http.mockResolvedValueOnce({
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
        error: null,
      });

      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      const emissions: any[] = [];
      const handle = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions.push(data),
      });

      await tick();
      await tick();

      // OPTIMIZED: Only 1 materialize (watchQuery with immediate: true on cache miss)
      // No data yet, so no emission
      expect(normalizeCount).toBe(0);
      expect(materializeCount).toBe(1);
      expect(emissions).toHaveLength(0);

      // Execute query via client (simulates real network request)
      await client.executeQuery({
        query: QUERY,
        variables: { id: "1" },
        cachePolicy: 'network-only',
      });

      await tick();
      await tick();

      // OPTIMIZATION TARGET:
      // - 1 normalize (executeQuery writes network response)
      // - 2 materializations: watchQuery initial + watcher onChange
      // CURRENT: 3 materializations (1 redundant somewhere)
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(2); // Target: 2, Current: 3
      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");

      handle.unsubscribe();
    });

    it("watchQuery + writeQuery: should materialize twice (initial + update)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Setup: write initial data
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });
      await tick();

      // Reset counts
      normalizeCount = 0;
      materializeCount = 0;

      const emissions: any[] = [];
      const handle = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions.push(data),
      });

      await tick();

      // OPTIMIZED: After initial watch - only 1 materialize
      expect(materializeCount).toBe(1);

      // Update data
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
          },
        },
      });

      await tick();

      // OPTIMIZED: 1 normalize (writeQuery) + 1 materialize (watcher onChange)
      // Total: initial(1) + update(1) = 2 materializations
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(2);
      expect(emissions).toHaveLength(2);

      handle.unsubscribe();
    });

    it("watchQuery with 2 watchers: should materialize once per watcher on update", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Setup: write initial data
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });

      // Create 2 watchers
      const emissions1: any[] = [];
      const emissions2: any[] = [];

      const handle1 = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions1.push(data),
      });

      const handle2 = client.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => emissions2.push(data),
      });

      await tick();

      // Reset counts after setup
      normalizeCount = 0;
      materializeCount = 0;

      // Update data
      client.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
          },
        },
      });

      await tick();

      // Should normalize once + materialize once per watcher (2 total)
      expect(normalizeCount).toBe(1);
      expect(materializeCount).toBe(2); // watcher1(1) + watcher2(1)
      expect(emissions1).toHaveLength(2); // Initial + update
      expect(emissions2).toHaveLength(2); // Initial + update

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("pagination with watcher: watcher materializes on each update", async () => {
      const USER_QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Setup: write initial data
      client.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
          },
        },
      });

      // Setup watcher
      const emissions: any[] = [];
      const handle = client.watchQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        onData: (data) => emissions.push(data),
      });

      await tick();

      // Reset counts after initial setup
      normalizeCount = 0;
      materializeCount = 0;

      // Update 5 times
      for (let i = 0; i < 5; i++) {
        client.writeQuery({
          query: USER_QUERY,
          variables: { id: "1" },
          data: {
            user: {
              __typename: "User",
              id: "1",
              name: `Alice ${i}`,
            },
          },
        });
        await tick();
      }

      // Should materialize once per update via watcher (optimized: no redundant materializations)
      expect(normalizeCount).toBe(5);
      expect(materializeCount).toBe(5); // 5 updates × 1 (watcher only, no redundant materialize)
      expect(emissions).toHaveLength(6); // Initial + 5 updates

      handle.unsubscribe();
    });

    describe("immediate option", () => {
      it("immediate: true materializes and emits on cache hit", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        const emissions: any[] = [];

        // Watch with immediate: true (default)
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        // Should emit immediately with cached data
        expect(emissions).toHaveLength(1);
        expect(emissions[0].user.name).toBe("Alice");

        handle.unsubscribe();
      });

      it("watchQuery with immediate: false does not emit on cache hit", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        const emissions: any[] = [];

        // Watch with immediate: false
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: (data) => {
            emissions.push(data);
          },
        });

        // Should NOT emit immediately
        expect(emissions).toHaveLength(0);

        handle.unsubscribe();
      });

      it("watchQuery with immediate: true does not emit on cache miss", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        const emissions: any[] = [];

        // Watch with immediate: true but no cached data
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "999" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        // Should NOT emit (cache miss)
        expect(emissions).toHaveLength(0);

        handle.unsubscribe();
      });

      it("watchQuery with immediate: false does not track dependencies until first materialize", async () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        const emissions: any[] = [];

        // Watch with immediate: false
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: false,
          onData: (data) => {
            emissions.push(data);
          },
        });

        // Should NOT emit immediately
        expect(emissions).toHaveLength(0);

        // Update data - watcher won't be notified because it has no dependencies yet
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Bob" },
          },
        });

        await tick(); // Wait for scheduleFlush microtask

        // Should still NOT emit (no dependencies tracked yet)
        expect(emissions).toHaveLength(0);

        // Now manually trigger materialize with update
        handle.update({ variables: { id: "1" }, immediate: true });

        // Should emit now with current data
        expect(emissions).toHaveLength(1);
        expect(emissions[0].user.name).toBe("Bob");

        // Now watcher has dependencies, so future updates will trigger
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Charlie" },
          },
        });

        await tick();

        // Should emit via propagateData
        expect(emissions).toHaveLength(2);
        expect(emissions[1].user.name).toBe("Charlie");

        handle.unsubscribe();
      });
    });
  });

  describe("update method", () => {
    describe("immediate option", () => {
      it("immediate: true materializes and emits", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache with two users
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        client.writeQuery({
          query: QUERY,
          variables: { id: "2" },
          data: {
            user: { __typename: "User", id: "2", name: "Bob" },
          },
        });

        const emissions: any[] = [];

        // Watch user 1
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        expect(emissions).toHaveLength(1);
        expect(emissions[0].user.name).toBe("Alice");

        // Update to user 2 with immediate: true
        handle.update({ variables: { id: "2" }, immediate: true });

        // Should emit immediately with user 2 data
        expect(emissions).toHaveLength(2);
        expect(emissions[1].user.name).toBe("Bob");

        handle.unsubscribe();
      });

      it("update with immediate: false does not emit", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache with two users
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        client.writeQuery({
          query: QUERY,
          variables: { id: "2" },
          data: {
            user: { __typename: "User", id: "2", name: "Bob" },
          },
        });

        const emissions: any[] = [];

        // Watch user 1
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        expect(emissions).toHaveLength(1);
        expect(emissions[0].user.name).toBe("Alice");

        // Update to user 2 with immediate: false
        handle.update({ variables: { id: "2" }, immediate: false });

        // Should NOT emit immediately
        expect(emissions).toHaveLength(1);

        handle.unsubscribe();
      });

      it("update with immediate: false waits for propagateData", async () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        const emissions: any[] = [];

        // Watch user 1
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        expect(emissions).toHaveLength(1);

        // Update to same variables with immediate: false
        handle.update({ variables: { id: "1" }, immediate: false });

        // Should NOT emit immediately
        expect(emissions).toHaveLength(1);

        // Now update the cache to trigger propagateData
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Bob" },
          },
        });

        await tick();

        // Should emit now via propagateData
        expect(emissions).toHaveLength(2);
        expect(emissions[1].user.name).toBe("Bob");

        handle.unsubscribe();
      });

      it("update with immediate: true on cache miss does not emit", () => {
        const QUERY = gql`
          query GetUser($id: ID!) {
            user(id: $id) {
              id
              name
            }
          }
        `;

        // Pre-populate cache with user 1
        client.writeQuery({
          query: QUERY,
          variables: { id: "1" },
          data: {
            user: { __typename: "User", id: "1", name: "Alice" },
          },
        });

        const emissions: any[] = [];

        // Watch user 1
        const handle = client.watchQuery({
          query: QUERY,
          variables: { id: "1" },
          immediate: true,
          onData: (data) => {
            emissions.push(data);
          },
        });

        expect(emissions).toHaveLength(1);

        // Update to user 999 (not in cache) with immediate: true
        handle.update({ variables: { id: "999" }, immediate: true });

        // Should NOT emit (cache miss)
        expect(emissions).toHaveLength(1);

        handle.unsubscribe();
      });
    });
  });
});
