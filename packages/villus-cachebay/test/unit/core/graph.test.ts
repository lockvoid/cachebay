import { isReactive } from 'vue';
import { createGraph } from '@/src/core/graph';
import type { GraphAPI } from '@/src/core/graph';

const makeGraph = (overrides?: Partial<Parameters<typeof createGraph>[0]>): GraphAPI => {
  return createGraph({
    keys: {
      User: (object: { id: string }) => {
        return object.id;
      },

      Profile: (object: { id: string }) => {
        return object.id;
      },

      Post: (object: { id: string }) => {
        return object.id;
      },

      Comment: (object: { id: string }) => {
        return object.id;
      },

      Tag: (object: { id: string }) => {
        return object.id;
      },

      ...(overrides?.keys || {})
    },

    interfaces: {
      Post: ['AudioPost', 'VideoPost'],

      ...(overrides?.interfaces || {})
    },

    ...overrides,
  });
}

describe("Graph", () => {
  describe("identify", () => {
    it("returns canonical keys for base and interface implementors", () => {
      const graph = makeGraph();

      expect(graph.identify({ __typename: "Post", id: "1" })).toBe("Post:1");
      expect(graph.identify({ __typename: "AudioPost", id: "1" })).toBe("Post:1");
      expect(graph.identify({ __typename: "VideoPost", id: "1" })).toBe("Post:1");
    });

    it("supports custom keyers and ignores non-entities", () => {
      const graph = makeGraph({
        keys: {
          Profile: (object: any) => object?.uuid ?? null,
        },
      });

      expect(graph.identify({ __typename: "Profile", uuid: "profile-uuid-1" })).toBe("Profile:profile-uuid-1");
      expect(graph.identify({ __typename: "PageInfo", endCursor: "c2" })).toBe(null);
      expect(graph.identify({ foo: 1 })).toBe(null);
    });
  });

  describe("putEntity", () => {
    it("canonicalizes implementors and merges subsequent writes", () => {
      const graph = makeGraph();

      const firstKey = graph.putEntity({ __typename: "Post", id: "1", title: "A" });

      expect(firstKey).toBe("Post:1");
      expect(graph.getEntity("Post:1")).toEqual({ __typename: "Post", id: "1", title: "A" });

      const secondKey = graph.putEntity({ __typename: "AudioPost", id: "1", title: "B" });

      expect(secondKey).toBe("Post:1");
      expect(graph.getEntity("Post:1")).toEqual({ __typename: "AudioPost", id: "1", title: "B" });

      const thirdKey = graph.putEntity({ __typename: "VideoPost", id: "1", extra: "C" });

      expect(thirdKey).toBe("Post:1");
      expect(graph.getEntity("Post:1")).toEqual({ __typename: "VideoPost", id: "1", title: "B", extra: "C" });
    });

    it("normalizes nested references and leaves scalars embedded", () => {
      const graph = makeGraph();

      graph.putEntity({
        __typename: "Post",
        id: "p1",
        title: "A",

        author: {
          __typename: "User",
          id: "u1",
          name: "Ada"
        },

        links: [
          {
            __typename: "AudioPost",
            id: "p2",
            title: "Audio A",
          },

          {
            __typename: "VideoPost",
            id: "p3",
            title: "Video B",
          },
        ],

        tags: [
          "red",
          "blue",
        ],
      });

      const snapshot = graph.getEntity("Post:p1")!;

      expect(snapshot.author).toEqual({ __ref: "User:u1" });
      expect(snapshot.links).toEqual([{ __ref: "Post:p2" }, { __ref: "Post:p3" }]);
      expect(snapshot.tags).toEqual(["red", "blue"]);
    });

    it("embeds plain objects without identity, but normalizes objects with __typename+id", () => {
      const graph = makeGraph();

      graph.putEntity({
        __typename: "Post",
        id: "p1",

        color: {
          r: 1,
          g: 2,
          b: 3,
        },
      });

      graph.putEntity({
        __typename: "Post",
        id: "p2",

        tags: [
          {
            __typename: "Tag",
            id: "t1",
            label: "physics"
          }
        ],
      });

      expect(graph.getEntity("Post:p1")).toEqual({ __typename: "Post", id: "p1", color: { r: 1, g: 2, b: 3 } });
      expect(graph.getEntity("Post:p2")).toEqual({ __typename: "Post", id: "p2", tags: [{ __ref: "Tag:t1" }] });
      expect(graph.getEntity("Tag:t1")).toEqual({ __typename: "Tag", id: "t1", label: "physics" });
    });
  });

  describe("getEntity", () => {
    it("returns the normalized snapshot (identity + refs)", () => {
      const graph = makeGraph();

      graph.putEntity({
        __typename: "Post",
        id: "p1",
        title: "A",

        author: {
          __typename: "User",
          id: "u1",
          name: "Ada"
        },
      });

      expect(graph.getEntity("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "A", author: { __ref: "User:u1" } });
      expect(graph.getEntity("User:u1")).toEqual({ __typename: "User", id: "u1", name: "Ada" });
    });
  });

  describe("materializeEntity", () => {
    it("returns a shallow-reactive proxy and reflects subsequent entity writes", () => {
      const graph = makeGraph();

      graph.putEntity({ __typename: "User", id: "1", name: "John" });

      const user = graph.materializeEntity("User:1");

      expect(isReactive(user)).toBe(true);
      expect(user.name).toBe("John");

      graph.putEntity({ __typename: "User", id: "1", name: "John Updated" });

      expect(isReactive(user)).toBe(true);
      expect(user.name).toBe("John Updated");
    });

    it("materializes nested refs as proxies (arrays & objects)", () => {
      const graph = makeGraph();

      graph.putEntity({
        __typename: "Post",
        id: "p1",
        title: "P1",

        author: {
          __typename: "User",
          id: "u1",
          name: "Ada",
        },

        links: [{
          __typename: "Post",
          id: "p2",
          title: "P2",
        }],
      });

      const post = graph.materializeEntity("Post:p1");

      expect(isReactive(post.author)).toBe(true);
      expect(post.author).toEqual({ __typename: "User", id: "u1", name: "Ada" });
      expect(isReactive(post.links)).toBe(true);
      expect(post.links[0]).toEqual({ __typename: "Post", id: "p2", title: "P2" });
      expect(isReactive(post.links[0])).toBe(true);
    });
  });

  describe("removeEntity", () => {
    it("clears any live proxy (fully) and leaves no snapshot", () => {
      const graph = makeGraph();

      graph.putEntity({ __typename: "User", id: "1", name: "John", email: "j@example.com" });

      const user = graph.materializeEntity("User:1");

      expect(user).toEqual({ __typename: "User", id: "1", name: "John", email: "j@example.com" });

      graph.removeEntity("User:1");

      expect(user).toEqual({});
      expect(graph.getEntity("User:1")).toBeUndefined();
    });
  });

  describe("putSelection", () => {
    it("normalizes skeletons, indexes entity refs and refreshes live selection proxies", () => {
      const graph = makeGraph();

      const payload = {
        __typename: "User",
        id: "u1",
        name: "Ada",

        posts: {
          __typename: "PostConnection",

          pageInfo: {
            __typename: "PageInfo",
            endCursor: "c2",
            hasNextPage: true,
          },

          edges: [
            {
              cursor: "c1",

              node: {
                __typename: "Post",
                id: "p1",
                title: "P1"
              }
            },
            {
              cursor: "c2",

              node: {
                __typename: "Post",
                id: "p2",
                title: "P2"
              }
            },
          ],
        },
      };

      // Store selections

      graph.putSelection('user({"id":"1"})', payload);
      graph.putSelection('User:u1.posts({"first":2})', payload.posts);

      // Verify entities were normalized

      expect(graph.getEntity("User:u1")).toBeTruthy();
      expect(graph.getEntity("Post:p1")).toBeTruthy();
      expect(graph.getEntity("Post:p2")).toBeTruthy();

      // Verify skeleton contains refs

      const skeleton = graph.getSelection('User:u1.posts({"first":2})')!;

      expect(skeleton.edges[0].node).toEqual({ __ref: "Post:p1" });

      // Verify live selection materializes correctly

      const liveSelection = graph.materializeSelection('User:u1.posts({"first":2})');

      expect(Array.isArray(liveSelection.edges)).toBe(true);
      expect(liveSelection.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "P1" });
      expect(liveSelection.edges[1].node).toEqual({ __typename: "Post", id: "p2", title: "P2" });

      // Verify live selection updates when entity changes

      graph.putEntity({ __typename: "Post", id: "p1", title: "P1 (Updated)" });

      expect(liveSelection.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "P1 (Updated)" });
      expect(liveSelection.edges[1].node).toEqual({ __typename: "Post", id: "p2", title: "P2" });
    });
  });

  describe("getSelection", () => {
    it("returns normalized skeletons with __ref nodes", () => {
      const graph = makeGraph();

      graph.putSelection('featuredPost({})', { __typename: "Post", id: "p1", title: "T" });

      const skeleton = graph.getSelection('featuredPost({})')!;

      expect(skeleton).toEqual({ __ref: "Post:p1" });
    });
  });

  describe("materializeSelection", () => {
    it("returns a shallow-reactive wrapper tree, overlaying entity proxies", () => {
      const graph = makeGraph();

      const payload = {
        __typename: "PostConnection",

        pageInfo: {
          __typename: "PageInfo",
          endCursor: "c1",
          hasNextPage: false,
        },

        edges: [
          {
            cursor: "c1",

            node: {
              __typename: "Post",
              id: "p1",
              title: "P1"
            }
          },

          {
            cursor: "c2",

            node: {
              __typename: "Post",
              id: "p2",
              title: "P2"
            }
          }
        ],
      }

      graph.putEntity({ __typename: "User", id: "1", name: "Ada" });
      graph.putSelection('User:1.posts({"first":1})', payload);

      const selection = graph.materializeSelection('User:1.posts({"first":1})');

      expect(isReactive(selection)).toBe(true);
      expect(isReactive(selection.edges)).toBe(true);

      expect(isReactive(selection.edges[0].node)).toBe(true);
      expect(selection.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "P1" });

      expect(isReactive(selection.edges[1].node)).toBe(true);
      expect(selection.edges[1].node).toEqual({ __typename: "Post", id: "p2", title: "P2" });
    });
  });

  describe("removeSelection", () => {
    it("clears the live wrapper but leaves entities intact", () => {
      const graph = makeGraph();

      graph.putSelection('user({"id":"1"})', { __typename: "User", id: "1", name: "Ada" });

      const selection = graph.materializeSelection('user({"id":"1"})');

      expect(selection).toEqual({ __typename: "User", id: "1", name: "Ada" });

      graph.removeSelection('user({"id":"1"})')

      expect(selection).toEqual({});
      expect(graph.getEntity("User:1")).toEqual({ __typename: "User", id: "1", name: "Ada" });
    });
  });

  describe("listEntityKeys", () => {
    it("lists entity keys", () => {
      const graph = makeGraph();

      graph.putEntity({ __typename: "User", id: "1", name: "Ada" });
      graph.putEntity({ __typename: "Post", id: "p1", title: "T" });

      expect(graph.listEntityKeys().sort()).toEqual(["Post:p1", "User:1"]);
    });
  });

  describe("listSelectionKeys", () => {
    it("lists selection keys", () => {
      const graph = makeGraph();

      graph.putSelection('user({"id":"1"})', { __typename: "User", id: "1" });
      graph.putSelection('featuredPost({})', { __typename: "Post", id: "p1" });

      expect(graph.listSelectionKeys().sort()).toEqual(["featuredPost({})", "user({\"id\":\"1\"})"]);
    });
  });

  describe("clear", () => {
    it("clears all selections and entities", () => {
      const graph = makeGraph();

      graph.putEntity({ __typename: "User", id: "1", name: "Ada" });
      graph.putEntity({ __typename: "Post", id: "p1", title: "T" });
      graph.putSelection('user({"id":"1"})', { __typename: "User", id: "1" });
      graph.putSelection('featuredPost({})', { __typename: "Post", id: "p1" });

      graph.clear();

      expect(graph.listSelectionKeys().length).toBe(0);
      expect(graph.listEntityKeys().length).toBe(0);
    });
  });

  describe("inspect", () => {
    it("exposes entities, selections, and config (keys/interfaces)", () => {
      const graph = makeGraph();

      graph.putEntity({ __typename: "User", id: "1", name: "Ada" });
      graph.putSelection('user({"id":"1"})', { __typename: "User", id: "1" });

      const snapshot = graph.inspect();

      expect(snapshot.entities["User:1"]).toEqual({ __typename: "User", id: "1", name: "Ada" });
      expect(snapshot.selections['user({"id":"1"})']).toEqual({ __ref: "User:1" });

      expect(Object.keys(snapshot.options.keys)).toEqual(["User", "Profile", "Post", "Comment", "Tag"]);
      expect(Object.keys(snapshot.options.interfaces)).toEqual(["Post"]);
    });
  });
});
