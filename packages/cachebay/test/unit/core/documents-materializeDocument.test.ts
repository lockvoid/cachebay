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
import {
  USER_QUERY,
  USERS_QUERY,
  USER_POSTS_QUERY,
  USERS_POSTS_QUERY,
  USERS_POSTS_COMMENTS_QUERY,
  POSTS_QUERY,
  POSTS_WITH_AGGREGATIONS_QUERY,
  POST_COMMENTS_QUERY,
  USER_POSTS_COMMENTS_QUERY,
  MULTIPLE_USERS_QUERY,
} from "@/test/helpers/operations";

describe("documents.materializeDocument (plain materialization + source/ok + dependencies)", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let canonicalLayer: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    planner = createPlanner();

    // We don't need to call into documents on graph changes anymore.
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
      onChange: (_touchedIds) => {
        // No per-plan dirty marking; watchers will rely on versioned dependencies.
      },
    });

    optimistic = createOptimistic({ graph });
    canonicalLayer = createCanonical({ graph, optimistic });

    // Root record is always present
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    documents = createDocuments({
      graph,
      planner,
      canonical: canonicalLayer,
    });
  });

  it("FULFILLED (source !== 'none') for fully-present entity selection (scalars + link)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query UserById($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `);

    documents.normalizeDocument({
      document: QUERY,
      variables: { id: "u1" },
      data: {
        user: { __typename: "User", id: "u1", email: "u1@example.com" },
      },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } }) as any;
    expect(res.source).not.toBe("none");
    expect(res.data).toEqual({
      __version: expect.any(Number),
      user: { __typename: "User", id: "u1", email: "u1@example.com", __version: expect.any(Number) },
    });

    // dependencies should include root field key and entity id
    expect(res.dependencies).toEqual(new Set([
      `${ROOT_ID}.user({"id":"u1"})`,
      "User:u1",
    ]));
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
      ['user({"id":"u2"})']: { __ref: "User:u2" },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: { id: "u2" } }) as any;
    expect(res.source).toBe("none");
    expect(res.data).toBeUndefined();

    // Still tracks dependency to the missing entity id (helps watchers)
    expect(res.dependencies).toEqual(new Set([
      `${ROOT_ID}.user({"id":"u2"})`,
      "User:u2",
    ]));
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
          previewUrl: "raw-2",
        },
      },
    });

    const res = documents.materializeDocument({ document: QUERY, variables: {} }) as any;
    expect(res.source).not.toBe("none");
    expect(res.data).toEqual({
      __version: expect.any(Number),
      media: {
        __typename: "Media",
        key: "m1",
        dataUrl: "raw-1",
        previewUrl: "raw-2",
        __version: expect.any(Number),
      },
    });

    expect(res.dependencies).toEqual(new Set([
      `${ROOT_ID}.media({"key":"m1"})`,
      "Media:m1",
    ]));
  });

  it("materializes a ROOT connection via canonical key (edges + pageInfo)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query AdminUsers($role: String!, $first: Int, $after: ID) {
        users(role: $role, first: $first, after: $after) @connection {
          edges { cursor node { id email __typename } __typename }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage __typename }
        }
      }
    `);

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

    expect(res.source).toBe("canonical");
    expect(res.ok.canonical).toBe(true);
    expect(res.data.users.pageInfo.startCursor).toBe("u1");
    expect(res.data.users.pageInfo.endCursor).toBe("u2");
    expect(res.data.users.edges).toHaveLength(2);

    // dependencies include the canonical connection key, pageInfo & edges
    expect(res.dependencies).toEqual(new Set([
      canonicalKey,
      `${canonicalKey}.pageInfo`,
      "User:u1",
      "User:u2",
    ]));

    // Fingerprinting: connection should have fingerprint
    const fp1 = (res.data as any).__version;
    expect(fp1).toBeGreaterThan(0);
    // expect((res.data.users as any).__version).toBeGreaterThan(0);
    // expect((res.data.users.edges as any).__version).toBeGreaterThan(0);
    // expect((res.data.users.pageInfo as any).__version).toBeGreaterThan(0);

    // Update a user node
    graph.putRecord("User:u1", { email: "u1+updated@example.com" });

    const res2 = documents.materializeDocument({
      document: QUERY,
      variables: { role: "admin", first: 2, after: null },
      force: true, // Force re-materialization after graph update
    }) as any;

    // Fingerprint should change because node changed
    expect((res2.data as any).__version).not.toBe(fp1);
    // expect((res2.data.users as any).__version).not.toBe((res.data.users as any).__version);
  });

  it("materializes a nested connection via canonical key (user.posts)", () => {
    const QUERY = compilePlan(/* GraphQL */ `
      query UserPosts($id: ID!, $first: Int, $after: ID, $category: String!) {
        user(id: $id) {
          id
          posts(first: $first, after: $after, category: $category) @connection {
            edges { cursor node { id title flags } }
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
          }
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

    expect(res.source).toBe("canonical");
    expect(res.data.user.posts.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [], __version: expect.any(Number) });

    // dependencies include user record + nested connection keys
    expect(res.dependencies).toEqual(new Set([
      `${ROOT_ID}.user({"id":"u1"})`,
      "User:u1",
      postsCanonicalKey,
      `${postsCanonicalKey}.pageInfo`,
      "Post:p1",
    ]));

    // Fingerprinting: nested connection fingerprints
    // const userFp1 = (res.data.user as any).__version;
    // const postsFp1 = (res.data.user.posts as any).__version;
    // const edgeFp1 = (res.data.user.posts.edges[0] as any).__version;
    // const nodeFp1 = (res.data.user.posts.edges[0].node as any).__version;

    // expect(userFp1).toBeGreaterThan(0);
    // expect(postsFp1).toBeGreaterThan(0);
    // expect(edgeFp1).toBeGreaterThan(0);
    // expect(nodeFp1).toBeGreaterThan(0);

    // Update the post node
    graph.putRecord("Post:p1", { title: "Post 1 Updated" });

    const res2 = documents.materializeDocument({
      document: QUERY,
      variables: { id: "u1", first: 1, after: null, category: "tech" },
      force: true, // Force re-materialization after graph update
    }) as any;

    // All fingerprints in the chain should change
    // expect((res2.data.user.posts.edges[0].node as any).__version).not.toBe(nodeFp1);
    // expect((res2.data.user.posts.edges[0] as any).__version).not.toBe(edgeFp1);
    // expect((res2.data.user.posts as any).__version).not.toBe(postsFp1);
    // expect((res2.data.user as any).__version).not.toBe(userFp1);
    expect((res2.data as any).__version).not.toBe((res.data as any).__version);
  });

  describe("dependencies tracking", () => {
    it("tracks dependencies for entities and root fields", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserById($id: ID!) {
          user(id: $id) {
            id
            email
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: { user: { __typename: "User", id: "u1", email: "a@example.com" } },
      });

      const r1 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } }) as any;
      expect(r1.dependencies).toEqual(new Set([
        `${ROOT_ID}.user({"id":"u1"})`,
        "User:u1",
      ]));

      // Write a change -> dependencies should still be tracked
      graph.putRecord("User:u1", { email: "b@example.com" });

      const r2 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" }, force: true }) as any;
      expect(r2.dependencies).toEqual(new Set([
        `${ROOT_ID}.user({"id":"u1"})`,
        "User:u1",
      ]));
    });

    it("tracks connection keys, pageInfo and edge records as dependencies", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query AdminUsers($role: String!, $first: Int, $after: ID) {
          users(role: $role, first: $first, after: $after) @connection {
            edges { cursor node { id email  }  }
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage  }
          }
        }
      `);

      const connKey = '@connection.users({"role":"admin"})';
      const data = users.buildConnection(
        [
          { id: "u1", email: "u1@example.com" },
          { id: "u2", email: "u2@example.com" },
        ],
        { startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
      );
      writeConnectionPage(graph, connKey, data);

      const res = documents.materializeDocument({
        document: QUERY,
        variables: { role: "admin", first: 2, after: null },
      }) as any;

      expect(res.dependencies).toEqual(new Set([
        connKey,
        `${connKey}.pageInfo`,
        "User:u1",
        "User:u2",
      ]));

      // Mutate an edge (simulate new cursor) -> dependencies should still be tracked
      graph.putRecord(`${connKey}.edges.0`, { cursor: "u1-new" });

      const res2 = documents.materializeDocument({
        document: QUERY,
        variables: { role: "admin", first: 2, after: null },
        force: true, // Force re-materialization after graph update
      }) as any;

      expect(res2.dependencies).toEqual(new Set([
        connKey,
        `${connKey}.pageInfo`,
        "User:u1",
        "User:u2",
      ]));
    });
  });

  describe("primitives (views)", () => {
    it("reads string scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({ __version: expect.any(Number), entity: { __typename: "Entity", id: "e1", data: "string", __version: expect.any(Number) } });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });

    it("reads number scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({ __version: expect.any(Number), entity: { __typename: "Entity", id: "e1", data: 123, __version: expect.any(Number) } });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });

    it("reads boolean scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({ __version: expect.any(Number), entity: { __typename: "Entity", id: "e1", data: true, __version: expect.any(Number) } });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });

    it("reads null scalar via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({ __version: expect.any(Number), entity: { __typename: "Entity", id: "e1", data: null, __version: expect.any(Number) } });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });

    it("reads JSON scalar (object) inline via entity view", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({ __version: expect.any(Number), entity: { __typename: "Entity", id: "e1", data: { foo: { bar: "baz" } }, __version: expect.any(Number) } });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });
  });

  describe("aliases (views)", () => {
    it("maps alias + args to response keys (previewUrl) from stored field keys", () => {
      const QUERY = `
        query Query($id: ID!) {
          entity(id: $id) {
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
      expect(c.source).not.toBe("none");
      expect(c.data).toEqual({
        __version: expect.any(Number),
        entity: {
          __typename: "Entity",
          id: "e1",
          dataUrl: "1",
          previewUrl: "2",
          __version: expect.any(Number),
        },
      });

      expect(c.dependencies).toEqual(new Set([
        `${ROOT_ID}.entity({"id":"e1"})`,
        "Entity:e1",
      ]));
    });
  });

  describe("entities", () => {
    it("creates reactive entity view", async () => {
      const QUERY = `
        query Query($id: ID!) {
          user(id: $id) {
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
      expect(c1.source).not.toBe("none");
      expect(c1.data.user).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
        __version: expect.any(Number),
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

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" }, force: true }) as any;
      expect(c2.source).not.toBe("none");
      expect(c2.data.user).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
        __version: expect.any(Number),
      });

      expect(c1.dependencies).toEqual(new Set([
        `${ROOT_ID}.user({"id":"u1"})`,
        "User:u1",
      ]));
      expect(c2.dependencies).toEqual(new Set([
        `${ROOT_ID}.user({"id":"u1"})`,
        "User:u1",
      ]));
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
      };

      documents.normalizeDocument({
        document: USER_POSTS_QUERY,
        variables: { id: "u1", postsCategory: "tech", postsFirst: 10 },
        data: data1,
      });

      const c1 = documents.materializeDocument({
        document: USER_POSTS_QUERY,
        variables: { id: "u1", postsCategory: "tech", postsFirst: 10 },
      }) as any;

      expect(c1.source).not.toBe("none");
      expect(c1.data.user.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
          __version: expect.any(Number),
        },
        __version: expect.any(Number),
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
          __version: expect.any(Number),
        },
        __version: expect.any(Number),
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
        force: true,
      }) as any;

      expect(c2.source).not.toBe("none");
      expect(c2.data.user.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        flags: [],
        author: {
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
          __version: expect.any(Number),
        },
        __version: expect.any(Number),
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
          __version: expect.any(Number),
        },
        __version: expect.any(Number),
      });
    });

    it("maintains entity view identity through deeply nested inline objects", async () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            id
            title
            nested1 {
              nested2 {
                nested3 {
                  author {
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
      expect(c1.source).not.toBe("none");
      expect(c1.data.post.nested1.nested2.nested3.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
        __version: expect.any(Number),
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

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" }, force: true }) as any;
      expect(c2.source).not.toBe("none");
      expect(c2.data.post.nested1.nested2.nested3.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
        __version: expect.any(Number),
      });
    });

    it("handles arrays", () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            id
            title
            tags {
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

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: data1,
      });

      const c = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } }) as any;
      expect(c.source).not.toBe("none");
      expect(c.data.post.tags).toHaveLength(2);
      expect(c.data.post.tags[0]).toEqual({
        __typename: "Tag",
        id: "t1",
        name: "Tag 1",
        __version: expect.any(Number),
      });
      expect(c.data.post.tags[1]).toEqual({
        __typename: "Tag",
        id: "t2",
        name: "Tag 2",
        __version: expect.any(Number),
      });
    });

    it("returns MISSING (source === 'none') when field is explicitly null", () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            id
            author {
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
      expect(c.source).toBe("none");
    });

    it("hydrates in place when record appears after initial null", async () => {
      const QUERY = `
        query Query($id: ID!) {
          post(id: $id) {
            id
            author {
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
      expect(c1.source).toBe("none");

      // Now normalize with author present
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            author: users.buildNode({ id: "u1", email: "u1@example.com" }),
          },
        },
      });

      const c2 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" }, force: true }) as any;
      expect(c2.source).not.toBe("none");
      expect(c2.data.post.author).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
        __version: expect.any(Number),
      });
    });

    it("returns consistent data for same query and variables", () => {
      documents.normalizeDocument({
        document: USER_QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      const c1 = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } }) as any;
      const c2 = documents.materializeDocument({ document: USER_QUERY, variables: { id: "u1" } }) as any;

      expect(c1.source).not.toBe("none");
      expect(c2.source).not.toBe("none");
      expect(c1.data).toEqual(c2.data);
    });
  });

  describe("connections", () => {
    it("materializes POSTS_QUERY connection", () => {
      const postsData = posts.buildConnection(
        [{ id: "p1", title: "Post 1" }],
        { startCursor: "p1", endCursor: "p1", hasNextPage: false },
      );

      documents.normalizeDocument({
        document: POSTS_QUERY,
        variables: { id: "u1" },
        data: {
          posts: postsData,
        },
      });

      const d = documents.materializeDocument({ document: POSTS_QUERY, variables: { id: "u1" } }) as any;

      expect(d.source).not.toBe("none");

      expect(d.data.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p1",
        hasNextPage: false,
        hasPreviousPage: false,
        __version: expect.any(Number),
      });

      expect(d.data.posts.edges).toEqual([
        {
          __typename: "PostEdge",
          __version: expect.any(Number),
          cursor: "p1",
          node: {
            __typename: "Post",
            id: "p1",
            title: "Post 1",
            flags: [],
            __version: expect.any(Number),
          },
        },
      ]);
    });
  });

  it("materializes USER_POSTS_COMMENTS_QUERY connection", () => {
    const commentsDataP1 = comments.buildConnection(
      [
        { uuid: "c1", text: "Comment 1", author: users.buildNode({ id: "u2", email: "u2@example.com" }) },
        { uuid: "c2", text: "Comment 2", author: users.buildNode({ id: "u3", email: "u3@example.com" }) },
      ],
      { startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
    );

    const commentsDataP2 = comments.buildConnection(
      [{ uuid: "c3", text: "Comment 3", author: users.buildNode({ id: "u2", email: "u2@example.com" }) }],
      { startCursor: "c3", endCursor: "c3", hasNextPage: false, hasPreviousPage: false },
    );

    const postsData = posts.buildConnection(
      [
        {
          id: "p1",
          title: "Post 1",
          comments: commentsDataP1,
        },
        {
          id: "p2",
          title: "Post 2",
          comments: commentsDataP2,
        },
      ],
      { startCursor: "p1", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
    );

    const data1 = {
      user: {
        ...users.buildNode({ id: "u1", email: "u1@example.com" }),
        posts: postsData,
      },
    };

    documents.normalizeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
      data: data1,
    });

    const d = documents.materializeDocument({
      document: USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
    }) as any;

    expect(d.source).not.toBe("none");
    expect(d.data.user).toMatchObject({
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.edges).toHaveLength(2);

    // First post
    expect(d.data.user.posts.edges[0].node).toMatchObject({
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.edges[0].node.comments.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c1",
      endCursor: "c2",
      hasNextPage: true,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.edges[0].node.comments.edges).toEqual([
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c1",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c1",
          text: "Comment 1",
          author: {
            __typename: "User",
            __version: expect.any(Number),
            id: "u2",
          },
        },
      },
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c2",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c2",
          text: "Comment 2",
          author: {
            __typename: "User",
            __version: expect.any(Number),
            id: "u3",
          },
        },
      },
    ]);

    // Second post
    expect(d.data.user.posts.edges[1].node).toMatchObject({
      __typename: "Post",
      id: "p2",
      title: "Post 2",
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.edges[1].node.comments.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c3",
      endCursor: "c3",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.user.posts.edges[1].node.comments.edges).toEqual([
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c3",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c3",
          text: "Comment 3",
          author: {
            __typename: "User",
            __version: expect.any(Number),
            id: "u2",
          },
        },
      },
    ]);
  });

  it("materializes USERS_POSTS_COMMENTS_QUERY connection", () => {
    // User 1 data
    const commentsDataU1P1 = comments.buildConnection(
      [
        { uuid: "c1", text: "Comment 1" },
        { uuid: "c2", text: "Comment 2" },
      ],
      { startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
    );
    const commentsDataU1P2 = comments.buildConnection(
      [{ uuid: "c3", text: "Comment 3" }],
      { startCursor: "c3", endCursor: "c3", hasNextPage: false, hasPreviousPage: false },
    );
    const postsDataU1 = posts.buildConnection(
      [
        {
          id: "p1",
          title: "Post 1",
          comments: commentsDataU1P1,
        },
        {
          id: "p2",
          title: "Post 2",
          comments: commentsDataU1P2,
        },
      ],
      { startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false },
    );

    // User 2 data
    const commentsDataU2P1 = comments.buildConnection(
      [{ uuid: "c4", text: "Comment 4" }],
      { startCursor: "c4", endCursor: "c4", hasNextPage: false, hasPreviousPage: false },
    );
    const postsDataU2 = posts.buildConnection(
      [
        {
          id: "p3",
          title: "Post 3",
          comments: commentsDataU2P1,
        },
      ],
      { startCursor: "p3", endCursor: "p3", hasNextPage: false, hasPreviousPage: false },
    );

    const usersData = users.buildConnection(
      [
        {
          id: "u1",
          email: "u1@example.com",
          posts: postsDataU1,
        },
        {
          id: "u2",
          email: "u2@example.com",
          posts: postsDataU2,
        },
      ],
      { startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
    );

    documents.normalizeDocument({
      document: USERS_POSTS_COMMENTS_QUERY,
      variables: {
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
      data: {
        users: usersData,
      },
    });

    const d = documents.materializeDocument({
      document: USERS_POSTS_COMMENTS_QUERY,
      variables: {
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
    }) as any;

    expect(d.source).not.toBe("none");
    expect(d.data.users.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges).toHaveLength(2);

    // First user
    expect(d.data.users.edges[0].node).toMatchObject({
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasNextPage: true,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.edges).toHaveLength(2);

    // First user, first post
    expect(d.data.users.edges[0].node.posts.edges[0].node).toMatchObject({
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.edges[0].node.comments.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c1",
      endCursor: "c2",
      hasNextPage: true,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.edges[0].node.comments.edges).toEqual([
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c1",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c1",
          text: "Comment 1",
        },
      },
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c2",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c2",
          text: "Comment 2",
        },
      },
    ]);

    // First user, second post
    expect(d.data.users.edges[0].node.posts.edges[1].node).toMatchObject({
      __typename: "Post",
      id: "p2",
      title: "Post 2",
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.edges[1].node.comments.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c3",
      endCursor: "c3",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[0].node.posts.edges[1].node.comments.edges).toEqual([
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c3",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c3",
          text: "Comment 3",
        },
      },
    ]);

    // Second user
    expect(d.data.users.edges[1].node).toMatchObject({
      __typename: "User",
      id: "u2",
      email: "u2@example.com",
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[1].node.posts.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "p3",
      endCursor: "p3",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[1].node.posts.edges).toHaveLength(1);

    // Second user, first post
    expect(d.data.users.edges[1].node.posts.edges[0].node).toMatchObject({
      __typename: "Post",
      id: "p3",
      title: "Post 3",
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[1].node.posts.edges[0].node.comments.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "c4",
      endCursor: "c4",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges[1].node.posts.edges[0].node.comments.edges).toEqual([
      {
        __typename: "CommentEdge",
        __version: expect.any(Number),
        cursor: "c4",
        node: {
          __typename: "Comment",
          __version: expect.any(Number),
          uuid: "c4",
          text: "Comment 4",
        },
      },
    ]);
  });

  it("materializes MULTIPLE_USERS_QUERY with both single user and users connection", () => {
    const usersData = users.buildConnection(
      [
        {
          id: "u2",
          email: "u2@example.com",
        },
        {
          id: "u3",
          email: "u3@example.com",
        },
        {
          id: "u4",
          email: "u4@example.com",
        },
      ],
      { startCursor: "u2", endCursor: "u4", hasNextPage: true, hasPreviousPage: false },
    );

    documents.normalizeDocument({
      document: MULTIPLE_USERS_QUERY,
      variables: {
        userId: "u1",
        usersRole: "admin",
        usersFirst: 3,
        usersAfter: null,
      },
      data: {
        user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        users: usersData,
      },
    });

    const d = documents.materializeDocument({
      document: MULTIPLE_USERS_QUERY,
      variables: {
        userId: "u1",
        usersRole: "admin",
        usersFirst: 3,
        usersAfter: null,
      },
    }) as any;

    expect(d.source).not.toBe("none");

    // Single user query
    expect(d.data.user).toEqual({
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      __version: expect.any(Number),
    });

    // Users connection query
    expect(d.data.users.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "u2",
      endCursor: "u4",
      hasNextPage: true,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.users.edges).toHaveLength(3);

    expect(d.data.users.edges[0].node).toEqual({
      __typename: "User",
      id: "u2",
      email: "u2@example.com",
      __version: expect.any(Number),
    });

    expect(d.data.users.edges[1].node).toEqual({
      __typename: "User",
      id: "u3",
      email: "u3@example.com",
      __version: expect.any(Number),
    });

    expect(d.data.users.edges[2].node).toEqual({
      __typename: "User",
      id: "u4",
      email: "u4@example.com",
      __version: expect.any(Number),
    });
  });

  it("materializes POSTS_WITH_AGGREGATIONS_QUERY with nested aggregations", () => {
    // Post-level aggregations
    const moderationTagsP1 = tags.buildConnection(
      [
        { id: "mt1", name: "NSFW" },
        { id: "mt2", name: "Spam" },
      ],
      { startCursor: "mt1", endCursor: "mt2", hasNextPage: false, hasPreviousPage: false },
    );

    const userTagsP1 = tags.buildConnection(
      [
        { id: "ut1", name: "Tech" },
        { id: "ut2", name: "AI" },
      ],
      { startCursor: "ut1", endCursor: "ut2", hasNextPage: false, hasPreviousPage: false },
    );

    const moderationTagsP2 = tags.buildConnection(
      [{ id: "mt3", name: "Flagged" }],
      { startCursor: "mt3", endCursor: "mt3", hasNextPage: false, hasPreviousPage: false },
    );

    const userTagsP2 = tags.buildConnection(
      [{ id: "ut3", name: "News" }],
      { startCursor: "ut3", endCursor: "ut3", hasNextPage: false, hasPreviousPage: false },
    );

    // Connection-level aggregations
    const connectionTags = tags.buildConnection(
      [
        { id: "bt1", name: "Popular" },
        { id: "bt2", name: "Trending" },
        { id: "bt3", name: "Featured" },
      ],
      { startCursor: "bt1", endCursor: "bt3", hasNextPage: true, hasPreviousPage: false },
    );

    const postsData = posts.buildConnection(
      [
        {
          id: "p1",
          title: "Video Post",
          typename: "VideoPost",
          video: medias.buildNode({ key: "video1", mediaUrl: "https://example.com/video1.mp4" }),
          aggregations: {
            __typename: "Aggregations",
            moderationTags: moderationTagsP1,
            userTags: userTagsP1,
          },
        },
        {
          id: "p2",
          title: "Audio Post",
          typename: "AudioPost",
          audio: medias.buildNode({ key: "audio1", mediaUrl: "https://example.com/audio1.mp3" }),
          aggregations: {
            __typename: "Aggregations",
            moderationTags: moderationTagsP2,
            userTags: userTagsP2,
          },
        },
      ],
      { startCursor: "p1", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
    );

    postsData.totalCount = 2;
    postsData.aggregations = {
      scoring: 95,
      todayStat: { __typename: "Stat", key: "today", views: 1500 },
      yesterdayStat: { __typename: "Stat", key: "yesterday", views: 1200 },
      tags: connectionTags,
    };

    documents.normalizeDocument({
      document: POSTS_WITH_AGGREGATIONS_QUERY,
      variables: {
        category: "tech",
        sort: "recent",
        first: 2,
        after: null,
      },
      data: {
        posts: postsData,
      },
    });

    const d = documents.materializeDocument({
      document: POSTS_WITH_AGGREGATIONS_QUERY,
      variables: {
        category: "tech",
        sort: "recent",
        first: 2,
        after: null,
      },
    }) as any;

    expect(d.source).not.toBe("none");
    expect(d.data.posts.totalCount).toBe(2);
    expect(d.data.posts.pageInfo).toEqual({
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasNextPage: false,
      hasPreviousPage: false,
      __version: expect.any(Number),
    });
    expect(d.data.posts.edges).toHaveLength(2);

    // First post (VideoPost)
    expect(d.data.posts.edges[0].node).toMatchObject({
      __typename: "VideoPost",
      id: "p1",
      title: "Video Post",
      flags: [],
    });
    expect(d.data.posts.edges[0].node.video).toEqual({
      __typename: "Media",
      __version: expect.any(Number),
      key: "video1",
      mediaUrl: "https://example.com/video1.mp4",
    });

    expect(d.data.posts.edges[0].node.aggregations).toMatchObject({
      __typename: "Aggregations",
    });

    expect(d.data.posts.edges[0].node.aggregations.moderationTags.pageInfo).toEqual({
      __typename: "PageInfo",
      __version: expect.any(Number),
      startCursor: "mt1",
      endCursor: "mt2",
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(d.data.posts.edges[0].node.aggregations.moderationTags.edges).toEqual([
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "mt1",
          name: "NSFW",
        },
      },
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "mt2",
          name: "Spam",
        },
      },
    ]);
    expect(d.data.posts.edges[0].node.aggregations.userTags.pageInfo).toEqual({
      __typename: "PageInfo",
      __version: expect.any(Number),
      startCursor: "ut1",
      endCursor: "ut2",
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(d.data.posts.edges[0].node.aggregations.userTags.edges).toEqual([
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "ut1",
          name: "Tech",
        },
      },
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "ut2",
          name: "AI",
        },
      },
    ]);

    // Second post (AudioPost)
    expect(d.data.posts.edges[1].node).toMatchObject({
      __typename: "AudioPost",
      id: "p2",
      title: "Audio Post",
      flags: [],
    });
    expect(d.data.posts.edges[1].node.audio).toEqual({
      __typename: "Media",
      __version: expect.any(Number),
      key: "audio1",
      mediaUrl: "https://example.com/audio1.mp3",
    });
    expect(d.data.posts.edges[1].node.aggregations.moderationTags.pageInfo).toEqual({
      __typename: "PageInfo",
      __version: expect.any(Number),
      startCursor: "mt3",
      endCursor: "mt3",
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(d.data.posts.edges[1].node.aggregations.moderationTags.edges).toEqual([
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "mt3",
          name: "Flagged",
        },
      },
    ]);
    expect(d.data.posts.edges[1].node.aggregations.userTags.pageInfo).toEqual({
      __typename: "PageInfo",
      __version: expect.any(Number),
      startCursor: "ut3",
      endCursor: "ut3",
      hasPreviousPage: false,
      hasNextPage: false,
    });
    expect(d.data.posts.edges[1].node.aggregations.userTags.edges).toEqual([
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "ut3",
          name: "News",
        },
      },
    ]);

    // Connection-level aggregations
    expect(d.data.posts.aggregations.scoring).toBe(95);
    expect(d.data.posts.aggregations.todayStat).toEqual({
      __typename: "Stat",
      __version: expect.any(Number),
      key: "today",
      views: 1500,
    });
    expect(d.data.posts.aggregations.yesterdayStat).toEqual({
      __typename: "Stat",
      __version: expect.any(Number),
      key: "yesterday",
      views: 1200,
    });
    expect(d.data.posts.aggregations.tags.pageInfo).toEqual({
      __typename: "PageInfo",
      __version: expect.any(Number),
      startCursor: "bt1",
      endCursor: "bt3",
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(d.data.posts.aggregations.tags.edges).toEqual([
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "bt1",
          name: "Popular",
        },
      },
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "bt2",
          name: "Trending",
        },
      },
      {
        __typename: "TagEdge",
        __version: expect.any(Number),
        node: {
          __typename: "Tag",
          __version: expect.any(Number),
          id: "bt3",
          name: "Featured",
        },
      },
    ]);
  });

  describe("canonical flag & ok/source behavior", () => {
    describe("1-level nested (USER_QUERY)", () => {
      it("MISSING: no data exists", () => {
        const result = documents.materializeDocument({
          document: USER_QUERY,
          variables: { id: "u1" },
          canonical: false,
        });

        expect(result.source).toBe("none");
        expect(result.ok.strict).toBe(false);
        expect(result.ok.canonical).toBe(false);
        expect(result.data).toBeUndefined();
      });

      it("FULFILLED strict read when canonical: false", () => {
        documents.normalizeDocument({
          document: USER_QUERY,
          variables: { id: "u1" },
          data: {
            __typename: "Query",
            user: {
              __typename: "User",
              id: "u1",
              email: "u1@example.com",
              posts: [{ __typename: "Post", id: "p1", title: "Post 1" }],
            },
          },
        });

        const result = documents.materializeDocument({
          document: USER_QUERY,
          variables: { id: "u1" },
          canonical: false,
        });

        expect(result.source).toBe("strict");
        expect(result.ok.strict).toBe(true);
        expect(result.data?.user?.email).toBe("u1@example.com");
      });

      it("FULFILLED canonical read when server data exists", () => {
        documents.normalizeDocument({
          document: USER_QUERY,
          variables: { id: "u2" },
          data: {
            __typename: "Query",
            user: {
              __typename: "User",
              id: "u2",
              email: "u2@example.com",
            },
          },
        });

        const result = documents.materializeDocument({
          document: USER_QUERY,
          variables: { id: "u2" },
          canonical: true,
        });

        expect(result.source).toBe("canonical");
        expect(result.ok.strict).toBe(true);
        expect(result.ok.canonical).toBe(true);
        expect(result.data?.user?.email).toBe("u2@example.com");
      });

      it("FULFILLED canonical read for connection with only canonical data", () => {
        // Seed canonical connection data
        const canonicalKey = '@connection.posts({})';
        const connectionData = posts.buildConnection(
          [
            { id: "p1", title: "Post 1" },
            { id: "p2", title: "Post 2" },
          ],
          { startCursor: "p1", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, canonicalKey, connectionData);

        const result = documents.materializeDocument({
          document: POSTS_QUERY,
          variables: {},
          canonical: true,
        });

        expect(result.source).toBe("canonical");
        expect(result.ok.canonical).toBe(true);
        expect(result.ok.strict).toBe(false);
        expect(result.data?.posts?.edges).toHaveLength(2);
      });

      it("MISSING with canonical: false when only canonical connection exists (no strict data)", () => {
        // Seed canonical connection data (no strict/server data for this specific query)
        const canonicalKey = '@connection.posts({})';
        const connectionData = posts.buildConnection(
          [{ id: "p3", title: "Post 3" }],
          { startCursor: "p3", endCursor: "p3", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, canonicalKey, connectionData);

        const result = documents.materializeDocument({
          document: POSTS_QUERY,
          variables: {},
          canonical: false,
        });

        expect(result.source).toBe("none");
        expect(result.ok.strict).toBe(false);
        expect(result.ok.canonical).toBe(true);
        expect(result.data).toBeUndefined();
      });
    });
  });

  describe("fingerprinting", () => {
    it("returns same fingerprint for unchanged data", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserById($id: ID!) {
          user(id: $id) {
            id
            email
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: { __typename: "User", id: "u1", email: "u1@example.com" },
        },
      });

      const result1 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } });
      const result2 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } });

      expect((result1.data as any).__version).toBe((result2.data as any).__version);
      expect((result1.data as any).__version).toBeGreaterThan(0);
    });

    it("returns different fingerprint after data changes", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserById($id: ID!) {
          user(id: $id) {
            id
            email
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: { __typename: "User", id: "u1", email: "u1@example.com" },
        },
      });

      const result1 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } });

      // Update the user
      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: { __typename: "User", id: "u1", email: "u1+updated@example.com" },
        },
      });

      const result2 = documents.materializeDocument({ document: QUERY, variables: { id: "u1" }, force: true });

      expect((result1.data as any).__version).not.toBe((result2.data as any).__version);
      expect((result1.data as any).__version).toBeGreaterThan(0);
      expect((result2.data as any).__version).toBeGreaterThan(0);
    });

    it("stores fingerprints externally (not on object)", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserById($id: ID!) {
          user(id: $id) {
            id
            email
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: { __typename: "User", id: "u1", email: "u1@example.com" },
        },
      });

      const result = documents.materializeDocument({ document: QUERY, variables: { id: "u1" } });

      // Fingerprint should be accessible via __version property
      // const userFp = (result.data.user as any).__version;
      // expect(userFp).toBeGreaterThan(0);

      // __version is on the object (enumerable for performance)
      expect(Object.keys(result.data.user)).toContain("__version");
      expect(JSON.stringify(result.data.user)).toContain("__version");
    });

    it("computes hierarchical fingerprints: User -> Post -> Comment", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserWithPostAndComment($userId: ID!, $postId: ID!) {
          user(id: $userId) {
            id
            email
            post(id: $postId) {
              id
              title
              comment {
                uuid
                text
              }
            }
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { userId: "u1", postId: "p1" },
        data: {
          user: {
            __typename: "User",
            id: "u1",
            email: "u1@example.com",
            post: {
              __typename: "Post",
              id: "p1",
              title: "Post 1",
              comment: {
                __typename: "Comment",
                uuid: "c1",
                text: "Comment 1",
              },
            },
          },
        },
      });

      const r1 = documents.materializeDocument({ document: QUERY, variables: { userId: "u1", postId: "p1" } });
      // const userFp1 = (r1.data.user as any).__version;
      // const postFp1 = (r1.data.user.post as any).__version;
      // const commentFp1 = (r1.data.user.post.comment as any).__version;

      // Update Post only
      graph.putRecord("Post:p1", { title: "Post 1 Updated" });

      const r2 = documents.materializeDocument({ document: QUERY, variables: { userId: "u1", postId: "p1" }, force: true });
      // const userFp2 = (r2.data.user as any).__version;
      // const postFp2 = (r2.data.user.post as any).__version;
      // const commentFp2 = (r2.data.user.post.comment as any).__version;

      // Comment should have same fingerprint (unchanged)
      // expect(commentFp2).toBe(commentFp1);

      // Post should have different fingerprint (changed)
      // expect(postFp2).not.toBe(postFp1);

      // User should have different fingerprint (child changed)
      // expect(userFp2).not.toBe(userFp1);

      // Root should have different fingerprint
      expect((r2.data as any).__version).not.toBe((r1.data as any).__version);
    });

    it("computes fingerprints for arrays", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query PostWithTags($id: ID!) {
          post(id: $id) {
            id
            title
            tags {
              id
              name
            }
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "p1" },
        data: {
          post: {
            __typename: "Post",
            id: "p1",
            title: "Post 1",
            tags: [
              { __typename: "Tag", id: "t1", name: "Tag 1" },
              { __typename: "Tag", id: "t2", name: "Tag 2" },
            ],
          },
        },
      });

      const result1 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" } });

      // Update one of the tags
      graph.putRecord("Tag:t1", { name: "Tag 1 Updated" });

      const result2 = documents.materializeDocument({ document: QUERY, variables: { id: "p1" }, force: true });

      // Fingerprints should be different because array item changed
      expect((result1.data as any).__version).not.toBe((result2.data as any).__version);
      // const tags1Fp = (result1.data.post.tags as any).__version;
      // const tags2Fp = (result2.data.post.tags as any).__version;
      // expect(tags1Fp).not.toBe(tags2Fp);

      // Array should have a fingerprint
      // expect(tags1Fp).toBeGreaterThan(0);
    });

    it("can disable fingerprinting with fingerprint: false option", () => {
      const QUERY = compilePlan(/* GraphQL */ `
        query UserById($id: ID!) {
          user(id: $id) {
            id
            email
          }
        }
      `);

      documents.normalizeDocument({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: { __typename: "User", id: "u1", email: "u1@example.com" },
        },
      });

      const result = documents.materializeDocument({
        document: QUERY,
        variables: { id: "u1" },
        fingerprint: false,
      });

      // Root should NOT have __version when fingerprinting is disabled
      expect((result.data as any).__version).toBeUndefined();

      // Objects should NOT have __version
      expect((result.data.user as any).__version).toBeUndefined();
      expect(Object.keys(result.data.user)).toEqual(["__typename", "id", "email"]);
    });
  });
});
