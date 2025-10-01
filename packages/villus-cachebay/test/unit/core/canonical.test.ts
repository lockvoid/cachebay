import type { PlanField } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { writePageSnapshot } from "@/test/helpers/unit";

const POSTS_PLAN_FIELD: PlanField = {
  fieldName: "posts",
  responseKey: "posts",
  isConnection: true,
  connectionMode: "infinite",
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

const USERS_PLAN_FIELD: PlanField = {
  fieldName: "users",
  responseKey: "users",
  isConnection: true,
  connectionMode: "infinite",
  connectionFilters: ["role"],
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

describe("Canonical", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let canonical: ReturnType<typeof createCanonical>;

  const getNodeIds = (connectionKey: string): string[] => {
    const canonicalConnection = graph.getRecord(connectionKey);

    return canonicalConnection?.edges?.map((edgeRef: any) => {
      const edge = graph.getRecord(edgeRef.__ref);
      const node = graph.getRecord(edge?.node?.__ref);

      return node?.id;
    }) || [];
  };

  beforeEach(() => {
    graph = createGraph();
    optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
  });

  describe("updateConnection", () => {
    it("replaces leader on refetch, appends forward pages, and aggregates pageInfo head/tail", () => {
      // 1. Create and update initial leader page (1,2,3)
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { start: "p1", end: "p3", hasNext: true },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 2. Verify initial state
      const nodeIdsBefore = getNodeIds("@connection.posts({})");
      expect(nodeIdsBefore).toEqual(["1", "2", "3"]);

      const pageInfoBefore = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfoBefore?.endCursor).toBe("p3");

      // 3. Create and append forward page (4,5,6)
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { start: "p4", end: "p6", hasNext: false },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 4. Verify final aggregated state
      const nodeIdsAfter = getNodeIds("@connection.posts({})");
      expect(nodeIdsAfter).toEqual(["1", "2", "3", "4", "5", "6"]);

      const pageInfoAfter = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfoAfter?.startCursor).toBe("p1");
      expect(pageInfoAfter?.endCursor).toBe("p6");
      expect(pageInfoAfter?.hasNextPage).toBe(false);
    });

    it("replaces edges when reloading a slice (remove 5, add 7)", () => {
      // 1. Create and update initial pages (1,2,3) and (4,5,6)
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { end: "p3", hasNext: true },
      );
      canonical.updateConnection({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { end: "p6", hasNext: true },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 2. Verify initial state (1,2,3,4,5,6)
      const nodeIdsBefore = getNodeIds("@connection.posts({})");
      expect(nodeIdsBefore).toEqual(["1", "2", "3", "4", "5", "6"]);

      const pageInfoBefore = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfoBefore?.endCursor).toBe("p6");
      expect(pageInfoBefore?.hasNextPage).toBe(true);

      // 3. Reload slice with changes (remove 5, add 7)
      const { page: updatedPage1, edgeRefs: updatedPage1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 6, 7],
        { end: "p7", hasNext: false },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: updatedPage1,
        pageEdgeRefs: updatedPage1EdgeRefs,
      });

      // 4. Verify updated state (1,2,3,4,6,7)
      const nodeIdsAfter = getNodeIds("@connection.posts({})");
      expect(nodeIdsAfter).toEqual(["1", "2", "3", "4", "6", "7"]);

      const pageInfoAfter = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfoAfter?.endCursor).toBe("p7");
      expect(pageInfoAfter?.hasNextPage).toBe(false);
    });

    it("refreshes edge meta without duplication when duplicate node appears in P2", () => {
      // 1. Create and update initial page (1,2,3)
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { end: "p3", hasNext: true },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 2. Create page with duplicate node 3 (3,4,5)
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [3, 4, 5],
        { end: "p5", hasNext: false },
      );

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 3. Verify no duplication (1,2,3,4,5)
      const nodeIds = getNodeIds("@connection.posts({})");
      expect(nodeIds).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("updates edge meta without dupes and maintains order when refreshing same page", () => {
      // 1. Create initial page snapshot with custom cursors and scores
      const { page: initialPage, edgeRefs: initialEdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":2})',
        [1, 2],
        { start: "c1", end: "c2", hasNext: true, hasPrev: false },
      );

      // Override edge records with custom cursors and scores
      graph.putRecord('@.posts({"after":null,"first":2}).edges.0', {
        __typename: "PostEdge",
        cursor: "c1",
        node: { __ref: "Post:1" },
        score: 1,
      });
      graph.putRecord('@.posts({"after":null,"first":2}).edges.1', {
        __typename: "PostEdge",
        cursor: "c2",
        node: { __ref: "Post:2" },
        score: 1,
      });

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: "@",
        variables: { first: 2, after: null },
        pageKey: '@.posts({"after":null,"first":2})',
        pageSnapshot: initialPage,
        pageEdgeRefs: initialEdgeRefs,
      });

      // 2. Update edge records with new cursors and scores
      graph.putRecord('@.posts({"after":null,"first":2}).edges.0', {
        score: 9,
        cursor: "c1x",
        node: { __ref: "Post:1" },
      });
      graph.putRecord('@.posts({"after":null,"first":2}).edges.1', {
        score: 8,
        cursor: "c2x",
        node: { __ref: "Post:2" },
      });

      // 3. Create updated page snapshot with new cursors
      const updatedPage = {
        __typename: "PostConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "c1x",
          endCursor: "c2x",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: initialEdgeRefs,
      };

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: "@",
        variables: { first: 2, after: null },
        pageKey: '@.posts({"after":null,"first":2})',
        pageSnapshot: updatedPage,
        pageEdgeRefs: initialEdgeRefs,
      });

      // 4. Verify edge meta is updated without duplication
      const canonicalConnection = graph.getRecord("@connection.posts({})");
      expect(canonicalConnection.edges.length).toBe(2);

      const edge0 = graph.getRecord(canonicalConnection.edges[0].__ref);
      const edge1 = graph.getRecord(canonicalConnection.edges[1].__ref);
      expect(edge0.cursor).toBe("c1x");
      expect(edge0.score).toBe(9);
      expect(edge1.cursor).toBe("c2x");
      expect(edge1.score).toBe(8);

      const nodeIds = getNodeIds("@connection.posts({})");
      expect(nodeIds).toEqual(["1", "2"]);
    });

    it("maintains leader-first order and anchored pageInfo when refetching leader after forward pages", () => {
      // 1. Create User entities and first page edges
      graph.putRecord("User:u1", { __typename: "User", id: "u1" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2" });
      graph.putRecord("User:u3", { __typename: "User", id: "u3" });
      graph.putRecord("User:u4", { __typename: "User", id: "u4" });

      const page0EdgeRefs = [
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.0' },
        { __ref: '@.users({"after":null,"first":2,"role":"admin"}).edges.1' },
      ];
      graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.0', {
        __typename: "UserEdge",
        cursor: "u1",
        node: { __ref: "User:u1" },
      });
      graph.putRecord('@.users({"after":null,"first":2,"role":"admin"}).edges.1', {
        __typename: "UserEdge",
        cursor: "u2",
        node: { __ref: "User:u2" },
      });

      const page0 = {
        __typename: "UserConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        },
        edges: page0EdgeRefs,
      };

      // 2. Update connection with first page (u1, u2)
      canonical.updateConnection({
        field: USERS_PLAN_FIELD,
        parentId: "@",
        variables: { usersRole: "admin", first: 2, after: null },
        pageKey: '@.users({"after":null,"first":2,"role":"admin"})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 3. Create second page edges (u3, u4)
      const page1EdgeRefs = [
        { __ref: '@.users({"after":"u2","first":2,"role":"admin"}).edges.0' },
        { __ref: '@.users({"after":"u2","first":2,"role":"admin"}).edges.1' },
      ];
      graph.putRecord('@.users({"after":"u2","first":2,"role":"admin"}).edges.0', {
        __typename: "UserEdge",
        cursor: "u3",
        node: { __ref: "User:u3" },
      });
      graph.putRecord('@.users({"after":"u2","first":2,"role":"admin"}).edges.1', {
        __typename: "UserEdge",
        cursor: "u4",
        node: { __ref: "User:u4" },
      });

      const page1 = {
        __typename: "UserConnection",
        pageInfo: {
          __typename: "PageInfo",
          startCursor: "u3",
          endCursor: "u4",
          hasNextPage: false,
          hasPreviousPage: true,
        },
        edges: page1EdgeRefs,
      };

      // 4. Update connection with second page (u3, u4)
      canonical.updateConnection({
        field: USERS_PLAN_FIELD,
        parentId: "@",
        variables: { role: "admin", first: 2, after: "u2" },
        pageKey: '@.users({"after":"u2","first":2,"role":"admin"})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 5. Refetch leader page (should reset to leader only)
      canonical.updateConnection({
        field: USERS_PLAN_FIELD,
        parentId: "@",
        variables: { role: "admin", first: 2, after: null },
        pageKey: '@.users({"after":null,"first":2,"role":"admin"})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 6. Verify leader-first order and anchored pageInfo
      const canKey = '@connection.users({"role":"admin"})';
      const userIds = getNodeIds(canKey);
      expect(userIds).toEqual(["u1", "u2"]);

      const pageInfo = graph.getRecord(canKey).pageInfo;
      expect(pageInfo?.startCursor).toBe("u1");
      expect(pageInfo?.endCursor).toBe("u2");
    });
  });

  describe("mergeFromCache", () => {
    it("merges multiple out-of-order pages from cache and maintains leader-first order", () => {
      // 1. Create pages in reverse order (P1, P0, P2)
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { start: "p4", end: "p6", hasNext: true },
      );
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { start: "p1", end: "p3", hasNext: true },
      );
      const { page: page2, edgeRefs: page2EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p6","first":3})',
        [7, 8],
        { start: "p7", end: "p8", hasNext: false },
      );

      // 2. Merge pages out of order (P1 first, then P2, then P0)
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p6" },
        pageKey: '@.posts({"after":"p6","first":3})',
        pageSnapshot: page2,
        pageEdgeRefs: page2EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 3. Verify correct leader-first order (P0, P1, P2)
      const nodeIds = getNodeIds("@connection.posts({})");
      expect(nodeIds).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

      const pageInfo = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfo?.startCursor).toBe("p1");
      expect(pageInfo?.endCursor).toBe("p8");
    });

    it("yields consistent order P0,P1,P2 when prewarming with BEFORE and AFTER pages", () => {
      // 1. Create pages with BEFORE/AFTER cursors
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { start: "p1", end: "p3", hasNext: true, hasPrev: true },
      );
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"before":"p1","last":3})',
        [-2, -1, 0],
        { start: "p-2", end: "p0", hasPrev: false, hasNext: true },
      );
      const { page: page2, edgeRefs: page2EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5],
        { start: "p4", end: "p5", hasNext: true },
      );

      // 2. Merge pages in mixed order (P2, P0, P1)
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page2,
        pageEdgeRefs: page2EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { last: 3, before: "p1" },
        pageKey: '@.posts({"before":"p1","last":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 3. Verify consistent P0,P1,P2 order
      const nodeIds = getNodeIds("@connection.posts({})");
      expect(nodeIds).toEqual(["-2", "-1", "0", "1", "2", "3", "4", "5"]);

      const pageInfo = graph.getRecord("@connection.posts({})")?.pageInfo;
      expect(pageInfo?.startCursor).toBe("p-2");
      expect(pageInfo?.endCursor).toBe("p5");
    });

    it("resets to leader slice only when network call occurs after prewarm", () => {
      // 1. Create pages for prewarming
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { end: "p3", hasNext: true },
      );
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { end: "p6", hasNext: false },
      );

      // 2. Prewarm cache with both pages
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });

      // 3. Verify prewarmed state (1,2,3,4,5,6)
      const nodeIdsBefore = getNodeIds("@connection.posts({})");
      expect(nodeIdsBefore).toEqual(["1", "2", "3", "4", "5", "6"]);

      // 4. Network call for leader page (should reset to leader only)
      canonical.updateConnection({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 5. Verify reset to leader slice only (1,2,3)
      const nodeIdsAfter = getNodeIds("@connection.posts({})");
      expect(nodeIdsAfter).toEqual(["1", "2", "3"]);
    });

    it("re-applies optimistic overlay after base writes and prewarm", () => {
      // 1. Apply optimistic updates (remove 2, add 9 at start)
      const tx = optimistic.modifyOptimistic((o) => {
        const c = o.connection({ parent: "Query", key: "posts" });

        c.removeNode({ __typename: "Post", id: 2 });
        c.addNode({ __typename: "Post", id: 9, title: "P9" }, { position: "start" });
      });

      tx.commit?.();

      // 2. Create base pages for cache merge
      const { page: page1, edgeRefs: page1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { end: "p6", hasNext: true },
      );
      const { page: page0, edgeRefs: page0EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { end: "p3", hasNext: true },
      );

      // 3. Merge base pages from cache
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: page1,
        pageEdgeRefs: page1EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD, parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: page0,
        pageEdgeRefs: page0EdgeRefs,
      });

      // 4. Verify optimistic overlay is re-applied (9 at start, 2 removed)
      const nodeIds = getNodeIds("@connection.posts({})");
      expect(nodeIds).toEqual(["9", "1", "3", "4", "5", "6"]);
    });

    it("maintains union 1..6 when network P2 arrives after prewarming P1,P2 from cache", () => {
      const canKey = "@connection.posts({})";

      // 1. Create P1 (leader) and P2 (forward) pages
      const { page: P1, edgeRefs: P1EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":null,"first":3})',
        [1, 2, 3],
        { hasNext: true, hasPrev: false },
      );

      const { page: P2, edgeRefs: P2EdgeRefs } = writePageSnapshot(
        graph,
        '@.posts({"after":"p3","first":3})',
        [4, 5, 6],
        { hasNext: false, hasPrev: true },
      );

      // 2. Prewarm cache with both pages
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey: '@.posts({"after":null,"first":3})',
        pageSnapshot: P1,
        pageEdgeRefs: P1EdgeRefs,
      });
      canonical.mergeFromCache({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: P2,
        pageEdgeRefs: P2EdgeRefs,
      });

      // 3. Verify prewarmed union
      const nodeIds = getNodeIds(canKey);
      expect(nodeIds).toEqual(["1", "2", "3", "4", "5", "6"]);

      // 4. Network call for P2 arrives (should maintain union)
      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: "p3" },
        pageKey: '@.posts({"after":"p3","first":3})',
        pageSnapshot: P2,
        pageEdgeRefs: P2EdgeRefs,
      });

      // 5. Verify union is maintained
      const nodeIdsAfter = getNodeIds(canKey);
      expect(nodeIdsAfter).toEqual(["1", "2", "3", "4", "5", "6"]);

      const pageInfo = graph.getRecord(canKey)?.pageInfo;
      expect(pageInfo?.startCursor).toBe("p1");
      expect(pageInfo?.endCursor).toBe("p6");
    });
  });
});
