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

  // Helper: wraps a set of PlanFields as the "entity" selection
  const makeEntityField = (...fields: any) =>
  ({
    name: "__entity__",
    isConnection: false,
    selectionSet: fields,
    selectionMap: new Map(fields.map((f: any) => [f.name, f])),
  } as any);

  // ────────────────────────────────────────────────────────────────────────────
  // getView
  // ────────────────────────────────────────────────────────────────────────────
  describe("getView", () => {
    describe("entities", () => {
      it("creates reactive entity view", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        const userProxy = graph.materializeRecord("User:u1");
        const userView = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        expect(userView.__typename).toBe("User");
        expect(userView.id).toBe("u1");
        expect(userView.email).toBe("u1@example.com");

        graph.putRecord("User:u1", {
          email: "updated@example.com",
        });

        await nextTick();
        expect(userView.email).toBe("updated@example.com");
      });

      it("follows __ref to child entity", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          title: "Post 1",
          author: {
            __ref: "User:u1",
          },
        });

        const postProxy = graph.materializeRecord("Post:p1");
        const postView = views.getView({
          source: postProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        const userProxy = graph.materializeRecord("User:u1");
        const userView = views.getView({
          source: userProxy,
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

        graph.putRecord("User:u1", {
          email: "new@example.com",
        });

        await nextTick();

        expect(postView.author).toBe(userView);
        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "new@example.com",
        });
      });

      it("maintains entity view identity through deeply nested inline objects", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          title: "Post 1",
          nested1: {
            nested2: {
              nested3: {
                author: { __ref: "User:u1" },
              },
            },
          },
        });

        const postProxy = graph.materializeRecord("Post:p1");
        const postView = views.getView({
          source: postProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        const userProxy = graph.materializeRecord("User:u1");
        const userView = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        const authorFromPost = postView.nested1.nested2.nested3.author;
        expect(authorFromPost).toBe(userView);
        expect(authorFromPost).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", {
          email: "new@example.com",
        });

        await nextTick();

        const authorFromPostAfter = postView.nested1.nested2.nested3.author;
        expect(authorFromPostAfter).toBe(userView);
        expect(authorFromPostAfter).toEqual({
          __typename: "User",
          id: "u1",
          email: "new@example.com",
        });
      });

      it("handles array of refs", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });
        graph.putRecord("User:u2", {
          __typename: "User",
          id: "u2",
        });
        graph.putRecord("Team:t1", {
          __typename: "Team",
          id: "t1",
          members: [{ __ref: "User:u1" }, { __ref: "User:u2" }],
        });

        const teamProxy = graph.materializeRecord("Team:t1");
        const teamView = views.getView({
          source: teamProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const user2View = views.getView({
          source: graph.materializeRecord("User:u2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(teamView.members).toHaveLength(2);
        expect(teamView.members[0]).toBe(user1View);
        expect(teamView.members[1]).toBe(user2View);
        expect(teamView.members[0]).toEqual({ __typename: "User", id: "u1" });
        expect(teamView.members[1]).toEqual({ __typename: "User", id: "u2" });
      });

      it("handles array with { __refs } format", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });
        graph.putRecord("User:u2", {
          __typename: "User",
          id: "u2",
        });
        graph.putRecord("Team:t1", {
          __typename: "Team",
          id: "t1",
          members: { __refs: ["User:u1", "User:u2"] },
        });

        const teamView = views.getView({
          source: graph.materializeRecord("Team:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const user2View = views.getView({
          source: graph.materializeRecord("User:u2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(teamView.members).toHaveLength(2);
        expect(teamView.members[0]).toBe(user1View);
        expect(teamView.members[1]).toBe(user2View);
        expect(teamView.members[0]).toEqual({ __typename: "User", id: "u1" });
        expect(teamView.members[1]).toEqual({ __typename: "User", id: "u2" });
      });

      it("handles deeply nested array of refs", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
        graph.putRecord("User:u2", {
          __typename: "User",
          id: "u2",
          email: "u2@example.com",
        });
        graph.putRecord("Team:t1", {
          __typename: "Team",
          id: "t1",
          nested1: {
            nested2: {
              nested3: {
                members: [{ __ref: "User:u1" }, { __ref: "User:u2" }],
              },
            },
          },
        });

        const teamView = views.getView({
          source: graph.materializeRecord("Team:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const user2View = views.getView({
          source: graph.materializeRecord("User:u2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(teamView.nested1.nested2.nested3.members).toHaveLength(2);
        expect(teamView.nested1.nested2.nested3.members[0]).toBe(user1View);
        expect(teamView.nested1.nested2.nested3.members[1]).toBe(user2View);
        expect(teamView.nested1.nested2.nested3.members[0]).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
        expect(teamView.nested1.nested2.nested3.members[1]).toEqual({
          __typename: "User",
          id: "u2",
          email: "u2@example.com",
        });
      });

      it("handles deeply nested array with { __refs } format", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
        graph.putRecord("User:u2", {
          __typename: "User",
          id: "u2",
          email: "u2@example.com",
        });
        graph.putRecord("Team:t1", {
          __typename: "Team",
          id: "t1",
          nested1: {
            nested2: {
              nested3: {
                members: { __refs: ["User:u1", "User:u2"] },
              },
            },
          },
        });

        const teamView = views.getView({
          source: graph.materializeRecord("Team:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const user1View = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const user2View = views.getView({
          source: graph.materializeRecord("User:u2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(teamView.nested1.nested2.nested3.members).toHaveLength(2);
        expect(teamView.nested1.nested2.nested3.members[0]).toBe(user1View);
        expect(teamView.nested1.nested2.nested3.members[1]).toBe(user2View);
        expect(teamView.nested1.nested2.nested3.members[0]).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
        expect(teamView.nested1.nested2.nested3.members[1]).toEqual({
          __typename: "User",
          id: "u2",
          email: "u2@example.com",
        });
      });

      it("returns empty reactive placeholder for missing refs", () => {
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          author: { __ref: "User:missing" },
        });

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
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          author: null,
        });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toBeNull();
      });

      it("returns empty placeholder for missing ref, then hydrates in place when record appears", async () => {
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          author: { __ref: "User:u1" },
        });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const authorView = postView.author;
        expect(authorView).toEqual({});

        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        await nextTick();

        expect(postView.author).toBe(authorView);
        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
      });

      it("returns same view for same (proxy, selection, canonical)", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });

        const userProxy = graph.materializeRecord("User:u1");
        const view1 = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: true,
        });
        const view2 = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: true,
        });

        expect(view1).toBe(view2);
      });

      it("returns empty placeholder for deeply nested missing ref, then hydrates", async () => {
        graph.putRecord("Post:p1", {
          __typename: "Post",
          id: "p1",
          nested1: {
            nested2: {
              author: { __ref: "User:u1" },
            },
          },
        });

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const authorView = postView.nested1.nested2.author;
        expect(authorView).toEqual({});

        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        await nextTick();

        expect(postView.nested1.nested2.author).toBe(authorView);
        expect(postView.nested1.nested2.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
      });

      it("returns different views for different canonical flag", () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });

        const userProxy = graph.materializeRecord("User:u1");
        const canonicalView = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: true,
        });
        const pageView = views.getView({
          source: userProxy,
          field: null,
          variables: {},
          canonical: false,
        });

        expect(canonicalView).not.toBe(pageView);
      });

      it("returns different views for different selections", () => {
        const postsField = createConnectionPlanField("posts");
        const commentsField = createConnectionPlanField("comments");

        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });

        const userProxy = graph.materializeRecord("User:u1");

        const view1 = views.getView({
          source: userProxy,
          field: makeEntityField(postsField),
          variables: {},
          canonical: true,
        });
        const view2 = views.getView({
          source: userProxy,
          field: makeEntityField(commentsField),
          variables: {},
          canonical: true,
        });

        expect(view1).not.toBe(view2);
      });

      it("returns null when entity proxy is null", () => {
        const view = views.getView({
          source: null,
          field: null,
          variables: {},
          canonical: true,
        });
        expect(view).toBeNull();
      });

      it("returns undefined when entity proxy is undefined", () => {
        const view = views.getView({
          source: undefined as any,
          field: null,
          variables: {},
          canonical: true,
        });
        expect(view).toBeUndefined();
      });

      it("is read-only", () => {
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

        const result = Reflect.set(userView, "email", "hacker@example.com");
        expect(result).toBe(false);
        expect(userView.email).toBe("u1@example.com");
      });
    });

    describe("connections", () => {
      it("maintains edges array identity across updates", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

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
        graph.putRecord("Post:p2", {
          __typename: "Post",
          id: "p2",
          title: "P2",
        });
        graph.putRecord("@.User:u1.posts({}).edges:1", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });

        const prevRefs = graph.getRecord("@.User:u1.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u1.posts({})", {
          edges: { __refs: [...prevRefs, "@.User:u1.posts({}).edges:1"] },
        });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(seenLen).toBe(2);
        expect(edgesRef.value[1].node).toEqual({
          __typename: "Post",
          id: "p2",
          title: "P2",
        });

        stop();
      });

      it("updates computed mapping when edges change", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u2", { __typename: "User", id: "u2" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "A" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

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

        const prevRefs = graph.getRecord("@.User:u2.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u2.posts({})", {
          edges: { __refs: [...prevRefs, "@.User:u2.posts({}).edges:1"] },
        });

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

        graph.putRecord("@.User:u3.posts({})", {
          edges: { __refs: ["@.User:u3.posts({}).edges:0"] },
        });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(edgesRef.value.length).toBe(1);
      });

      it("keeps same edges array on edge replacement (refetch)", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u4", { __typename: "User", id: "u4" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

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
        expect(stableEdges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "P1",
        });

        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });
        graph.putRecord("@.User:u4.posts({}).edges:0", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(edgesRef.value[0].node).toEqual({
          __typename: "Post",
          id: "p2",
          title: "P2",
        });
      });

      it("observes pageInfo changes via its __ref", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

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

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

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

      it("handles simple container ref", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const aggregationsKey = "@.User:u1.posts({}).aggregations";
        graph.putRecord(aggregationsKey, {
          __typename: "Aggregations",
          scoring: 88,
          totalViews: 1000,
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        graph.putRecord("@.User:u1.posts({})", {
          aggregations: { __ref: aggregationsKey },
        });

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.aggregations).toBeDefined();
        expect(conn.aggregations.scoring).toBe(88);
        expect(conn.aggregations.totalViews).toBe(1000);
      });

      it("handles nested container refs", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const statsKey = "@.User:u1.posts({}).metadata.stats";
        graph.putRecord(statsKey, {
          __typename: "Stats",
          views: 5000,
          likes: 123,
        });

        const metadataKey = "@.User:u1.posts({}).metadata";
        graph.putRecord(metadataKey, {
          __typename: "Metadata",
          version: "v1",
          stats: { __ref: statsKey },
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        graph.putRecord("@.User:u1.posts({})", {
          metadata: { __ref: metadataKey },
        });

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.metadata).toBeDefined();
        expect(conn.metadata.version).toBe("v1");
        expect(conn.metadata.stats).toBeDefined();
        expect(conn.metadata.stats.views).toBe(5000);
        expect(conn.metadata.stats.likes).toBe(123);
      });

      it("handles array of container refs", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const tag1Key = "@.User:u1.posts({}).tags:0";
        graph.putRecord(tag1Key, { __typename: "Tag", name: "javascript" });

        const tag2Key = "@.User:u1.posts({}).tags:1";
        graph.putRecord(tag2Key, { __typename: "Tag", name: "typescript" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        graph.putRecord("@.User:u1.posts({})", {
          tags: [{ __ref: tag1Key }, { __ref: tag2Key }],
        });

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.tags).toHaveLength(2);
        expect(conn.tags[0]).toEqual({ __typename: "Tag", name: "javascript" });
        expect(conn.tags[1]).toEqual({ __typename: "Tag", name: "typescript" });
      });

      it("handles deeply nested container refs", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const themeKey = "@.User:u1.posts({}).meta.config.settings.theme";
        graph.putRecord(themeKey, {
          __typename: "Theme",
          primary: "#007bff",
          secondary: "#6c757d",
        });

        const settingsKey = "@.User:u1.posts({}).meta.config.settings";
        graph.putRecord(settingsKey, {
          __typename: "Settings",
          enabled: true,
          theme: { __ref: themeKey },
        });

        const configKey = "@.User:u1.posts({}).meta.config";
        graph.putRecord(configKey, {
          __typename: "Config",
          version: 2,
          settings: { __ref: settingsKey },
        });

        const metaKey = "@.User:u1.posts({}).meta";
        graph.putRecord(metaKey, {
          __typename: "Meta",
          timestamp: "2025-01-01",
          config: { __ref: configKey },
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        graph.putRecord("@.User:u1.posts({})", {
          meta: { __ref: metaKey },
        });

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.meta.timestamp).toBe("2025-01-01");
        expect(conn.meta.config.version).toBe(2);
        expect(conn.meta.config.settings.enabled).toBe(true);
        expect(conn.meta.config.settings.theme.primary).toBe("#007bff");
        expect(conn.meta.config.settings.theme.secondary).toBe("#6c757d");
      });

      it("relinks page containers to canonical when canonical=true", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const pageKey = "@.User:u1.posts({})";
        const aggregationsPageKey = `${pageKey}.aggregations`;
        graph.putRecord(aggregationsPageKey, {
          __typename: "Aggregations",
          scoring: 88,
          totalViews: 1000,
        });

        const pageConnectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, pageKey, pageConnectionData);
        graph.putRecord(pageKey, { aggregations: { __ref: aggregationsPageKey } });

        const canonicalKey = "@connection.User:u1.posts({})";
        const aggregationsCanonicalKey = `${canonicalKey}.aggregations`;
        graph.putRecord(aggregationsCanonicalKey, {
          __typename: "Aggregations",
          scoring: 95,
          totalViews: 2000,
        });

        const canonicalConnectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, canonicalKey, canonicalConnectionData);
        // canonical connection points to page container; in canonical mode we relink to canonical container
        graph.putRecord(canonicalKey, { aggregations: { __ref: aggregationsPageKey } });

        const pageView = views.getView({
          source: pageKey,
          field: postsField,
          variables: {},
          canonical: false,
        });
        expect(pageView.aggregations.scoring).toBe(88);
        expect(pageView.aggregations.totalViews).toBe(1000);

        const canonicalView = views.getView({
          source: canonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(canonicalView.aggregations.scoring).toBe(95);
        expect(canonicalView.aggregations.totalViews).toBe(2000);
      });

      it("falls back to page container if canonical container does not exist", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const pageKey = "@.User:u1.posts({})";
        const aggregationsPageKey = `${pageKey}.aggregations`;
        graph.putRecord(aggregationsPageKey, {
          __typename: "Aggregations",
          scoring: 88,
        });

        const canonicalKey = "@connection.User:u1.posts({})";
        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, canonicalKey, connectionData);
        graph.putRecord(canonicalKey, { aggregations: { __ref: aggregationsPageKey } });

        const canonicalView = views.getView({
          source: canonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(canonicalView.aggregations.scoring).toBe(88);
      });

      it("containers are reactive", async () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const aggregationsKey = "@.User:u1.posts({}).aggregations";
        graph.putRecord(aggregationsKey, { __typename: "Aggregations", scoring: 88 });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);
        graph.putRecord("@.User:u1.posts({})", { aggregations: { __ref: aggregationsKey } });

        const conn = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(conn.aggregations.scoring).toBe(88);

        graph.putRecord(aggregationsKey, { scoring: 95 });
        await nextTick();
        expect(conn.aggregations.scoring).toBe(95);
      });

      it("reads from canonical key when canonical=true via entity field selection", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "P1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@connection.User:u1.posts({})", connectionData);

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: makeEntityField(postsField),
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

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: makeEntityField(postsField),
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

      it("returns undefined for missing connection", () => {
        const postsField = createConnectionPlanField("posts");
        const connView = views.getView({
          source: "missing:connection",
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(connView).toBeUndefined();
      });

      it("handles non-array edges", () => {
        const postsField = createConnectionPlanField("posts");

        graph.putRecord("@.posts({})", {
          __typename: "PostConnection",
          edges: null,
        });

        const connView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(connView.edges).toBeNull();
      });

      it("is read-only", () => {
        const postsField = createConnectionPlanField("posts");

        const connectionData = posts.buildConnection([{ id: "p1", title: "P1" }], {
          hasNextPage: false,
        });
        writeConnectionPage(graph, "@.posts({})", connectionData);

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
  });
});
