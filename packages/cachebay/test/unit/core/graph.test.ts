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

    describe("changes", () => {
      describe("string values", () => {
        it("does not emit change when string value is the same", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { name: "John" });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when string value changes", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { name: "Jane" });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when empty string changes to non-empty", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { name: "John" });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("does not emit change for empty string to empty string", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { name: "" });
          expect(graph.getVersion("User:u1")).toBe(1);
        });
      });

      describe("number values", () => {
        it("does not emit change when number value is the same", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", age: 25 });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { age: 25 });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when number value changes", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", age: 25 });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { age: 26 });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("does not emit change for zero to zero", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", count: 0 });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { count: 0 });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when zero changes to non-zero", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", count: 0 });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { count: 1 });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change for NaN to number", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", value: NaN });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { value: 42 });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("does not emit change for NaN to NaN (NaN !== NaN)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", value: NaN });
          expect(graph.getVersion("User:u1")).toBe(1);

          // NaN !== NaN, so this should trigger a change
          graph.putRecord("User:u1", { value: NaN });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });

      describe("boolean values", () => {
        it("does not emit change when boolean value is the same (true)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", active: true });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { active: true });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("does not emit change when boolean value is the same (false)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", active: false });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { active: false });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when boolean value changes (true to false)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", active: true });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { active: false });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when boolean value changes (false to true)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", active: false });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { active: true });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });

      describe("null values", () => {
        it("does not emit change when null value stays null", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", email: null });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: null });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when null changes to string", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", email: null });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: "john@example.com" });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when string changes to null", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "john@example.com" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: null });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when null changes to number", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", age: null });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { age: 25 });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when null changes to boolean", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", active: null });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { active: true });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });

      describe("undefined values", () => {
        it("does not emit change when undefined is passed (no-op)", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: undefined });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("does not change existing field when undefined is passed", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John", email: "john@example.com" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: undefined });
          expect(graph.getVersion("User:u1")).toBe(1);
          expect(graph.getRecord("User:u1")?.email).toBe("john@example.com");
        });
      });

      describe("object values", () => {
        it("emits change when content changes", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", address: { city: "NYC", country: "USA" } });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { address: { city: "NYC", country: { city: "LA", country: "USA" } } });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("does not emit change when same object reference is used", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", address: { city: "NYC", country: "USA" } });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { address: { city: "NYC", country: "USA" } });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when empty object changes to non-empty", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", metadata: {} });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { metadata: { key: "value" } });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });

      describe("array values", () => {
        it("emits change when array content changes", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", tags: ["tag1", "tag2"] });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { tags: ["tag1", "tag3"] });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("does not emit change when same array reference is used", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", tags: ["tag1", "tag2"] });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { tags: ["tag1", "tag2"] });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when empty array changes to non-empty", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", tags: [] });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { tags: ["tag1"] });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when array length changes", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", tags: ["tag1"] });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { tags: ["tag1", "tag2"] });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });

      describe("mixed field updates", () => {
        it("does not emit change when all fields are the same", () => {
          graph.putRecord("User:u1", {
            __typename: "User",
            id: "u1",
            name: "John",
            age: 25,
            active: true,
            email: null,
            arr: [1, 2],
            obj: { key: "value" },
          });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", {
            name: "John",
            age: 25,
            active: true,
            email: null,
            arr: [1, 2],
            obj: { key: "value" },
          });
          expect(graph.getVersion("User:u1")).toBe(1);
        });

        it("emits change when at least one field changes", () => {
          graph.putRecord("User:u1", {
            __typename: "User",
            id: "u1",
            name: "John",
            age: 25,
            active: true,
          });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", {
            name: "John",  // same
            age: 26,       // changed
            active: true,   // same
          });
          expect(graph.getVersion("User:u1")).toBe(2);
        });

        it("emits change when adding new field", () => {
          graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "John" });
          expect(graph.getVersion("User:u1")).toBe(1);

          graph.putRecord("User:u1", { email: "john@example.com" });
          expect(graph.getVersion("User:u1")).toBe(2);
        });
      });
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

      // With global clock, versions are sequential across all records
      expect(graph.getVersion("User:u1")).toBe(1);
      expect(graph.getVersion("User:u2")).toBe(2);

      graph.putRecord("User:u1", { name: "John Updated" });

      expect(graph.getVersion("User:u1")).toBe(3);
      expect(graph.getVersion("User:u2")).toBe(2);
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

      // With global clock, next write gets next clock value (2), not 1
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Jane" });
      expect(graph.getVersion("User:u1")).toBe(2);
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

  describe("evictAll", () => {
    it("clears all records and versions", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Title 1" });

      // With global clock, versions are sequential
      expect(graph.getVersion("User:u1")).toBe(1);
      expect(graph.getVersion("Post:p1")).toBe(2);

      graph.evictAll();

      expect(graph.keys().length).toBe(0);
      expect(graph.getVersion("User:u1")).toBe(0);
      expect(graph.getVersion("Post:p1")).toBe(0);
    });

    it("resets version clock so next write starts from 1", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      expect(graph.getVersion("User:u1")).toBe(1);

      graph.evictAll();

      graph.putRecord("User:u2", { __typename: "User", id: "u2", name: "Bob" });
      expect(graph.getVersion("User:u2")).toBe(1);
    });

    it("does not fire pending onChange after evictAll", async () => {
      const changes: Set<string>[] = [];
      const graphWithListener = createGraph({
        onChange: (recordIds) => {
          changes.push(new Set(recordIds));
        },
      });

      graphWithListener.putRecord("User:u1", { __typename: "User", id: "u1", name: "Ada" });
      // Don't flush — changes are pending

      graphWithListener.evictAll();

      // Wait for microtask
      await new Promise(resolve => setTimeout(resolve, 0));

      // No onChange should have fired since pendingChanges was cleared
      expect(changes).toHaveLength(0);
    });

    it("identity still works after evictAll", () => {
      graph.identify({ __typename: "User", id: "u1" });

      graph.evictAll();

      expect(graph.identify({ __typename: "User", id: "u1" })).toBe("User:u1");
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
