import { gql } from "graphql-tag";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";

/**
 * Documents Performance Tests - Materialize Cache
 *
 * Tests the WeakMap cache for materialize to ensure:
 * 1. Cache hits return the same result object (reference equality)
 * 2. force: true bypasses cache and re-materializes
 * 3. Different options create separate cache entries:
 *    - variables
 *    - canonical mode (canonical vs strict)
 *    - fingerprint option (true vs false)
 *    - entityId (for fragments)
 * 4. Cache invalidation works correctly with force: true
 */
describe("documents - materialize cache", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (u: any) => u.id,
        Post: (p: any) => p.id,
      },
      interfaces: {},
      onChange: vi.fn(),
    });

    planner = createPlanner();
    canonical = createCanonical({ graph });
    documents = createDocuments({ graph, planner, canonical });
  });

  describe("cache behavior", () => {
    it("should return cached result on second call (same reference)", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const data = { user: { __typename: "User", id: "1", name: "Alice" } };

      // Write data to cache
      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data,
      });

      // First materialize
      const result1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Check hot field immediately after first call
      expect(result1.hot).toBe(false); // First call - COLD

      // Second materialize - should return cached result
      const result2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Check hot field after second call
      expect(result2.hot).toBe(true);  // Second call - HOT

      // Should return exact same reference (cached)
      expect(result1).toBe(result2);
      expect(result1.data).toBe(result2.data);
      expect(result1.dependencies).toBe(result2.dependencies);
    });

    it("should bypass cache when force: true", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const data = { user: { __typename: "User", id: "1", name: "Alice" } };

      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data,
      });

      // First materialize
      const result1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Second materialize with force: true - should create new result
      const result2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        force: true,
      });

      // Check hot field
      expect(result1.hot).toBe(false); // First call - COLD
      expect(result2.hot).toBe(false); // force: true bypasses cache - COLD

      // Should NOT return same reference (force bypasses cache)
      expect(result1).not.toBe(result2);
      // But data should be structurally equal
      expect(result1.data).toEqual(result2.data);
    });

    it("should create separate cache entries for different variables", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const data1 = { user: { __typename: "User", id: "1", name: "Alice" } };
      const data2 = { user: { __typename: "User", id: "2", name: "Bob" } };

      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data: data1,
      });

      documents.normalize({
        document: QUERY,
        variables: { id: "2" },
        data: data2,
      });

      // Materialize with id: "1"
      const result1a = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Materialize with id: "2"
      const result2a = documents.materialize({
        document: QUERY,
        variables: { id: "2" },
        canonical: true,
      });

      // Materialize with id: "1" again - should be cached
      const result1b = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Materialize with id: "2" again - should be cached
      const result2b = documents.materialize({
        document: QUERY,
        variables: { id: "2" },
        canonical: true,
      });

      // Same variables should return same reference
      expect(result1a).toBe(result1b);
      expect(result2a).toBe(result2b);

      // Different variables should return different references
      expect(result1a).not.toBe(result2a);
      expect(result1a.data.user.name).toBe("Alice");
      expect(result2a.data.user.name).toBe("Bob");
    });

    it("should create separate cache entries for canonical vs strict mode", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const data = { user: { __typename: "User", id: "1", name: "Alice" } };

      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data,
      });

      // Materialize in canonical mode
      const canonicalResult1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Materialize in strict mode
      const strictResult1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: false,
      });

      // Materialize in canonical mode again
      const canonicalResult2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      // Materialize in strict mode again
      const strictResult2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: false,
      });

      // Same mode should return same reference
      expect(canonicalResult1).toBe(canonicalResult2);
      expect(strictResult1).toBe(strictResult2);

      // Different modes should return different references
      expect(canonicalResult1).not.toBe(strictResult1);
    });

    it("should create separate cache entries for different entityId", () => {
      const FRAGMENT = gql`
        fragment UserFields on User {
          id
          name
        }
      `;

      const data1 = { __typename: "User", id: "1", name: "Alice" };
      const data2 = { __typename: "User", id: "2", name: "Bob" };

      // Write entities directly
      graph.putRecord("User:1", { __typename: "User", id: "1", name: "Alice" });
      graph.putRecord("User:2", { __typename: "User", id: "2", name: "Bob" });

      // Materialize fragment for User:1
      const result1a = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:1",
      });

      // Materialize fragment for User:2
      const result2a = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:2",
      });

      // Materialize fragment for User:1 again - should be cached
      const result1b = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:1",
      });

      // Same entityId should return same reference
      expect(result1a).toBe(result1b);

      // Different entityId should return different references
      expect(result1a).not.toBe(result2a);
      expect(result1a.data.name).toBe("Alice");
      expect(result2a.data.name).toBe("Bob");
    });
  });

  describe("cache invalidation", () => {
    it("should update cache when data changes and force: true is used", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const initialData = { user: { __typename: "User", id: "1", name: "Alice" } };
      const updatedData = { user: { __typename: "User", id: "1", name: "Alice Updated" } };

      // Write initial data
      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data: initialData,
      });

      // First materialize - gets cached
      const result1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      expect(result1.data.user.name).toBe("Alice");

      // Update data in cache
      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data: updatedData,
      });

      // Materialize without force - returns OLD cached result
      const result2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      expect(result2).toBe(result1); // Same reference
      expect(result2.data.user.name).toBe("Alice"); // Old data

      // Materialize with force: true - gets NEW data and updates cache
      const result3 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        force: true,
      });

      expect(result3).not.toBe(result1); // Different reference
      expect(result3.data.user.name).toBe("Alice Updated"); // New data

      // Subsequent calls without force should return the updated cached result
      const result4 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
      });

      expect(result4).toBe(result3); // Same reference as force: true result
      expect(result4.data.user.name).toBe("Alice Updated");
    });
  });

  describe("performance optimization", () => {
    it("should avoid redundant materialization work when cache hits", () => {
      const QUERY = gql`
        query GetUsers {
          users {
            id
            name
            email
          }
        }
      `;

      const data = {
        users: [
          { __typename: "User", id: "1", name: "Alice", email: "alice@example.com" },
          { __typename: "User", id: "2", name: "Bob", email: "bob@example.com" },
          { __typename: "User", id: "3", name: "Charlie", email: "charlie@example.com" },
        ],
      };

      documents.normalize({
        document: QUERY,
        variables: {},
        data,
      });

      // First call - does actual materialization work
      const result1 = documents.materialize({
        document: QUERY,
        variables: {},
        canonical: true,
      });

      // Second call - should be instant (cache hit)
      const result2 = documents.materialize({
        document: QUERY,
        variables: {},
        canonical: true,
      });

      // Should return exact same reference (proves cache hit)
      expect(result1).toBe(result2);
      expect(result1.data).toBe(result2.data);
      expect(result1.dependencies).toBe(result2.dependencies);
    });

    it("should handle multiple queries with different cache entries efficiently", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Populate cache with 10 different users
      for (let i = 1; i <= 10; i++) {
        documents.normalize({
          document: QUERY,
          variables: { id: String(i) },
          data: { user: { __typename: "User", id: String(i), name: `User ${i}` } },
        });
      }

      // Materialize all 10 users (first time - cache miss)
      const firstResults = [];
      for (let i = 1; i <= 10; i++) {
        firstResults.push(
          documents.materialize({
            document: QUERY,
            variables: { id: String(i) },
            canonical: true,
          }),
        );
      }

      // Materialize all 10 users again (second time - cache hit)
      const secondResults = [];
      for (let i = 1; i <= 10; i++) {
        secondResults.push(
          documents.materialize({
            document: QUERY,
            variables: { id: String(i) },
            canonical: true,
          }),
        );
      }

      // All results should be cached (same references)
      for (let i = 0; i < 10; i++) {
        expect(firstResults[i]).toBe(secondResults[i]);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle cache miss (no data) correctly", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Materialize without writing data first (cache miss)
      const result1 = documents.materialize({
        document: QUERY,
        variables: { id: "999" },
        canonical: true,
      });

      // Second call should also return cached "none" result
      const result2 = documents.materialize({
        document: QUERY,
        variables: { id: "999" },
        canonical: true,
      });

      expect(result1.source).toBe("none");
      expect(result2.source).toBe("none");
      expect(result1).toBe(result2); // Should cache even "none" results
    });

    it("should handle empty variables object correctly", () => {
      const QUERY = gql`
        query GetAllUsers {
          users {
            id
            name
          }
        }
      `;

      const data = {
        users: [{ __typename: "User", id: "1", name: "Alice" }],
      };

      documents.normalize({
        document: QUERY,
        variables: {},
        data,
      });

      // Materialize with empty object
      const result1 = documents.materialize({
        document: QUERY,
        variables: {},
        canonical: true,
      });

      // Materialize with undefined (defaults to {})
      const result2 = documents.materialize({
        document: QUERY,
        canonical: true,
      });

      // Should return same cached result
      expect(result1).toBe(result2);
    });

    it("should create separate cache entries for different fingerprint option", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const data = { user: { __typename: "User", id: "1", name: "Alice" } };

      documents.normalize({
        document: QUERY,
        variables: { id: "1" },
        data,
      });

      // Materialize with fingerprint: true
      const result1 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        fingerprint: true,
      });

      // Check hot immediately
      const result1Hot = result1.hot;
      expect(result1Hot).toBe(false); // First call - COLD

      // Materialize with fingerprint: false
      const result2 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        fingerprint: false,
      });

      // Check hot immediately
      const result2Hot = result2.hot;
      expect(result2Hot).toBe(false); // First call with different signature - COLD

      // Materialize with fingerprint: true again
      const result3 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        fingerprint: true,
      });

      // Check hot immediately
      expect(result3.hot).toBe(true);  // Second call with same signature - HOT

      // Materialize with fingerprint: false again
      const result4 = documents.materialize({
        document: QUERY,
        variables: { id: "1" },
        canonical: true,
        fingerprint: false,
      });

      // Check hot immediately
      expect(result4.hot).toBe(true);  // Second call with same signature - HOT

      // Same fingerprint option should return same reference
      expect(result1).toBe(result3);
      expect(result2).toBe(result4);

      // Different fingerprint option should return different references
      expect(result1).not.toBe(result2);

      // fingerprint: true adds __version fields
      expect(result1.data.__version).toBeDefined();
      expect(result1.data.user.__version).toBeDefined();

      // fingerprint: false does not add __version fields
      expect(result2.data.__version).toBeUndefined();
      expect(result2.data.user.__version).toBeUndefined();

      // Core data should be the same
      expect(result1.data.user.id).toBe(result2.data.user.id);
      expect(result1.data.user.name).toBe(result2.data.user.name);
    });
  });

});
