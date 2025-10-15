// documents.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { writeConnectionPage } from "@/test/helpers";
import { users, posts, comments, tags, medias } from "@/test/helpers/fixtures";
import { USER_QUERY, USERS_QUERY, USER_POSTS_QUERY, USERS_POSTS_QUERY, USERS_POSTS_COMMENTS_QUERY, POSTS_QUERY, POSTS_WITH_AGGREGATIONS_QUERY, POST_COMMENTS_QUERY, USER_POSTS_COMMENTS_QUERY } from "@/test/helpers/operations";

describe("documents.materializeDocument (plain materialization + status)", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        Profile: (p) => p.slug,
        Media: (m) => m.key,
        Stat: (s) => s.key,
        Comment: (c) => c.uuid,
        User: (u) => u.id,
        Post: (p) => p.id,
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });

    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });

    // Root record is always present
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    documents = createDocuments({
      graph,
      planner,
      canonical,
      // no views!
    });
  });

  it("FULFILLED for fully-present entity selection (scalars + link)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query UserById($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `);

    // Simulate a network payload -> normalize into the graph store
    documents.normalizeDocument({
      document: QUERY,
      variables: { id: "u1" },
      data: {
        user: { __typename: "User", id: "u1", email: "u1@example.com" },
      },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } }) as any;
    expect(res.status).toBe("FULFILLED");
    expect(res.data).toEqual({
      user: { __typename: "User", id: "u1", email: "u1@example.com" },
    });
  });

  it("MISSING when a required link target is absent", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query UserById($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `);

    // Only wire the ROOT link but don't create the target record
    graph.putRecord(ROOT_ID, {
      [/* storage key */ 'user({"id":"u2"})']: { __ref: "User:u2" },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: { id: "u2" } }) as any;
    expect(res.status).not.toBe("FULFILLED");
    // You can assert exact string if your impl uses "MISSING" or "MISSED"
    expect(["MISSING", "MISSED"]).toContain(res.status);
    expect(res.data).toBeUndefined();
  });

  it("maps aliases and args to response keys (no proxies)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query MediaView {
        media(key: "m1") {
          key
          dataUrl
          previewUrl: dataUrl(variant: "preview")
        }
      }
    `);

    documents.normalizeDocument({
      document: QUERY,
      variables: {},
      data: {
        media: {
          __typename: "Media",
          key: "m1",
          dataUrl: "raw-1",
          previewUrl: "raw-2", // response alias
        },
      },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: {} }) as any;
    expect(res.status).toBe("FULFILLED");
    expect(res.data).toEqual({
      media: {
        __typename: "Media",
        key: "m1",
        dataUrl: "raw-1",
        previewUrl: "raw-2",
      },
    });
  });

  it("materializes a ROOT connection via canonical key (edges + pageInfo)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query AdminUsers($role: String!, $first: Int, $after: ID) {
        users(role: $role, first: $first, after: $after) {
          edges { cursor node { id email __typename } __typename }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage __typename }
          __typename
        }
      }
    `);

    // Build canonical connection directly (helper writes records correctly)
    const canonicalKey = '@connection.users({"role":"admin"})';
    const data = users.buildConnection(
      [
        { id: "u1", email: "u1@example.com" },
        { id: "u2", email: "u2@example.com" },
      ],
      { startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
    );
    writeConnectionPage(graph, canonicalKey, data);

    const res = documents.materializeDocument({
      document: QUERY,
      variables: { role: "admin", first: 2, after: null },
    }) as any;

    expect(res.status).toBe("FULFILLED");
    expect(res.data.users.pageInfo.startCursor).toBe("u1");
    expect(res.data.users.pageInfo.endCursor).toBe("u2");
    expect(res.data.users.edges).toHaveLength(2);
    expect(res.data.users.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });
  });

  it("materializes a nested connection via canonical key (user.posts)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query UserPosts($id: ID!, $first: Int, $after: ID, $category: String!) {
        user(id: $id) {
          id
          posts(first: $first, after: $after, category: $category) {
            edges { cursor node { id title __typename } __typename }
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage __typename }
            __typename
          }
          __typename
        }
      }
    `);

    // Seed user & canonical posts
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });
    graph.putRecord(ROOT_ID, { ['user({"id":"u1"})']: { __ref: "User:u1" } });

    const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
    const postsData = posts.buildConnection(
      [{ id: "p1", title: "Post 1" }],
      { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
    );
    writeConnectionPage(graph, postsCanonicalKey, postsData);

    const res = documents.materializeDocument({
      document: QUERY,
      variables: { id: "u1", first: 1, after: null, category: "tech" },
    }) as any;

    expect(res.status).toBe("FULFILLED");
    expect(res.data.user.posts.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1" });
  });

  it("LRU-ish cache: returns same object reference for identical reads, invalidates after graph update", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query Q {
        user(id: "u1") { id email __typename }
      }
    `);

    documents.normalizeDocument({
      document: QUERY,
      variables: {},
      data: { user: { __typename: "User", id: "u1", email: "v1@example.com" } },
    });

    const a = documents.materializeDocument({ document: QUERY, variables: {} }) as any;
    const b = documents.materializeDocument({ document: QUERY, variables: {} }) as any;

    expect(a.status).toBe("FULFILLED");
    expect(b.status).toBe("FULFILLED");
    // identity stable if cache hits
    expect(b.data).toBe(a.data);

    // mutate underlying record -> should invalidate cached shape
    graph.putRecord("User:u1", { email: "v2@example.com" });

    const c = documents.materializeDocument({ document: QUERY, variables: {} }) as any;
    expect(c.status).toBe("FULFILLED");
    expect(c.data).not.toBe(a.data);
    expect(c.data).toEqual({ user: { __typename: "User", id: "u1", email: "v2@example.com" } });
  });

  describe("primitives (views)", () => {
    it("reads string scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            data
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: { entity: { __typename: "Entity", id: "e1", data: "string" } },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({ entity: { __typename: "Entity", id: "e1", data: "string" } });
    });

    it("reads number scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            data
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: { entity: { __typename: "Entity", id: "e1", data: 123 } },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({ entity: { __typename: "Entity", id: "e1", data: 123 } });
    });

    it("reads boolean scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            data
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: { entity: { __typename: "Entity", id: "e1", data: true } },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({ entity: { __typename: "Entity", id: "e1", data: true } });
    });

    it("reads null scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            data
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: { entity: { __typename: "Entity", id: "e1", data: null } },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({ entity: { __typename: "Entity", id: "e1", data: null } });
    });

    it("reads JSON scalar (object) inline via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            data
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: { entity: { __typename: "Entity", id: "e1", data: { foo: { bar: "baz" } } } },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({ entity: { __typename: "Entity", id: "e1", data: { foo: { bar: "baz" } } } });
    });
  });

  describe("aliases (views)", () => {
    it("maps alias + args to response keys (previewUrl) from stored field keys", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
            __typename
            id
            dataUrl
            previewUrl: dataUrl(variant: "preview")
          }
        }
      `;
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "e1" },
        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            dataUrl: "1",
            previewUrl: "2",
          },
        },
      });
      const c = documents.materializeDocument({ document: QUERY, variables: { id: "e1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data).toEqual({
        entity: {
          __typename: "Entity",
          id: "e1",
          dataUrl: "1",
          previewUrl: "2",
        },
      });
    });
  });

  describe("entities", () => {
    it("creates reactive entity view", async () => {
      const QUERY = `
        query Query($id: ID!) {
          user(id: $id) {
            __typename
            id
            email
          }
        }
      `;

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: {
            __typename: "User",
            id: "u1",
            email: "u1@example.com",
          },
        },
      });

      const c1 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } }) as any;
      expect(c1.status).toBe("FULFILLED");
      expect(c1.data.user).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });

      // Update the user
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: {
            __typename: "User",
            id: "u1",
            email: "u1+updated@example.com",
          },
        },
      });

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } }) as any;
      expect(c2.status).toBe("FULFILLED");
      expect(c2.data.user).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
      });
    });

    it("follows __ref to child entity", async () => {
      const data1 = {
        user: {
          ...users.buildNode({ id: "u1", email: "u1@example.com" }),

          posts: posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              author: users.buildNode({ id: "u1", email: "u1@example.com" }),
            },

            {
              id: "p2",
              title: "Post 2",
              author: users.buildNode({ id: "u1", email: "u1@example.com" }),
            },
          ]),
        },
      }

      console.log(data1);

      documents.normalizeDocument({
        document: USER_POSTS_QUERY,
        variables: { id: "u1", postsCategory: "tech", postsFirst: 10 },
        data: data1,
      });

      const c1 = documents.materializeDocument({
        document: USER_POSTS_QUERY,
        variables: { id: "u1", postsCategory: "tech", postsFirst: 10 },
      }) as any;

      expect(c1.status).toBe("FULFILLED");
      expect(c1.data.user.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        },
      });

      expect(c1.data.user.posts.edges[1].node).toEqual({
        __typename: "Post",
        id: "p2",
        title: "Post 2",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        },
      });

      // Update the user
      documents.normalizeDocument({
        document: USER_QUERY,
        variables: { id: "u1" },
        data: {
          user: {
            __typename: "User",
            id: "u1",
            email: "u1+updated@example.com",
          },
        },
      });

      const c2 = documents.materializeDocument({
        document: USER_POSTS_QUERY,
        variables: { id: "u1", postsCategory: "tech", postsFirst: 10 },
      }) as any;

      expect(c2.status).toBe("FULFILLED");
      expect(c2.data.user.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        }
      });
      expect(c2.data.user.posts.edges[1].node).toEqual({
        __typename: "Post",
        id: "p2",
        title: "Post 2",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        }
      });
    });

    it("maintains entity view identity through deeply nested inline objects", async () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            __typename
            id
            title
            nested1 {
              nested2 {
                nested3 {
                  author {
                    __typename
                    id
                    email
                  }
                }
              }
            }
          }
        }
      `;

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            title: "Post 1",
            nested1: {
              nested2: {
                nested3: {
                  author: {
                    __typename: "User",
                    id: "u1",
                    email: "u1@example.com",
                  },
                },
              },
            },
          },
        },
      });

      const c1 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c1.status).toBe("FULFILLED");
      expect(c1.data.post.nested1.nested2.nested3.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });

      // Update the user
      documents.normalizeDocument({
        document: USER_QUERY,
        variables: { id: "u1" },
        data: {
          user: {
            __typename: "User",
            id: "u1",
            email: "u1+updated@example.com",
          },
        },
      });

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c2.status).toBe("FULFILLED");
      expect(c2.data.post.nested1.nested2.nested3.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
      });
    });

    it.only("handles arrays", () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            __typename
            id
            title
            tags {
              __typename
              id
              name
            }
          }
        }
      `;

      const data1 = {
        post: {
          __typename: "Post",
          id: "p1",
          title: "Post 1",
          tags: [
            tags.buildNode({ id: "t1", name: "Tag 1" }),
            tags.buildNode({ id: "t2", name: "Tag 2" }),
          ],
        },
      };

      console.log(JSON.stringify(data1, null, 2));

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: data1,
      });

      const c = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data.post.tags).toHaveLength(2);
      expect(c.data.post.tags[0]).toEqual({
        __typename: "Tag",
        id: "t1",
        name: "Tag 1",
      });
      expect(c.data.post.tags[1]).toEqual({
        __typename: "Tag",
        id: "t2",
        name: "Tag 2",
      });
    });

    it("returns null when field is explicitly null", () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            __typename
            id
            author {
              __typename
              id
              email
            }
          }
        }
      `;

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            author: null,
          },
        },
      });

      const c = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c.status).toBe("FULFILLED");
      expect(c.data.post.author).toBeNull();
    });

    it("hydrates in place when record appears after initial null", async () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            __typename
            id
            author {
              __typename
              id
              email
            }
          }
        }
      `;

      // First normalize with missing author
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            author: null,
          },
        },
      });

      const c1 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c1.status).toBe("FULFILLED");
      expect(c1.data.post.author).toBeNull();

      // Now normalize with author present
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            author: user({ id: "u1", email: "u1@example.com" }),
          },
        },
      });

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c2.status).toBe("FULFILLED");
      expect(c2.data.post.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });
    });

    it("returns consistent data for same query and variables", () => {
      documents.normalizeDocument({
        document: USER_QUERY,
        variables: { id: "u1" },
        data: {
          user: user({ id: "u1", email: "u1@example.com" }),
        },
      });

      const c1 = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } }) as any;
      const c2 = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } }) as any;

      expect(c1.status).toBe("FULFILLED");
      expect(c2.status).toBe("FULFILLED");
      expect(c1.data).toEqual(c2.data);
    });

    it("is read-only", () => {
      documents.normalizeDocument({
        document: USER_QUERY,
        variables: { id: "u1" },
        data: {
          user: user({ id: "u1", email: "u1@example.com" }),
        },
      });

      const c = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } }) as any;
      expect(c.status).toBe("FULFILLED");

      const userView = c.data.user;
      expect(Reflect.set(userView, "email", "hacker@example.com")).toBe(false);
      expect(userView.email).toBe("u1@example.com");
    });
  });
});
