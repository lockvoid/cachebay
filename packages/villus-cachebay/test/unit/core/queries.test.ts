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

    it("triggers when nested entity (User->Profile) is updated", async () => {
      const USER_QUERY = gql`
        query GetUserWithProfile($id: ID!) {
          user(id: $id) {
            id
            name
            profile {
              id
              bio
              avatar
            }
          }
        }
      `;

      // Write initial data with nested profile
      cache.writeQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
            profile: {
              __typename: "Profile",
              id: "p1",
              bio: "Original bio",
              avatar: "avatar1.jpg",
            },
          },
        },
      });

      const emissions: any[] = [];

      // Watch the user query
      const handle = cache.watchQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.profile.bio).toBe("Original bio");

      // Update ONLY the profile entity (not the user)
      const PROFILE_FRAGMENT = gql`
        fragment ProfileFields on Profile {
          id
          bio
          avatar
        }
      `;

      cache.writeFragment({
        id: "Profile:p1",
        fragment: PROFILE_FRAGMENT,
        data: {
          __typename: "Profile",
          id: "p1",
          bio: "Updated bio",
          avatar: "avatar2.jpg",
        },
      });

      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve));

      // User query should have triggered because Profile:p1 is in its deps
      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.profile.bio).toBe("Updated bio");
      expect(emissions[1].user.profile.avatar).toBe("avatar2.jpg");
      expect(emissions[1].user.name).toBe("Alice"); // User data unchanged

      handle.unsubscribe();
    });

    it("triggers when mutation updates entity", async () => {
      const USER_QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
            email
          }
        }
      `;

      const UPDATE_USER_MUTATION = gql`
        mutation UpdateUser($id: ID!, $name: String!, $email: String!) {
          updateUser(id: $id, name: $name, email: $email) {
            id
            name
            email
          }
        }
      `;

      // Write initial user data
      cache.writeQuery({
        query: USER_QUERY,
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

      const emissions: any[] = [];

      // Watch the user query
      const handle = cache.watchQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");
      expect(emissions[0].user.email).toBe("alice@example.com");

      // Execute mutation (write mutation result to cache)
      cache.writeQuery({
        query: UPDATE_USER_MUTATION,
        variables: { id: "1", name: "Alice Updated", email: "alice.updated@example.com" },
        data: {
          updateUser: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
            email: "alice.updated@example.com",
          },
        },
      });

      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve));

      // Query should have triggered because User:1 was updated
      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Alice Updated");
      expect(emissions[1].user.email).toBe("alice.updated@example.com");

      handle.unsubscribe();
    });

    it("does not trigger watcher when unrelated data is mutated", async () => {
      const USER_QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            __typename
            id
            name
            email
          }
        }
      `;

      const UPDATE_OTHER_USER_MUTATION = gql`
        mutation UpdateOtherUser($id: ID!, $name: String!, $email: String!) {
          updateUser(id: $id, name: $name, email: $email) {
            __typename
            id
            name
            email
          }
        }
      `;

      // Write initial user data for User:1
      const initialWrite = cache.writeQuery({
        query: USER_QUERY,
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
      console.log('[TEST] Initial write touched:', Array.from(initialWrite.touched));
      
      // Check what deps a read would return
      const initialRead = cache.readQuery({
        query: USER_QUERY,
        variables: { id: "1" },
      });
      console.log('[TEST] Initial read deps:', initialRead.deps);

      const emissions: any[] = [];
      const deps: any[] = [];

      // Watch User:1
      const handle = cache.watchQuery({
        query: USER_QUERY,
        variables: { id: "1" },
        onData: (data) => {
          console.log('[TEST] Watcher fired, emissions count:', emissions.length + 1);
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");
      
      console.log('[TEST] Initial watcher created');

      // Mutate a DIFFERENT user (User:2) - should NOT trigger watcher for User:1
      console.log('[TEST] Writing mutation for User:2');
      const writeResult = cache.writeQuery({
        query: UPDATE_OTHER_USER_MUTATION,
        variables: { id: "2", name: "Bob Updated", email: "bob.updated@example.com" },
        data: {
          updateUser: {
            __typename: "User",
            id: "2",
            name: "Bob Updated",
            email: "bob.updated@example.com",
          },
        },
      });
      console.log('[TEST] Mutation touched records:', Array.from(writeResult.touched));
      console.log('[TEST] Mutation touched size:', writeResult.touched.size);

      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve));

      // Watcher should NOT have triggered because User:2 is unrelated to the query for User:1
      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");

      handle.unsubscribe();
    });
  });
});
