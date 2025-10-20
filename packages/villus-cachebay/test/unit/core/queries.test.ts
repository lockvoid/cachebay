import { describe, it, expect, beforeEach } from "vitest";
import { createCache } from "@/src/core/internals";
import { gql } from "graphql-tag";

describe("queries API", () => {
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    cache = createCache({
      keys: {
        User: (u: any) => u.id,
        Post: (p: any) => p.id,
      },
    });
  });

  describe("readQuery / writeQuery", () => {
    it("writes and reads query data", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
            email
          }
        }
      `;

      // Write data
      const writeResult = cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
            email: "alice@example.com",
          },
        },
      });

      expect(writeResult.touched.size).toBeGreaterThan(0);

      // Read it back
      const readResult = cache.readQuery({
        query: QUERY,
        variables: { id: "1" },
      });

      expect(readResult.data).toEqual({
        user: {
          __typename: "User",
          id: "1",
          name: "Alice",
          email: "alice@example.com",
        },
      });
      expect(readResult.deps.length).toBeGreaterThan(0);
    });

    it("returns undefined for missing data", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const result = cache.readQuery({
        query: QUERY,
        variables: { id: "999" },
      });

      expect(result.data).toBeUndefined();
      expect(result.deps).toEqual([]);
    });

    it("supports decisionMode", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      // Strict mode
      const strictResult = cache.readQuery({
        query: QUERY,
        variables: { id: "1" },
        decisionMode: "strict",
      });

      expect(strictResult.data).toBeDefined();

      // Canonical mode
      const canonicalResult = cache.readQuery({
        query: QUERY,
        variables: { id: "1" },
        decisionMode: "canonical",
      });

      expect(canonicalResult.data).toBeDefined();
    });
  });

  describe("watchQuery", () => {
    it("emits initial data and reacts to updates", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Write initial data
      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      // Watch the query
      const handle = cache.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      // Initial emission
      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");

      // Update the data
      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice Updated" },
        },
      });

      // Wait for microtask to flush
      await new Promise((resolve) => queueMicrotask(resolve));

      // Should have emitted again
      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Alice Updated");

      // Cleanup
      handle.unsubscribe();
    });

    it("supports refetch", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      const handle = cache.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update data directly (not via writeQuery)
      cache.__internals.graph.putRecord("User:1", { name: "Bob" });

      // Manually refetch
      handle.refetch();

      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Bob");

      handle.unsubscribe();
    });

    it("unsubscribes correctly", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      const handle = cache.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Unsubscribe
      handle.unsubscribe();

      // Update data
      cache.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Bob" },
        },
      });

      await new Promise((resolve) => queueMicrotask(resolve));

      // Should NOT have emitted again
      expect(emissions).toHaveLength(1);
    });
  });
});
