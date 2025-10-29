// Test normalize for fragments with rootId
import { describe, it, expect, beforeEach } from "vitest";
import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";

describe("documents.normalize - fragments with rootId", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
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
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, canonical, planner });
  });

  it("normalizes fragment data to entity", () => {
    const USER_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserFields on User {
        id
        email
        name
      }
    `);

    const fragmentData = {
      __typename: "User",
      id: "u1",
      email: "user@example.com",
      name: "Alice",
    };

    // Normalize fragment with entityId
    documents.normalize({
      document: USER_FRAGMENT,
      variables: {},
      data: fragmentData,
      rootId: "User:u1",
    });

    // Entity should be normalized
    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "user@example.com",
      name: "Alice",
    });
  });

  it("normalizes fragment with nested entities", () => {
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

    const fragmentData = {
      __typename: "User",
      id: "u1",
      name: "Alice",
      posts: [
        { __typename: "Post", id: "p1", title: "Post 1" },
        { __typename: "Post", id: "p2", title: "Post 2" },
      ],
    };

    // Normalize fragment
    documents.normalize({
      document: USER_WITH_POSTS_FRAGMENT,
      variables: {},
      data: fragmentData,
      rootId: "User:u1",
    });

    // User entity should be normalized
    expect(graph.getRecord("User:u1")).toMatchObject({
      id: "u1",
      __typename: "User",
      name: "Alice",
    });

    // Post entities should be normalized
    expect(graph.getRecord("Post:p1")).toEqual({
      id: "p1",
      __typename: "Post",
      title: "Post 1",
    });

    expect(graph.getRecord("Post:p2")).toEqual({
      id: "p2",
      __typename: "Post",
      title: "Post 2",
    });
  });

  it("normalizes fragment with custom key field", () => {
    const COMMENT_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment CommentFields on Comment {
        uuid
        text
      }
    `);

    const commentUuid = "550e8400-e29b-41d4-a716-446655440000";
    const fragmentData = {
      __typename: "Comment",
      uuid: commentUuid,
      text: "Great post!",
    };

    // Normalize fragment with custom key
    documents.normalize({
      document: COMMENT_FRAGMENT,
      variables: {},
      data: fragmentData,
      rootId: `Comment:${commentUuid}`,
    });

    // Entity should be normalized with custom key
    expect(graph.getRecord(`Comment:${commentUuid}`)).toEqual({
      uuid: commentUuid,
      __typename: "Comment",
      text: "Great post!",
    });
  });

  it("fragment normalization updates existing entity", () => {
    const USER_FRAGMENT = compilePlan(/* GraphQL */ `
      fragment UserFields on User {
        id
        email
      }
    `);

    // First normalization
    documents.normalize({
      document: USER_FRAGMENT,
      variables: {},
      data: {
        __typename: "User",
        id: "u1",
        email: "old@example.com",
      },
      rootId: "User:u1",
    });

    // Second normalization updates the entity
    documents.normalize({
      document: USER_FRAGMENT,
      variables: {},
      data: {
        __typename: "User",
        id: "u1",
        email: "new@example.com",
      },
      rootId: "User:u1",
    });

    // Entity should have updated data
    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "new@example.com",
    });
  });

  // Note: Fragments should always be normalized with rootId set to the entity ID
  // Normalizing a fragment without rootId is not a valid use case
});
