import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createInspect } from "@/src/core/inspect";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { createQueries } from "@/src/core/queries";
import { users } from "@/test/helpers/fixtures";
import { USER_QUERY, USER_FRAGMENT } from "@/test/helpers/operations";
import { writeConnectionPage } from "@/test/helpers/unit";

describe("Inspect", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonicalLayer: ReturnType<typeof createCanonical>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let documents: ReturnType<typeof createDocuments>;
  let queries: ReturnType<typeof createQueries>;
  let fragments: ReturnType<typeof createFragments>;
  let inspect: ReturnType<typeof createInspect>;

  beforeEach(() => {
    planner = createPlanner();

    graph = createGraph({
      keys: {
        User: (u) => u.id,
      },
      onChange: () => {},
    });

    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    canonicalLayer = createCanonical({ graph });
    optimistic = createOptimistic({ graph, canonical: canonicalLayer });

    documents = createDocuments({
      graph,
      planner,
      canonical: canonicalLayer,
    });

    queries = createQueries({
      documents,
      planner,
    });

    fragments = createFragments({
      graph,
      planner,
      documents,
    });

    inspect = createInspect({ graph, optimistic, queries, fragments });
  });

  describe("getEntityKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.getEntityKeys()).toEqual([]);
    });

    it("filters entity records excluding pages and edges", () => {
      graph.putRecord("@", { id: "@", __typename: "@" });
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
      graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });

      const pageKey = '@.User:u1.posts({"first":1})';
      writeConnectionPage(graph, pageKey, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        edges: [
          {
            __typename: "PostEdge",
            cursor: "p1",
            node: { __typename: "Post", id: "p1" },
          },
        ],
      });

      const entityRecordKeys = inspect.getEntityKeys().sort();
      expect(entityRecordKeys).toContain("User:u1");
      expect(entityRecordKeys).toContain("Post:p1");
      expect(entityRecordKeys).toContain("Post:p2");
      expect(entityRecordKeys.find((k) => k === "@")).toBeUndefined();
      expect(entityRecordKeys.find((k) => k === pageKey)).toBeUndefined();
      expect(entityRecordKeys.find((k) => k.includes(".edges."))).toBeUndefined();
    });

    it("filters by typename when provided", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });

      expect(inspect.getEntityKeys("User")).toEqual(["User:u1", "User:u2"]);
      expect(inspect.getEntityKeys("Post")).toEqual(["Post:p1"]);
      expect(inspect.getEntityKeys("Comment")).toEqual([]);
    });
  });

  describe("getConnectionKeys", () => {
    it("returns empty array for empty graph", () => {
      expect(inspect.getConnectionKeys()).toEqual([]);
    });

    it("maps root pages to @connection and strips pagination args", () => {
      const pageA = '@.posts({"category":"tech","first":1})';
      const pageB = '@.posts({"category":"tech","after":"p1","first":1})';
      const pageC = '@.posts({"category":"lifestyle","first":1})';

      writeConnectionPage(graph, pageA, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:t1" } }],
      });
      writeConnectionPage(graph, pageB, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "p2", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:t2" } }],
      });
      writeConnectionPage(graph, pageC, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "p3", endCursor: "p3", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:l1" } }],
      });

      const keys = inspect.getConnectionKeys({ parent: "Query", key: "posts" }).sort();

      expect(keys).toEqual(
        ['@connection.posts({"category":"lifestyle"})', '@connection.posts({"category":"tech"})'].sort(),
      );
    });

    it("scopes canonical keys by parent entity", () => {
      const u1A = '@.User:u1.posts({"category":"tech","first":1})';
      const u1B = '@.User:u1.posts({"category":"tech","after":"p2","first":1})';
      const u2A = '@.User:u2.posts({"category":"tech","first":1})';

      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });

      writeConnectionPage(graph, u1A, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "u1p1", endCursor: "u1p1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:u1t1" } }],
      });
      writeConnectionPage(graph, u1B, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "u1p2", endCursor: "u1p2", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:u1t2" } }],
      });
      writeConnectionPage(graph, u2A, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "u2p1", endCursor: "u2p1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:u2t1" } }],
      });

      const user1 = inspect.getConnectionKeys({ parent: { __typename: "User", id: "u1" }, key: "posts" });
      const user2 = inspect.getConnectionKeys({ parent: { __typename: "User", id: "u2" }, key: "posts" });

      expect(user1).toEqual(['@connection.User:u1.posts({"category":"tech"})']);
      expect(user2).toEqual(['@connection.User:u2.posts({"category":"tech"})']);
    });

    it("emits {} when only pagination args exist", () => {
      const onlyPaging = '@.posts({"first":10,"after":"c1"})';
      writeConnectionPage(graph, onlyPaging, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
        edges: [],
      });

      expect(inspect.getConnectionKeys({ parent: "Query", key: "posts" })).toEqual(["@connection.posts({})"]);
    });

    it("can be narrowed by argsFn predicate", () => {
      const tech = '@.posts({"category":"tech","first":1})';
      const life = '@.posts({"category":"lifestyle","first":1})';

      writeConnectionPage(graph, tech, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "t1", endCursor: "t1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:t1" } }],
      });
      writeConnectionPage(graph, life, {
        __typename: "PostConnection",
        pageInfo: { startCursor: "l1", endCursor: "l1", hasNextPage: false, hasPreviousPage: false },
        edges: [{ __typename: "PostEdge", node: { __typename: "Post", id: "Post:l1" } }],
      });

      const onlyTech = inspect.getConnectionKeys({
        parent: "Query",
        key: "posts",
        argsFn: (raw) => raw.includes('"category":"tech"'),
      });

      expect(onlyTech).toEqual(['@connection.posts({"category":"tech"})']);
    });
  });

  describe("getRecord", () => {
    it("returns undefined for non-existent record", () => {
      expect(inspect.getRecord("User:nonexistent")).toBeUndefined();
    });

    it("returns raw snapshot", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

      const raw = inspect.getRecord("User:u1");
      expect(raw).toEqual({ __typename: "User", id: "u1", email: "a@example.com" });
    });
  });

  describe("config", () => {
    it("exposes keys and interfaces used by the graph", () => {
      const cfg = inspect.config();

      expect(cfg).toBeTruthy();
      expect(cfg).toHaveProperty("keys");
      expect(cfg).toHaveProperty("interfaces");
      expect(typeof cfg.keys).toBe("object");
      expect(typeof cfg.interfaces).toBe("object");
    });
  });

  describe("queries", () => {
    it("returns queries inspect data", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      // Create watchers
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const queriesInspect = inspect.queries();

      expect(queriesInspect.watchersCount).toBe(2);
      expect(queriesInspect.getQueryWatchers(QUERY, { id: "u1" })).toBe(2);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("returns empty state when no query watchers", () => {
      const queriesInspect = inspect.queries();

      expect(queriesInspect.watchersCount).toBe(0);
    });
  });

  describe("fragments", () => {
    it("returns fragments inspect data", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      // Create watchers
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const fragmentsInspect = inspect.fragments();

      expect(fragmentsInspect.watchersCount).toBe(2);
      expect(fragmentsInspect.getFragmentWatchers("User:u1", FRAGMENT)).toBe(2);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("returns empty state when no fragment watchers", () => {
      const fragmentsInspect = inspect.fragments();

      expect(fragmentsInspect.watchersCount).toBe(0);
    });
  });
});
