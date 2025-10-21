import { isReactive } from "vue";
import { createGraph } from "@/src/core/graph";
import type { GraphInstance } from "@/src/core/graph";

describe("core/graph.ts", () => {
  let graph: GraphInstance;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        Profile: (object: any) => object?.uuid ?? null,
      },

      interfaces: {
        Post: ["AudioPost", "VideoPost"],
      },
    });
  });

  describe("identify", () => {
    it("returns canonical keys for base and interface implementors", () => {
      expect(graph.identify({ __typename: "Post", id: "p1" })).toBe("Post:p1");
      expect(graph.identify({ __typename: "AudioPost", id: "p1" })).toBe("Post:p1");
      expect(graph.identify({ __typename: "VideoPost", id: "p1" })).toBe("Post:p1");
    });

    it("supports custom keyers and ignores non-entities", () => {
      expect(graph.identify({ __typename: "Profile", uuid: "profile-uuid-1" })).toBe("Profile:profile-uuid-1");
      expect(graph.identify({ __typename: "PageInfo", endCursor: "c2" })).toBe(null);
      expect(graph.identify({ foo: 1 })).toBe(null);
    });

    it("handles falsy but valid IDs", () => {
      expect(graph.identify({ __typename: "User", id: "0" })).toBe("User:0");
      expect(graph.identify({ __typename: "User", id: "" })).toBe("User:");
      expect(graph.identify({ __typename: "User", id: false })).toBe("User:false");
    });

    it("normalizes numeric IDs to strings", () => {
      expect(graph.identify({ __typename: "User", id: 123 })).toBe("User:123");
      expect(graph.identify({ __typename: "User", id: 0 })).toBe("User:0");
    });

    it("handles null and undefined IDs", () => {
      expect(graph.identify({ __typename: "User", id: null })).toBe(null);
      expect(graph.identify({ __typename: "User", id: undefined })).toBe(null);
      expect(graph.identify({ __typename: "User" })).toBe(null);
    });
  });

  describe("putRecord", () => {
    it("merges subsequent writes and supports interface canonicalization", () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });
      expect(graph.getRecord("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "Title 1" });

      graph.putRecord("Post:p1", { __typename: "AudioPost" });
      expect(graph.getRecord("Post:p1")).toEqual({ __typename: "AudioPost", id: "p1", title: "Title 1" });

      graph.putRecord("Post:p1", { extra: "C" });
      expect(graph.getRecord("Post:p1")).toEqual({ __typename: "AudioPost", id: "p1", title: "Title 1", extra: "C" });
    });

    it("stores normalized refs as-is and leaves plain objects embedded", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Title 2" });
      graph.putRecord("Post:p3", { __typename: "Post", id: "p3", title: "Title 3" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1", author: { __ref: "User:u1" }, links: [{ __ref: "Post:p2" }, { __ref: "Post:p3" }], tags: ["red", "green", "blue"], color: { r: 1, g: 2, b: 3 } });

      const snapshot = graph.getRecord("Post:p1")!;

      expect(snapshot.author).toEqual({ __ref: "User:u1" });
      expect(snapshot.links).toEqual([{ __ref: "Post:p2" }, { __ref: "Post:p3" }]);
      expect(snapshot.tags).toEqual(["red", "green", "blue"]);
      expect(snapshot.color).toEqual({ r: 1, g: 2, b: 3 });
    });

    it("keeps existing scalar fields when patched with undefined (snapshot)", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "john@example.com", name: "John" });

      // Patch with undefined should NOT delete existing fields.
      graph.putRecord("User:u1", { email: undefined, name: undefined });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        email: "john@example.com",
        name: "John",
      });
    });

    it("keeps existing collection/object fields when patched with undefined (snapshot)", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        tags: ["react", "ts"],
        meta: { r: 1, g: 2, b: 3 },
      });

      // Patch with undefined should NOT delete or alter existing fields.
      graph.putRecord("Post:p1", { tags: undefined, meta: undefined });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        tags: ["react", "ts"],
        meta: { r: 1, g: 2, b: 3 },
      });
    });

    it("stores null values for scalar fields", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "John",
        email: "john@example.com",
      });

      graph.putRecord("User:u1", { email: null });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        name: "John",
        email: null,
      });
    });

    it("stores null values for reference fields", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "Title",
        author: { __ref: "User:u1" },
      });

      graph.putRecord("Post:p1", { author: null });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Title",
        author: null,
      });
    });

    it("stores null values for array fields", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "Title",
        tags: ["react", "vue"],
      });

      graph.putRecord("Post:p1", { tags: null });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Title",
        tags: null,
      });
    });

    it("stores null values for object fields", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "Title",
        metadata: { views: 100, likes: 50 },
      });

      graph.putRecord("Post:p1", { metadata: null });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        title: "Title",
        metadata: null,
      });
    });

    it("distinguishes between null and undefined", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "John",
        email: "john@example.com",
        phone: "555-1234",
      });

      graph.putRecord("User:u1", {
        email: null,
        phone: undefined,
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        name: "John",
        email: null,
        phone: "555-1234",
      });
    });

    it("handles null ID correctly", () => {
      graph.putRecord("User:temp", { __typename: "User", id: null, name: "Guest" });

      expect(graph.getRecord("User:temp")).toEqual({
        __typename: "User",
        id: null,
        name: "Guest",
      });
    });

    it("can update null field back to a value", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        email: null,
      });

      expect(graph.getRecord("User:u1")?.email).toBeNull();

      graph.putRecord("User:u1", { email: "john@example.com" });

      expect(graph.getRecord("User:u1")?.email).toBe("john@example.com");
    });

    it("handles PageInfo with null cursors", () => {
      graph.putRecord("PageInfo:1", {
        __typename: "PageInfo",
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      });

      expect(graph.getRecord("PageInfo:1")).toEqual({
        __typename: "PageInfo",
        startCursor: null,
        endCursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it("handles connection edges with null cursors", () => {
      graph.putRecord("PostEdge:1", {
        __typename: "PostEdge",
        cursor: null,
        node: { __ref: "Post:p1" },
      });

      expect(graph.getRecord("PostEdge:1")).toEqual({
        __typename: "PostEdge",
        cursor: null,
        node: { __ref: "Post:p1" },
      });
    });

    it("handles empty string values", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "",
        email: "",
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        name: "",
        email: "",
      });
    });

    it("handles zero values", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        views: 0,
        likes: 0,
      });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        views: 0,
        likes: 0,
      });
    });

    it("handles boolean false values", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        isActive: false,
        emailVerified: false,
      });

      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        isActive: false,
        emailVerified: false,
      });
    });

    it("handles empty arrays", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        tags: [],
        comments: [],
      });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        tags: [],
        comments: [],
      });
    });

    it("handles empty objects", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        metadata: {},
      });

      expect(graph.getRecord("Post:p1")).toEqual({
        __typename: "Post",
        id: "p1",
        metadata: {},
      });
    });

    it("handles deeply nested null values", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        metadata: {
          author: null,
          stats: {
            views: null,
            likes: 10,
          },
        },
      });

      expect(graph.getRecord("Post:p1")?.metadata).toEqual({
        author: null,
        stats: {
          views: null,
          likes: 10,
        },
      });
    });

    it("handles NaN values", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        score: NaN,
      });

      expect(graph.getRecord("Post:p1")?.score).toBeNaN();
    });

    it("handles Infinity values", () => {
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        maxValue: Infinity,
        minValue: -Infinity,
      });

      const post = graph.getRecord("Post:p1");
      expect(post?.maxValue).toBe(Infinity);
      expect(post?.minValue).toBe(-Infinity);
    });

    it("handles large numbers", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        balance: 9007199254740991,
      });

      expect(graph.getRecord("User:u1")?.balance).toBe(9007199254740991);
    });
  });

  describe("getRecord", () => {
    it("returns stored record data", () => {
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });
      expect(graph.getRecord("Post:p1")).toEqual({ __typename: "Post", id: "p1", title: "Title 1" });
    });
  });

  describe("materializeRecord", () => {
    it("returns a shallow-reactive empty proxy for non-existing records", () => {
      const user1 = graph.materializeRecord("User:u1")!;

      expect(isReactive(user1)).toBe(true);
      expect(user1).toEqual({});
    });

    it("returns a shallow-reactive proxy and reflects subsequent record writes", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      const user1 = graph.materializeRecord("User:u1")!;

      expect(isReactive(user1)).toBe(true);
      expect(user1.name).toBe("John");

      graph.putRecord("User:u1", { name: "John Updated" });

      expect(isReactive(user1)).toBe(true);
      expect(user1.name).toBe("John Updated");
    });

    it("does not deep-materialize refs and allows separate materialization", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Title 2" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1", author: { __ref: "User:u1" }, links: [{ __ref: "Post:p2" }] });

      const post1 = graph.materializeRecord("Post:p1")!;

      expect(isReactive(post1)).toBe(true);
      expect(post1.author).toEqual({ __ref: "User:u1" });
      expect(post1.links).toEqual([{ __ref: "Post:p2" }]);

      const user1 = graph.materializeRecord("User:u1")!;

      expect(isReactive(user1)).toBe(true);
      expect(user1).toEqual({ __typename: "User", id: "u1", name: "Ada" });
    });

    it("returns same proxy instance for multiple calls", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      const user1 = graph.materializeRecord("User:u1");
      const user2 = graph.materializeRecord("User:u1");
      const user3 = graph.materializeRecord("User:u1");

      expect(user1).toBe(user2);
      expect(user2).toBe(user3);
    });

    it("reuses existing proxy after updates", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      const user1 = graph.materializeRecord("User:u1");

      graph.putRecord("User:u1", { name: "Jane" });

      const user2 = graph.materializeRecord("User:u1");

      expect(user1).toBe(user2);
      expect(user1.name).toBe("Jane");
    });

    it("reflects null values in materialized proxies", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "John",
        email: "john@example.com",
      });

      const user = graph.materializeRecord("User:u1");
      expect(user.email).toBe("john@example.com");

      graph.putRecord("User:u1", { email: null });

      expect(user.email).toBeNull();
    });

    it("reflects field added after materialization", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "John",
      });

      const user = graph.materializeRecord("User:u1");
      expect(user.email).toBeUndefined();

      graph.putRecord("User:u1", { email: "john@example.com" });

      expect(user.email).toBe("john@example.com");
    });

    it("reflects field changed to null", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        email: "john@example.com",
      });

      const user = graph.materializeRecord("User:u1");
      expect(user.email).toBe("john@example.com");

      graph.putRecord("User:u1", { email: null });

      expect(user.email).toBeNull();
    });

    it("reflects field changed from null to value", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        email: null,
      });

      const user = graph.materializeRecord("User:u1");
      expect(user.email).toBeNull();

      graph.putRecord("User:u1", { email: "john@example.com" });

      expect(user.email).toBe("john@example.com");
    });
  });

  describe("removeRecord", () => {
    it("clears any live proxy and removes record snapshot", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John", email: "john@example.com" });

      const user1 = graph.materializeRecord("User:u1")!;

      expect(user1).toEqual({ __typename: "User", id: "u1", name: "John", email: "john@example.com" });

      graph.removeRecord("User:u1");

      expect(user1).toEqual({});
      expect(graph.getRecord("User:u1")).toBeUndefined();
    });

    it("handles proxy after record is cleared and recreated", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "John",
      });

      const user = graph.materializeRecord("User:u1");
      expect(user.name).toBe("John");

      graph.removeRecord("User:u1");
      expect(user).toEqual({});

      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        name: "Jane",
      });

      expect(user).toEqual({});

      const user2 = graph.materializeRecord("User:u1");
      expect(user2.name).toBe("Jane");
      expect(user2).not.toBe(user);
    });
  });

  describe("keys", () => {
    it("lists record ids", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });

      expect(graph.keys().sort()).toEqual(["Post:p1", "User:u1"]);
    });
  });

  describe("clear", () => {
    it("clears all records", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });

      graph.clear();

      expect(graph.keys().length).toBe(0);
    });
  });

  describe("inspect", () => {
    it("exposes records and config", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });

      const snapshot = graph.inspect();

      expect(snapshot.records["User:u1"]).toEqual({ __typename: "User", id: "u1", name: "Ada" });
      expect(snapshot.records["Post:p1"]).toEqual({ __typename: "Post", id: "p1", title: "Title 1" });

      expect(Object.keys(snapshot.options.keys)).toEqual(["Profile"]);
      expect(Object.keys(snapshot.options.interfaces)).toEqual(["Post"]);
    });
  });
});
