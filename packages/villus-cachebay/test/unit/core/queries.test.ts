import { describe, it, expect, beforeEach } from "vitest";
import { createQueries } from "@/src/core/queries";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { createFragments } from "@/src/core/fragments";
import { gql } from "graphql-tag";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("queries API", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;
  let fragments: ReturnType<typeof createFragments>;
  let queries: ReturnType<typeof createQueries>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (u: any) => u.id,
        Post: (p: any) => p.id,
        Profile: (p: any) => p.id,
      },
      onChange: (touchedIds) => {
        documents._markDirty(touchedIds);
        queries._notifyTouched(touchedIds);
        fragments._notifyTouched(touchedIds);
      },
    });
    planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, planner, canonical });
    fragments = createFragments({ graph, planner, documents });
    queries = createQueries({ graph, planner, documents });
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
      const writeResult = queries.writeQuery({
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

      // Read it back (default = canonical true)
      const readResult = queries.readQuery({
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
      expect(readResult.source === "canonical" || readResult.source === "strict").toBe(true);
    });

    it("returns no data but provides deps for missing data", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      const result = queries.readQuery({
        query: QUERY,
        variables: { id: "999" },
      });

      expect(result.data).toBeUndefined();
      // With new materialization, deps should be present so watchers can subscribe.
      expect(result.deps.length).toBeGreaterThan(0);
      expect(result.source).toBe("none");
      expect(result.ok).toBeDefined();
    });

    it("supports canonical flag (strict vs canonical)", () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      // Strict mode (canonical: false)
      const strictResult = queries.readQuery({
        query: QUERY,
        variables: { id: "1" },
        canonical: false,
      });
      expect(strictResult.data).toBeDefined();
      expect(strictResult.source === "strict" || strictResult.source === "canonical").toBe(true);

      // Canonical mode (canonical: true)
      const canonicalResult = queries.readQuery({
        query: QUERY,
        variables: { id: "1" },
        canonical: true,
      });
      expect(canonicalResult.data).toBeDefined();
      expect(canonicalResult.source === "canonical" || canonicalResult.source === "strict").toBe(true);
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
      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      // Watch the query
      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      // Initial emission (watchers emit immediately on fulfilled data)
      expect(emissions).toHaveLength(1);
      expect(emissions[0].user.name).toBe("Alice");

      // Update the data
      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice Updated" },
        },
      });

      // Wait for microtask to flush batched notifications
      await tick();

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

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update data directly (not via writeQuery)
      graph.putRecord("User:1", { name: "Bob" });

      // Manually refetch (should emit synchronously with current snapshot)
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

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Alice" },
        },
      });

      const emissions: any[] = [];

      const handle = queries.watchQuery({
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
      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: { __typename: "User", id: "1", name: "Bob" },
        },
      });

      await tick();

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
      queries.writeQuery({
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
      const handle = queries.watchQuery({
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

      fragments.writeFragment({
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
      await tick();

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
      queries.writeQuery({
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
      const handle = queries.watchQuery({
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
      queries.writeQuery({
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
      await tick();

      // Query should have triggered because User:1 was updated
      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Alice Updated");
      expect(emissions[1].user.email).toBe("alice.updated@example.com");

      handle.unsubscribe();
    });
  });
});
