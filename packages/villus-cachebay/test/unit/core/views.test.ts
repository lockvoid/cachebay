// test/unit/core/views.test.ts
import { computed, watchEffect, nextTick } from "vue";
import { compilePlan } from "@/src/compiler";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { writeConnectionPage } from "@/test/helpers";
import { posts, users, comments } from "@/test/helpers/fixtures";
import { USER_QUERY, USERS_QUERY, USER_POSTS_QUERY, USERS_POSTS_QUERY, USER_POSTS_COMMENTS_QUERY, USERS_POSTS_COMMENTS_QUERY, POSTS_QUERY, POSTS_WITH_AGGREGATIONS_QUERY, POST_COMMENTS_QUERY } from "@/test/helpers/operations";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph();
    views = createViews({ graph });
  });

  // Helper to get a field from compiled plan
  const getField = (query: string, ...path: string[]) => {
    const plan = compilePlan(query);
    let field: any = plan.root[0]; // Start with first root field

    for (const key of path) {
      if (!field?.selectionSet) return null;
      field = field.selectionSet.find((f: any) => f.responseKey === key);
    }

    return field;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // getView → entities
  // ────────────────────────────────────────────────────────────────────────────
  describe("getView", () => {
    describe("entities", () => {
      it.only("creates reactive entity view", async () => {
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

        expect(userView).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });

        expect(userView).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        });
      });

      it.only("follows __ref to child entity", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

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

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });

        expect(postView.author).toBe(userView);
        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        });
      });

      it.only("maintains entity view identity through deeply nested inline objects", async () => {
        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

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

        expect(postView.nested1.nested2.nested3.author).toBe(userView);
        expect(postView.nested1.nested2.nested3.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });

        expect(postView.nested1.nested2.nested3.author).toBe(userView);
        expect(postView.nested1.nested2.nested3.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        });
      });

      it.only("handles array of refs", () => {
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
          members: [
            { __ref: "User:u1" },
            { __ref: "User:u2" },
          ],
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

      it("returns same view for same (proxy, field, canonical)", () => {
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
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");
        const commentsField = getField(POST_COMMENTS_QUERY, "post", "comments");

        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });

        // Wrap different entity selections
        const userWithPosts = {
          selectionSet: [postsField],
          selectionMap: new Map([["posts", postsField]]),
        } as any;
        const userWithComments = {
          selectionSet: [commentsField],
          selectionMap: new Map([["comments", commentsField]]),
        } as any;

        const v1 = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userWithPosts,
          variables: {},
          canonical: true,
        });
        const v2 = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userWithComments,
          variables: {},
          canonical: true,
        });

        expect(v1).not.toBe(v2);
      });

      it("null/undefined passthrough", () => {
        expect(views.getView({
          source: null,
          field: null,
          variables: {},
          canonical: true,
        })).toBeNull();
        expect(views.getView({
          source: undefined as any,
          field: null,
          variables: {},
          canonical: true,
        })).toBeUndefined();
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
        expect(userView).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
      });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // connections
    // ──────────────────────────────────────────────────────────────────────────
    describe("connections", () => {
      it("creates basic connection view with edges and pageInfo", () => {
        const postsField = getField(POSTS_QUERY, "posts");

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(connectionView.edges).toHaveLength(1);
        expect(connectionView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1" });
        expect(connectionView.pageInfo.startCursor).toBe("p1");
        expect(connectionView.pageInfo.endCursor).toBe("p1");
        expect(connectionView.pageInfo.hasNextPage).toBe(false);
      });

      it("handles null edges", () => {
        const postsField = getField(POSTS_QUERY, "posts");
        graph.putRecord("@.posts({})", {
          __typename: "PostConnection",
          edges: null,
        });

        const connectionView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(connectionView.edges).toBeNull();
      });

      it("returns undefined for missing connection", () => {
        const postsField = getField(POSTS_QUERY, "posts");
        const connectionView = views.getView({
          source: "missing:connection",
          field: postsField,
          variables: {},
          canonical: true,
        });
        expect(connectionView).toBeUndefined();
      });

      it("maintains edges array identity when appending new edges", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");

        graph.putRecord("User:u1", {
          __typename: "User",
          id: "u1",
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.User:u1.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => connectionView.edges);

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
          title: "Post 2",
        });
        graph.putRecord("@.User:u1.posts({}).edges:1", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });
        const prev = graph.getRecord("@.User:u1.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u1.posts({})", {
          edges: { __refs: [...prev, "@.User:u1.posts({}).edges:1"] },
        });

        await nextTick();
        expect(edgesRef.value).toBe(stableEdges);
        expect(seenLen).toBe(2);
        expect(edgesRef.value[1].node).toEqual({
          __typename: "Post",
          id: "p2",
          title: "Post 2",
        });

        stop();
      });

      it("maintains edges array identity when edges shrink", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");
        graph.putRecord("User:u3", {
          __typename: "User",
          id: "u3",
        });

        const connectionData = posts.buildConnection(
          [
            { id: "p1", title: "Post 1" },
            { id: "p2", title: "Post 2" },
          ],
          { startCursor: "p1", endCursor: "p2", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u3.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.User:u3.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => connectionView.edges);

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

      it("maintains edges array identity on edge replacement (refetch)", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");
        graph.putRecord("User:u4", {
          __typename: "User",
          id: "u4",
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u4.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.User:u4.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const edgesRef = computed(() => connectionView.edges);

        await nextTick();
        const stableEdges = edgesRef.value;
        expect(stableEdges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "Post 1",
        });

        graph.putRecord("Post:p2", {
          __typename: "Post",
          id: "p2",
          title: "Post 2",
        });
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
          title: "Post 2",
        });
      });

      it("updates computed mapping when edges change", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");
        graph.putRecord("User:u2", {
          __typename: "User",
          id: "u2",
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u2.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.User:u2.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const titles = computed(() => connectionView.edges.map((e: any) => e.node.title));

        await nextTick();
        expect(titles.value).toEqual(["Post 1"]);

        graph.putRecord("Post:p2", {
          __typename: "Post",
          id: "p2",
          title: "Post 2",
        });
        graph.putRecord("@.User:u2.posts({}).edges:1", {
          __typename: "PostEdge",
          cursor: "p2",
          node: { __ref: "Post:p2" },
        });
        const prev = graph.getRecord("@.User:u2.posts({})")?.edges?.__refs || [];
        graph.putRecord("@.User:u2.posts({})", {
          edges: { __refs: [...prev, "@.User:u2.posts({}).edges:1"] },
        });

        await nextTick();
        expect(titles.value).toEqual(["Post 1", "Post 2"]);

        graph.putRecord("Post:p2", { title: "Post 2 Updated" });
        await nextTick();
        expect(titles.value).toEqual(["Post 1", "Post 2 Updated"]);
      });

      it("observes pageInfo changes via its __ref", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");
        graph.putRecord("User:u3", {
          __typename: "User",
          id: "u3",
        });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u3.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.User:u3.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const endCursor = computed(() => connectionView.pageInfo?.endCursor ?? null);

        await nextTick();
        expect(endCursor.value).toBe("p1");

        const pageInfoRef = graph.getRecord("@.User:u3.posts({})")!.pageInfo.__ref;
        graph.putRecord(pageInfoRef, { endCursor: "p2" });
        await nextTick();

        expect(endCursor.value).toBe("p2");
      });

      it("handles connection with nested aggregations (posts with stats and tags)", () => {
        const postsField = getField(POSTS_WITH_AGGREGATIONS_QUERY, "posts");

        // Create tags for aggregations
        graph.putRecord("Tag:t1", { __typename: "Tag", id: "t1", name: "Tag 1" });
        graph.putRecord("Tag:t2", { __typename: "Tag", id: "t2", name: "Tag 2" });

        // Create post with nested aggregations
        const postsPageKey = '@.posts({"after":null,"category":"tech","first":1})';
        const postsData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        postsData.totalCount = 1;
        writeConnectionPage(graph, postsPageKey, postsData);

        // Add connection-level aggregations
        const connectionAggregationsKey = `${postsPageKey}.aggregations`;
        graph.putRecord(connectionAggregationsKey, {
          __typename: "Aggregations",
          scoring: 88,
          todayStat: { __ref: "Stat:today" },
          yesterdayStat: { __ref: "Stat:yesterday" },
        });

        graph.putRecord("Stat:today", { __typename: "Stat", key: "today", views: 1000 });
        graph.putRecord("Stat:yesterday", { __typename: "Stat", key: "yesterday", views: 850 });

        // Add tags connection to aggregations
        const baseTagsKey = `${connectionAggregationsKey}.tags({})`;
        const baseTagsData = {
          __typename: "TagConnection",
          edges: [
            { __typename: "TagEdge", cursor: "t1", node: { __ref: "Tag:t1" } },
            { __typename: "TagEdge", cursor: "t2", node: { __ref: "Tag:t2" } },
          ],
          pageInfo: {
            __typename: "PageInfo",
            startCursor: "t1",
            endCursor: "t2",
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };

        graph.putRecord(`${baseTagsKey}.edges:0`, baseTagsData.edges[0]);
        graph.putRecord(`${baseTagsKey}.edges:1`, baseTagsData.edges[1]);
        graph.putRecord(`${baseTagsKey}.pageInfo`, baseTagsData.pageInfo);
        graph.putRecord(baseTagsKey, {
          __typename: "TagConnection",
          edges: { __refs: [`${baseTagsKey}.edges:0`, `${baseTagsKey}.edges:1`] },
          pageInfo: { __ref: `${baseTagsKey}.pageInfo` },
        });

        graph.putRecord(connectionAggregationsKey, {
          tags: { __ref: baseTagsKey },
        });

        graph.putRecord(postsPageKey, { aggregations: { __ref: connectionAggregationsKey } });

        // Now test canonical connection with different aggregations
        const postsCanonicalKey = '@connection.posts({"category":"tech"})';
        const canonicalData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        canonicalData.totalCount = 1;
        writeConnectionPage(graph, postsCanonicalKey, canonicalData);

        const canonicalAggregationsKey = `${postsCanonicalKey}.aggregations`;
        graph.putRecord(canonicalAggregationsKey, {
          __typename: "Aggregations",
          scoring: 95,
          todayStat: { __ref: "Stat:today" },
          yesterdayStat: { __ref: "Stat:yesterday" },
        });

        graph.putRecord(postsCanonicalKey, { aggregations: { __ref: canonicalAggregationsKey } });

        const pageView = views.getView({
          source: postsPageKey,
          field: postsField,
          variables: { category: "tech", first: 1, after: null },
          canonical: false,
        });

        expect(pageView.aggregations.scoring).toBe(88);
        expect(pageView.aggregations.todayStat).toEqual({ __typename: "Stat", key: "today", views: 1000 });
        expect(pageView.aggregations.tags.edges).toHaveLength(2);
        expect(pageView.aggregations.tags.edges[0].node).toEqual({ __typename: "Tag", id: "t1", name: "Tag 1" });

        const canonicalView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: { category: "tech", first: 1, after: null },
          canonical: true,
        });

        expect(canonicalView.aggregations.scoring).toBe(95);
        expect(canonicalView.aggregations.todayStat).toEqual({ __typename: "Stat", key: "today", views: 1000 });
      });

      it("materializes root-level connection with reactive edges and nodes", async () => {
        const usersField = getField(USERS_QUERY, "users");

        const canonicalKey = '@connection.users({"role":"admin"})';
        const connectionData = users.buildConnection(
          [
            { id: "u1", email: "u1@example.com" },
            { id: "u2", email: "u2@example.com" },
          ],
          { startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, canonicalKey, connectionData);

        const usersView = views.getView({
          source: canonicalKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        const pageInfoView = usersView.pageInfo;
        expect(pageInfoView.startCursor).toBe("u1");
        expect(pageInfoView.endCursor).toBe("u2");

        expect(usersView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });

        const pageInfoKey = `${canonicalKey}.pageInfo`;
        graph.putRecord(pageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo).toBe(pageInfoView);
        expect(usersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(usersView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1+updated@example.com" });
      });

      it("materializes nested connection via entity field (user.posts)", async () => {
        const canonicalKey = '@connection.User:u1.posts({"category":"tech"})';

        const connectionData = posts.buildConnection(
          [
            { id: "p1", title: "Post 1", flags: [], author: { __ref: "User:u1" } },
            { id: "p2", title: "Post 2", flags: [], author: { __ref: "User:u1" } },
          ],
          { startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false },
        );

        // Manually add score to edges since buildConnection doesn't support it
        connectionData.edges[0].score = 0.5;
        connectionData.edges[1].score = 0.7;
        connectionData.totalCount = 2;

        writeConnectionPage(graph, canonicalKey, connectionData);

        // Also create the user entity
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

        const userPlan = compilePlan(USER_POSTS_QUERY);
        const userField = userPlan.root[0];

        const userView = views.getView({
          source: "User:u1",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
          canonical: true,
        });

        expect(userView.posts.totalCount).toBe(2);

        graph.putRecord(canonicalKey, { totalCount: 3 });
        await nextTick();
        expect(userView.posts.totalCount).toBe(3);

        const edgeKey = `${canonicalKey}.edges:0`;
        graph.putRecord(edgeKey, { score: 0.9 });
        await nextTick();
        expect(userView.posts.edges[0].score).toBe(0.9);

        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(userView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "Post 1 (Updated)",
          flags: [],
          author: { __typename: "User", id: "u1", email: "u1@example.com" },
        });

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(userView.posts.edges[0].node.author).toEqual({ __typename: "User", id: "u1", email: "u1+updated@example.com" });
      });

      it("materializes root connection with nested connection (users.posts)", async () => {
        const usersField = getField(USERS_POSTS_QUERY, "users");
        const postsField = getField(USERS_POSTS_QUERY, "users", "edges", "node", "posts");

        const usersCanonicalKey = '@connection.users({"role":"dj"})';
        const usersData = users.buildConnection(
          [
            { id: "u1", email: "u1@example.com" },
            { id: "u2", email: "u2@example.com" },
          ],
          { startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersCanonicalKey, usersData);

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsData);

        const usersView = views.getView({
          source: usersCanonicalKey,
          field: usersField,
          variables: { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null },
          canonical: true,
        });

        const postsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const usersPageInfoKey = `${usersCanonicalKey}.pageInfo`;
        graph.putRecord(usersPageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(postsView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1 (Updated)", flags: [] });
      });

      it("materializes deeply nested connections (user.posts.comments)", async () => {
        const postsField = getField(USER_POSTS_COMMENTS_QUERY, "user", "posts");
        const commentsField = getField(USER_POSTS_COMMENTS_QUERY, "user", "posts", "edges", "node", "comments");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });
        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsData);

        const commentsCanonicalKey = "@connection.Post:p1.comments({})";
        const commentsData = comments.buildConnection(
          [
            { uuid: "c1", text: "Comment 1", author: { __ref: "User:u2" } },
            { uuid: "c2", text: "Comment 2", author: { __ref: "User:u3" } },
          ],
          { startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsCanonicalKey, commentsData);

        const userPlan = compilePlan(USER_POSTS_COMMENTS_QUERY);
        const userField = userPlan.root[0];

        const userView = views.getView({
          source: "User:u1",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: null },
          canonical: true,
        });

        const postsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const commentsView = views.getView({
          source: commentsCanonicalKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(commentsView.edges[0].node).toEqual({
          __typename: "Comment",
          uuid: "c1",
          text: "Comment 1 (Updated)",
          author: { __typename: "User", id: "u2" },
        });
        expect(userView.posts.edges[0].node.id).toBe("p1");
      });

      it("materializes three-level nested connections (users.posts.comments)", async () => {
        const usersField = getField(USERS_POSTS_COMMENTS_QUERY, "users");
        const postsField = getField(USERS_POSTS_COMMENTS_QUERY, "users", "edges", "node", "posts");
        const commentsField = getField(USERS_POSTS_COMMENTS_QUERY, "users", "edges", "node", "posts", "edges", "node", "comments");

        const usersCanonicalKey = '@connection.users({"role":"admin"})';
        const usersData = users.buildConnection(
          [{ id: "u1", email: "u1@example.com" }],
          { startCursor: "u1", endCursor: "u1", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersCanonicalKey, usersData);

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsData);

        const commentsCanonicalKey = "@connection.Post:p1.comments({})";
        const commentsData = comments.buildConnection(
          [{ uuid: "c1", text: "Comment 1" }],
          { startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsCanonicalKey, commentsData);

        const usersView = views.getView({
          source: usersCanonicalKey,
          field: usersField,
          variables: { usersRole: "admin", usersFirst: 2, usersAfter: null },
          canonical: true,
        });

        const postsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const commentsView = views.getView({
          source: commentsCanonicalKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });

        const usersPageInfoKey = `${usersCanonicalKey}.pageInfo`;
        graph.putRecord(usersPageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(usersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(commentsView.edges[0].node).toEqual({ __typename: "Comment", uuid: "c1", text: "Comment 1 (Updated)" });
        expect(usersView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });
        expect(postsView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [] });
      });

      it("maintains identity stability for edges and nodes across updates", async () => {
        const usersField = getField(USERS_QUERY, "users");

        const canonicalKey = '@connection.users({"role":"admin"})';
        const usersData = users.buildConnection(
          [
            { id: "u1", email: "u1@example.com" },
            { id: "u2", email: "u2@example.com" },
          ],
          { startCursor: "u1", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, canonicalKey, usersData);

        const firstView = views.getView({
          source: canonicalKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        const edgesRef1 = firstView.edges;
        const pageInfoRef1 = firstView.pageInfo;
        const nodeRef1 = firstView.edges[0].node;

        const pageInfoKey = `${canonicalKey}.pageInfo`;
        graph.putRecord(pageInfoKey, { endCursor: "u3" });
        await nextTick();

        const secondView = views.getView({
          source: canonicalKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        expect(secondView.edges).toBe(edgesRef1);
        expect(secondView.pageInfo).toBe(pageInfoRef1);
        expect(secondView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(nodeRef1.email).toBe("u1+updated@example.com");

        const edgeKey2 = `${canonicalKey}.edges:2`;
        graph.putRecord(edgeKey2, { __typename: "UserEdge", cursor: "u3", node: { __ref: "User:u2" } });
        const prev = graph.getRecord(canonicalKey)!.edges.__refs;
        graph.putRecord(canonicalKey, { edges: { __refs: [...prev, edgeKey2] } });

        const thirdView = views.getView({
          source: canonicalKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        expect(thirdView.edges).toBe(edgesRef1);
        expect(edgesRef1.length).toBe(3);
        expect(edgesRef1[2].cursor).toBe("u3");
      });

      it("reads from canonical key when canonical=true via entity field", () => {
        const userPlan = compilePlan(USER_POSTS_QUERY);
        const userField = userPlan.root[0];

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@connection.User:u1.posts({})", connectionData);

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userField,
          variables: {},
          canonical: true,
        });

        expect(userView.posts.edges).toHaveLength(1);
        expect(userView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "Post 1",
        });
      });

      it("reads from page key when canonical=false via entity field", () => {
        const userPlan = compilePlan(USER_POSTS_QUERY);
        const userField = userPlan.root[0];

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });

        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        writeConnectionPage(graph, "@.User:u1.posts({})", connectionData);

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: userField,
          variables: {},
          canonical: false,
        });

        expect(userView.posts.edges).toHaveLength(1);
        expect(userView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "Post 1",
        });
      });

      it("is read-only", () => {
        const postsField = getField(POSTS_QUERY, "posts");
        const connectionData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { hasNextPage: false },
        );
        writeConnectionPage(graph, "@.posts({})", connectionData);

        const connectionView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const result = Reflect.set(connectionView, "totalCount", 999);
        expect(result).toBe(false);
      });
    });
  });
});
