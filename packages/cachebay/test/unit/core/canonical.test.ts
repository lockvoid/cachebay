import { vi } from "vitest";
import type { PlanField } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { writeConnectionPage } from "@/test/helpers";
import { posts, users, tags } from "@/test/helpers/fixtures";

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

const TAGS_PLAN_FIELD: PlanField = {
  fieldName: "tags",
  responseKey: "tags",
  isConnection: true,
  connectionMode: "page",
  buildArgs: (v: any) => v || {},
  selectionSet: [],
  selectionMap: new Map(),
};

describe("Canonical - Relay Style Pagination", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let canonical: ReturnType<typeof createCanonical>;

  const getNodeIds = (canonicalKey: string): string[] => {
    const canonicalConnection = graph.getRecord(canonicalKey);
    const refs: string[] = canonicalConnection?.edges?.__refs || [];
    return refs
      .map((edgeRef: string) => {
        const edge = graph.getRecord(edgeRef);
        const node = graph.getRecord(edge?.node?.__ref);
        return node?.id;
      })
      .filter(Boolean);
  };

  beforeEach(() => {
    graph = createGraph();
    optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
  });

  describe("updateConnection - infinite mode", () => {
    describe("leader pages", () => {
      it("creates canonical record for leader page on first fetch", () => {
        const pageKey = '@.posts({"after":null,"first":3})';
        const connectionData = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          normalizedPage,
        });

        const canonicalKey = "@connection.posts({})";
        const canonicalConnection = graph.getRecord(canonicalKey);

        expect(canonicalConnection).toBeDefined();
        expect(canonicalConnection.__typename).toBe("PostConnection");
        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3"]);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toEqual({
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p3",
          hasPreviousPage: false,
          hasNextPage: true,
        });
      });

      it("resets canonical on leader refetch", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p3");
        expect(pageInfo.hasNextPage).toBe(true);
      });

      it("copies extra fields from page to canonical on leader fetch", () => {
        const pageKey = '@.posts({"after":null,"first":3})';
        const connectionData = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { hasNextPage: true },
        );
        connectionData.totalCount = 100;
        connectionData.aggregations = { scoring: 88 };

        const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          normalizedPage,
        });

        const canonicalKey = "@connection.posts({})";
        const canonicalConnection = graph.getRecord(canonicalKey);

        expect(canonicalConnection.totalCount).toBe(100);
        expect(canonicalConnection.aggregations).toEqual({ scoring: 88 });
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toBeDefined();
      });

      it("handles leader page with no cursors in pageInfo", () => {
        const pageKey = '@.posts({"after":null,"first":3})';
        const connectionData = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { hasNextPage: true },
        );
        const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          normalizedPage,
        });

        const canonicalKey = "@connection.posts({})";
        const canonicalConnection = graph.getRecord(canonicalKey);
        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);

        expect(pageInfo.startCursor).toBeDefined();
        expect(pageInfo.endCursor).toBeDefined();
        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3"]);
      });
    });

    describe("forward pagination", () => {
      it("appends forward page by splicing at cursor", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { endCursor: "p6", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toBeDefined();
        expect(pageInfo.endCursor).toBe("p6");
        expect(pageInfo.hasNextPage).toBe(false);
      });

      it("updates pageInfo at end boundary when appending", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: false, hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toEqual({
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p6",
          hasPreviousPage: false,
          hasNextPage: false,
        });
      });

      it("replaces edges when refetching same forward page", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { endCursor: "p6", hasNextPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const connectionData2 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { endCursor: "p6", hasNextPage: false },
        );
        const normalizedPage2 = writeConnectionPage(graph, pageKey1, connectionData2);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage2,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo.endCursor).toBe("p6");
        expect(pageInfo.hasNextPage).toBe(false);
      });

      it("discards future pages when refetching middle page (splice behavior)", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3"]);

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const pageKey2 = '@.posts({"after":"p6","first":3})';
        const connectionData2 = posts.buildConnection(
          [{ id: "p7" }, { id: "p8" }, { id: "p9" }],
          { startCursor: "p7", endCursor: "p9", hasNextPage: false },
        );
        const normalizedPage2 = writeConnectionPage(graph, pageKey2, connectionData2);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p6" },
          pageKey: pageKey2,
          normalizedPage: normalizedPage2,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);

        const connectionData1Updated = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true },
        );
        const normalizedPage1Updated = writeConnectionPage(graph, pageKey1, connectionData1Updated);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1Updated,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        const pageInfo = graph.getRecord(canonicalConnection.pageInfo.__ref);

        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p6");
        expect(pageInfo.hasNextPage).toBe(true);
      });

      it("preserves extra fields from existing canonical when appending", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { endCursor: "p3", hasNextPage: true },
        );
        connectionData0.totalCount = 100;
        connectionData0.aggregations = { scoring: 88 };

        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        let canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.totalCount).toBe(100);
        expect(canonicalConnection.aggregations).toEqual({ scoring: 88 });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { endCursor: "p6", hasNextPage: false },
        );

        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.totalCount).toBe(100);
        expect(canonicalConnection.aggregations).toEqual({ scoring: 88 });
        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
      });

      it("updates extra fields when incoming page has new values", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { hasNextPage: true },
        );
        connectionData0.totalCount = 100;
        connectionData0.aggregations = { scoring: 88 };

        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }],
          { hasNextPage: false },
        );
        connectionData1.totalCount = 105;
        connectionData1.aggregations = { scoring: 92 };

        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.totalCount).toBe(105);
        expect(canonicalConnection.aggregations).toEqual({ scoring: 92 });
        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      });

      it("preserves container references across pagination", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":2})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }],
          { hasNextPage: true },
        );

        const aggregationsKey = `${pageKey0}.aggregations`;
        graph.putRecord(aggregationsKey, {
          __typename: "Aggregations",
          scoring: 88,
          totalViews: 1000,
        });

        connectionData0.aggregations = { __ref: aggregationsKey };

        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        let canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.aggregations).toEqual({ __ref: aggregationsKey });

        const pageKey1 = '@.posts({"after":"p2","first":2})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p3" }, { id: "p4" }],
          { hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: "p2" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.aggregations).toEqual({ __ref: aggregationsKey });
        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4"]);

        const aggregations = graph.getRecord(aggregationsKey);
        expect(aggregations.scoring).toBe(88);
        expect(aggregations.totalViews).toBe(1000);
      });

      it("handles forward pagination with missing cursor in middle", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p99","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { endCursor: "p6", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p99" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
      });
    });

    describe("backward pagination", () => {
      it("prepends before page by splicing at cursor", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey1 = '@.posts({"after":null,"first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true, hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        const pageKey0 = '@.posts({"before":"p4","last":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p4" },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toBeDefined();
      });

      it("updates pageInfo at start boundary when prepending", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey1 = '@.posts({"after":null,"first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true, hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        const pageKey0 = '@.posts({"before":"p4","last":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p4" },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toEqual({
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p6",
          hasPreviousPage: false,
          hasNextPage: true,
        });
      });

      it("handles backward pagination with missing cursor", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey1 = '@.posts({"after":null,"first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        const pageKey0 = '@.posts({"before":"p99","last":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p99" },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
      });

      it("handles multiple backward pages in sequence", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey2 = '@.posts({"after":null,"first":2})';
        const connectionData2 = posts.buildConnection(
          [{ id: "p5" }, { id: "p6" }],
          { startCursor: "p5", endCursor: "p6", hasPreviousPage: true },
        );
        const normalizedPage2 = writeConnectionPage(graph, pageKey2, connectionData2);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 2, after: null },
          pageKey: pageKey2,
          normalizedPage: normalizedPage2,
        });

        const pageKey1 = '@.posts({"before":"p5","last":2})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p3" }, { id: "p4" }],
          { startCursor: "p3", endCursor: "p4", hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 2, before: "p5" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p3", "p4", "p5", "p6"]);

        const pageKey0 = '@.posts({"before":"p3","last":2})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }],
          { startCursor: "p1", endCursor: "p2", hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 2, before: "p3" },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.hasPreviousPage).toBe(false);
      });

      it("discards earlier pages when refetching middle page backward (splice behavior)", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey2 = '@.posts({"after":null,"first":3})';
        const connectionData2 = posts.buildConnection(
          [{ id: "p7" }, { id: "p8" }, { id: "p9" }],
          { startCursor: "p7", endCursor: "p9", hasNextPage: false, hasPreviousPage: true },
        );
        const normalizedPage2 = writeConnectionPage(graph, pageKey2, connectionData2);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey2,
          normalizedPage: normalizedPage2,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p7", "p8", "p9"]);

        const pageKey1 = '@.posts({"before":"p7","last":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true, hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p7" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p4", "p5", "p6", "p7", "p8", "p9"]);

        const pageKey0 = '@.posts({"before":"p4","last":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { startCursor: "p1", endCursor: "p3", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p4" },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);

        const connectionData1Updated = posts.buildConnection(
          [{ id: "p4" }, { id: "p5" }, { id: "p6" }],
          { startCursor: "p4", endCursor: "p6", hasNextPage: true, hasPreviousPage: true },
        );
        const normalizedPage1Updated = writeConnectionPage(graph, pageKey1, connectionData1Updated);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { last: 3, before: "p7" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1Updated,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p4", "p5", "p6", "p7", "p8", "p9"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        const pageInfo = graph.getRecord(canonicalConnection.pageInfo.__ref);

        expect(pageInfo.startCursor).toBe("p4");
        expect(pageInfo.endCursor).toBe("p9");
        expect(pageInfo.hasPreviousPage).toBe(true);
        expect(pageInfo.hasNextPage).toBe(false);
      });
    });

    describe("splice behavior (no deduplication)", () => {
      it("handles overlapping nodes via splice mechanism", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { endCursor: "p3", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p3" }, { id: "p4" }, { id: "p5" }],
          { endCursor: "p5", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p3", "p4", "p5"]);

        const canonicalConnection = graph.getRecord(canonicalKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
        expect(pageInfo).toBeDefined();
      });

      it("handles refetch by replacing edges via splice", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":4})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }],
          { endCursor: "p4", hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 4, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p4","first":4})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p5" }, { id: "p6" }, { id: "p7" }, { id: "p8" }],
          { endCursor: "p8", hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 4, after: "p4" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 4, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p4"]);
      });

      it("preserves edge order without deduplication", () => {
        const canonicalKey = "@connection.posts({})";

        const pageKey0 = '@.posts({"after":null,"first":3})';
        const connectionData0 = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { hasNextPage: true },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.posts({"after":"p3","first":3})';
        const connectionData1 = posts.buildConnection(
          [{ id: "p2" }, { id: "p4" }, { id: "p1" }],
          { hasNextPage: false },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: "p3" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3", "p2", "p4", "p1"]);
      });
    });

    describe("connection filters", () => {
      it("creates separate canonical keys for different filter values", () => {
        const adminKey = '@connection.users({"role":"admin"})';
        const userKey = '@connection.users({"role":"user"})';

        const adminPageKey = '@.users({"after":null,"first":2,"role":"admin"})';
        const adminData = users.buildConnection([{ id: "u1" }, { id: "u2" }], { hasNextPage: false });
        const normalizedAdminPage = writeConnectionPage(graph, adminPageKey, adminData);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: adminPageKey,
          normalizedPage: normalizedAdminPage,
        });

        const userPageKey = '@.users({"after":null,"first":2,"role":"user"})';
        const userData = users.buildConnection([{ id: "u3" }, { id: "u4" }], { hasNextPage: false });
        const normalizedUserPage = writeConnectionPage(graph, userPageKey, userData);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "user", first: 2, after: null },
          pageKey: userPageKey,
          normalizedPage: normalizedUserPage,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2"]);
        expect(getNodeIds(userKey)).toEqual(["u3", "u4"]);

        const adminConnection = graph.getRecord(adminKey);
        expect(adminConnection.pageInfo).toEqual({ __ref: `${adminKey}.pageInfo` });

        const userConnection = graph.getRecord(userKey);
        expect(userConnection.pageInfo).toEqual({ __ref: `${userKey}.pageInfo` });
      });

      it("maintains separate state for filtered connections after leader refetch", () => {
        const adminKey = '@connection.users({"role":"admin"})';

        const pageKey0 = '@.users({"after":null,"first":2,"role":"admin"})';
        const connectionData0 = users.buildConnection(
          [{ id: "u1" }, { id: "u2" }],
          { startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        );
        const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        const pageKey1 = '@.users({"after":"u2","first":2,"role":"admin"})';
        const connectionData1 = users.buildConnection(
          [{ id: "u3" }, { id: "u4" }],
          { startCursor: "u3", endCursor: "u4", hasNextPage: false, hasPreviousPage: true },
        );
        const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: "u2" },
          pageKey: pageKey1,
          normalizedPage: normalizedPage1,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2", "u3", "u4"]);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: pageKey0,
          normalizedPage: normalizedPage0,
        });

        expect(getNodeIds(adminKey)).toEqual(["u1", "u2"]);

        const canonicalConnection = graph.getRecord(adminKey);
        expect(canonicalConnection.pageInfo).toEqual({ __ref: `${adminKey}.pageInfo` });

        const pageInfo = graph.getRecord(`${adminKey}.pageInfo`);
        expect(pageInfo.startCursor).toBe("u1");
        expect(pageInfo.endCursor).toBe("u2");
      });

      it("handles pagination independently for each filter", () => {
        const adminKey = '@connection.users({"role":"admin"})';
        const userKey = '@connection.users({"role":"user"})';

        const adminPageKey0 = '@.users({"after":null,"first":2,"role":"admin"})';
        const adminData0 = users.buildConnection(
          [{ id: "a1" }, { id: "a2" }],
          { endCursor: "a2", hasNextPage: true },
        );
        const normalizedAdminPage0 = writeConnectionPage(graph, adminPageKey0, adminData0);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey: adminPageKey0,
          normalizedPage: normalizedAdminPage0,
        });

        const userPageKey0 = '@.users({"after":null,"first":2,"role":"user"})';
        const userData0 = users.buildConnection(
          [{ id: "u1" }, { id: "u2" }],
          { endCursor: "u2", hasNextPage: true },
        );
        const normalizedUserPage0 = writeConnectionPage(graph, userPageKey0, userData0);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "user", first: 2, after: null },
          pageKey: userPageKey0,
          normalizedPage: normalizedUserPage0,
        });

        const adminPageKey1 = '@.users({"after":"a2","first":2,"role":"admin"})';
        const adminData1 = users.buildConnection(
          [{ id: "a3" }],
          { endCursor: "a3", hasNextPage: false },
        );
        const normalizedAdminPage1 = writeConnectionPage(graph, adminPageKey1, adminData1);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: "a2" },
          pageKey: adminPageKey1,
          normalizedPage: normalizedAdminPage1,
        });

        expect(getNodeIds(adminKey)).toEqual(["a1", "a2", "a3"]);
        expect(getNodeIds(userKey)).toEqual(["u1", "u2"]);
      });
    });

    describe("optimistic integration", () => {
      it("triggers optimistic replay after update", () => {
        const replaySpy = vi.spyOn(optimistic, "replayOptimistic");

        const pageKey = '@.posts({"after":null,"first":3})';
        const connectionData = posts.buildConnection(
          [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
          { hasNextPage: true },
        );
        const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

        canonical.updateConnection({
          field: POSTS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { first: 3, after: null },
          pageKey,
          normalizedPage,
        });

        expect(replaySpy).toHaveBeenCalledWith({
          connections: ["@connection.posts({})"],
        });
      });

      it("triggers replay for filtered connections", () => {
        const replaySpy = vi.spyOn(optimistic, "replayOptimistic");

        const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';
        const connectionData = users.buildConnection([{ id: "u1" }, { id: "u2" }], { hasNextPage: false });
        const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

        canonical.updateConnection({
          field: USERS_PLAN_FIELD,
          parentId: ROOT_ID,
          variables: { role: "admin", first: 2, after: null },
          pageKey,
          normalizedPage,
        });

        expect(replaySpy).toHaveBeenCalledWith({
          connections: ['@connection.users({"role":"admin"})'],
        });
      });
    });
  });

  describe("updateConnection - page mode", () => {
    it("replaces canonical with page snapshot", () => {
      const canonicalKey = "@connection.tags({})";
      const pageKey = '@.tags({"after":null,"first":10})';

      const connectionData = tags.buildConnection(
        [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
        { startCursor: "t1", endCursor: "t3", hasNextPage: false },
      );
      connectionData.totalCount = 3;

      const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey,
        normalizedPage,
      });

      const canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection.__typename).toBe("TagConnection");
      expect(getNodeIds(canonicalKey)).toEqual(["t1", "t2", "t3"]);
      expect(canonicalConnection.totalCount).toBe(3);
      expect(canonicalConnection.pageInfo).toEqual({ __ref: "@connection.tags({}).pageInfo" });

      const pageInfo = graph.getRecord(canonicalConnection.pageInfo.__ref);
      expect(pageInfo.startCursor).toBe("t1");
      expect(pageInfo.endCursor).toBe("t3");
      expect(pageInfo.hasNextPage).toBe(false);
      expect(pageInfo.hasPreviousPage).toBe(false);
    });

    it("replaces entire canonical on each page mode update", () => {
      const canonicalKey = "@connection.tags({})";

      const pageKey0 = '@.tags({"after":null,"first":10})';
      const connectionData0 = tags.buildConnection([{ id: "t1" }, { id: "t2" }], { hasNextPage: true });
      const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey: pageKey0,
        normalizedPage: normalizedPage0,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["t1", "t2"]);

      const pageKey1 = '@.tags({"after":"t2","first":10})';
      const connectionData1 = tags.buildConnection(
        [{ id: "t3" }, { id: "t4" }, { id: "t5" }],
        { hasNextPage: false },
      );
      const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: "t2" },
        pageKey: pageKey1,
        normalizedPage: normalizedPage1,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["t3", "t4", "t5"]);
    });

    it("preserves extra fields in page mode", () => {
      const canonicalKey = "@connection.tags({})";

      const pageKey0 = '@.tags({"after":null,"first":10})';
      const connectionData0 = tags.buildConnection([{ id: "t1" }], { hasNextPage: false });
      connectionData0.totalCount = 1;

      const normalizedPage0 = writeConnectionPage(graph, pageKey0, connectionData0);

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey: pageKey0,
        normalizedPage: normalizedPage0,
      });

      const canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection.totalCount).toBe(1);

      const pageKey1 = '@.tags({"after":null,"first":10})';
      const connectionData1 = tags.buildConnection([{ id: "t1" }, { id: "t2" }], { hasNextPage: false });
      connectionData1.totalCount = 2;

      const normalizedPage1 = writeConnectionPage(graph, pageKey1, connectionData1);

      canonical.updateConnection({
        field: TAGS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 10, after: null },
        pageKey: pageKey1,
        normalizedPage: normalizedPage1,
      });

      const updatedConnection = graph.getRecord(canonicalKey);
      expect(updatedConnection.totalCount).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty page gracefully", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      const connectionData = posts.buildConnection(
        [],
        { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
      );
      const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage,
      });

      expect(getNodeIds(canonicalKey)).toEqual([]);

      const canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

      const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
      expect(pageInfo).toBeDefined();
    });

    it("handles page with missing pageInfo fields", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });
      graph.putRecord(`${pageKey}.edges.0`, {
        __typename: "PostEdge",
        node: { __ref: "Post:p1" },
      });

      const normalizedPage = {
        __typename: "PostConnection",
        edges: { __refs: [`${pageKey}.edges.0`] },
        pageInfo: { __ref: `${pageKey}.pageInfo` },
      };

      graph.putRecord(`${pageKey}.pageInfo`, {});

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["p1"]);

      const canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });
      expect(canonicalConnection.__typename).toBe("PostConnection");

      const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
      expect(pageInfo.startCursor).toBeNull();
      expect(pageInfo.endCursor).toBeNull();
    });

    it("ensures canonical record exists on first update", () => {
      const canonicalKey = "@connection.posts({})";

      let canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection).toBeUndefined();

      const pageKey = '@.posts({"after":null,"first":3})';
      const connectionData = posts.buildConnection([{ id: "p1" }], { hasNextPage: false });
      const normalizedPage = writeConnectionPage(graph, pageKey, connectionData);

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage,
      });

      canonicalConnection = graph.getRecord(canonicalKey);
      expect(canonicalConnection.__typename).toBe("PostConnection");
      expect(canonicalConnection.pageInfo).toEqual({ __ref: `${canonicalKey}.pageInfo` });

      const pageInfo = graph.getRecord(`${canonicalKey}.pageInfo`);
      expect(pageInfo).toBeDefined();
    });

    it("falls back to edge cursors when pageInfo cursors missing", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":2})';

      graph.putRecord("Post:p1", {
        __typename: "Post",
        id: "p1",
      });

      graph.putRecord("Post:p2", {
        __typename: "Post",
        id: "p2",
      });

      graph.putRecord(`${pageKey}.edges.0`, {
        __typename: "PostEdge",
        cursor: "edge_cursor_p1",
        node: { __ref: "Post:p1" },
      });

      graph.putRecord(`${pageKey}.edges.1`, {
        __typename: "PostEdge",
        cursor: "edge_cursor_p2",
        node: { __ref: "Post:p2" },
      });

      graph.putRecord(`${pageKey}.pageInfo`, {
        __typename: "PageInfo",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const normalizedPage = {
        __typename: "PostConnection",
        edges: { __refs: [`${pageKey}.edges.0`, `${pageKey}.edges.1`] },
        pageInfo: { __ref: `${pageKey}.pageInfo` },
      };

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 2, after: null },
        pageKey,
        normalizedPage,
      });

      const canonicalConnection = graph.getRecord(canonicalKey);
      const pageInfo = graph.getRecord(canonicalConnection.pageInfo.__ref);

      expect(pageInfo.startCursor).toBe("edge_cursor_p1");
      expect(pageInfo.endCursor).toBe("edge_cursor_p2");
      expect(pageInfo.hasNextPage).toBe(false);
      expect(pageInfo.hasPreviousPage).toBe(false);
    });

    it("handles null edges array", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      const normalizedPage = {
        __typename: "PostConnection",
        edges: null,
        pageInfo: { __ref: `${pageKey}.pageInfo` },
      };

      graph.putRecord(`${pageKey}.pageInfo`, {
        __typename: "PageInfo",
        hasNextPage: false,
      });

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage,
      });

      expect(getNodeIds(canonicalKey)).toEqual([]);
    });

    it("handles missing node reference in edge", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":2})';

      graph.putRecord("Post:p1", { __typename: "Post", id: "p1" });

      graph.putRecord(`${pageKey}.edges.0`, {
        __typename: "PostEdge",
        cursor: "c1",
        node: { __ref: "Post:p1" },
      });

      graph.putRecord(`${pageKey}.edges.1`, {
        __typename: "PostEdge",
        cursor: "c2",
      });

      const normalizedPage = {
        __typename: "PostConnection",
        edges: { __refs: [`${pageKey}.edges.0`, `${pageKey}.edges.1`] },
        pageInfo: { __ref: `${pageKey}.pageInfo` },
      };

      graph.putRecord(`${pageKey}.pageInfo`, {
        __typename: "PageInfo",
        hasNextPage: false,
      });

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 2, after: null },
        pageKey,
        normalizedPage,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["p1"]);
    });

    it("handles refetch with completely different data", () => {
      const canonicalKey = "@connection.posts({})";
      const pageKey = '@.posts({"after":null,"first":3})';

      const connectionData0 = posts.buildConnection(
        [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
        { hasNextPage: false },
      );
      const normalizedPage0 = writeConnectionPage(graph, pageKey, connectionData0);

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage: normalizedPage0,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["p1", "p2", "p3"]);

      const connectionData1 = posts.buildConnection(
        [{ id: "p100" }, { id: "p101" }],
        { hasNextPage: true },
      );
      const normalizedPage1 = writeConnectionPage(graph, pageKey, connectionData1);

      canonical.updateConnection({
        field: POSTS_PLAN_FIELD,
        parentId: ROOT_ID,
        variables: { first: 3, after: null },
        pageKey,
        normalizedPage: normalizedPage1,
      });

      expect(getNodeIds(canonicalKey)).toEqual(["p100", "p101"]);
    });
  });
});
