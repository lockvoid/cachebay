// test/fragments.spec.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { operations, writeConnectionPage, tick } from "@/test/helpers";

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
        documents._markDirty(touchedIds);
        fragments._notifyTouched(touchedIds);
      },
    });
    planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, planner, canonical });
    fragments = createFragments({ graph, planner, documents });
  });

  describe("readFragment (snapshot)", () => {
    it("reads user fragment snapshot; re-read reflects updates", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const snap1 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      })!;

      expect(snap1).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });

      const snap2 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      })!;

      expect(snap2).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
      });
    });

    it("returns undefined when entity is missing", () => {
      const missing = fragments.readFragment({
        id: "User:missing",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });
      expect(missing).toBeUndefined();
    });
  });

  describe("watchFragment (reactive)", () => {
    it("posts connection (strict): emits after data arrives and reacts to updates", async () => {
      // Seed only the User (no posts link/page yet)
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

      // We'll collect last value from the watcher
      let last: any;

      const sub = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        canonical: false, // STRICT read
        onData: (d) => (last = d),
      });

      // No strict data yet -> nothing emitted
      expect(last).toBeUndefined();

      // IMPORTANT: normalize out null args in keys
      const pageKey = '@.User:u1.posts({"category":"tech","first":2,"after":null})';

      // Create the strict page
      writeConnectionPage(graph, pageKey, {
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

      // Link User.posts(...) to that strict page
      const existingUser = graph.getRecord("User:u1") || {};
      graph.putRecord("User:u1", {
        ...existingUser,
        'posts({"category":"tech","first":2,"after":null})': { __ref: pageKey },
      });

      // Nudge the watcher (in case your graph.onChange didn’t already)
      fragments._notifyTouched(new Set(["User:u1", pageKey]));
      await tick(); // flush microtask

      // Now we should have data
      expect(last.posts.totalCount).toBe(2);
      expect(last.posts.pageInfo).toEqual({
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Update a node → reactive update
      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      fragments._notifyTouched(new Set(["Post:p1"]));
      await tick();
      expect(last.posts.edges[0].node.title).toBe("P1 (Updated)");

      // Update an edge record on the strict page
      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      fragments._notifyTouched(new Set([`${pageKey}.edges.0`]));
      await tick();
      expect(last.posts.edges[0].score).toBe(0.9);

      // Update pageInfo
      graph.putRecord(`${pageKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      fragments._notifyTouched(new Set([`${pageKey}.pageInfo`]));
      await tick();
      expect(last.posts.pageInfo).toEqual({
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Update page container (e.g. totalCount)
      graph.putRecord(pageKey, { totalCount: 3 });
      fragments._notifyTouched(new Set([pageKey]));
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
        canonical: true, // canonical read: uses the canonical container we seeded above
        onData: (d) => (last = d),
      });

      expect(last.posts.totalCount).toBe(2);
      expect(last.posts.pageInfo).toEqual({
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Update a node → notify touched entity
      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      fragments._notifyTouched(new Set(["Post:p1"]));
      await tick();
      expect(last.posts.edges[0].node.title).toBe("P1 (Updated)");

      // Update an edge record in the CANONICAL container
      graph.putRecord(`${canonicalKey}.edges.0`, { score: 0.9 });
      fragments._notifyTouched(new Set([`${canonicalKey}.edges.0`]));
      await tick();
      expect(last.posts.edges[0].score).toBe(0.9);

      // Update canonical pageInfo
      graph.putRecord(`${canonicalKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      fragments._notifyTouched(new Set([`${canonicalKey}.pageInfo`]));
      await tick();
      expect(last.posts.pageInfo).toEqual({
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Update container-level field (e.g. totalCount)
      graph.putRecord(canonicalKey, { totalCount: 3 });
      fragments._notifyTouched(new Set([canonicalKey]));
      await tick();
      expect(last.posts.totalCount).toBe(3);

      sub.unsubscribe();
    });

    it("nested comments connection reacts to node changes", async () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
      graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3" });

      const pageKey = '@.Post:p1.comments({"first":2,"after":null})';
      writeConnectionPage(graph, pageKey, {
        __typename: "CommentConnection",
        pageInfo: { startCursor: "c1", endCursor: "c2", hasNextPage: false, hasPreviousPage: false },
        edges: [
          { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } } as any },
          { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } } as any },
        ],
      });

      // Link Post entity to connection page (merge with existing record)
      const existingPost = graph.getRecord("Post:p1") || {};
      graph.putRecord("Post:p1", {
        ...existingPost,
        'comments({"first":2,"after":null})': { __ref: pageKey },
      });

      let last: any;
      const sub = fragments.watchFragment({
        id: "Post:p1",
        fragment: operations.POST_COMMENTS_FRAGMENT,
        fragmentName: "PostComments",
        variables: { commentsFirst: 2, commentsAfter: null },
        canonical: false, // strict read: page-only seeded
        onData: (d) => (last = d),
      });

      console.log("last", last);
      await tick();

      expect(last.comments.pageInfo).toEqual({
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      expect(last.comments.edges[0]).toEqual({
        __typename: "CommentEdge",
        cursor: "c1",
        node: { __typename: "Comment", id: "c1", text: "Comment 1", author: { __typename: "User", id: "u2" } },
      });

      graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
      fragments._notifyTouched(new Set(["Comment:c1"]));
      await tick();

      expect(last.comments.edges[0].node).toEqual({
        __typename: "Comment",
        id: "c1",
        text: "Comment 1 (Updated)",
        author: { __typename: "User", id: "u2" },
      });

      sub.unsubscribe();
    });
  });

  describe("writeFragment", () => {
    it("writes entity fields shallowly and re-reads show updates", () => {
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
      expect(snap1).toEqual({ __typename: "User", id: "u1", email: "seed@example.com" });

      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: { email: "seed2@example.com" },
      });

      const snap2 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
      })!;
      expect(graph.getRecord("User:u1")).toEqual({ __typename: "User", id: "u1", email: "seed2@example.com" });
      expect(snap2).toEqual({ __typename: "User", id: "u1", email: "seed2@example.com" });
    });

    it.only("writes a connection page; watcher sees edges/pageInfo/totalCount changes", async () => {
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
        canonical: false, // strict read to match page written by fragment
        onData: (d) => (last = d),
      });

      expect(last.posts.edges.length).toBe(2);
      expect(last.posts.totalCount).toBe(2);

      const pageKey = '@.User:u1.posts({"category":"tech","first":2,"after":null})';
      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      fragments._notifyTouched(new Set([`${pageKey}.edges.0`]));

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
      expect(last.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(last.posts.totalCount).toBe(3);

      graph.putRecord(pageKey, { totalCount: 4 });
      fragments._notifyTouched(new Set([pageKey]));

      await tick();

      expect(last.posts.totalCount).toBe(4);

      sub.unsubscribe();
    });
  });
});
