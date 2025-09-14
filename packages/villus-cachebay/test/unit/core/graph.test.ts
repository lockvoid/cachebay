// test/unit/core/graph.test.ts
import { describe, it, expect } from "vitest";
import { isReactive } from "vue";
import { createGraph, type GraphAPI } from "@/src/core/graph";
import { createSelections } from "@/src/core/selections";

describe("graph.ts — normalized store + materialization", () => {
  function makeGraph(): GraphAPI {
    return createGraph({
      reactiveMode: "shallow",
      keys: {
        Profile: (o) => o?.id ?? null,
        Post: (o) => o?.id ?? null,
        User: (o) => o?.id ?? null,
        Comment: (o) => o?.id ?? null,
        PageInfo: () => null,
        PostEdge: () => null,
        AudioPost: (o) => o?.id ?? null,
        VideoPost: (o) => o?.id ?? null,
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });
  }

  it("identify canonicalizes implementors (AudioPost/VideoPost → Post)", () => {
    const g = makeGraph();
    const k = g.putEntity({ __typename: "AudioPost", id: "1", title: "A" });
    expect(k).toBe("Post:1");
    expect(g.getEntity("Post:1")).toMatchObject({ title: "A" });

    const p = g.materializeEntity("Post:1");
    expect(isReactive(p)).toBe(true);
    expect(p.__typename).toBe("AudioPost");
    expect(p.title).toBe("A");

    g.putEntity({ __typename: "VideoPost", id: "1", title: "B" });
    const p2 = g.materializeEntity("Post:1");
    expect(p2).toBe(p);
    expect(p2.__typename).toBe("VideoPost");
    expect(p2.title).toBe("B");
  });

  it("putEntity normalizes nested references; materializeEntity returns reactive proxies", () => {
    const g = makeGraph();

    g.putEntity({
      __typename: "Post",
      id: "p1",
      title: "Hello",
      author: { __typename: "User", id: "u1", name: "Ada" },
      tags: ["intro", "blue"],
    });

    expect(g.getEntity("Post:p1")).toBeTruthy();
    expect(g.getEntity("User:u1")).toBeTruthy();
    expect(g.getEntity("Post:p1")!.author).toEqual({ __ref: "User:u1" });

    const post = g.materializeEntity("Post:p1");
    expect(isReactive(post)).toBe(true);
    expect(post.__typename).toBe("Post");
    expect(post.id).toBe("p1");
    expect(isReactive(post.author)).toBe(true);
    expect(post.author.id).toBe("u1");

    g.putEntity({ __typename: "Post", id: "p1", title: "Hello World" });
    expect(post.title).toBe("Hello World");
  });

  describe("Complex selection: user + profile + posts(first:10) connection", () => {
    it("stores selection skeletons and materializes reactive trees; keeps pages", () => {
      const g = makeGraph();
      const sel = createSelections({
        config: {},
        dependencies: {
          identify: g.identify,
          stableStringify: g.stableStringify,
        },
      });

      // Page 1
      const dataPage1 = {
        data: {
          user: {
            __typename: "User",
            id: "1",
            name: "John Doe",
            profile: {
              __typename: "Profile",
              id: "profile-1",
              bio: "dev",
              avatar: "/a.jpg",
              joinedAt: "2023-01-15",
            },
            posts: {
              __typename: "PostConnection",
              edges: [
                {
                  __typename: "PostEdge",
                  cursor: "c1",
                  node: { __typename: "VideoPost", id: "101", title: "Getting Started", content: "...", author: { __typename: "User", id: "1", name: "John Doe" } },
                },
                {
                  __typename: "PostEdge",
                  cursor: "c2",
                  node: { __typename: "AudioPost", id: "102", title: "Apollo Client Deep Dive", content: "...", author: { __typename: "User", id: "1", name: "John Doe" } },
                },
                {
                  __typename: "PostEdge",
                  cursor: "c3",
                  node: { __typename: "Post", id: "103", title: "Caching Strategies", content: "...", author: { __typename: "User", id: "1", name: "John Doe" } },
                },
              ],
              pageInfo: { __typename: "PageInfo", hasNextPage: true, endCursor: "c3" },
            },
          },
        },
      };

      const qUser = sel.buildRootSelectionKey("user", { id: "1" });
      g.putSelection(qUser, dataPage1.data.user);

      const qPosts1 = sel.buildFieldSelectionKey("User:1", "posts", { first: 10 });
      g.putSelection(qPosts1, dataPage1.data.user.posts);

      expect(g.getEntity("User:1")).toBeTruthy();
      expect(g.getEntity("Profile:profile-1")).toBeTruthy();
      expect(g.getEntity("Post:101")).toBeTruthy();

      expect(g.getSelection(qUser)).toEqual({ __ref: "User:1" });
      expect(g.getSelection(qPosts1)).toMatchObject({ pageInfo: { hasNextPage: true, endCursor: "c3", __typename: "PageInfo" } });

      const mUser = g.materializeSelection(qUser);
      expect(isReactive(mUser)).toBe(true);
      expect(mUser.__typename).toBe("User");
      expect(mUser.id).toBe("1");

      const mPosts1 = g.materializeSelection(qPosts1);
      expect(Array.isArray(mPosts1.edges)).toBe(true);
      expect(mPosts1.edges.map((e: any) => e.node.id)).toEqual(["101", "102", "103"]);

      g.putEntity({ __typename: "Post", id: "101", title: "Getting Started (Updated)" });
      expect(mPosts1.edges[0].node.title).toBe("Getting Started (Updated)");

      // Page 2
      const dataPage2 = {
        data: {
          user: {
            __typename: "User",
            id: "1",
            posts: {
              __typename: "PostConnection",
              edges: [
                { __typename: "PostEdge", cursor: "c4", node: { __typename: "Post", id: "104", title: "Optimistic UI Updates", content: "...", author: { __typename: "User", id: "1" } } },
                { __typename: "PostEdge", cursor: "c5", node: { __typename: "AudioPost", id: "105", title: "Error Handling", content: "...", author: { __typename: "User", id: "1" } } },
                { __typename: "PostEdge", cursor: "c6", node: { __typename: "VideoPost", id: "106", title: "Real-time Subscriptions", content: "...", author: { __typename: "User", id: "1" } } },
              ],
              pageInfo: { __typename: "PageInfo", hasNextPage: false, endCursor: "c6" },
            },
          },
        },
      };

      const qPosts2 = sel.buildFieldSelectionKey("User:1", "posts", { first: 10, after: "c3" });
      g.putSelection(qPosts2, dataPage2.data.user.posts);

      const mPosts2 = g.materializeSelection(qPosts2);
      expect(mPosts2.edges.map((e: any) => e.node.id)).toEqual(["104", "105", "106"]);

      const p104 = g.materializeEntity("Post:104");
      expect(p104.title).toBe("Optimistic UI Updates");
      g.removeEntity("Post:104");
      expect(p104.__typename).toBe("Post");
      expect(p104.id).toBe("104");
      expect(p104.title).toBeUndefined();
      expect(mPosts2.edges[0].node.id).toBe("104");
      expect(mPosts2.edges[0].node.title).toBeUndefined();
    });
  });

  it("materializeSelection reuses the same entity proxies across different trees", () => {
    const g = makeGraph();
    const sel = createSelections({
      config: {},
      dependencies: {
        identify: g.identify
      },
    });

    g.putEntity({ __typename: "User", id: "1", name: "John" });
    g.putEntity({ __typename: "Post", id: "p1", title: "Hello", author: { __typename: "User", id: "1", name: "John" } });

    const qA = sel.buildRootSelectionKey("post", { id: "p1" });
    const qB = sel.buildRootSelectionKey("featuredPost", {});
    g.putSelection(qA, { __typename: "Post", id: "p1" });
    g.putSelection(qB, { __typename: "Post", id: "p1" });

    const a = g.materializeSelection(qA);
    const b = g.materializeSelection(qB);
    expect(a).toBe(b);
  });
});
