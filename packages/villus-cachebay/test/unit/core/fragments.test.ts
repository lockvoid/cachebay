// test/fragments.spec.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { operations, writeConnectionPage } from "@/test/helpers";

describe("Fragments (documents-powered)", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;
  let fragments: ReturnType<typeof createFragments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    canonical = createCanonical({ graph });
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
    it("posts connection: edges/pageInfo/totalCount update through watcher", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2", flags: [] });

      const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';

      writeConnectionPage(graph, pageKey, {
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

      let last: any;
      const sub = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
        onData: (d) => (last = d),
      });

      expect(last.posts.totalCount).toBe(2);
      expect(last.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Update a node → notify touched entity
      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      fragments._notifyTouched(new Set(["Post:p1"]));
      expect(last.posts.edges[0].node.title).toBe("P1 (Updated)");

      // Update an edge record
      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      fragments._notifyTouched(new Set([`${pageKey}.edges.0`]));
      expect(last.posts.edges[0].score).toBe(0.9);

      // Update pageInfo
      graph.putRecord(`${pageKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      fragments._notifyTouched(new Set([`${pageKey}.pageInfo`]));
      expect(last.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      // Update page container (e.g. totalCount)
      graph.putRecord(pageKey, { totalCount: 3 });
      fragments._notifyTouched(new Set([pageKey]));
      expect(last.posts.totalCount).toBe(3);

      sub.unsubscribe();
    });

    it("nested comments connection reacts to node changes", () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
      graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3" });

      const pageKey = '@.Post:p1.comments({"after":null,"first":2})';
      writeConnectionPage(graph, pageKey, {
        __typename: "CommentConnection",
        pageInfo: { startCursor: "c1", endCursor: "c2", hasNextPage: false, hasPreviousPage: false },
        edges: [
          { __typename: "CommentEdge", cursor: "c1", node: { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } } as any },
          { __typename: "CommentEdge", cursor: "c2", node: { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } } as any },
        ],
      });

      let last: any;
      const sub = fragments.watchFragment({
        id: "Post:p1",
        fragment: operations.POST_COMMENTS_FRAGMENT,
        fragmentName: "PostComments",
        variables: { commentsFirst: 2, commentsAfter: null },
        onData: (d) => (last = d),
      });

      expect(last.comments.pageInfo).toEqual({
        __typename: "PageInfo",
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

    it("writes a connection page; watcher sees edges/pageInfo/totalCount changes", () => {
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

      const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';
      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      fragments._notifyTouched(new Set([`${pageKey}.edges.0`]));
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
      expect(last.posts.totalCount).toBe(4);

      sub.unsubscribe();
    });
  });
});