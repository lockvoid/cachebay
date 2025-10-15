import { describe, it, expect, beforeEach } from "vitest";
import { createGraph } from "@/src/core/graph";
import { createSSR } from "@/src/core/ssr";
import { delay } from "@/test/helpers";
import { writeConnectionPage } from "@/test/helpers/unit";

describe("SSR", () => {
  let graph: ReturnType<typeof createGraph>;
  let ssr: ReturnType<typeof createSSR>;

  beforeEach(() => {
    graph = createGraph();
    ssr = createSSR({ hydrationTimeout: 5 }, { graph });
  });

  describe("hydrate", () => {
    it("accepts a function (stream-friendly) and toggles isHydrating()", async () => {
      const snapshot = {
        records: [
          ["@", { id: "@", __typename: "@", 'user({"id":"u2"})': { __ref: "User:u2" } }],
          ["User:u2", { __typename: "User", id: "u2", email: "u2@example.com" }],
        ] as Array<[string, any]>,
      };

      ssr.hydrate((emit) => {
        emit(snapshot);
      });

      expect(ssr.isHydrating()).toBe(true);
      await delay(10);
      expect(ssr.isHydrating()).toBe(false);

      const rootRecord = graph.getRecord("@");
      expect(rootRecord['user({"id":"u2"})'].__ref).toBe("User:u2");
      expect(graph.getRecord("User:u2").email).toBe("u2@example.com");
    });

    it("handles malformed snapshots gracefully (no throw)", async () => {
      ssr.hydrate({
        // Invalid snapshot...
      } as any);

      await delay(0);

      expect(graph.keys().length).toBe(0);

      ssr.hydrate({
        records: [null as any, ["User:x", null], ["User:y", 123], ["User:z", { __typename: "User", id: "z" }]],
      });

      await delay(0);

      expect(graph.getRecord("User:z")?.id).toBe("z");
    });
  });

  describe("dehydrate", () => {
    it("reflects runtime updates after hydrate", async () => {
      const snapshot = {
        records: [
          ["@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } }],
          ["User:u1", { __typename: "User", id: "u1", email: "u1@example.com" }],
        ] as Array<[string, any]>,
      };

      ssr.hydrate(snapshot);

      await delay(0);

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });

      const next = ssr.dehydrate();
      const recs = new Map(next.records);
      expect(recs.get("User:u1").email).toBe("u1+updated@example.com");
    });

    it("roundtrips all records with hydrate", async () => {
      graph.putRecord("@", { id: "@", __typename: "@", 'user({"id":"u1"})': { __ref: "User:u1" } });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1" });

      const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":1})';

      // Seed normalized connection page using the new helper
      writeConnectionPage(graph, pageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        pageInfo: { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        edges: [
          {
            __typename: "PostEdge",
            cursor: "p1",
            node: { __typename: "Post", id: "p1", title: "Post 1" },
          },
        ],
      });

      // 1) Dehydrate
      const snapshot = ssr.dehydrate();
      expect(() => JSON.stringify(snapshot)).not.toThrow();

      // 2) Clear and ensure empty
      graph.clear();
      expect(graph.keys().length).toBe(0);

      // 3) Hydrate
      ssr.hydrate(snapshot);
      expect(ssr.isHydrating()).toBe(true);
      await delay(10);
      expect(ssr.isHydrating()).toBe(false);

      // 4) Verify restored records
      const rootRecord = graph.getRecord("@");
      expect(rootRecord['user({"id":"u1"})'].__ref).toBe("User:u1");
      expect(graph.getRecord("User:u1").email).toBe("u1@example.com");

      const pageRecord = graph.getRecord(pageKey);
      expect(pageRecord.__typename).toBe("PostConnection");

      // pageInfo is stored by ref
      const pageInfoRef = pageRecord.pageInfo.__ref;
      const pageInfoRecord = graph.getRecord(pageInfoRef);
      expect(pageInfoRecord.endCursor).toBe("p1");

      // edges are stored as __refs
      const firstEdgeKey = pageRecord.edges.__refs[0];
      const edgeRecord = graph.getRecord(firstEdgeKey);
      expect(edgeRecord.cursor).toBe("p1");
      expect(edgeRecord.node.__ref).toBe("Post:p1");
    });
  });
});
