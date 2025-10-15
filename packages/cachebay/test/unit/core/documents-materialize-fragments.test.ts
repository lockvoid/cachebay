// Test materialize for fragments with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { USER_QUERY } from "@/test/helpers/operations";

describe("documents.materialize - fragments with rootId", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    planner = createPlanner();

    graph = createGraph({
      keys: {
        User: (u) => u.id,
        Post: (p) => p.id,
        Comment: (c) => c.uuid,
      },
      interfaces: {},
      onChange: () => {},
    });

    optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, canonical, planner });
  });

  it("reads fragment with standard id field", () => {
    const USER_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserFields on User {
        id
        email
      }
    `);

    // Write a user entity to cache
    documents.normalize({
      document: USER_QUERY,
      variables: { id: "u1" },
      data: {
        user: { __typename: "User", id: "u1", email: "user1@test.com" },
      },
    });

    // Read fragment using standard rootId format: TypeName:id
    const result = documents.materialize({
      document: USER_FRAGMENT,
      variables: {},
      canonical: true,
      rootId: "User:u1",
      fingerprint: true,
    });

    expect(result.source).not.toBe("none");
    expect(result.data).toEqual({
      __typename: "User",
      id: "u1",
      email: "user1@test.com",
    });
    expect(result.fingerprints).toEqual({
      __version: expect.any(Number),
    });
  });

  it("reads fragment with custom key field (uuid)", () => {
    const COMMENT_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment CommentFields on Comment {
        uuid
        text
        author {
          id
          name
        }
      }
    `);

    // Write a comment entity with custom key field (uuid)
    const commentUuid = "550e8400-e29b-41d4-a716-446655440000";
    
    // First write the author
    documents.normalize({
      document: USER_QUERY,
      variables: { id: "u1" },
      data: {
        user: { __typename: "User", id: "u1", name: "Alice" },
      },
    });

    // Then write a query that returns the comment
    const COMMENT_QUERY = compilePlan(/* GraphQL */ `
      query GetComment($uuid: ID!) {
        comment(uuid: $uuid) {
          uuid
          text
          author {
            id
            name
          }
        }
      }
    `);

    documents.normalize({
      document: COMMENT_QUERY,
      variables: { uuid: commentUuid },
      data: {
        comment: {
          __typename: "Comment",
          uuid: commentUuid,
          text: "Great post!",
          author: { __typename: "User", id: "u1", name: "Alice" },
        },
      },
    });

    // Read fragment using custom key field: TypeName:uuid
    const result = documents.materialize({
      document: COMMENT_FRAGMENT,
      variables: {},
      canonical: true,
      rootId: `Comment:${commentUuid}`,
      fingerprint: true,
    });

    expect(result.source).not.toBe("none");
    expect(result.data).toEqual({
      __typename: "Comment",
      uuid: commentUuid,
      text: "Great post!",
      author: {
        __typename: "User",
        id: "u1",
        name: "Alice",
      },
    });
    expect(result.fingerprints).toEqual({
      __version: expect.any(Number),
      author: {
        __version: expect.any(Number),
      },
    });
  });

  it("returns null for non-existent fragment entity", () => {
    const USER_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserFields on User {
        id
        email
      }
    `);

    // Try to read fragment for entity that doesn't exist
    const result = documents.materialize({
      document: USER_FRAGMENT,
      variables: {},
      canonical: true,
      rootId: "User:nonexistent",
      fingerprint: true,
    });

    expect(result.source).toBe("none");
    expect(result.data).toBeUndefined();
  });

  it("fragment materialization respects cache invalidation", () => {
    const USER_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserFields on User {
        id
        email
      }
    `);

    // Write a user entity
    documents.normalize({
      document: USER_QUERY,
      variables: { id: "u1" },
      data: {
        user: { __typename: "User", id: "u1", email: "original@test.com" },
      },
    });

    // Materialize and cache
    const result1 = documents.materialize({
      document: USER_FRAGMENT,
      variables: {},
      rootId: "User:u1",
      updateCache: true,
    });

    // Verify cached
    const cached = documents.materialize({
      document: USER_FRAGMENT,
      variables: {},
      rootId: "User:u1",
      preferCache: true,
    });
    expect(cached).toBe(result1);

    // Invalidate
    documents.invalidate({
      document: USER_FRAGMENT,
      variables: {},
      rootId: "User:u1",
    });

    // Should return new reference
    const result2 = documents.materialize({
      document: USER_FRAGMENT,
      variables: {},
      rootId: "User:u1",
      preferCache: true,
    });
    expect(result2).not.toBe(result1);
  });

  it("fragment with nested entities resolves correctly", () => {
    const USER_WITH_POSTS_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserWithPosts on User {
        id
        name
        posts {
          id
          title
        }
      }
    `);

    // Write user with posts
    const QUERY = compilePlan(/* GraphQL */ `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          posts {
            id
            title
          }
        }
      }
    `);

    documents.normalize({
      document: QUERY,
      variables: { id: "u1" },
      data: {
        user: {
          __typename: "User",
          id: "u1",
          name: "Alice",
          posts: [
            { __typename: "Post", id: "p1", title: "Post 1" },
            { __typename: "Post", id: "p2", title: "Post 2" },
          ],
        },
      },
    });

    // Read fragment
    const result = documents.materialize({
      document: USER_WITH_POSTS_FRAGMENT,
      variables: {},
      rootId: "User:u1",
      canonical: true,
      fingerprint: true,
    });

    expect(result.source).not.toBe("none");
    expect(result.data).toMatchObject({
      __typename: "User",
      id: "u1",
      name: "Alice",
      posts: [
        { __typename: "Post", id: "p1", title: "Post 1" },
        { __typename: "Post", id: "p2", title: "Post 2" },
      ],
    });
  });
});
