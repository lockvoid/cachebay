import { ROOT_ID } from "@/src/core/constants";
import { LRU, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, recycleSnapshots, isObject } from "@/src/core/utils";
import { operations, createTestPlan } from "@/test/helpers";

describe("Utils", () => {
  describe("LRU", () => {
    it("stores and retrieves values", () => {
      const lru = new LRU<string, number>(3);
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      expect(lru.get("a")).toBe(1);
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
      expect(lru.size).toBe(3);
    });

    it("evicts oldest item when capacity exceeded", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.set("d", 4); // Should evict "a"
      
      expect(lru.get("a")).toBeUndefined();
      expect(lru.get("b")).toBe(2);
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
      expect(lru.size).toBe(3);
      expect(evicted).toEqual([["a", 1]]);
    });

    it("moves accessed items to end (most recent)", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      // Access "a" to make it most recent
      lru.get("a");
      
      // Add "d" - should evict "b" (oldest), not "a"
      lru.set("d", 4);
      
      expect(lru.get("a")).toBe(1);
      expect(lru.get("b")).toBeUndefined();
      expect(lru.get("c")).toBe(3);
      expect(lru.get("d")).toBe(4);
      expect(evicted).toEqual([["b", 2]]);
    });

    it("updates existing keys without eviction", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      lru.set("a", 10); // Update "a"
      
      expect(lru.get("a")).toBe(10);
      expect(lru.size).toBe(3);
      expect(evicted).toEqual([]);
    });

    it("clears all items and calls onEvict for each", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(3, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);
      
      lru.clear();
      
      expect(lru.size).toBe(0);
      expect(lru.get("a")).toBeUndefined();
      expect(evicted).toHaveLength(3);
      expect(evicted).toContainEqual(["a", 1]);
      expect(evicted).toContainEqual(["b", 2]);
      expect(evicted).toContainEqual(["c", 3]);
    });

    it("handles capacity of 1", () => {
      const evicted: Array<[string, number]> = [];
      const lru = new LRU<string, number>(1, (k, v) => evicted.push([k, v]));
      
      lru.set("a", 1);
      expect(lru.size).toBe(1);
      
      lru.set("b", 2);
      expect(lru.size).toBe(1);
      expect(lru.get("a")).toBeUndefined();
      expect(lru.get("b")).toBe(2);
      expect(evicted).toEqual([["a", 1]]);
    });
  });

  describe("buildFieldKey", () => {
    it("uses field.stringifyArgs with raw variables mapped to field argument names", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key = buildFieldKey(posts, { category: "tech", first: 2, after: null });
      // Order is from plan's expectedArgNames, not alphabetical
      expect(key).toBe("posts({\"category\":\"tech\",\"first\":2,\"after\":null})");
    });

    it("returns bare field name when the field has no args (e.g., author)", () => {
      const plan = createTestPlan(operations.USER_POSTS_COMMENTS_QUERY);

      const user = plan.rootSelectionMap!.get("user")!;
      const posts = user.selectionMap!.get("posts")!;
      const postEdges = posts.selectionMap!.get("edges")!;
      const pNode = postEdges.selectionMap!.get("node")!;
      const comments = pNode.selectionMap!.get("comments")!;
      const commentEdges = comments.selectionMap!.get("edges")!;
      const commentNode = commentEdges.selectionMap!.get("node")!;
      const author = commentNode.selectionMap!.get("author")!;

      const key = buildFieldKey(author, {});
      expect(key).toBe("author");
    });

    it("returns bare field name when all args are missing/undefined (stringifyArgs → '{}')", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key1 = buildFieldKey(posts, {});
      expect(key1).toBe("posts");

      const key2 = buildFieldKey(posts, { category: undefined, sort: undefined, first: undefined, after: undefined, last: undefined, before: undefined });
      expect(key2).toBe("posts");
    });

    it("ignores unrelated variables and only serializes declared args", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const key = buildFieldKey(posts, { category: "tech", unrelated: "ignored" } as any);
      expect(key).toBe('posts({"category":"tech"})');
    });
  });

  describe("buildConnectionKey", () => {
    it("builds concrete page key for root parent", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      // Order is from plan's expectedArgNames
      expect(postsKey).toBe("@.posts({\"category\":\"tech\",\"first\":2,\"after\":null})");
    });

    it("builds concrete page key for nested parent", () => {
      const plan = createTestPlan(operations.USER_POSTS_QUERY);
      const user = plan.rootSelectionMap!.get("user")!;
      const posts = user.selectionMap!.get("posts")!;

      const userPostsKey = buildConnectionKey(posts, "User:u1", { id: "u1", postsFirst: 1, postsAfter: "p2" });
      // Order is from plan's expectedArgNames
      expect(userPostsKey).toBe("@.User:u1.posts({\"first\":1,\"after\":\"p2\"})");
    });
  });

  describe("buildConnectionCanonicalKey", () => {
    it("respects filters and uses directive key under @connection", () => {
      const plan = createTestPlan(operations.POSTS_WITH_KEY_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      expect(postsKey).toBe("@connection.KeyedPosts({\"category\":\"tech\"})");

      const userPostsKey = buildConnectionCanonicalKey(posts, "User:u1", { category: "tech", first: 2, after: "p2" });
      expect(userPostsKey).toBe("@connection.User:u1.KeyedPosts({\"category\":\"tech\"})");
    });

    it("defaults filters to all non-pagination args when filters omitted", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const postsKey = buildConnectionCanonicalKey(posts, ROOT_ID, { category: "tech", first: 2, after: null });
      expect(postsKey).toBe("@connection.posts({\"category\":\"tech\"})");
    });

    it("produces stable stringify identity regardless of variable order", () => {
      const plan = createTestPlan(operations.POSTS_QUERY);
      const posts = plan.rootSelectionMap!.get("posts")!;

      const keyA = buildConnectionCanonicalKey(posts, ROOT_ID, {
        category: "tech",
        first: 2,
        after: null,
      });
      const keyB = buildConnectionCanonicalKey(posts, ROOT_ID, {
        category: "tech",
        after: null,
        first: 2,
      });

      expect(keyA).toBe(keyB);
      expect(keyA).toBe("@connection.posts({\"category\":\"tech\"})");
    });
  });

  describe("recycleSnapshots", () => {
    describe("basic behavior", () => {
      it("reuses prevData when fingerprints match", () => {
        const prevData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };
        const nextData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(prevData);
        expect(result).not.toBe(nextData);
      });

      it("returns nextData when fingerprints differ", () => {
        const prevData = { __typename: "User", __version: 123, id: "u1", name: "Alice" };
        const nextData = { __typename: "User", __version: 124, id: "u1", name: "Bob" };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result).not.toBe(prevData);
      });

      it("returns same reference when prevData === nextData", () => {
        const data = { __version: 123, id: "u1", name: "Alice" };

        const result = recycleSnapshots(data, data);

        expect(result).toBe(data);
      });

      it("handles primitives and non-objects", () => {
        expect(recycleSnapshots(42, 42)).toBe(42);
        expect(recycleSnapshots("hello", "hello")).toBe("hello");
        expect(recycleSnapshots(true, false)).toBe(false);
        expect(recycleSnapshots(null, null)).toBe(null);
        expect(recycleSnapshots(undefined, undefined)).toBe(undefined);
      });

      it("does not recycle non-plain objects", () => {
        class CustomClass {
          value = 42;
        }

        const prevData = new CustomClass();
        const nextData = new CustomClass();

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result).not.toBe(prevData);
      });
    });

    describe("partial recycling", () => {
      it("recycles unchanged subtrees in objects", () => {
        const prevUser = { __typename: "User", __version: 200, id: "u1", name: "Alice" };
        const prevData = {
          __typename: "Query",
          __version: 100,
          user: prevUser,
          count: 10,
        };

        const nextUser = { __typename: "User", __version: 200, id: "u1", name: "Alice" };
        const nextData = {
          __typename: "Query",
          __version: 101,
          user: nextUser,
          count: 11,
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.user).toBe(prevUser); // Recycled!
      });

      it("recycles unchanged elements in arrays", () => {
        const prevItem1 = { __typename: "Post", __version: 100, id: "p1", title: "Post 1" };
        const prevItem2 = { __typename: "Post", __version: 200, id: "p2", title: "Post 2" };
        const prevData = [prevItem1, prevItem2];
        (prevData as any).__version = 500;

        const nextItem1 = { __typename: "Post", __version: 100, id: "p1", title: "Post 1" };
        const nextItem2 = { __typename: "Post", __version: 201, id: "p2", title: "Post 2 Updated" };
        const nextData = [nextItem1, nextItem2];
        (nextData as any).__version = 501;

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result[0]).toBe(prevItem1); // Recycled!
        expect(result[1]).toBe(nextItem2); // Not recycled
      });

      it("handles mixed arrays and objects with partial changes", () => {
        const prevUser1 = { __typename: "User", __version: 100, id: "u1", name: "Alice" };
        const prevUser2 = { __typename: "User", __version: 101, id: "u2", name: "Bob" };
        const prevUsers = [prevUser1, prevUser2];
        (prevUsers as any).__version = 200;

        const prevData = {
          __typename: "Query",
          __version: 300,
          users: prevUsers,
          metadata: { __typename: "Metadata", __version: 400, count: 2 },
        };

        const nextUser1 = { __typename: "User", __version: 100, id: "u1", name: "Alice" };
        const nextUser2 = { __typename: "User", __version: 102, id: "u2", name: "Bob Updated" };
        const nextUsers = [nextUser1, nextUser2];
        (nextUsers as any).__version = 201;

        const nextData = {
          __typename: "Query",
          __version: 301,
          users: nextUsers,
          metadata: { __typename: "Metadata", __version: 400, count: 2 },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.users[0]).toBe(prevUser1); // Recycled!
        expect(result.users[1]).toBe(nextUser2); // Not recycled
        expect(result.metadata).toBe(prevData.metadata); // Recycled!
      });

      it("recycles deep unchanged subtrees when middle level changes", () => {
        const prevLevel4 = { __version: 500, value: "deep" };
        const prevLevel3 = { __version: 400, level4: prevLevel4 };
        const prevLevel2 = { __version: 300, level3: prevLevel3 };
        const prevData = {
          __version: 100,
          level1: { __version: 200, level2: prevLevel2 },
        };

        const nextLevel4 = { __version: 500, value: "deep" };
        const nextLevel3 = { __version: 400, level4: nextLevel4 };
        const nextLevel2 = { __version: 301, level3: nextLevel3 }; // L2 changed!
        const nextData = {
          __version: 101,
          level1: { __version: 201, level2: nextLevel2 },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.level1.level2.level3).toBe(prevLevel3); // L3 recycled!
        expect(result.level1.level2.level3.level4).toBe(prevLevel4); // L4 not traversed
      });

      it("recycles unchanged edges and pageInfo in connections", () => {
        const prevEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "c1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const prevEdge2 = {
          __typename: "PostEdge",
          __version: 101,
          cursor: "c2",
          node: { __typename: "Post", __version: 201, id: "p2", title: "Post 2" },
        };
        const prevEdges = [prevEdge1, prevEdge2];
        (prevEdges as any).__version = 300;

        const prevPageInfo = {
          __typename: "PageInfo",
          __version: 400,
          hasNextPage: true,
          endCursor: "c2",
        };

        const prevData = {
          __typename: "PostConnection",
          __version: 500,
          edges: prevEdges,
          pageInfo: prevPageInfo,
        };

        // Next data: edge2 changed
        const nextEdge1 = {
          __typename: "PostEdge",
          __version: 100,
          cursor: "c1",
          node: { __typename: "Post", __version: 200, id: "p1", title: "Post 1" },
        };
        const nextEdge2 = {
          __typename: "PostEdge",
          __version: 102, // Changed!
          cursor: "c2",
          node: { __typename: "Post", __version: 202, id: "p2", title: "Post 2 Updated" },
        };
        const nextEdges = [nextEdge1, nextEdge2];
        (nextEdges as any).__version = 301; // Changed!

        const nextPageInfo = {
          __typename: "PageInfo",
          __version: 400, // Same
          hasNextPage: true,
          endCursor: "c2",
        };

        const nextData = {
          __typename: "PostConnection",
          __version: 501, // Changed!
          edges: nextEdges,
          pageInfo: nextPageInfo,
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.edges[0]).toBe(prevEdge1); // Recycled!
        expect(result.edges[1]).toBe(nextEdge2); // Not recycled
        expect(result.pageInfo).toBe(prevPageInfo); // Recycled!
      });

      it("recycles unchanged posts in nested connections", () => {
        const prevComment1 = {
          __typename: "Comment",
          __version: 100,
          id: "c1",
          text: "Comment 1",
        };
        const prevCommentEdges = [prevComment1];
        (prevCommentEdges as any).__version = 200;

        const prevPost1 = {
          __typename: "Post",
          __version: 300,
          id: "p1",
          title: "Post 1",
          comments: {
            __typename: "CommentConnection",
            __version: 400,
            edges: prevCommentEdges,
          },
        };

        const prevPost2 = {
          __typename: "Post",
          __version: 350,
          id: "p2",
          title: "Post 2",
          comments: {
            __typename: "CommentConnection",
            __version: 450,
            edges: [],
          },
        };

        const prevPostEdges = [prevPost1, prevPost2];
        (prevPostEdges as any).__version = 500;

        const prevData = {
          __typename: "Query",
          __version: 600,
          user: {
            __typename: "User",
            __version: 700,
            id: "u1",
            posts: {
              __typename: "PostConnection",
              __version: 800,
              edges: prevPostEdges,
            },
          },
        };

        // Next data: comment in post1 changed
        const nextComment1 = {
          __typename: "Comment",
          __version: 101, // Changed!
          id: "c1",
          text: "Comment 1 Updated",
        };
        const nextCommentEdges = [nextComment1];
        (nextCommentEdges as any).__version = 201; // Changed!

        const nextPost1 = {
          __typename: "Post",
          __version: 301, // Changed!
          id: "p1",
          title: "Post 1",
          comments: {
            __typename: "CommentConnection",
            __version: 401, // Changed!
            edges: nextCommentEdges,
          },
        };

        const nextPost2 = {
          __typename: "Post",
          __version: 350, // Same!
          id: "p2",
          title: "Post 2",
          comments: {
            __typename: "CommentConnection",
            __version: 450,
            edges: [],
          },
        };

        const nextPostEdges = [nextPost1, nextPost2];
        (nextPostEdges as any).__version = 501; // Changed!

        const nextData = {
          __typename: "Query",
          __version: 601, // Changed!
          user: {
            __typename: "User",
            __version: 701, // Changed!
            id: "u1",
            posts: {
              __typename: "PostConnection",
              __version: 801, // Changed!
              edges: nextPostEdges,
            },
          },
        };

        const result = recycleSnapshots(prevData, nextData);

        expect(result).toBe(nextData);
        expect(result.user.posts.edges[1]).toBe(prevPost2); // Post2 recycled!
      });
    });
  });
});

