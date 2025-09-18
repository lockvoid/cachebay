import { isReactive } from "vue";
import { createGraph } from "@/src/core/graph";
import type { GraphInstance } from "@/src/core/graph";

const makeGraph = (overrides?: Partial<Parameters<typeof createGraph>[0]>): GraphInstance => {
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

      ...(overrides?.keys || {}),
    },

    interfaces: {
      Post: ["AudioPost", "VideoPost"],

      ...(overrides?.interfaces || {}),
    },

    ...overrides,
  });
};

describe("Graph (low-level record store)", () => {
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

  describe("putRecord / getRecord", () => {
    it("merges subsequent writes and supports interface canonicalization via identify (done by caller)", () => {
      const graph = makeGraph();

      // Caller decides ids; graph shallow-merges by recordId
      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "A" });
      expect(graph.getRecord("Post:1")).toEqual({ __typename: "Post", id: "1", title: "A" });

      // Change typename to an implementor; store accepts it as-is
      graph.putRecord("Post:1", { __typename: "AudioPost" });
      expect(graph.getRecord("Post:1")).toEqual({ __typename: "AudioPost", id: "1", title: "A" });

      // Merge an extra field
      graph.putRecord("Post:1", { extra: "C" });
      expect(graph.getRecord("Post:1")).toEqual({ __typename: "AudioPost", id: "1", title: "A", extra: "C" });
    });

    it("stores normalized refs as-is and leaves plain objects embedded", () => {
      const graph = makeGraph();

      // Pre-normalized related records
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Audio A" });
      graph.putRecord("Post:p3", { __typename: "Post", id: "p3", title: "Video B" });

      // Parent with refs + scalar array + plain object
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "A",
        author: { __ref: "User:u1" },
        links: [{ __ref: "Post:p2" }, { __ref: "Post:p3" }],
        color: { r: 1, g: 2, b: 3 },
        tags: ["red", "blue"],
      });

      const snapshot = graph.getRecord("Post:p1")!;

      expect(snapshot.author).toEqual({ __ref: "User:u1" });
      expect(snapshot.links).toEqual([{ __ref: "Post:p2" }, { __ref: "Post:p3" }]);
      expect(snapshot.color).toEqual({ r: 1, g: 2, b: 3 });
      expect(snapshot.tags).toEqual(["red", "blue"]);
    });
  });

  describe("materializeRecord", () => {
    it("returns a shallow-reactive empty proxy unless the record is existing", () => {
      const graph = makeGraph();

      const userProxy = graph.materializeRecord("User:1")!;

      expect(isReactive(userProxy)).toBe(true);
      expect(userProxy).toEqual({});
    });

    it("returns a shallow-reactive proxy and reflects subsequent record writes", () => {
      const graph = makeGraph();

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "John" });

      const userProxy = graph.materializeRecord("User:1")!;

      expect(isReactive(userProxy)).toBe(true);
      expect(userProxy.name).toBe("John");

      graph.putRecord("User:1", { name: "John Updated" });

      expect(isReactive(userProxy)).toBe(true);
      expect(userProxy.name).toBe("John Updated");
    });

    it("does not deep-materialize { __ref } (values are assigned as-is); referenced records can be materialized separately", () => {
      const graph = makeGraph();

      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });

      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "P1",
        author: { __ref: "User:u1" },
        links: [{ __ref: "Post:p2" }],
      });

      const postProxy = graph.materializeRecord("Post:p1")!;

      // Shallow reactive: nested values are whatever was stored (normalized)
      expect(isReactive(postProxy)).toBe(true);
      expect(postProxy.author).toEqual({ __ref: "User:u1" });
      expect(Array.isArray(postProxy.links)).toBe(true);
      expect(postProxy.links[0]).toEqual({ __ref: "Post:p2" });

      // Caller can materialize a referenced record when needed
      const authorProxy = graph.materializeRecord("User:u1")!;
      expect(isReactive(authorProxy)).toBe(true);
      expect(authorProxy).toEqual({ __typename: "User", id: "u1", name: "Ada" });
    });
  });

  describe("removeRecord", () => {
    it("clears any live proxy (fully) and leaves no snapshot", () => {
      const graph = makeGraph();

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "John", email: "j@example.com" });

      const userProxy = graph.materializeRecord("User:1")!;

      expect(userProxy).toEqual({ __typename: "User", id: "1", name: "John", email: "j@example.com" });

      graph.removeRecord("User:1");

      expect(userProxy).toEqual({});
      expect(graph.getRecord("User:1")).toBeUndefined();
    });
  });

  describe("keys", () => {
    it("lists record ids", () => {
      const graph = makeGraph();

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "T" });

      expect(graph.keys().sort()).toEqual(["Post:p1", "User:1"]);
    });
  });

  describe("clear", () => {
    it("clears all records", () => {
      const graph = makeGraph();

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "T" });

      graph.clear();

      expect(graph.keys().length).toBe(0);
    });
  });

  describe("inspect", () => {
    it("exposes records and config (keys/interfaces)", () => {
      const graph = makeGraph();

      graph.putRecord("User:1", { __typename: "User", id: "1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "T" });

      const snapshot = graph.inspect();

      expect(snapshot.records["User:1"]).toEqual({ __typename: "User", id: "1", name: "Ada" });
      expect(snapshot.records["Post:p1"]).toEqual({ __typename: "Post", id: "p1", title: "T" });

      expect(Object.keys(snapshot.options.keys).sort()).toEqual(["Comment", "Post", "Profile", "Tag", "User"]);
      expect(Object.keys(snapshot.options.interfaces)).toEqual(["Post"]);
    });
  });
});
