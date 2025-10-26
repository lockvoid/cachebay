import { describe, it, expect, beforeEach, vi } from "vitest";
import { createQueries, getQueryCanonicalKeys } from "@/src/core/queries";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { createOperations } from "@/src/core/operations";
import { createSSR } from "@/src/core/ssr";
import { gql } from "graphql-tag";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("queries API", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;
  let queries: ReturnType<typeof createQueries>;
  let operations: ReturnType<typeof createOperations>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        User: (u: any) => u.id,
        Post: (p: any) => p.id,
        Profile: (p: any) => p.id,
      },
      onChange: (touchedIds) => {
        queries.propagateData(touchedIds);
      },
    });
    planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, planner, canonical });
    const ssr = createSSR({ hydrationTimeout: 100 }, { graph });

    // Create queries first (without operations)
    queries = createQueries({ documents, planner, operations: null as any });

    // Create operations with callback
    operations = createOperations(
      {
        transport: {
          http: vi.fn().mockResolvedValue({ data: null, error: null }),
          ws: vi.fn(),
        },
      },
      { planner, documents, ssr },
      {
        onQueryExecuted: queries.handleQueryExecuted,
      }
    );

    // Inject operations into queries
    queries._setOperations(operations);
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
      queries.writeQuery({
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
      expect(readResult.error).toBeUndefined();
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
      // Should have error when data is missing
      expect(result.error).toBeDefined();
      expect(result.error?.name).toBe("CacheMissError");
    });

    it("reads written data successfully", () => {
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

      // Read the data back (always uses canonical mode now)
      const result = queries.readQuery({
        query: QUERY,
        variables: { id: "1" },
      });
      expect(result.data).toBeDefined();
      expect(result.data).toEqual({
        user: { __typename: "User", id: "1", name: "Alice" },
      });
      expect(result.error).toBeUndefined();
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
      // refetch removed - use update with same variables to re-materialize
      handle.update({ variables: { id: "1" }, immediate: true });

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

      // Update ONLY the profile entity using low-level graph API
      // This simulates an external update to the Profile entity
      graph.putRecord("Profile:p1", {
        bio: "Updated bio",
        avatar: "avatar2.jpg",
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

  describe("recycleSnapshots integration", () => {
    it("reuses unchanged nested objects when only one field changes", async () => {
      const QUERY = gql`
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

      // Initial write
      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
            profile: {
              __typename: "Profile",
              id: "p1",
              bio: "Software Engineer",
              avatar: "avatar1.jpg",
            },
          },
        },
      });

      const emissions: any[] = [];
      const profileRefs: any[] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
          profileRefs.push(data.user.profile);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(profileRefs[0].bio).toBe("Software Engineer");

      // Update only user name (profile unchanged)
      queries.writeQuery({
        query: gql`
          mutation UpdateUserName($id: ID!, $name: String!) {
            updateUser(id: $id, name: $name) {
              id
              name
            }
          }
        `,
        variables: { id: "1", name: "Alice Updated" },
        data: {
          updateUser: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
          },
        },
      });

      await tick();

      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Alice Updated");
      // Profile object should be recycled (same reference)
      expect(profileRefs[1]).toBe(profileRefs[0]);

      handle.unsubscribe();
    });

    it("reuses unchanged array elements when only one element changes", async () => {
      const QUERY = gql`
        query GetUserPosts($id: ID!) {
          user(id: $id) {
            id
            posts {
              id
              title
              content
            }
          }
        }
      `;

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            posts: [
              { __typename: "Post", id: "p1", title: "Post 1", content: "Content 1" },
              { __typename: "Post", id: "p2", title: "Post 2", content: "Content 2" },
              { __typename: "Post", id: "p3", title: "Post 3", content: "Content 3" },
            ],
          },
        },
      });

      const emissions: any[] = [];
      const postRefs: any[][] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
          postRefs.push(data.user.posts);
        },
      });

      expect(emissions).toHaveLength(1);
      const initialPost1 = postRefs[0][0];
      const initialPost2 = postRefs[0][1];
      const initialPost3 = postRefs[0][2];

      // Update only post 2
      queries.writeQuery({
        query: gql`
          mutation UpdatePost($id: ID!, $title: String!) {
            updatePost(id: $id, title: $title) {
              id
              title
            }
          }
        `,
        variables: { id: "p2", title: "Post 2 Updated" },
        data: {
          updatePost: {
            __typename: "Post",
            id: "p2",
            title: "Post 2 Updated",
          },
        },
      });

      await tick();

      expect(emissions).toHaveLength(2);
      // Post 1 and Post 3 should be recycled (same references)
      expect(postRefs[1][0]).toBe(initialPost1);
      expect(postRefs[1][2]).toBe(initialPost3);
      // Post 2 should be new reference
      expect(postRefs[1][1]).not.toBe(initialPost2);
      expect(postRefs[1][1].title).toBe("Post 2 Updated");

      handle.unsubscribe();
    });

    it("does not emit when data is structurally identical (no changes)", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
            email
          }
        }
      `;

      queries.writeQuery({
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

      const emissions: any[] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Write same data again (should not trigger emission)
      queries.writeQuery({
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

      await tick();

      // Should still be 1 emission (no change detected)
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("recycles deeply nested unchanged structures", async () => {
      const QUERY = gql`
        query GetUserWithNestedData($id: ID!) {
          user(id: $id) {
            id
            name
            profile {
              id
              bio
              settings {
                id
                theme
                notifications {
                  id
                  email
                  push
                }
              }
            }
          }
        }
      `;

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
            profile: {
              __typename: "Profile",
              id: "p1",
              bio: "Engineer",
              settings: {
                __typename: "Settings",
                id: "s1",
                theme: "dark",
                notifications: {
                  __typename: "Notifications",
                  id: "n1",
                  email: true,
                  push: false,
                },
              },
            },
          },
        },
      });

      const emissions: any[] = [];
      const settingsRefs: any[] = [];
      const notificationsRefs: any[] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
          settingsRefs.push(data.user.profile.settings);
          notificationsRefs.push(data.user.profile.settings.notifications);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update only user name (all nested structures unchanged)
      queries.writeQuery({
        query: gql`
          mutation UpdateUserName($id: ID!, $name: String!) {
            updateUser(id: $id, name: $name) {
              id
              name
            }
          }
        `,
        variables: { id: "1", name: "Alice Updated" },
        data: {
          updateUser: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
          },
        },
      });

      await tick();

      expect(emissions).toHaveLength(2);
      // All nested structures should be recycled
      expect(settingsRefs[1]).toBe(settingsRefs[0]);
      expect(notificationsRefs[1]).toBe(notificationsRefs[0]);

      handle.unsubscribe();
    });

    it("works correctly with refetch", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
            profile {
              id
              bio
            }
          }
        }
      `;

      queries.writeQuery({
        query: QUERY,
        variables: { id: "1" },
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "Alice",
            profile: {
              __typename: "Profile",
              id: "p1",
              bio: "Engineer",
            },
          },
        },
      });

      const emissions: any[] = [];
      const profileRefs: any[] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "1" },
        onData: (data) => {
          emissions.push(data);
          profileRefs.push(data.user.profile);
        },
      });

      expect(emissions).toHaveLength(1);

      // Refetch (data unchanged)
      // refetch removed - use update with same variables to re-materialize
      handle.update({ variables: { id: "1" }, immediate: true });

      expect(emissions).toHaveLength(1); // No new emission (data identical)

      // Update user name
      queries.writeQuery({
        query: gql`
          mutation UpdateUserName($id: ID!, $name: String!) {
            updateUser(id: $id, name: $name) {
              id
              name
            }
          }
        `,
        variables: { id: "1", name: "Alice Updated" },
        data: {
          updateUser: {
            __typename: "User",
            id: "1",
            name: "Alice Updated",
          },
        },
      });

      // Refetch after update
      // refetch removed - use update with same variables to re-materialize
      handle.update({ variables: { id: "1" }, immediate: true });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Alice Updated");
      // Profile should be recycled
      expect(profileRefs[1]).toBe(profileRefs[0]);

      handle.unsubscribe();
    });

    it("updates variables with update method", async () => {
      const QUERY = gql`
        query GetUser($id: ID!) {
          user(id: $id) {
            id
            name
          }
        }
      `;

      // Write data for two users
      queries.writeQuery({
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

      queries.writeQuery({
        query: QUERY,
        variables: { id: "2" },
        data: {
          user: {
            __typename: "User",
            id: "2",
            name: "Bob",
          },
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
      expect(emissions[0].user.name).toBe("Alice");

      // Update variables to fetch different user
      handle.update({ variables: { id: "2" } });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].user.name).toBe("Bob");

      handle.unsubscribe();
    });

    it("recycles data with update method for pagination", async () => {
      const QUERY = gql`
        query GetPosts($first: Int!, $after: String) {
          posts(first: $first, after: $after) {
            edges {
              node {
                id
                title
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      // Write initial page
      queries.writeQuery({
        query: QUERY,
        variables: { first: 2, after: null },
        data: {
          posts: {
            __typename: "PostConnection",
            edges: [
              {
                __typename: "PostEdge",
                node: {
                  __typename: "Post",
                  id: "1",
                  title: "Post 1",
                },
              },
              {
                __typename: "PostEdge",
                node: {
                  __typename: "Post",
                  id: "2",
                  title: "Post 2",
                },
              },
            ],
            pageInfo: {
              __typename: "PageInfo",
              hasNextPage: true,
              endCursor: "cursor2",
            },
          },
        },
      });

      // Write next page (accumulated in canonical cache)
      queries.writeQuery({
        query: QUERY,
        variables: { first: 2, after: "cursor2" },
        data: {
          posts: {
            __typename: "PostConnection",
            edges: [
              {
                __typename: "PostEdge",
                node: {
                  __typename: "Post",
                  id: "3",
                  title: "Post 3",
                },
              },
              {
                __typename: "PostEdge",
                node: {
                  __typename: "Post",
                  id: "4",
                  title: "Post 4",
                },
              },
            ],
            pageInfo: {
              __typename: "PageInfo",
              hasNextPage: false,
              endCursor: "cursor4",
            },
          },
        },
      });

      const emissions: any[] = [];
      const edgeRefs: any[][] = [];

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { first: 2, after: null },
        canonical: true,
        onData: (data) => {
          emissions.push(data);
          edgeRefs.push(data.posts.edges);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].posts.edges).toHaveLength(2);

      // Update to next page
      handle.update({ variables: { first: 2, after: "cursor2" } });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].posts.edges).toHaveLength(2); // Next page has 2 edges
      expect(emissions[1].posts.edges[0].node.id).toBe("3");
      expect(emissions[1].posts.edges[1].node.id).toBe("4");

      handle.unsubscribe();
    });
  });
});
