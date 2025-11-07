import { ROOT_ID } from "@/src/core/constants";
import {
  isObject,
  isEmptyObject,
  isDataDeepEqual,
  hasTypename,
  fingerprintNodes,
  recycleSnapshots,
} from "@/src/core/utils";
import { operations, createTestPlan } from "@/test/helpers";

describe("Utils", () => {
  describe("isObject", () => {
    it("returns true for plain objects", () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
      expect(isObject({ __typename: "User" })).toBe(true);
    });

    it("returns true for arrays", () => {
      expect(isObject([])).toBe(true);
      expect(isObject([1, 2, 3])).toBe(true);
    });

    it("returns false for null", () => {
      expect(isObject(null)).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isObject(42)).toBe(false);
      expect(isObject("string")).toBe(false);
      expect(isObject(true)).toBe(false);
      expect(isObject(undefined)).toBe(false);
    });

    it("returns true for class instances", () => {
      class CustomClass { }
      expect(isObject(new CustomClass())).toBe(true);
      expect(isObject(new Date())).toBe(true);
    });
  });

  describe("isEmptyObject", () => {
    it("returns true for empty plain objects", () => {
      expect(isEmptyObject({})).toBe(true);
      expect(isEmptyObject(Object.create(null))).toBe(true);
    });

    it("returns false for objects with properties", () => {
      expect(isEmptyObject({ a: 1 })).toBe(false);
      expect(isEmptyObject({ __typename: "User" })).toBe(false);
      expect(isEmptyObject({ a: undefined })).toBe(false); // undefined is still a property
    });

    it("returns false for null", () => {
      expect(isEmptyObject(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isEmptyObject(undefined)).toBe(false);
    });

    it("returns false for arrays (even empty ones)", () => {
      expect(isEmptyObject([])).toBe(false);
      expect(isEmptyObject([1, 2, 3])).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isEmptyObject(42)).toBe(false);
      expect(isEmptyObject("")).toBe(false);
      expect(isEmptyObject("string")).toBe(false);
      expect(isEmptyObject(true)).toBe(false);
      expect(isEmptyObject(false)).toBe(false);
    });

    it("returns false for class instances", () => {
      class CustomClass { }
      expect(isEmptyObject(new CustomClass())).toBe(false);
      expect(isEmptyObject(new Date())).toBe(false);
    });

    it("handles GraphQL subscription acknowledgment patterns", () => {
      // Common patterns from GraphQL servers
      expect(isEmptyObject({})).toBe(true); // Empty acknowledgment
      expect(isEmptyObject({ data: null })).toBe(false); // Has 'data' property
      expect(isEmptyObject({ data: {} })).toBe(false); // Has 'data' property
    });
  });

  describe("isDataDeepEqual", () => {
    describe("primitives", () => {
      it("compares primitives with ===", () => {
        expect(isDataDeepEqual(42, 42)).toBe(true);
        expect(isDataDeepEqual("hello", "hello")).toBe(true);
        expect(isDataDeepEqual(true, true)).toBe(true);
        expect(isDataDeepEqual(null, null)).toBe(true);
        expect(isDataDeepEqual(undefined, undefined)).toBe(true);
      });

      it("returns false for different primitives", () => {
        expect(isDataDeepEqual(42, 43)).toBe(false);
        expect(isDataDeepEqual("hello", "world")).toBe(false);
        expect(isDataDeepEqual(true, false)).toBe(false);
      });

      it("treats null and undefined as different", () => {
        expect(isDataDeepEqual(null, undefined)).toBe(false);
        expect(isDataDeepEqual(undefined, null)).toBe(false);
      });

      it("returns false for different types", () => {
        expect(isDataDeepEqual(42, "42")).toBe(false);
        expect(isDataDeepEqual(0, false)).toBe(false);
        expect(isDataDeepEqual("", false)).toBe(false);
      });
    });

    describe("__ref objects", () => {
      it("compares __ref objects by reference value", () => {
        const a = { __ref: "User:1" };
        const b = { __ref: "User:1" };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different __ref values", () => {
        const a = { __ref: "User:1" };
        const b = { __ref: "User:2" };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("ignores other properties when __ref is present", () => {
        const a = { __ref: "User:1", extra: "ignored" };
        const b = { __ref: "User:1", different: "also ignored" };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });
    });

    describe("__refs arrays", () => {
      it("compares __refs arrays shallowly", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1", "User:2"] };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different __refs arrays", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1", "User:3"] };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("returns false for different __refs array lengths", () => {
        const a = { __refs: ["User:1", "User:2"] };
        const b = { __refs: ["User:1"] };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });
    });

    describe("arrays", () => {
      it("compares arrays recursively", () => {
        expect(isDataDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(isDataDeepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
      });

      it("returns false for different array lengths", () => {
        expect(isDataDeepEqual([1, 2], [1, 2, 3])).toBe(false);
      });

      it("returns false for different array elements", () => {
        expect(isDataDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      });

      it("returns false when comparing array to non-array", () => {
        expect(isDataDeepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
      });
    });

    describe("objects", () => {
      it("compares plain objects recursively", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice", age: 30 };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("returns false for different key counts", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice" };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("returns false for different values", () => {
        const a = { name: "Alice", age: 30 };
        const b = { name: "Alice", age: 31 };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });

      it("compares nested objects", () => {
        const a = { user: { name: "Alice", posts: [{ id: "p1" }] } };
        const b = { user: { name: "Alice", posts: [{ id: "p1" }] } };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });
    });

    describe("complex scenarios", () => {
      it("handles normalized cache data with __ref", () => {
        const a = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        const b = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        expect(isDataDeepEqual(a, b)).toBe(true);
      });

      it("detects differences in nested cache data", () => {
        const a = {
          __typename: "Query",
          user: { __ref: "User:1" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        const b = {
          __typename: "Query",
          user: { __ref: "User:2" },
          posts: { __refs: ["Post:1", "Post:2"] },
        };
        expect(isDataDeepEqual(a, b)).toBe(false);
      });
    });
  });

  describe("hasTypename", () => {
    it("returns true for objects with __typename string", () => {
      expect(hasTypename({ __typename: "User" })).toBe(true);
      expect(hasTypename({ __typename: "Post", id: "p1" })).toBe(true);
    });

    it("returns false for objects without __typename", () => {
      expect(hasTypename({ id: "u1" })).toBe(false);
      expect(hasTypename({})).toBe(false);
    });

    it("returns false for __typename with non-string value", () => {
      expect(hasTypename({ __typename: 123 })).toBe(false);
      expect(hasTypename({ __typename: null })).toBe(false);
      expect(hasTypename({ __typename: undefined })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(hasTypename(null)).toBe(false);
      expect(hasTypename(undefined)).toBe(false);
      expect(hasTypename(42)).toBe(false);
      expect(hasTypename("User")).toBe(false);
      expect(hasTypename([])).toBe(false);
    });
  });

  describe("fingerprintNodes", () => {
    it("combines base node with child fingerprints", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 300]);
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe("number");
    });

    it("produces different fingerprints for different base nodes", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(101, [200, 300]);
      expect(fp1).not.toBe(fp2);
    });

    it("produces different fingerprints for different child nodes", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 301]);
      expect(fp1).not.toBe(fp2);
    });

    it("is order-dependent", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [300, 200]);
      expect(fp1).not.toBe(fp2);
    });

    it("handles empty child array", () => {
      const fp1 = fingerprintNodes(100, []);
      const fp2 = fingerprintNodes(100, []);
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe("number");
    });

    it("handles base node of 0 for arrays", () => {
      const fp1 = fingerprintNodes(0, [100, 200, 300]);
      const fp2 = fingerprintNodes(0, [100, 200, 300]);
      expect(fp1).toBe(fp2);
    });

    it("handles large child arrays", () => {
      const children = Array.from({ length: 100 }, (_, i) => i);
      const fp1 = fingerprintNodes(42, children);
      const fp2 = fingerprintNodes(42, children);
      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprints for different array lengths", () => {
      const fp1 = fingerprintNodes(100, [200, 300]);
      const fp2 = fingerprintNodes(100, [200, 300, 400]);
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("basic behavior", () => {
    it("reuses prevData when fingerprints match", () => {
      const prevData = { __typename: "User", id: "u1", name: "Alice" };
      const nextData = { __typename: "User", id: "u1", name: "Alice" };
      const prevFp = { __version: 123 };
      const nextFp = { __version: 123 };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(prevData);
      expect(result).not.toBe(nextData);
    });

    it("returns nextData when fingerprints differ", () => {
      const prevData = { __typename: "User", id: "u1", name: "Alice" };
      const nextData = { __typename: "User", id: "u1", name: "Bob" };
      const prevFp = { __version: 123 };
      const nextFp = { __version: 124 };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result).not.toBe(prevData);
    });

    it("returns same reference when prevData === nextData", () => {
      const data = { id: "u1", name: "Alice" };
      const fp = { __version: 123 };

      const result = recycleSnapshots(data, data, fp, fp);

      expect(result).toBe(data);
    });

    it("handles primitives and non-objects", () => {
      expect(recycleSnapshots(42, 42, undefined, undefined)).toBe(42);
      expect(recycleSnapshots("hello", "hello", undefined, undefined)).toBe("hello");
      expect(recycleSnapshots(true, false, undefined, undefined)).toBe(false);
      expect(recycleSnapshots(null, null, undefined, undefined)).toBe(null);
      expect(recycleSnapshots(undefined, undefined, undefined, undefined)).toBe(undefined);
    });

    it("does not recycle non-plain objects", () => {
      class CustomClass {
        value = 42;
      }

      const prevData = new CustomClass();
      const nextData = new CustomClass();
      const prevFp = { __version: 100 };
      const nextFp = { __version: 100 };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result).not.toBe(prevData);
    });
  });

  describe("partial recycling", () => {
    it("recycles unchanged subtrees in objects", () => {
      const prevUser = { __typename: "User", id: "u1", name: "Alice" };
      const prevData = {
        __typename: "Query",
        user: prevUser,
        count: 10,
      };
      const prevFp = {
        __version: 100,
        user: { __version: 200 },
      };

      const nextUser = { __typename: "User", id: "u1", name: "Alice" };
      const nextData = {
        __typename: "Query",
        user: nextUser,
        count: 11,
      };
      const nextFp = {
        __version: 101,
        user: { __version: 200 }, // Same fingerprint!
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result.user).toBe(prevUser); // Recycled!
    });

    it("recycles unchanged elements in arrays", () => {
      const prevItem1 = { __typename: "Post", id: "p1", title: "Post 1" };
      const prevItem2 = { __typename: "Post", id: "p2", title: "Post 2" };
      const prevData = [prevItem1, prevItem2];
      const prevFp = {
        __version: 500,
        0: { __version: 100 },
        1: { __version: 200 },
      };

      const nextItem1 = { __typename: "Post", id: "p1", title: "Post 1" };
      const nextItem2 = { __typename: "Post", id: "p2", title: "Post 2 Updated" };
      const nextData = [nextItem1, nextItem2];
      const nextFp = {
        __version: 501,
        0: { __version: 100 }, // Same!
        1: { __version: 201 }, // Changed!
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result[0]).toBe(prevItem1); // Recycled!
      expect(result[1]).toBe(nextItem2); // Not recycled
    });

    it("handles mixed arrays and objects with partial changes", () => {
      const prevUser1 = { __typename: "User", id: "u1", name: "Alice" };
      const prevUser2 = { __typename: "User", id: "u2", name: "Bob" };
      const prevUsers = [prevUser1, prevUser2];

      const prevData = {
        __typename: "Query",
        users: prevUsers,
        metadata: { __typename: "Metadata", count: 2 },
      };
      const prevFp = {
        __version: 300,
        users: {
          __version: 200,
          0: { __version: 100 },
          1: { __version: 101 },
        },
        metadata: { __version: 400 },
      };

      const nextUser1 = { __typename: "User", id: "u1", name: "Alice" };
      const nextUser2 = { __typename: "User", id: "u2", name: "Bob Updated" };
      const nextUsers = [nextUser1, nextUser2];

      const nextData = {
        __typename: "Query",
        users: nextUsers,
        metadata: { __typename: "Metadata", count: 2 },
      };
      const nextFp = {
        __version: 301,
        users: {
          __version: 201,
          0: { __version: 100 }, // Same!
          1: { __version: 102 }, // Changed!
        },
        metadata: { __version: 400 }, // Same!
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result.users[0]).toBe(prevUser1); // Recycled!
      expect(result.users[1]).toBe(nextUser2); // Not recycled
      expect(result.metadata).toBe(prevData.metadata); // Recycled!
    });

    it("recycles deep unchanged subtrees when middle level changes", () => {
      const prevLevel4 = { value: "deep" };
      const prevLevel3 = { level4: prevLevel4 };
      const prevLevel2 = { level3: prevLevel3 };
      const prevData = {
        level1: { level2: prevLevel2 },
      };
      const prevFp = {
        __version: 100,
        level1: {
          __version: 200,
          level2: {
            __version: 300,
            level3: {
              __version: 400,
              level4: { __version: 500 },
            },
          },
        },
      };

      const nextLevel4 = { value: "deep" };
      const nextLevel3 = { level4: nextLevel4 };
      const nextLevel2 = { level3: nextLevel3 }; // L2 changed!
      const nextData = {
        level1: { level2: nextLevel2 },
      };
      const nextFp = {
        __version: 101,
        level1: {
          __version: 201,
          level2: {
            __version: 301, // Changed!
            level3: {
              __version: 400, // Same!
              level4: { __version: 500 },
            },
          },
        },
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result.level1.level2.level3).toBe(prevLevel3); // L3 recycled!
      expect(result.level1.level2.level3.level4).toBe(prevLevel4); // L4 not traversed
    });

    it("recycles unchanged edges and pageInfo in connections", () => {
      const prevEdge1 = {
        __typename: "PostEdge",
        cursor: "c1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const prevEdge2 = {
        __typename: "PostEdge",
        cursor: "c2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const prevEdges = [prevEdge1, prevEdge2];

      const prevPageInfo = {
        __typename: "PageInfo",
        hasNextPage: true,
        endCursor: "c2",
      };

      const prevData = {
        __typename: "PostConnection",
        edges: prevEdges,
        pageInfo: prevPageInfo,
      };
      const prevFp = {
        __version: 500,
        edges: {
          __version: 300,
          0: { __version: 100, node: { __version: 200 } },
          1: { __version: 101, node: { __version: 201 } },
        },
        pageInfo: { __version: 400 },
      };

      // Next data: edge2 changed
      const nextEdge1 = {
        __typename: "PostEdge",
        cursor: "c1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const nextEdge2 = {
        __typename: "PostEdge",
        cursor: "c2",
        node: { __typename: "Post", id: "p2", title: "Post 2 Updated" },
      };
      const nextEdges = [nextEdge1, nextEdge2];

      const nextPageInfo = {
        __typename: "PageInfo",
        hasNextPage: true,
        endCursor: "c2",
      };

      const nextData = {
        __typename: "PostConnection",
        edges: nextEdges,
        pageInfo: nextPageInfo,
      };
      const nextFp = {
        __version: 501, // Changed!
        edges: {
          __version: 301, // Changed!
          0: { __version: 100, node: { __version: 200 } }, // Same!
          1: { __version: 102, node: { __version: 202 } }, // Changed!
        },
        pageInfo: { __version: 400 }, // Same!
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result.edges[0]).toBe(prevEdge1); // Recycled!
      expect(result.edges[1]).toBe(nextEdge2); // Not recycled
      expect(result.pageInfo).toBe(prevPageInfo); // Recycled!
    });

    it("recycles common prefix when array grows (pagination append)", () => {
      const prevEdge1 = {
        __typename: "PostEdge",
        cursor: "p1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const prevEdge2 = {
        __typename: "PostEdge",
        cursor: "p2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const prevEdges = [prevEdge1, prevEdge2];
      const prevFp = {
        __version: 300,
        0: { __version: 100, node: { __version: 200 } },
        1: { __version: 101, node: { __version: 201 } },
      };

      // Next data: array grew from 2 to 4 edges (appended new page)
      const nextEdge1 = {
        __typename: "PostEdge",
        cursor: "p1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const nextEdge2 = {
        __typename: "PostEdge",
        cursor: "p2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const nextEdge3 = {
        __typename: "PostEdge",
        cursor: "p3",
        node: { __typename: "Post", id: "p3", title: "Post 3" },
      };
      const nextEdge4 = {
        __typename: "PostEdge",
        cursor: "p4",
        node: { __typename: "Post", id: "p4", title: "Post 4" },
      };
      const nextEdges = [nextEdge1, nextEdge2, nextEdge3, nextEdge4];
      const nextFp = {
        __version: 301,
        0: { __version: 100, node: { __version: 200 } }, // Same!
        1: { __version: 101, node: { __version: 201 } }, // Same!
        2: { __version: 102, node: { __version: 202 } },
        3: { __version: 103, node: { __version: 203 } },
      };

      const result = recycleSnapshots(prevEdges, nextEdges, prevFp, nextFp);

      // Array reference should be nextEdges (different length)
      expect(result).toBe(nextEdges);
      // But first 2 edges should be recycled from prevEdges
      expect(result[0]).toBe(prevEdge1); // Recycled!
      expect(result[1]).toBe(prevEdge2); // Recycled!
      // New edges are not recycled (no previous version)
      expect(result[2]).toBe(nextEdge3);
      expect(result[3]).toBe(nextEdge4);
    });

    it("recycles elements when array is prepended", () => {
      const prevEdge1 = {
        __typename: "PostEdge",
        cursor: "p3",
        node: { __typename: "Post", id: "p3", title: "Post 3" },
      };
      const prevEdge2 = {
        __typename: "PostEdge",
        cursor: "p4",
        node: { __typename: "Post", id: "p4", title: "Post 4" },
      };
      const prevEdges = [prevEdge1, prevEdge2];
      const prevFp = {
        __version: 300,
        0: { __version: 100, node: { __version: 200 } },
        1: { __version: 101, node: { __version: 201 } },
      };

      // Next data: prepended 2 new edges at the start
      const nextEdge1 = {
        __typename: "PostEdge",
        cursor: "p1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const nextEdge2 = {
        __typename: "PostEdge",
        cursor: "p2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const nextEdge3 = {
        __typename: "PostEdge",
        cursor: "p3",
        node: { __typename: "Post", id: "p3", title: "Post 3" },
      };
      const nextEdge4 = {
        __typename: "PostEdge",
        cursor: "p4",
        node: { __typename: "Post", id: "p4", title: "Post 4" },
      };
      const nextEdges = [nextEdge1, nextEdge2, nextEdge3, nextEdge4];
      const nextFp = {
        __version: 301,
        0: { __version: 102, node: { __version: 202 } },
        1: { __version: 103, node: { __version: 203 } },
        2: { __version: 100, node: { __version: 200 } }, // Same as prevEdge1!
        3: { __version: 101, node: { __version: 201 } }, // Same as prevEdge2!
      };

      const result = recycleSnapshots(prevEdges, nextEdges, prevFp, nextFp);

      // Array reference should be nextEdges (different length)
      expect(result).toBe(nextEdges);
      // First 2 edges are new (not recycled)
      expect(result[0]).toBe(nextEdge1);
      expect(result[1]).toBe(nextEdge2);
      // Last 2 edges should be recycled from prevEdges
      expect(result[2]).toBe(prevEdge1); // Recycled!
      expect(result[3]).toBe(prevEdge2); // Recycled!
    });

    it("recycles common prefix when array shrinks", () => {
      const prevEdge1 = {
        __typename: "PostEdge",
        cursor: "p1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const prevEdge2 = {
        __typename: "PostEdge",
        cursor: "p2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const prevEdge3 = {
        __typename: "PostEdge",
        cursor: "p3",
        node: { __typename: "Post", id: "p3", title: "Post 3" },
      };
      const prevEdges = [prevEdge1, prevEdge2, prevEdge3];
      const prevFp = {
        __version: 300,
        0: { __version: 100, node: { __version: 200 } },
        1: { __version: 101, node: { __version: 201 } },
        2: { __version: 102, node: { __version: 202 } },
      };

      // Next data: array shrunk from 3 to 2 edges
      const nextEdge1 = {
        __typename: "PostEdge",
        cursor: "p1",
        node: { __typename: "Post", id: "p1", title: "Post 1" },
      };
      const nextEdge2 = {
        __typename: "PostEdge",
        cursor: "p2",
        node: { __typename: "Post", id: "p2", title: "Post 2" },
      };
      const nextEdges = [nextEdge1, nextEdge2];
      const nextFp = {
        __version: 301,
        0: { __version: 100, node: { __version: 200 } }, // Same!
        1: { __version: 101, node: { __version: 201 } }, // Same!
      };

      const result = recycleSnapshots(prevEdges, nextEdges, prevFp, nextFp);

      // Array reference should be nextEdges (different length)
      expect(result).toBe(nextEdges);
      // But first 2 edges should be recycled from prevEdges
      expect(result[0]).toBe(prevEdge1); // Recycled!
      expect(result[1]).toBe(prevEdge2); // Recycled!
    });

    it("recycles unchanged posts in nested connections", () => {
      const prevComment1 = {
        __typename: "Comment",
        id: "c1",
        text: "Comment 1",
      };
      const prevCommentEdges = [prevComment1];

      const prevPost1 = {
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        comments: {
          __typename: "CommentConnection",
          edges: prevCommentEdges,
        },
      };

      const prevPost2 = {
        __typename: "Post",
        id: "p2",
        title: "Post 2",
        comments: {
          __typename: "CommentConnection",
          edges: [],
        },
      };

      const prevPostEdges = [prevPost1, prevPost2];

      const prevData = {
        __typename: "Query",
        user: {
          __typename: "User",
          id: "u1",
          posts: {
            __typename: "PostConnection",
            edges: prevPostEdges,
          },
        },
      };
      const prevFp = {
        __version: 600,
        user: {
          __version: 700,
          posts: {
            __version: 800,
            edges: {
              __version: 500,
              0: {
                __version: 300,
                comments: {
                  __version: 400,
                  edges: {
                    __version: 200,
                    0: { __version: 100 },
                  },
                },
              },
              1: {
                __version: 350,
                comments: {
                  __version: 450,
                  edges: { __version: 0 },
                },
              },
            },
          },
        },
      };

      // Next data: comment in post1 changed
      const nextComment1 = {
        __typename: "Comment",
        id: "c1",
        text: "Comment 1 Updated",
      };
      const nextCommentEdges = [nextComment1];

      const nextPost1 = {
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        comments: {
          __typename: "CommentConnection",
          edges: nextCommentEdges,
        },
      };

      const nextPost2 = {
        __typename: "Post",
        id: "p2",
        title: "Post 2",
        comments: {
          __typename: "CommentConnection",
          edges: [],
        },
      };

      const nextPostEdges = [nextPost1, nextPost2];

      const nextData = {
        __typename: "Query",
        user: {
          __typename: "User",
          id: "u1",
          posts: {
            __typename: "PostConnection",
            edges: nextPostEdges,
          },
        },
      };
      const nextFp = {
        __version: 601, // Changed!
        user: {
          __version: 701, // Changed!
          posts: {
            __version: 801, // Changed!
            edges: {
              __version: 501, // Changed!
              0: {
                __version: 301, // Changed!
                comments: {
                  __version: 401, // Changed!
                  edges: {
                    __version: 201, // Changed!
                    0: { __version: 101 }, // Changed!
                  },
                },
              },
              1: {
                __version: 350, // Same!
                comments: {
                  __version: 450,
                  edges: { __version: 0 },
                },
              },
            },
          },
        },
      };

      const result = recycleSnapshots(prevData, nextData, prevFp, nextFp);

      expect(result).toBe(nextData);
      expect(result.user.posts.edges[1]).toBe(prevPost2); // Post2 recycled!
    });
  });
});
