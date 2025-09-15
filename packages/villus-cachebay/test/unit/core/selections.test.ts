import { createSelections } from "@/src/core/selections";

describe("Selections", () => {
  const selections = createSelections();

  describe("buildQuerySelectionKey", () => {
    it("drops undefined args and produces a stable key", () => {
      const key = selections.buildQuerySelectionKey("user", { id: "1", skip: undefined });

      expect(key).toBe('user({"id":"1"})');
    });

    it("stabilizes nested object key ordering", () => {
      const keyA = selections.buildQuerySelectionKey("list", {
        where: { b: 2, a: 1 }
      });

      const keyB = selections.buildQuerySelectionKey("list", {
        where: { a: 1, b: 2 }
      });

      expect(keyA).toBe(keyB);
      expect(keyA).toBe('list({"where":{"a":1,"b":2}})');
    });

    it("emits an empty-object suffix when args are omitted", () => {
      const key = selections.buildQuerySelectionKey("stats");

      expect(key).toBe("stats({})");
    });
  });

  describe("buildFieldSelectionKey", () => {
    it("builds a key with parent entity and drops undefined args", () => {
      const key = selections.buildFieldSelectionKey("User:1", "posts", { first: 10, after: undefined });

      expect(key).toBe('User:1.posts({"first":10})');
    });

    it("stabilizes nested object key ordering", () => {
      const keyA = selections.buildFieldSelectionKey("User:1", "posts", {
        first: 10,
        where: { x: 1, y: 2 },
      });

      const keyB = selections.buildFieldSelectionKey("User:1", "posts", {
        where: { y: 2, x: 1 },
        first: 10,
      });

      expect(keyA).toBe(keyB);
      expect(keyA).toBe('User:1.posts({"first":10,"where":{"x":1,"y":2}})');
    });

    it("emits an empty-object suffix when args are omitted", () => {
      const key = selections.buildFieldSelectionKey("User:1", "profile");

      expect(key).toBe("User:1.profile({})");
    });
  });

  describe("compileSelections", () => {
    it("emits a root key for each top-level field (entity or not)", () => {
      const data = {
        user: {
          __typename: "User",
          id: "1",
          name: "John"
        },

        stats: {
          totalUsers: 12,
          totalPosts: 34
        },
      };

      const result = selections.compileSelections(data);
      const keys = result.map((entry) => entry.key);

      expect(keys.length).toBe(2);
      expect(keys).toContain("user({})");
      expect(keys).toContain("stats({})");
    });

    it("emits only root keys when no selections are marked", () => {
      const data = {
        user: {
          __typename: "User",
          id: "u1",
          name: "John",

          posts: {
            __typename: "PostConnection",

            pageInfo: {
              hasNextPage: true,
              endCursor: "c2"
            },

            edges: [
              {
                cursor: "c1",

                node: {
                  __typename: "Post",
                  id: "p1",
                  title: "A"
                }
              },
              {
                cursor: "c2",

                node: {
                  __typename: "Post",
                  id: "p2",
                  title: "B"
                }
              },
            ],
          },
        },
      };

      const result = selections.compileSelections(data);
      const keys = result.map((entry) => entry.key);

      expect(keys.length).toBe(1);
      expect(keys).toContain("user({})");
    });

    it("emits marked nested selections in addition to root keys", () => {
      const data = {
        user: {
          __typename: "User",
          id: "u1",
          name: "John",

          posts: {
            __typename: "PostConnection",

            pageInfo: {
              hasNextPage: true,
              endCursor: "c2"
            },

            edges: [
              {
                cursor: "c1",
                node: {
                  __typename: "Post",
                  id: "p1",
                  title: "A"
                }
              },
              {
                cursor: "c2",
                node: {
                  __typename: "Post",
                  id: "p2",
                  title: "B"
                }
              },
            ],
          },
        },
      };

      selections.markSelection(data.user.posts, {
        entityKey: "User:u1",
        field: "posts",
        args: { first: 2 },
      });

      const result = selections.compileSelections(data);
      const keys = result.map((entry) => entry.key);

      expect(keys).toContain("user({})");
      expect(keys).toContain('User:u1.posts({"first":2})');

      const postsEntry = result.find((entry) => entry.key === 'User:u1.posts({"first":2})')!;

      expect(postsEntry.subtree).toBe(data.user.posts);
      expect(postsEntry.subtree.edges.length).toBe(2);
      expect(postsEntry.subtree.pageInfo.hasNextPage).toBe(true);
    });

    it("supports marking arbitrary nested objects (non-connection) as selections", () => {
      const data = {
        user: {
          __typename: "User",
          id: "u1",
          name: "Jack",

          profile: {
            __typename: "Profile",
            id: "p1",
            bio: "In the beginning there was Jack. And Jack had a groove."
          },
        },
      };

      selections.markSelection(data.user.profile, {
        entityKey: "User:u1",
        field: "profile",
        args: {},
      });

      const result = selections.compileSelections(data);
      const keys = result.map((entry) => entry.key);

      expect(keys).toContain("user({})");
      expect(keys).toContain("User:u1.profile({})");

      const profileEntry = result.find((entry) => entry.key === "User:u1.profile({})")!;

      expect(profileEntry.subtree).toBe(data.user.profile);
      expect(profileEntry.subtree.bio).toBe("In the beginning there was Jack. And Jack had a groove.");
    });

    it("returns an empty array when data is falsy or non-object", () => {
      expect(selections.compileSelections(null as any)).toEqual([]);
      expect(selections.compileSelections(undefined as any)).toEqual([]);
      expect(selections.compileSelections(123 as any)).toEqual([]);
      expect(selections.compileSelections("x" as any)).toEqual([]);
    });
  });
});
