// test/unit/core/views.test.ts
import { computed, watchEffect, nextTick } from "vue";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createConnectionPlanField, writeConnectionPage } from "@/test/helpers";
import { posts } from "@/test/helpers/fixtures";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph();
    views = createViews({ graph });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // getView → entities
  // ────────────────────────────────────────────────────────────────────────────
  describe("getView", () => {
    describe("entities", () => {
      it("creates reactive entity view", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(userView.__typename).toBe("User");
        expect(userView.id).toBe("u1");
        expect(userView.email).toBe("u1@example.com");

        graph.putRecord("User:u1", { email: "updated@example.com" });
        await nextTick();
        expect(userView.email).toBe("updated@example.com");
      });

      it("follows __ref to child entity", async () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          title: "Post 1",
          author: { __ref: "User:u1" },
        });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toBe(userView);
        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", { email: "new@example.com" });
        await nextTick();

        expect(postView.author).toBe(userView);
        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "new@example.com",
        });
      });

      it("maintains entity view identity through deeply nested inline objects", async () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          title: "Post 1",
          nested1: { nested2: { nested3: { author: { __ref: "User:u1" } } } },
        });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const authorFromPost = postView.nested1.nested2.nested3.author;
        expect(authorFromPost).toBe(userView);
        expect(authorFromPost).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });

        graph.putRecord("User:u1", { email: "new@example.com" });
        await nextTick();

        const authorAfter = postView.nested1.nested2.nested3.author;
        expect(authorAfter).toBe(userView);
        expect(authorAfter).toEqual({ __typename: "User", id: "u1", email: "new@example.com" });
      });

      it("handles array of refs", () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });
        graph.putRecord("Team:t1", {
          __typename: "Team",
          id: "t1",
          members: [{ __ref: "User:u1" }, { __ref: "User:u2" }],
        });

        const teamView = views.getView({
          source: graph.materializeRecord("Team:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({ source: graph.materializeRecord("User:u1"), field: null, variables: {}, canonical: true });
        const user2View = views.getView({ source: graph.materializeRecord("User:u2"), field: null, variables: {}, canonical: true });

        expect(teamView.members).toHaveLength(2);
        expect(teamView.members[0]).toBe(user1View);
        expect(teamView.members[1]).toBe(user2View);
        expect(teamView.members[0]).toEqual({ __typename: "User", id: "u1" });
        expect(teamView.members[1]).toEqual({ __typename: "User", id: "u2" });
      });

      it("handles array with { __refs } format", () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });
        graph.putRecord("Team:t1", { __typename: "Team", id: "t1", members: { __refs: ["User:u1", "User:u2"] } });

        const teamView = views.getView({
          source: graph.materializeRecord("Team:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({ source: graph.materializeRecord("User:u1"), field: null, variables: {}, canonical: true });
        const user2View = views.getView({ source: graph.materializeRecord("User:u2"), field: null, variables: {}, canonical: true });

        expect(teamView.members).toHaveLength(2);
        expect(teamView.members[0]).toBe(user1View);
        expect(teamView.members[1]).toBe(user2View);
      });

      it("returns empty reactive placeholder for missing refs", () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", author: { __ref: "User:missing" } });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toEqual({});
        expect(typeof postView.author).toBe("object");
        expect(Object.keys(postView.author)).toHaveLength(0);
      });

      it("returns null when field is explicitly null", () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", author: null });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toBeNull();
      });

      it("returns empty placeholder for missing ref, then hydrates in place when record appears", async () => {
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", author: { __ref: "User:u1" } });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const authorView = postView.author;
        expect(authorView).toEqual({});

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        await nextTick();

        expect(postView.author).toBe(authorView);
        expect(postView.author).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });
      });

      it("returns same view for same (proxy, field, canonical)", () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const userProxy = graph.materializeRecord("User:u1");
        const view1 = views.getView({ source: userProxy, field: null, variables: {}, canonical: true });
        const view2 = views.getView({ source: userProxy, field: null, variables: {}, canonical: true });

        expect(view1).toBe(view2);
      });

      it("returns different views for different canonical flag", () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1" });
        const userProxy = graph.materializeRecord("User:u1");

        const canonicalView = views.getView({ source: userProxy, field: null, variables: {}, canonical: true });
        const pageView = views.getView({ source: userProxy, field: null, variables: {}, canonical: false });

        expect(canonicalView).not.toBe(pageView);
      });

      it("returns different views for different selections", () => {
        const postsField = createConnectionPlanField("posts");
        const commentsField = createConnectionPlanField("comments");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        // Wrap different entity selections (one includes posts, other includes comments)
        const userWithPosts = { selectionSet: [postsField], selectionMap: new Map([["posts", postsField]]) } as any;
        const userWithComments = { selectionSet: [commentsField], selectionMap: new Map([["comments", commentsField]]) } as any;

        const v1 = views.getView({ source: graph.materializeRecord("User:u1"), field: userWithPosts, variables: {}, canonical: true });
        const v2 = views.getView({ source: graph.materializeRecord("User:u1"), field: userWithComments, variables: {}, canonical: true });

        expect(v1).not.toBe(v2);
      });

      it("null/undefined passthrough", () => {
        expect(views.getView({ source: null, field: null, variables: {}, canonical: true })).toBeNull();
        expect(views.getView({ source: undefined as any, field: null, variables: {}, canonical: true })).toBeUndefined();
      });

      it("is read-only", () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

        const userView = views.getView({ source: graph.materializeRecord("User:u1"), field: null, variables: {}, canonical: true });

        const result = Reflect.set(userView, "email", "hacker@example.com");
        expect(result).toBe(false);
        expect(userView.email).toBe("u1@example.com");
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // connections (existing set)
    // ──────────────────────────────────────────────────────────────────────────
    describe("connections", () => {
      it("maintains edges array identity across updates", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => conn.edges);

        let seenLen = -1;
        const stop = watchEffect(() => {
          seenLen = edgesRef.value.length;
        });

        await nextTick();
        expect(Array.isArray(edgesRef.value)).toBe(true);
        expect(seenLen).toBe(1);

        const stableEdges = edgesRef.value;

        // Append second edge
        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
        graph.putRecord("@.User:u1.posts({}).edges:1", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });
        const prev = graph.getRecord("@.User:u1.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u1.posts({})", { edges: { __refs: [...prev, "@.User:u1.posts({}).edges:1"] } });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(seenLen).toBe(2);
        expect(edgesRef.value[1].node).toEqual({ __typename: "Post", id: "p2", title: "P2" });

        stop();
      });

      it("updates computed mapping when edges change", async () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });

        const connectionData = posts.buildConnection([{ id: "p1", title: "A" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.User:u2.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u2.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const titles = computed(() => conn.edges.map((e: any) => e.node.title));

        await nextTick();
        expect(titles.value).toEqual(["A"]);

        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "B" });
        graph.putRecord("@.User:u2.posts({}).edges:1", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });
        const prev = graph.getRecord("@.User:u2.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u2.posts({})", { edges: { __refs: [...prev, "@.User:u2.posts({}).edges:1"] } });

        await nextTick();
        expect(titles.value).toEqual(["A", "B"]);

        graph.putRecord("Post:p2", { title: "B2" });
        await nextTick();
        expect(titles.value).toEqual(["A", "B2"]);
      });

      it("preserves edges array identity when edges shrink", async () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        const connectionData = posts.buildConnection(
          [
            { id: "p1", title: "P1" },
            { id: "p2", title: "P2" },
          ],
          { startCursor: "p1", endCursor: "p2", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u3.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u3.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => conn.edges);

        await nextTick();
        const stableEdges = edgesRef.value;
        expect(stableEdges.length).toBe(2);

        graph.putRecord("@.User:u3.posts({})", { edges: { __refs: ["@.User:u3.posts({}).edges:0"] } });
        await nextTick();

        expect(edgesRef.value).toBe(stableEdges);
        expect(edgesRef.value.length).toBe(1);
      });

      it("keeps same edges array on edge replacement (refetch)", async () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("User:u4", { __typename: "User", id: "u4" });

        const connectionData = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.User:u4.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u4.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => conn.edges);

        await nextTick();
        const stableEdges = edgesRef.value;
        expect(stableEdges[0].node).toEqual({ __typename: "Post", id: "p1", title: "P1" });

        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
        graph.putRecord("@.User:u4.posts({}).edges:0", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(edgesRef.value[0].node).toEqual({ __typename: "Post", id: "p2", title: "P2" });
      });

      it("observes pageInfo changes via its __ref", async () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        const connectionData = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.User:u3.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u3.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const endCursor = computed(() => conn.pageInfo?.endCursor ?? null);

        await nextTick();
        expect(endCursor.value).toBe("p1");

        const pageInfoRef = graph.getRecord("@.User:u3.posts({})")!.pageInfo.__ref;
        graph.putRecord(pageInfoRef, { endCursor: "p2" });
        await nextTick();

        expect(endCursor.value).toBe("p2");
      });

      it("exposes pageInfo shape with required fields", () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("User:u5", { __typename: "User", id: "u5" });

        const connectionData = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.User:u5.posts({})", connectionData);

        const conn = views.getView({
          source: "@.User:u5.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const pageInfo = conn.pageInfo;
        expect(pageInfo).toBeDefined();
        expect(pageInfo.__typename).toBe("PageInfo");
        expect(pageInfo.startCursor).toBe("p1");
        expect(pageInfo.endCursor).toBe("p1");
      });

      it("handles containers & deep container refs + relinking", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const pageKey = "@.User:u1.posts({})";
        const pageAggKey = `${pageKey}.aggregations`;
        graph.putRecord(pageAggKey, { __typename: "Aggregations", scoring: 88, totalViews: 1000 });

        const pageConn = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, pageKey, pageConn);
        graph.putRecord(pageKey, { aggregations: { __ref: pageAggKey } });

        const canKey = "@connection.User:u1.posts({})";
        const canAggKey = `${canKey}.aggregations`;
        graph.putRecord(canAggKey, { __typename: "Aggregations", scoring: 95, totalViews: 2000 });

        const canConn = posts.buildConnection([{ id: "p1", title: "P1" }], {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
        });
        writeConnectionPage(graph, canKey, canConn);
        graph.putRecord(canKey, { aggregations: { __ref: pageAggKey } });

        const pageView = views.getView({
          source: pageKey,
          field: postsField,
          variables: {},
          canonical: false,
        });
        expect(pageView.aggregations.scoring).toBe(88);

        const canView = views.getView({
          source: canKey,
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(canView.aggregations.scoring).toBe(95);
        expect(canView.aggregations.totalViews).toBe(2000);
      });

      it("handles non-array edges", () => {
        const postsField = createConnectionPlanField("posts");
        graph.putRecord("@.posts({})", { __typename: "PostConnection", edges: null });

        const conn = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.edges).toBeNull();
      });

      it("returns undefined for missing connection", () => {
        const postsField = createConnectionPlanField("posts");
        const conn = views.getView({
          source: "missing:connection",
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(conn).toBeUndefined();
      });

      it("is read-only (connection view)", () => {
        const postsField = createConnectionPlanField("posts");
        const connData = posts.buildConnection([{ id: "p1", title: "P1" }], { hasNextPage: false });
        writeConnectionPage(graph, "@.posts({})", connData);

        const conn = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const result = Reflect.set(conn, "totalCount", 999);
        expect(result).toBe(false);
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // MERGED from materializeDocument tests → rewritten to use views.getView
    // ──────────────────────────────────────────────────────────────────────────
    describe("merged scenarios (formerly materializeDocument)", () => {
      it("materializes user node reactively with correct shape", async () => {
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

        const userView = views.getView({
          source: "User:u1",
          field: null,
          variables: {},
          canonical: true,
        });

        expect(userView).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(userView.email).toBe("u1+updated@example.com");
      });

      it("materializes users connection with reactive edges and nodes (canonical)", async () => {
        const usersField = createConnectionPlanField("users");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

        // canonical users connection
        const pageEdge0 = '@.users({"after":null,"first":2,"role":"admin"}).edges:0';
        const pageEdge1 = '@.users({"after":null,"first":2,"role":"admin"}).edges:1';
        graph.putRecord(pageEdge0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
        graph.putRecord(pageEdge1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

        const canKey = '@connection.users({"role":"admin"})';
        const pageInfoKey = `${canKey}.pageInfo`;
        graph.putRecord(pageInfoKey, {
          __typename: "PageInfo",
          startCursor: "u1",
          endCursor: "u2",
          hasNextPage: true,
          hasPreviousPage: false,
        });
        graph.putRecord(canKey, {
          __typename: "UserConnection",
          pageInfo: { __ref: pageInfoKey },
          edges: { __refs: [pageEdge0, pageEdge1] },
        });

        const usersView = views.getView({
          source: canKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        const pageInfoView = usersView.pageInfo;
        expect(pageInfoView.startCursor).toBe("u1");
        expect(pageInfoView.endCursor).toBe("u2");

        const firstUserNode = usersView.edges[0].node;
        expect(firstUserNode.email).toBe("u1@example.com");

        graph.putRecord(pageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo).toBe(pageInfoView);
        expect(usersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(firstUserNode.email).toBe("u1+updated@example.com");
      });

      it("materializes nested posts connection with reactive totals, scores, nodes and authors", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", flags: [], author: { __ref: "User:u1" } });
        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "Post 2", flags: [], author: { __ref: "User:u1" } });

        // Build canonical posts connection for the user
        const pageEdge0 = '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges:0';
        const pageEdge1 = '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges:1';
        graph.putRecord(pageEdge0, { __typename: "PostEdge", cursor: "p1", score: 0.5, node: { __ref: "Post:p1" } });
        graph.putRecord(pageEdge1, { __typename: "PostEdge", cursor: "p2", score: 0.7, node: { __ref: "Post:p2" } });

        const canKey = '@connection.User:u1.posts({"category":"tech"})';
        const pageInfoKey = `${canKey}.pageInfo`;
        graph.putRecord(pageInfoKey, {
          __typename: "PageInfo",
          startCursor: "p1",
          endCursor: "p2",
          hasNextPage: true,
          hasPreviousPage: false,
        });
        graph.putRecord(canKey, {
          __typename: "PostConnection",
          totalCount: 2,
          pageInfo: { __ref: pageInfoKey },
          edges: { __refs: [pageEdge0, pageEdge1] },
        });

        // entity selection wrapper for "User" that includes "posts"
        const userWithPosts = { selectionSet: [postsField], selectionMap: new Map([["posts", postsField]]) } as any;

        const userView = views.getView({
          source: "User:u1",
          field: userWithPosts,
          variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
          canonical: true,
        });

        expect(userView.posts.totalCount).toBe(2);
        const firstEdge = userView.posts.edges[0];
        const firstPost = firstEdge.node;

        graph.putRecord(canKey, { totalCount: 3 });
        await nextTick();
        expect(userView.posts.totalCount).toBe(3);

        graph.putRecord(pageEdge0, { score: 0.9 });
        await nextTick();
        expect(userView.posts.edges[0].score).toBe(0.9);

        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(firstPost.title).toBe("Post 1 (Updated)");

        const postAuthor = firstPost.author;
        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(postAuthor.email).toBe("u1+updated@example.com");
      });

      it("materializes root users and nested posts with reactive canonical connections", async () => {
        const usersField = createConnectionPlanField("users");
        const postsField = createConnectionPlanField("posts");

        // users connection (canonical)
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

        const uEdge0 = '@.users({"after":null,"first":2,"role":"dj"}).edges:0';
        const uEdge1 = '@.users({"after":null,"first":2,"role":"dj"}).edges:1';
        graph.putRecord(uEdge0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
        graph.putRecord(uEdge1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

        const usersCanKey = '@connection.users({"role":"dj"})';
        const usersPIKey = `${usersCanKey}.pageInfo`;
        graph.putRecord(usersPIKey, { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false });
        graph.putRecord(usersCanKey, { __typename: "UserConnection", pageInfo: { __ref: usersPIKey }, edges: { __refs: [uEdge0, uEdge1] } });

        // nested posts for u1 (canonical)
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", flags: [] });
        const pEdge0 = '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0';
        graph.putRecord(pEdge0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
        const postsCanKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsPIKey = `${postsCanKey}.pageInfo`;
        graph.putRecord(postsPIKey, { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false });
        graph.putRecord(postsCanKey, { __typename: "PostConnection", pageInfo: { __ref: postsPIKey }, edges: { __refs: [pEdge0] } });

        const usersView = views.getView({
          source: usersCanKey,
          field: usersField,
          variables: { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null },
          canonical: true,
        });

        // You can also view the nested posts directly
        const u1Posts = views.getView({
          source: postsCanKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        graph.putRecord(usersPIKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo.endCursor).toBe("u3");

        const post0 = u1Posts.edges[0].node;
        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(post0.title).toBe("Post 1 (Updated)");
      });

      it("materializes nested posts and comments with canonical connections at every level", async () => {
        const postsField = createConnectionPlanField("posts");
        const commentsField = createConnectionPlanField("comments");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", flags: [] });
        graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1", author: { __ref: "User:u2" } });
        graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "Comment 2", author: { __ref: "User:u3" } });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });
        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        // posts (canonical) for u1
        const pEdge0 = '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0';
        graph.putRecord(pEdge0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
        const postsCanKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsPIKey = `${postsCanKey}.pageInfo`;
        graph.putRecord(postsPIKey, { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false });
        graph.putRecord(postsCanKey, { __typename: "PostConnection", pageInfo: { __ref: postsPIKey }, edges: { __refs: [pEdge0] } });

        // comments (canonical) for p1
        const cEdge0 = '@.Post:p1.comments({"after":null,"first":2}).edges:0';
        const cEdge1 = '@.Post:p1.comments({"after":null,"first":2}).edges:1';
        graph.putRecord(cEdge0, { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
        graph.putRecord(cEdge1, { __typename: "CommentEdge", cursor: "c2", node: { __ref: "Comment:c2" } });
        const commentsCanKey = "@connection.Post:p1.comments({})";
        const commentsPIKey = `${commentsCanKey}.pageInfo`;
        graph.putRecord(commentsPIKey, { __typename: "PageInfo", startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false });
        graph.putRecord(commentsCanKey, { __typename: "CommentConnection", pageInfo: { __ref: commentsPIKey }, edges: { __refs: [cEdge0, cEdge1] } });

        // entity selection for user that includes posts
        const userWithPosts = { selectionSet: [postsField], selectionMap: new Map([["posts", postsField]]) } as any;

        const userView = views.getView({
          source: "User:u1",
          field: userWithPosts,
          variables: { postsCategory: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: null },
          canonical: true,
        });

        const post = views.getView({
          source: postsCanKey,
          field: postsField,
          variables: {},
          canonical: true,
        }).edges[0].node;

        const postComments = views.getView({
          source: commentsCanKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });

        const firstComment = postComments.edges[0].node;

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(firstComment.text).toBe("Comment 1 (Updated)");
        expect(userView.posts.edges[0].node.id).toBe("p1");
      });

      it("materializes users, posts and comments with reactive canonical connections (root + nested)", async () => {
        const usersField = createConnectionPlanField("users");
        const postsField = createConnectionPlanField("posts");
        const commentsField = createConnectionPlanField("comments");

        // users canonical
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        const uEdge0 = '@.users({"after":null,"first":2,"role":"admin"}).edges:0';
        graph.putRecord(uEdge0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
        const usersCanKey = '@connection.users({"role":"admin"})';
        const usersPIKey = `${usersCanKey}.pageInfo`;
        graph.putRecord(usersPIKey, { __typename: "PageInfo", startCursor: "u1", endCursor: "u1", hasNextPage: true, hasPreviousPage: false });
        graph.putRecord(usersCanKey, { __typename: "UserConnection", pageInfo: { __ref: usersPIKey }, edges: { __refs: [uEdge0] } });

        // posts canonical for u1
        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "Post 1", flags: [] });
        const pEdge0 = '@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0';
        graph.putRecord(pEdge0, { __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });
        const postsCanKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsPIKey = `${postsCanKey}.pageInfo`;
        graph.putRecord(postsPIKey, { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false });
        graph.putRecord(postsCanKey, { __typename: "PostConnection", pageInfo: { __ref: postsPIKey }, edges: { __refs: [pEdge0] } });

        // comments canonical for p1
        graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "Comment 1" });
        const cEdge0 = '@.Post:p1.comments({"after":null,"first":1}).edges:0';
        graph.putRecord(cEdge0, { __typename: "CommentEdge", cursor: "c1", node: { __ref: "Comment:c1" } });
        const commentsCanKey = "@connection.Post:p1.comments({})";
        const commentsPIKey = `${commentsCanKey}.pageInfo`;
        graph.putRecord(commentsPIKey, { __typename: "PageInfo", startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false });
        graph.putRecord(commentsCanKey, { __typename: "CommentConnection", pageInfo: { __ref: commentsPIKey }, edges: { __refs: [cEdge0] } });

        const usersView = views.getView({
          source: usersCanKey,
          field: usersField,
          variables: { usersRole: "admin", usersFirst: 2, usersAfter: null },
          canonical: true,
        });

        const firstUser = usersView.edges[0].node;
        const userPosts = views.getView({
          source: postsCanKey,
          field: postsField,
          variables: {},
          canonical: true,
        });
        const post = userPosts.edges[0].node;
        const postComments = views.getView({
          source: commentsCanKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });
        const firstComment = postComments.edges[0].node;

        graph.putRecord(usersPIKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(firstComment.text).toBe("Comment 1 (Updated)");
        expect(firstUser.id).toBe("u1");
        expect(post.id).toBe("p1");
      });

      it("maintains identity stability for edges and node proxies across re-materialization", async () => {
        const usersField = createConnectionPlanField("users");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@x" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@x" });

        const e0 = '@.users({"after":null,"first":2,"role":"admin"}).edges:0';
        const e1 = '@.users({"after":null,"first":2,"role":"admin"}).edges:1';
        graph.putRecord(e0, { __typename: "UserEdge", cursor: "u1", node: { __ref: "User:u1" } });
        graph.putRecord(e1, { __typename: "UserEdge", cursor: "u2", node: { __ref: "User:u2" } });

        const canKey = '@connection.users({"role":"admin"})';
        const piKey = `${canKey}.pageInfo`;
        graph.putRecord(piKey, { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false });
        graph.putRecord(canKey, { __typename: "UserConnection", pageInfo: { __ref: piKey }, edges: { __refs: [e0, e1] } });

        const first = views.getView({
          source: canKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        const edgesRef1 = first.edges;
        const pageInfoRef1 = first.pageInfo;
        const nodeRef1 = first.edges[0].node;

        // mutate pageInfo (same pageInfo view should persist)
        graph.putRecord(piKey, { endCursor: "u3" });
        await nextTick();

        const second = views.getView({
          source: canKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        expect(second.edges).toBe(edgesRef1);
        expect(second.pageInfo).toBe(pageInfoRef1);
        expect(second.pageInfo.endCursor).toBe("u3");

        graph.putRecord("User:u1", { email: "a+1@x" });
        await nextTick();
        expect(nodeRef1.email).toBe("a+1@x");

        // append edge; edges identity stays stable; array mutates in place
        const e2 = '@.users({"after":"u2","first":1,"role":"admin"}).edges:0';
        graph.putRecord(e2, { __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u2" } });
        const prev = graph.getRecord(canKey)!.edges.__refs;
        graph.putRecord(canKey, { edges: { __refs: [...prev, e2] } });

        const third = views.getView({
          source: canKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        expect(third.edges).toBe(edgesRef1);
        expect(edgesRef1.length).toBe(3);
        expect(edgesRef1[2].cursor).toBe("u3");
      });

      it("reads from canonical key when canonical=true via entity field selection", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@connection.User:u1.posts({})", connectionData);

        // entity selection wrapper including posts
        const userWithPosts = { selectionSet: [postsField], selectionMap: new Map([["posts", postsField]]) } as any;

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userWithPosts,
          variables: {},
          canonical: true,
        });

        expect(userView.posts.edges).toHaveLength(1);
        expect(userView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "P1",
        });
      });

      it("reads from page key when canonical=false via entity field selection", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        const userWithPosts = { selectionSet: [postsField], selectionMap: new Map([["posts", postsField]]) } as any;

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userWithPosts,
          variables: {},
          canonical: false,
        });

        expect(userView.posts.edges).toHaveLength(1);
        expect(userView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "P1",
        });
      });
    });
  });
});
