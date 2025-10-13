import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { operations, writeConnectionPage } from "@/test/helpers";

describe("Fragments", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let views: ReturnType<typeof createViews>;
  let fragments: ReturnType<typeof createFragments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    views = createViews({ graph });
    fragments = createFragments({ graph, planner, views });
  });

  describe("readFragment", () => {
    it("returns reactive user fragment with correct fields", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const userFragment = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
      });

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com",
      });
    });

    it("reads posts connection; edges/pageInfo/totalCount update reactively", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
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
          {
            __typename: "PostEdge",
            cursor: "p1",
            score: 0.5,
            node: { __typename: "Post", id: "p1", title: "P1", flags: [] },
          },
          {
            __typename: "PostEdge",
            cursor: "p2",
            score: 0.7,
            node: { __typename: "Post", id: "p2", title: "P2", flags: [] },
          },
        ],
      });

      const postsFragment = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null,
        },
      });

      expect(isReactive(postsFragment.posts.edges)).toBe(true);

      expect(postsFragment.posts.totalCount).toBe(2);
      expect(postsFragment.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      graph.putRecord("Post:p1", { title: "P1 (Updated)" });
      expect(postsFragment.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "P1 (Updated)",
        flags: [],
      });

      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      expect(postsFragment.posts.edges[0]).toEqual({
        __typename: "PostEdge",
        cursor: "p1",
        score: 0.9,
        node: {
          __typename: "Post",
          id: "p1",
          title: "P1 (Updated)",
          flags: [],
        },
      });

      graph.putRecord(`${pageKey}.pageInfo`, { endCursor: "p3", hasNextPage: false });
      expect(postsFragment.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      graph.putRecord(pageKey, { totalCount: 3 });
      expect(postsFragment.posts.totalCount).toBe(3);
    });

    it("reads nested comments connection (reactive nodes, pageInfo)", () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", flags: [] });
      graph.putRecord("Comment:c1", {
        __typename: "Comment",
        id: "c1",
        text: "Comment 1",
        author: { __ref: "User:u2" },
      });
      graph.putRecord("Comment:c2", {
        __typename: "Comment",
        id: "c2",
        text: "Comment 2",
        author: { __ref: "User:u3" },
      });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3" });

      const pageKey = '@.Post:p1.comments({"after":null,"first":2})';

      writeConnectionPage(graph, pageKey, {
        __typename: "CommentConnection",
        pageInfo: {
          startCursor: "c1",
          endCursor: "c2",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        edges: [
          {
            __typename: "CommentEdge",
            cursor: "c1",
            node: {
              __typename: "Comment",
              id: "c1",
              text: "Comment 1",
              author: { __ref: "User:u2" },
            } as any,
          },
          {
            __typename: "CommentEdge",
            cursor: "c2",
            node: {
              __typename: "Comment",
              id: "c2",
              text: "Comment 2",
              author: { __ref: "User:u3" },
            } as any,
          },
        ],
      });

      const commentsFragment = fragments.readFragment({
        id: "Post:p1",
        fragment: operations.POST_COMMENTS_FRAGMENT,
        fragmentName: "PostComments",
        variables: {
          commentsFirst: 2,
          commentsAfter: null,
        },
      });

      expect(isReactive(commentsFragment.comments.edges)).toBe(true);

      expect(commentsFragment.comments.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      expect(commentsFragment.comments.edges[0]).toEqual({
        __typename: "CommentEdge",
        cursor: "c1",
        node: {
          __typename: "Comment",
          id: "c1",
          text: "Comment 1",
          author: { __typename: "User", id: "u2" },
        },
      });

      graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });

      expect(commentsFragment.comments.edges[0].node).toEqual({
        __typename: "Comment",
        id: "c1",
        text: "Comment 1 (Updated)",
        author: { __typename: "User", id: "u2" },
      });
    });

    it("returns undefined when entity is missing", () => {
      const missingFragment = fragments.readFragment({
        id: "User:missing",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });

      expect(missingFragment).toEqual({});
    });
  });

  describe("writeFragment", () => {
    it("writes entity fields shallowly and maintains updates", () => {
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        data: {
          __typename: "User",
          id: "u1",
          email: "seed@example.com",
        },
      });

      const userFragment = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed@example.com",
      });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed@example.com",
      });

      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        data: { email: "seed2@example.com" },
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed2@example.com",
      });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed2@example.com",
      });
    });

    it("writes a connection page; edges array is reactive and identity-stable; pageInfo/totalCount update", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null,
        },
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
              {
                __typename: "PostEdge",
                cursor: "p1",
                score: 0.5,
                node: { __typename: "Post", id: "p1", title: "P1", flags: [] },
              },
              {
                __typename: "PostEdge",
                cursor: "p2",
                score: 0.7,
                node: { __typename: "Post", id: "p2", title: "P2", flags: [] },
              },
            ],
          },
        },
      });

      const postsFragment = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null,
        },
      });

      expect(isReactive(postsFragment.posts.edges)).toBe(true);
      expect(postsFragment.posts.edges.length).toBe(2);
      expect(postsFragment.posts.totalCount).toBe(2);

      const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';
      graph.putRecord(`${pageKey}.edges.0`, { score: 0.9 });
      expect(postsFragment.posts.edges[0].score).toBe(0.9);

      const edgesBefore = postsFragment.posts.edges;
      fragments.writeFragment({
        id: "User:u1",
        fragment: operations.USER_POSTS_FRAGMENT,
        fragmentName: "UserPosts",
        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null,
        },
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
              {
                __typename: "PostEdge",
                cursor: "p1",
                score: 0.9,
                node: { __typename: "Post", id: "p1", title: "P1", flags: [] },
              },
              {
                __typename: "PostEdge",
                cursor: "p2",
                score: 0.7,
                node: { __typename: "Post", id: "p2", title: "P2", flags: [] },
              },
              {
                __typename: "PostEdge",
                cursor: "p3",
                score: 0.4,
                node: { __typename: "Post", id: "p3", title: "P3", flags: [] },
              },
            ],
          },
        },
      });

      expect(postsFragment.posts.edges).toBe(edgesBefore);
      expect(postsFragment.posts.edges.length).toBe(3);
      expect(postsFragment.posts.edges[2].node.id).toBe("p3");

      expect(postsFragment.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p3",
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(postsFragment.posts.totalCount).toBe(3);

      graph.putRecord(pageKey, { totalCount: 4 });
      expect(postsFragment.posts.totalCount).toBe(4);
    });
  });
});
