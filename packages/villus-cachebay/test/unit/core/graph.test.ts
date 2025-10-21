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
      onChange: () => {
        // No-op for most tests
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
    it("stores record data and increments version", () => {
      expect(graph.getVersion("User:u1")).toBe(0);

      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });

      expect(graph.getRecord("User:u1")).toEqual({ __typename: "User", id: "u1", name: "Ada" });
      expect(graph.getVersion("User:u1")).toBe(1);
    });

    it("merges partial updates and increments version", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { email: "ada@example.com" });

      expect(graph.getVersion("User:u1")).toBe(2);
      expect(graph.getRecord("User:u1")).toEqual({
        __typename: "User",
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
      });
    });

    it("does not increment version when no changes occur", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);
    });

    it("stores normalized refs as-is", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "Title 1",
        author: { __ref: "User:u1" },
      });

      const post = graph.getRecord("Post:p1");
      expect(post?.author).toEqual({ __ref: "User:u1" });
    });
  });

  describe("getRecord", () => {
    it("returns undefined for non-existing records", () => {
      expect(graph.getRecord("User:u1")).toBeUndefined();
    });

    it("returns plain object with record data", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      const user = graph.getRecord("User:u1");

      expect(user).toEqual({ __typename: "User", id: "u1", name: "John" });
    });

    it("does not deep-materialize refs", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
        title: "Title 1",
        author: { __ref: "User:u1" },
      });

      const post = graph.getRecord("Post:p1");

      expect(post?.author).toEqual({ __ref: "User:u1" });
    });
  });

  describe("getVersion", () => {
    it("returns 0 for non-existing records", () => {
      expect(graph.getVersion("User:u1")).toBe(0);
      expect(graph.getVersion("Post:p1")).toBe(0);
    });

    it("returns 1 after first write", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      expect(graph.getVersion("User:u1")).toBe(1);
    });

    it("increments on each update", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { name: "Jane" });
      expect(graph.getVersion("User:u1")).toBe(2);

      graph.putRecord("User:u1", { email: "jane@example.com" });
      expect(graph.getVersion("User:u1")).toBe(3);
    });

    it("does not increment when no changes occur", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);
    });

    it("tracks versions independently per record", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", name: "Jane" });

      expect(graph.getVersion("User:u1")).toBe(1);
      expect(graph.getVersion("User:u2")).toBe(1);

      graph.putRecord("User:u1", { name: "John Updated" });

      expect(graph.getVersion("User:u1")).toBe(2);
      expect(graph.getVersion("User:u2")).toBe(1);
    });

    it("resets to 0 after removeRecord", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graph.putRecord("User:u1", { name: "Jane" });

      expect(graph.getVersion("User:u1")).toBe(2);

      graph.removeRecord("User:u1");

      expect(graph.getVersion("User:u1")).toBe(0);
    });

    it("starts from 1 after recreating removed record", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.removeRecord("User:u1");
      expect(graph.getVersion("User:u1")).toBe(0);

      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Jane" });
      expect(graph.getVersion("User:u1")).toBe(1);
    });

    it("increments for null value changes", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "john@example.com" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { email: null });
      expect(graph.getVersion("User:u1")).toBe(2);
    });

    it("does not increment for undefined values (no-op)", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.putRecord("User:u1", { email: undefined });
      expect(graph.getVersion("User:u1")).toBe(1);
    });
  });

  describe("removeRecord", () => {
    it("removes record and version from store", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      expect(graph.getRecord("User:u1")).toBeDefined();
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.removeRecord("User:u1");

      expect(graph.getRecord("User:u1")).toBeUndefined();
      expect(graph.getVersion("User:u1")).toBe(0);
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
    it("clears all records and versions", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });

      expect(graph.getVersion("User:u1")).toBe(1);
      expect(graph.getVersion("Post:p1")).toBe(1);

      graph.clear();

      expect(graph.keys().length).toBe(0);
      expect(graph.getVersion("User:u1")).toBe(0);
      expect(graph.getVersion("Post:p1")).toBe(0);
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

  describe("onChange", () => {
    it("notifies listener when records change", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(new Set(["User:u1"]));
    });

    it("batches multiple changes in single microtask", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graphWithListener.putRecord("User:u2", { __typename: "User", id: "u2", name: "Jane" });
      graphWithListener.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title" });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(new Set(["User:u1", "User:u2", "Post:p1"]));
    });

    it("notifies for ROOT_ID field-level changes", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("@", { users: { __ref: "User:u1" } });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(1);
      const changeArray = Array.from(changes[0]);
      expect(changeArray).toContain("@.users");
      expect(changeArray).toContain("@");
    });

    it("notifies when record is removed", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      await new Promise(resolve => setTimeout(resolve, 0));

      changes.length = 0;

      graphWithListener.removeRecord("User:u1");
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(new Set(["User:u1"]));
    });

    it("does not notify when no changes occur", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      await new Promise(resolve => setTimeout(resolve, 0));

      changes.length = 0;

      graphWithListener.putRecord("User:u1", { name: "John" });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(0);
    });

    it("can flush changes synchronously", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      expect(changes).toHaveLength(0);

      graphWithListener.flush();

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(new Set(["User:u1"]));
    });
  });

  describe("flush", () => {
    it("flushes pending changes immediately", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graphWithListener.putRecord("User:u2", { __typename: "User", id: "u2", name: "Jane" });

      expect(changes).toHaveLength(0);

      graphWithListener.flush();

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual(new Set(["User:u1", "User:u2"]));
    });

    it("does nothing when no pending changes", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.flush();

      expect(changes).toHaveLength(0);
    });

    it("clears pending changes after flush", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graphWithListener.flush();

      expect(changes).toHaveLength(1);

      graphWithListener.flush();

      expect(changes).toHaveLength(1);
    });

    it("can be called multiple times safely", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.flush();
      graphWithListener.flush();
      graphWithListener.flush();

      expect(changes).toHaveLength(0);
    });

    it("prevents microtask flush after manual flush", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });

      graphWithListener.flush();

      expect(changes).toHaveLength(1);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(changes).toHaveLength(1);
    });

    it("allows new changes after flush", () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
      graphWithListener.flush();

      expect(changes).toHaveLength(1);

      graphWithListener.putRecord("User:u2", { __typename: "User", id: "u2", name: "Jane" });
      graphWithListener.flush();

      expect(changes).toHaveLength(2);
      expect(changes[1]).toEqual(new Set(["User:u2"]));
    });
  });
});
