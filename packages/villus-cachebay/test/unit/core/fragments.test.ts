import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { createFragments } from "@/src/core/fragments";
import { USER_FRAGMENT, USER_POSTS_FRAGMENT, POST_COMMENTS_FRAGMENT, seedConnectionPage } from "@/test/helpers/unit";

describe('Fragments', () => {
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
        fragment: USER_FRAGMENT,
        variables: {},
      });

      expect(isReactive(userFragment)).toBe(true);

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1@example.com"
      });

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "u1+updated@example.com"
      });
    });

    it("returns reactive posts connection with extras", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", tags: [] });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2", tags: [] });

      seedConnectionPage(
        graph,
        '@.User:u1.posts({"after":null,"category":"tech","first":2})',
        [
          { nodeRef: "Post:p1", cursor: "p1", extra: { score: 0.5 } },
          { nodeRef: "Post:p2", cursor: "p2", extra: { score: 0.7 } },
        ],
        {
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        { totalCount: 2 },
        "PostEdge",
        "PostConnection"
      );

      const postsFragment = fragments.readFragment({
        id: "User:u1",
        fragment: USER_POSTS_FRAGMENT,

        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null
        },
      });

      expect(isReactive(postsFragment.posts)).toBe(true);
      expect(isReactive(postsFragment.posts.edges[0])).toBe(true);
      expect(isReactive(postsFragment.posts.edges[0].node)).toBe(true);
      expect(isReactive(postsFragment.posts.edges[1])).toBe(true);
      expect(isReactive(postsFragment.posts.edges[1].node)).toBe(true);

      expect(postsFragment.posts.totalCount).toBe(2);

      expect(postsFragment.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      expect(postsFragment.posts.edges[0]).toEqual({
        __typename: "PostEdge",
        cursor: "p1",
        score: 0.5,
        node: {
          __typename: "Post",
          id: "p1",
          title: "P1",
          tags: []
        }
      });

      expect(postsFragment.posts.edges[1]).toEqual({
        __typename: "PostEdge",
        cursor: "p2",
        score: 0.7,

        node: {
          __typename: "Post",
          id: "p2",
          title: "P2",
          tags: []
        }
      });

      expect(postsFragment.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "P1",
        tags: []
      });

      expect(postsFragment.posts.edges[1].node).toEqual({
        __typename: "Post",
        id: "p2",
        title: "P2",
        tags: []
      });

      graph.putRecord("Post:p1", { title: "P1 (Updated)" });

      expect(postsFragment.posts.edges[0].node).toEqual({
        __typename: "Post",
        id: "p1",
        title: "P1 (Updated)",
        tags: []
      });

      expect(postsFragment.posts.edges[1].node).toEqual({
        __typename: "Post",
        id: "p2",
        title: "P2",
        tags: []
      });
    });

    it("returns reactive nested comments connection", () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1", tags: [] });
      graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "C1", author: { __ref: "User:u2" } });
      graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "C2", author: { __ref: "User:u3" } });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3" });

      seedConnectionPage(
        graph,
        '@.Post:p1.comments({"after":null,"first":2})',
        [
          { nodeRef: "Comment:c1", cursor: "c1" },
          { nodeRef: "Comment:c2", cursor: "c2" },
        ],
        {
          __typename: "PageInfo",
          startCursor: "c1",
          endCursor: "c2",
          hasNextPage: false,
          hasPreviousPage: false,
        },
        undefined,
        "CommentEdge",
        "CommentConnection"
      );

      const commentsFragment = fragments.readFragment({
        id: "Post:p1",
        fragment: POST_COMMENTS_FRAGMENT,

        variables: {
          commentsFirst: 2,
          commentsAfter: null
        },
      });

      expect(isReactive(commentsFragment.comments)).toBe(true);
      expect(isReactive(commentsFragment.comments.edges[0])).toBe(true);
      expect(isReactive(commentsFragment.comments.edges[0].node)).toBe(true);
      expect(isReactive(commentsFragment.comments.edges[1])).toBe(true);
      expect(isReactive(commentsFragment.comments.edges[1].node)).toBe(true);

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
          text: "C1",
          author: {
            __typename: "User",
            id: "u2"
          }
        }
      });

      expect(commentsFragment.comments.edges[1]).toEqual({
        __typename: "CommentEdge",
        cursor: "c2",

        node: {
          __typename: "Comment",
          id: "c2",
          text: "C2",
          author: {
            __typename: "User",
            id: "u3"
          }
        }
      });

      expect(commentsFragment.comments.edges[0].node).toEqual({
        __typename: "Comment",
        id: "c1",
        text: "C1",

        author: {
          __typename: "User",
          id: "u2"
        }
      });

      expect(commentsFragment.comments.edges[1].node).toEqual({
        __typename: "Comment",
        id: "c2",
        text: "C2",

        author: {
          __typename: "User",
          id: "u3"
        }
      });

      graph.putRecord("Comment:c1", { text: "C1 (Updated)" });

      expect(commentsFragment.comments.edges[0].node).toEqual({
        __typename: "Comment",
        id: "c1",
        text: "C1 (Updated)",

        author: {
          __typename: "User",
          id: "u2"
        }
      });

      expect(commentsFragment.comments.edges[1].node).toEqual({
        __typename: "Comment",
        id: "c2",
        text: "C2",

        author: {
          __typename: "User",
          id: "u3"
        }
      });
    });

    it("returns reactive empty fragment when entity is missing", () => {
      const missingFragment = fragments.readFragment({
        id: "User:missing",
        fragment: USER_FRAGMENT,
        variables: {},
      });

      expect(isReactive(missingFragment)).toBe(true);
      expect(Object.keys(missingFragment).length).toBe(0);
    });
  });

  describe("writeFragment", () => {
    it("writes entity fields shallowly and maintains reactivity", () => {
      fragments.writeFragment({
        id: "User:u1",
        fragment: USER_FRAGMENT,

        data: {
          __typename: "User",
          id: "u1",
          email: "seed@example.com",
        },
      });

      const userFragment = fragments.readFragment({
        id: "User:u1",
        fragment: USER_FRAGMENT,
      });

      expect(isReactive(userFragment)).toBe(true);

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed@example.com",
      });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed@example.com"
      });

      fragments.writeFragment({
        id: "User:u1",
        fragment: USER_FRAGMENT,
        variables: {},
        data: { email: "seed2@example.com" },
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed2@example.com"
      });

      expect(userFragment).toEqual({
        __typename: "User",
        id: "u1",
        email: "seed2@example.com"
      });
    });

    it("writes connection page and maintains reactive reads", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "x@example.com" });

      fragments.writeFragment({
        id: "User:u1",
        fragment: USER_POSTS_FRAGMENT,

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
                node: { __typename: "Post", id: "p1", title: "P1", tags: [] },
              },

              {
                __typename: "PostEdge",
                cursor: "p2",
                score: 0.7,
                node: { __typename: "Post", id: "p2", title: "P2", tags: [] },
              },
            ],
          },
        },
      });

      const postsFragment = fragments.readFragment({
        id: "User:u1",
        fragment: USER_POSTS_FRAGMENT,

        variables: {
          postsCategory: "tech",
          postsFirst: 2,
          postsAfter: null
        },
      });

      expect(isReactive(postsFragment.posts)).toBe(true);
      expect(isReactive(postsFragment.posts.edges[0])).toBe(true);
      expect(isReactive(postsFragment.posts.edges[0].node)).toBe(true);
      expect(isReactive(postsFragment.posts.edges[1])).toBe(true);
      expect(isReactive(postsFragment.posts.edges[1].node)).toBe(true);

      expect(postsFragment.posts.edges.length).toBe(2);

      expect(postsFragment.posts.totalCount).toBe(2);

      expect(postsFragment.posts.pageInfo).toEqual({
        __typename: "PageInfo",
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      });

      expect(postsFragment.posts.edges[0]).toEqual({
        __typename: "PostEdge",
        cursor: "p1",
        score: 0.5,

        node: {
          __typename: "Post",
          id: "p1",
          title: "P1",
          tags: []
        }
      });

      expect(postsFragment.posts.edges[1]).toEqual({
        __typename: "PostEdge",
        cursor: "p2",
        score: 0.7,

        node: {
          __typename: "Post",
          id: "p2",
          title: "P2",
          tags: []
        }
      });

      graph.putRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges.0', { score: 0.9 });

      expect(postsFragment.posts.edges[0]).toEqual({
        __typename: "PostEdge",
        cursor: "p1",
        score: 0.9,

        node: {
          __typename: "Post",
          id: "p1",
          title: "P1",
          tags: []
        }
      });

      expect(postsFragment.posts.edges[1]).toEqual({
        __typename: "PostEdge",
        cursor: "p2",
        score: 0.7,

        node: {
          __typename: "Post",
          id: "p2",
          title: "P2",
          tags: []
        }
      });
    });
  });
});
