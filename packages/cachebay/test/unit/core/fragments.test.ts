// test/fragments.spec.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { operations, writeConnectionPage, tick, fixtures } from "@/test/helpers";
import { gql } from "graphql-tag";

describe("Fragments (documents-powered)", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;
  let fragments: ReturnType<typeof createFragments>;

  beforeEach(() => {
    graph = createGraph({
      interfaces: { Post: ["AudioPost", "VideoPost"] },
      onChange: (touchedIds) => {
        fragments.propagateData(touchedIds);
      },
    });
    planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, planner, canonical });
    fragments = createFragments({ graph, planner, documents });
  });

  describe("readFragment (snapshot)", () => {
    it("reads user fragment snapshot; re-read reflects updates", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const snap1 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      })!;

      expect(snap1).toMatchObject({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });
      expect(snap1.__version).toBeDefined();

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });

      const snap2 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      })!;

      expect(snap2).toMatchObject({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
      });
      expect(snap2.__version).toBeDefined();
    });

    it("returns null when entity is missing", () => {
      const missing = fragments.readFragment({
        id: "User:missing",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });
      expect(missing).toBeNull();
    });
  });

  describe("watchFragment (reactive)", () => {
    it("posts connection (canonical): emits after data arrives and reacts to updates", async () => {
      // Seed only the User (no posts link/page yet)
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

      // We'll collect last value from the watcher
      let last: any;

      const sub = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        onData: (d) => (last = d),
      });

      // No data yet -> nothing emitted
      expect(last).toBeUndefined();

      // Use canonical container key
      const canonicalKey = '@connection.User:u1.posts({"category":"tech"})';

      // Create the canonical page
      writeConnectionPage(graph, canonicalKey, {
        __typename: "PostConnection",
        totalCount: 2,
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
          { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
        ],
      });

      // Seed nodes referenced by the page (optional if writeConnectionPage already placed minimal node shells)
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2", flags: [] });

      // Note: no strict link from User.posts(...) needed for canonical reads.

      // Nudge the watcher (in case your graph.onChange didn’t already)
      fragments.propagateData(new Set(["User:u1", canonicalKey]));
      await tick(); // flush microtask

      // Now we should have data
      expect(last.posts.totalCount).toBe(2);
      expect(last.posts.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Update a node → reactive update
      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      fragments.propagateData(new Set(["Post:p1"]));
      await tick();
      expect(last.posts.edges[0].node.title).toBe("P1 (Updated)");

      // Update pageInfo
      graph.putRecord(`${canonicalKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      fragments.propagateData(new Set([`${canonicalKey}.pageInfo`]));
      await tick();
      expect(last.posts.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Update page container (e.g. totalCount)
      graph.putRecord(canonicalKey, { totalCount: 3 });
      fragments.propagateData(new Set([canonicalKey]));
      await tick();
      expect(last.posts.totalCount).toBe(3);

      sub.unsubscribe();
    });

    it("posts connection (canonical): edges/pageInfo/totalCount update through watcher", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2", flags: [] });

      // Seed the CANONICAL container for this parent & filter
      const canonicalKey = '@connection.User:u1.posts({"category":"tech"})';
      writeConnectionPage(graph, canonicalKey, {
        __typename: "PostConnection",
        totalCount: 2,
        pageInfo: {
          startCursor: "p1",
          endCursor: "p2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: [
          { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
          { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
        ],
      });

      // Note: no strict link from User.posts(...) needed for canonical reads.

      let last: any;
      const sub = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        onData: (d) => (last = d),
      });

      expect(last.posts.totalCount).toBe(2);
      expect(last.posts.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Update a node → notify touched entity
      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      fragments.propagateData(new Set(["Post:p1"]));
      await tick();
      expect(last.posts.edges[0].node.title).toBe("P1 (Updated)");

      // Update canonical pageInfo
      graph.putRecord(`${canonicalKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      fragments.propagateData(new Set([`${canonicalKey}.pageInfo`]));
      await tick();
      expect(last.posts.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Update container-level field (e.g. totalCount)
      graph.putRecord(canonicalKey, { totalCount: 3 });
      fragments.propagateData(new Set([canonicalKey]));
      await tick();
      expect(last.posts.totalCount).toBe(3);

      sub.unsubscribe();
    });

    it("nested comments connection reacts to node changes", async () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
      graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", name: "User 2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3", name: "User 3" });

      const canonicalKey = '@connection.Post:p1.PostComments({})';
      writeConnectionPage(graph, canonicalKey, {
        __typename: "CommentConnection",
        pageInfo: { startCursor: "c1", endCursor: "c2", hasNextPage: false, hasPreviousPage: false },
        edges: [
          { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } } as any },
          { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } } as any },
        ],
      });

      // Note: no strict link from Post.comments(...) needed for canonical reads.

      let last: any;
      const sub = fragments.watchFragment({
        id: "Post:p1",
        fragment: operations.POST_COMMENTS_FRAGMENT,
        fragmentName: "PostComments",
        variables: { commentsFirst: 2, commentsAfter: null },
        onData: (d) => (last = d),
      });

      // Nudge the watcher
      fragments.propagateData(new Set(["Post:p1", canonicalKey]));
      await tick();

      expect(last.comments.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      expect(last.comments.edges[0]).toMatchObject({
        __typename: "CommentEdge",
        cursor: "c1",
        node: { __typename: "Comment", id: "c1", text: "Comment 1", author: { __typename: "User", id: "u2", name: "User 2" } },
      });

      graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
      fragments.propagateData(new Set(["Comment:c1"]));
      await tick();

      expect(last.comments.edges[0].node).toMatchObject({
        __typename: "Comment",
        id: "c1",
        text: "Comment 1 (Updated)",
        author: { __typename: "User", id: "u2" },
      });

      sub.unsubscribe();
    });
  });

  describe("writeFragment", () => {
    it("writes entity fields shallowly and re-reads show updates", async () => {
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "u1", email: "seed@example.com" },
      });

      const snap1 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
      })!;
      expect(graph.getRecord("User:u1")).toEqual({ __typename: "User", id: "u1", email: "seed@example.com" });
      expect(snap1).toMatchObject({ __typename: "User", id: "u1", email: "seed@example.com" });
      expect(snap1.__version).toBeDefined();

      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: { __typename: "User", id: "u1", email: "seed2@example.com" },
      });

      const snap2 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
      })!;
      expect(graph.getRecord("User:u1")).toEqual({ __typename: "User", id: "u1", email: "seed2@example.com" });
      expect(snap2).toMatchObject({ __typename: "User", id: "u1", email: "seed2@example.com" });
      expect(snap2.__version).toBeDefined();
    });

    it("writes a connection page; watcher sees edges/pageInfo/totalCount changes", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

      // initial write
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        data: {
          id: "u1",
          posts: {
            __typename: "PostConnection",
            totalCount: 2,
            pageInfo: {
              __typename: "PageInfo",
              startCursor: "p1",
              endCursor: "p2",
              hasNextPage: true,
              hasPreviousPage: false,
            },
            edges: [
              { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
              { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
            ],
          },
        },
      });

      let last: any;
      const sub = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        onData: (d) => (last = d),
      });

      expect(last.posts.edges.length).toBe(2);
      expect(last.posts.totalCount).toBe(2);

      // Update edge metadata using writeFragment (proper high-level API)
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        data: {
          id: "u1",
          posts: {
            __typename: "PostConnection",
            totalCount: 2,
            pageInfo: {
              __typename: "PageInfo",
              startCursor: "p1",
              endCursor: "p2",
              hasNextPage: true,
              hasPreviousPage: false,
            },
            edges: [
              { __typename: "PostEdge", cursor: "p1", score: 0.9, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
              { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
            ],
          },
        },
      });

      await tick();
      expect(last.posts.edges[0].score).toBe(0.9);

      // second write expands data
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        data: {
          id: "u1",
          posts: {
            __typename: "PostConnection",
            totalCount: 3,
            pageInfo: {
              __typename: "PageInfo",
              startCursor: "p1",
              endCursor: "p3",
              hasNextPage: false,
              hasPreviousPage: false,
            },
            edges: [
              { __typename: "PostEdge", cursor: "p1", score: 0.9, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
              { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
              { __typename: "PostEdge", cursor: "p3", score: 0.4, node: { __typename: "Post", id: "p3", title: "P3", flags: [] } },
            ],
          },
        },
      });

      await tick();

      expect(last.posts.edges.length).toBe(3);
      expect(last.posts.edges[2].node.id).toBe("p3");
      expect(last.posts.pageInfo).toMatchObject({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(last.posts.totalCount).toBe(3);

      // Update totalCount using writeFragment
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        data: {
          id: "u1",
          posts: {
            __typename: "PostConnection",
            totalCount: 4,
            pageInfo: {
              __typename: "PageInfo",
              startCursor: "p1",
              endCursor: "p3",
              hasNextPage: false,
              hasPreviousPage: false,
            },
            edges: [
              { __typename: "PostEdge", cursor: "p1", score: 0.9, node: { __typename: "Post", id: "p1", title: "P1", flags: [] } },
              { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __typename: "Post", id: "p2", title: "P2", flags: [] } },
              { __typename: "PostEdge", cursor: "p3", score: 0.4, node: { __typename: "Post", id: "p3", title: "P3", flags: [] } },
            ],
          },
        },
      });

      await tick();

      expect(last.posts.totalCount).toBe(4);

      sub.unsubscribe();
    });
  });

  describe("update method", () => {
    it("updates entity id and emits new data immediately", async () => {
      // Setup two users
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].id).toBe("u1");
      expect(emissions[0].email).toBe("u1@example.com");

      // Update to watch different entity
      handle.update({ id: "User:u2", immediate: true });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].id).toBe("u2");
      expect(emissions[1].email).toBe("u2@example.com");

      handle.unsubscribe();
    });

    it("updates variables and emits new data", async () => {
      // Setup user with posts
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const FRAGMENT_WITH_VARS = gql`
        fragment UserWithCategory on User {
          id
          email
          posts(category: $category) @connection {
            edges { node { id title } }
          }
        }
      `;

      const postsKey1 = '@connection.User:u1.posts({"category":"tech"})';
      const postsKey2 = '@connection.User:u1.posts({"category":"news"})';

      writeConnectionPage(graph, postsKey1, fixtures.posts.buildConnection(
        [{ id: "p1", title: "Tech Post" }],
        { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false }
      ));

      writeConnectionPage(graph, postsKey2, fixtures.posts.buildConnection(
        [{ id: "p2", title: "News Post" }],
        { startCursor: "p2", endCursor: "p2", hasNextPage: false, hasPreviousPage: false }
      ));

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT_WITH_VARS,
        variables: { category: "tech" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].posts.edges[0].node.title).toBe("Tech Post");

      // Update variables to watch different category
      handle.update({ variables: { category: "news" }, immediate: true });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].posts.edges[0].node.title).toBe("News Post");

      handle.unsubscribe();
    });

    it("updates both id and variables together", async () => {
      // Setup two users with different posts
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

      const FRAGMENT_WITH_VARS = gql`
        fragment UserWithCategory on User {
          id
          email
          posts(category: $category) @connection {
            edges { node { id title } }
          }
        }
      `;

      const postsKey1 = '@connection.User:u1.posts({"category":"tech"})';
      const postsKey2 = '@connection.User:u2.posts({"category":"news"})';

      writeConnectionPage(graph, postsKey1, fixtures.posts.buildConnection(
        [{ id: "p1", title: "U1 Tech Post" }],
        { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false }
      ));

      writeConnectionPage(graph, postsKey2, fixtures.posts.buildConnection(
        [{ id: "p2", title: "U2 News Post" }],
        { startCursor: "p2", endCursor: "p2", hasNextPage: false, hasPreviousPage: false }
      ));

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT_WITH_VARS,
        variables: { category: "tech" },
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].id).toBe("u1");
      expect(emissions[0].posts.edges[0].node.title).toBe("U1 Tech Post");

      // Update both id and variables
      handle.update({ id: "User:u2", variables: { category: "news" }, immediate: true });

      expect(emissions).toHaveLength(2);
      expect(emissions[1].id).toBe("u2");
      expect(emissions[1].posts.edges[0].node.title).toBe("U2 News Post");

      handle.unsubscribe();
    });

    it("does not emit if immediate is false", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update with immediate: false
      handle.update({ id: "User:u2", immediate: false });

      // Should not emit immediately
      expect(emissions).toHaveLength(1);

      // But should emit when data changes via propagateData
      graph.putRecord("User:u2", { email: "u2+updated@example.com" });
      await tick();

      expect(emissions).toHaveLength(2);
      expect(emissions[1].id).toBe("u2");
      expect(emissions[1].email).toBe("u2+updated@example.com");

      handle.unsubscribe();
    });

    it("does not emit if data hasn't changed", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update with same id (data unchanged)
      handle.update({ id: "User:u1", immediate: true });

      // Should not emit because data is the same
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("handles cache miss gracefully", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update to non-existent entity
      handle.update({ id: "User:u999", immediate: true });

      // Should not emit on cache miss
      expect(emissions).toHaveLength(1);

      // Later when entity appears, should emit
      graph.putRecord("User:u999", { __typename: "User", id: "u999", email: "u999@example.com" });
      await tick();

      expect(emissions).toHaveLength(2);
      expect(emissions[1].id).toBe("u999");

      handle.unsubscribe();
    });
  });
});
