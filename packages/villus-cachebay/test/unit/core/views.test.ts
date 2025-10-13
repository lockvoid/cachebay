import { computed, watchEffect, nextTick } from "vue";
import { compilePlan } from "@/src/compiler";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { writeConnectionPage } from "@/test/helpers";
import { posts, users, comments, tags } from "@/test/helpers/fixtures";
import { USERS_QUERY, USER_POSTS_QUERY, USERS_POSTS_QUERY, USER_POSTS_COMMENTS_QUERY, USERS_POSTS_COMMENTS_QUERY, POSTS_QUERY, POSTS_WITH_AGGREGATIONS_QUERY, POST_COMMENTS_QUERY } from "@/test/helpers/operations";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        Profile: (profile) => profile.slug,
        Media: (media) => media.key,
        Stat: (stat) => stat.key,
        Comment: (comment) => comment.uuid,
      },
      interfaces: {
        Post: ["AudioPost", "VideoPost"],
      },
    });
    views = createViews({ graph });
  });

  const getField = (query: string, ...path: string[]) => {
    const plan = compilePlan(query);
    if (path.length === 0) return plan.root[0];
    let list: any[] = plan.root;
    let field: any | undefined;
    for (const key of path) {
      field = list.find((f: any) => f.responseKey === key);
      if (!field) return undefined;
      list = field.selectionSet ?? [];
    }
    return field;
  };

  describe("getView", () => {
    describe("entities", () => {
      it("creates reactive entity view", async () => {
        const user1 = users.buildNode({ id: "u1", email: "u1@example.com" });

        graph.putRecord("User:u1", user1);

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(userView).toEqual(user1);

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });

        expect(userView).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1+updated@example.com",
        });
      });

      it("follows __ref to child entity", async () => {
        const user1 = users.buildNode({
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", user1);

        const post1 = posts.buildNode({
          id: "p1",
          title: "Post 1",
          author: { __ref: "User:u1" },
        });

        graph.putRecord("Post:p1", post1);

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

      it("maintains entity view identity through deeply nested inline objects", async () => {
        const user1 = users.buildNode({
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", user1);

        const post1 = posts.buildNode({
          id: "p1",
          title: "Post 1",
          nested1: { nested2: { nested3: { author: { __ref: "User:u1" } } } },
        });

        graph.putRecord("Post:p1", post1);

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

      it("handles array of refs", () => {
        const tag1 = tags.buildNode({
          id: "t1",
          name: "Tag 1",
        });

        graph.putRecord("Tag:t1", tag1);

        const tag2 = tags.buildNode({
          id: "t2",
          name: "Tag 2",
        });

        graph.putRecord("Tag:t2", tag2);

        const post1 = posts.buildNode({
          id: "p1",
          title: "Post 1",
          tags: [
            { __ref: "Tag:t1" },
            { __ref: "Tag:t2" },
          ],
        });

        graph.putRecord("Post:p1", post1);

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const tag1View = views.getView({
          source: graph.materializeRecord("Tag:t1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const tag2View = views.getView({
          source: graph.materializeRecord("Tag:t2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.tags).toHaveLength(2);
        expect(postView.tags[0]).toBe(tag1View);
        expect(postView.tags[1]).toBe(tag2View);
        expect(postView.tags[0]).toEqual({
          __typename: "Tag",
          id: "t1",
          name: "Tag 1",
        });
        expect(postView.tags[1]).toEqual({
          __typename: "Tag",
          id: "t2",
          name: "Tag 2",
        });
      });

      it("handles array with { __refs } format", () => {
        const tag1 = tags.buildNode({
          id: "t1",
          name: "Tag 1",
        });

        graph.putRecord("Tag:t1", tag1);

        const tag2 = tags.buildNode({
          id: "t2",
          name: "Tag 2",
        });

        graph.putRecord("Tag:t2", tag2);

        const post1 = posts.buildNode({
          id: "p1",
          title: "Post 1",
          tags: { __refs: ["Tag:t1", "Tag:t2"] },
        });

        graph.putRecord("Post:p1", post1);

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const tag1View = views.getView({
          source: graph.materializeRecord("Tag:t1"),
          field: null,
          variables: {},
          canonical: true,
        });
        const tag2View = views.getView({
          source: graph.materializeRecord("Tag:t2"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.tags).toHaveLength(2);
        expect(postView.tags[0]).toBe(tag1View);
        expect(postView.tags[1]).toBe(tag2View);
        expect(postView.tags[0]).toEqual({
          __typename: "Tag",
          id: "t1",
          name: "Tag 1",
        });
        expect(postView.tags[1]).toEqual({
          __typename: "Tag",
          id: "t2",
          name: "Tag 2",
        });
      });

      it("returns empty reactive placeholder for missing refs", () => {
        const post1 = posts.buildNode({
          id: "p1",
          author: { __ref: "User:missing" },
        });

        graph.putRecord("Post:p1", post1);

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toEqual({});
      });

      it("returns null when field is explicitly null", () => {
        const post1 = posts.buildNode({
          id: "p1",
          author: null,
        });

        graph.putRecord("Post:p1", post1);

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toBeNull();
      });

      it("returns empty placeholder for missing ref, then hydrates in place when record appears", async () => {
        const post1 = posts.buildNode({
          id: "p1",
          author: { __ref: "User:u1" },
        });

        graph.putRecord("Post:p1", post1);

        const postView = views.getView({
          source: graph.materializeRecord("Post:p1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(postView.author).toEqual({});

        const user1 = users.buildNode({ id: "u1", email: "u1@example.com" });

        graph.putRecord("User:u1", user1);

        expect(postView.author).toEqual({
          __typename: "User",
          id: "u1",
          email: "u1@example.com",
        });
      });

      it("returns same view for same (proxy, field, canonical)", () => {
        const user1 = users.buildNode({ id: "u1" });

        graph.putRecord("User:u1", user1);

        const view1 = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const view2 = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(view1).toBe(view2);
      });

      it("returns different views for different canonical flag", () => {
        const user1 = users.buildNode({ id: "u1" });

        graph.putRecord("User:u1", user1);

        const canonicalView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        const pageView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: false,
        });

        expect(canonicalView).not.toBe(pageView);
      });

      it("returns different views for different selections", () => {
        const user1 = users.buildNode({
          id: "u1",
        });

        graph.putRecord("User:u1", user1);

        const postsField = getField(USER_POSTS_QUERY, "user", "posts");

        const userWithPosts = {
          selectionSet: [postsField],
          selectionMap: new Map([["posts", postsField]]),
        };

        const commentsField = getField(POST_COMMENTS_QUERY, "post", "comments");

        const userWithComments = {
          selectionSet: [commentsField],
          selectionMap: new Map([["comments", commentsField]]),
        };

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
        expect(views.getView({ source: null, field: null, variables: {}, canonical: true })).toBeNull();

        expect(views.getView({ source: undefined, field: null, variables: {}, canonical: true })).toBeUndefined();
      });

      it("is read-only", () => {
        const user1 = users.buildNode({
          id: "u1",
          email: "u1@example.com",
        });

        graph.putRecord("User:u1", user1);

        const userView = views.getView({
          source: graph.materializeRecord("User:u1"),
          field: null,
          variables: {},
          canonical: true,
        });

        expect(Reflect.set(userView, "email", "hacker@example.com")).toBe(false);
        expect(userView).toEqual(user1);
      });
    });

    describe("connections", () => {
      it("creates basic connection view with edges and pageInfo", () => {
        const postsField = getField(POSTS_QUERY, "posts");

        const postsData = posts.buildConnection(
          [{ id: "p1", title: "Post 1" }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );

        writeConnectionPage(graph, "@.posts({})", postsData);

        const postsView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        expect(postsView.edges).toHaveLength(1);
        expect(postsView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [] });
        expect(postsView.pageInfo.startCursor).toBe("p1");
        expect(postsView.pageInfo.endCursor).toBe("p1");
        expect(postsView.pageInfo.hasNextPage).toBe(false);
      });

      it("exposes edges as a stable empty array when no refs, upgrades when refs arrive", async () => {
        const postsField = getField(POSTS_QUERY, "posts");

        const post1 = posts.buildNode({
          id: "p1",
          title: "Post 1",
        });

        graph.putRecord("Post:p1", post1);

        graph.putRecord("@.posts({})", {
          __typename: "PostConnection",
          edges: null,
        });

        const postsView = views.getView({
          source: "@.posts({})",
          field: postsField,
          variables: {},
          canonical: false,
        });

        const postsEdges = postsView.edges;

        expect(Array.isArray(postsEdges)).toBe(true);
        expect(postsEdges.length).toBe(0);

        graph.putRecord("@.posts({}).edges:0", {
          __typename: "PostEdge",
          cursor: "p1",
          node: { __ref: "Post:p1" },
        });

        graph.putRecord("@.posts({})", {
          edges: { __refs: ["@.posts({}).edges:0"] },
        });

        expect(postsView.edges).toBe(postsEdges);
        expect(postsEdges.length).toBe(1);
        expect(postsEdges[0].node).toEqual(post1);
      });

      it("returns skeleton for missing connection", () => {
        const postsField = getField(POSTS_QUERY, "posts");

        const connectionView = views.getView({
          source: "missing:connection",
          field: postsField,
          variables: {},
          canonical: true,
        });

        expect(connectionView).toBeDefined();
        expect(Array.isArray(connectionView.edges)).toBe(true);
        expect(connectionView.edges.length).toBe(0);
        expect(connectionView.pageInfo).toBeDefined();
        expect(connectionView.pageInfo.hasNextPage).toBe(false);
        expect(connectionView.pageInfo.hasPreviousPage).toBe(false);
        expect(connectionView.pageInfo.startCursor).toBeNull();
        expect(connectionView.pageInfo.endCursor).toBeNull();
      });

      it("maintains edges array identity when appending new edges", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");

        const user1 = users.buildNode({ id: "u1" });
        graph.putRecord("User:u1", user1);

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

        const post2 = posts.buildNode({ id: "p2", title: "Post 2" });
        graph.putRecord("Post:p2", post2);
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
        expect(edgesRef.value[1].node).toEqual(post2);

        stop();
      });

      it("maintains edges array identity when edges shrink", async () => {
        const postsField = getField(USER_POSTS_QUERY, "user", "posts");

        const user3 = users.buildNode({ id: "u3" });
        graph.putRecord("User:u3", user3);

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
          flags: [],
        });

        graph.putRecord("Post:p2", {
          __typename: "Post",
          id: "p2",
          title: "Post 2",
        });
        graph.putRecord("@.User:u4.posts({}).edges.0", {
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

      it("materializes root-level connection with reactive edges and nodes", async () => {
        const usersField = getField(USERS_QUERY, "users");

        const canonicalKey = '@connection.users({"role":"admin"})';
        const canonicalData = users.buildConnection(
          [
            { id: "u1", email: "u1@example.com" },
            { id: "u2", email: "u2@example.com" },
          ],
          { startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, canonicalKey, canonicalData);

        const canonicalView = views.getView({
          source: canonicalKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: true,
        });

        const canonicalPageInfoView = canonicalView.pageInfo;
        expect(canonicalPageInfoView.startCursor).toBe("u1");
        expect(canonicalPageInfoView.endCursor).toBe("u2");
        expect(canonicalView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });

        const canonicalPageInfoKey = `${canonicalKey}.pageInfo`;
        graph.putRecord(canonicalPageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(canonicalView.pageInfo).toBe(canonicalPageInfoView);
        expect(canonicalView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(canonicalView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1+updated@example.com" });

        const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';
        const pageData = users.buildConnection(
          [
            { id: "u3", email: "u3@example.com" },
            { id: "u4", email: "u4@example.com" },
          ],
          { startCursor: "u3", endCursor: "u4", hasNextPage: false, hasPreviousPage: true },
        );
        writeConnectionPage(graph, pageKey, pageData);

        const pageView = views.getView({
          source: pageKey,
          field: usersField,
          variables: { role: "admin", first: 2, after: null },
          canonical: false,
        });

        expect(pageView.pageInfo.startCursor).toBe("u3");
        expect(pageView.pageInfo.endCursor).toBe("u4");
        expect(pageView.edges[0].node).toEqual({ __typename: "User", id: "u3", email: "u3@example.com" });

        graph.putRecord("User:u3", { email: "u3+updated@example.com" });
        await nextTick();
        expect(pageView.edges[0].node).toEqual({ __typename: "User", id: "u3", email: "u3+updated@example.com" });
      });

      it("materializes nested connection via entity field (user.posts)", async () => {
        const userPlan = compilePlan(USER_POSTS_QUERY);
        const userField = userPlan.root[0];

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

        const canonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const canonicalData = posts.buildConnection(
          [
            { id: "p1", title: "Post 1", flags: [], author: { __ref: "User:u1" } },
            { id: "p2", title: "Post 2", flags: [], author: { __ref: "User:u1" } },
          ],
          { startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false },
        );
        canonicalData.edges[0].score = 0.5;
        canonicalData.edges[1].score = 0.7;
        canonicalData.totalCount = 2;
        writeConnectionPage(graph, canonicalKey, canonicalData);

        const canonicalUserView = views.getView({
          source: "User:u1",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
          canonical: true,
        });

        expect(canonicalUserView.posts.totalCount).toBe(2);
        expect(canonicalUserView.posts.edges[0].score).toBe(0.5);
        expect(canonicalUserView.posts.edges[0].node.title).toBe("Post 1");

        graph.putRecord(canonicalKey, { totalCount: 3 });
        await nextTick();
        expect(canonicalUserView.posts.totalCount).toBe(3);

        const edgeKey = `${canonicalKey}.edges.0`;
        graph.putRecord(edgeKey, { score: 0.9 });
        await nextTick();
        expect(canonicalUserView.posts.edges[0].score).toBe(0.9);

        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(canonicalUserView.posts.edges[0].node).toEqual({
          __typename: "Post",
          id: "p1",
          title: "Post 1 (Updated)",
          flags: [],
          author: { __typename: "User", id: "u1", email: "u1@example.com" },
        });

        graph.putRecord("User:u1", { email: "u1+updated@example.com" });
        await nextTick();
        expect(canonicalUserView.posts.edges[0].node.author).toEqual({ __typename: "User", id: "u1", email: "u1+updated@example.com" });

        const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';
        const pageData = posts.buildConnection(
          [
            { id: "p3", title: "Post 3", flags: [] },
            { id: "p4", title: "Post 4", flags: [] },
          ],
          { startCursor: "p3", endCursor: "p4", hasNextPage: false, hasPreviousPage: false },
        );
        pageData.edges[0].score = 0.8;
        pageData.edges[1].score = 0.6;
        pageData.totalCount = 2;
        writeConnectionPage(graph, pageKey, pageData);

        const pageUserView = views.getView({
          source: "User:u1",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 2, postsAfter: null },
          canonical: false,
        });

        expect(pageUserView.posts.totalCount).toBe(2);
        expect(pageUserView.posts.edges[0].score).toBe(0.8);
        expect(pageUserView.posts.edges[0].node.title).toBe("Post 3");

        graph.putRecord("Post:p3", { title: "Post 3 (Updated)" });
        await nextTick();
        expect(pageUserView.posts.edges[0].node.title).toBe("Post 3 (Updated)");
      });

      it("materializes root connection with nested connection (users.posts)", async () => {
        const usersField = getField(USERS_POSTS_QUERY, "users");
        const postsField = getField(USERS_POSTS_QUERY, "users", "edges", "node", "posts");

        const usersCanonicalKey = '@connection.users({"role":"dj"})';
        const usersCanonicalData = users.buildConnection(
          [
            { id: "u1", email: "u1@example.com" },
            { id: "u2", email: "u2@example.com" },
          ],
          { startCursor: "u1", endCursor: "u2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersCanonicalKey, usersCanonicalData);

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsCanonicalData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsCanonicalData);

        const canonicalUsersView = views.getView({
          source: usersCanonicalKey,
          field: usersField,
          variables: { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null },
          canonical: true,
        });

        const canonicalPostsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const usersPageInfoKey = `${usersCanonicalKey}.pageInfo`;
        graph.putRecord(usersPageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(canonicalUsersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("Post:p1", { title: "Post 1 (Updated)" });
        await nextTick();
        expect(canonicalPostsView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1 (Updated)", flags: [] });

        const usersPageKey = '@.users({"after":null,"first":2,"role":"dj"})';
        const usersPageData = users.buildConnection(
          [{ id: "u3", email: "u3@example.com" }],
          { startCursor: "u3", endCursor: "u3", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersPageKey, usersPageData);

        const postsPageKey = '@.User:u3.posts({"after":null,"category":"tech","first":1})';
        const postsPageData = posts.buildConnection(
          [{ id: "p2", title: "Post 2", flags: [] }],
          { startCursor: "p2", endCursor: "p2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsPageKey, postsPageData);

        const pageUsersView = views.getView({
          source: usersPageKey,
          field: usersField,
          variables: { usersRole: "dj", usersFirst: 2, usersAfter: null, postsCategory: "tech", postsFirst: 1, postsAfter: null },
          canonical: false,
        });

        expect(pageUsersView.edges[0].node.email).toBe("u3@example.com");
        expect(pageUsersView.edges[0].node.posts.edges[0].node.title).toBe("Post 2");

        graph.putRecord("Post:p2", { title: "Post 2 (Updated)" });
        await nextTick();
        expect(pageUsersView.edges[0].node.posts.edges[0].node.title).toBe("Post 2 (Updated)");
      });

      it("materializes deeply nested connections (user.posts.comments)", async () => {
        const userPlan = compilePlan(USER_POSTS_COMMENTS_QUERY);
        const userField = userPlan.root[0];
        const postsField = getField(USER_POSTS_COMMENTS_QUERY, "user", "posts");
        const commentsField = getField(USER_POSTS_COMMENTS_QUERY, "user", "posts", "edges", "node", "comments");

        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });
        graph.putRecord("User:u3", { __typename: "User", id: "u3" });

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsCanonicalData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsCanonicalData);

        const commentsCanonicalKey = "@connection.Post:p1.comments({})";
        const commentsCanonicalData = comments.buildConnection(
          [
            { uuid: "c1", text: "Comment 1", author: { __ref: "User:u2" } },
            { uuid: "c2", text: "Comment 2", author: { __ref: "User:u3" } },
          ],
          { startCursor: "c1", endCursor: "c2", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsCanonicalKey, commentsCanonicalData);

        const canonicalUserView = views.getView({
          source: "User:u1",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: null },
          canonical: true,
        });

        const canonicalPostsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const canonicalCommentsView = views.getView({
          source: commentsCanonicalKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });

        expect(canonicalUserView.posts.edges[0].node.id).toBe("p1");
        expect(canonicalCommentsView.edges[0].node.text).toBe("Comment 1");

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(canonicalCommentsView.edges[0].node).toEqual({
          __typename: "Comment",
          uuid: "c1",
          text: "Comment 1 (Updated)",
          author: { __typename: "User", id: "u2" },
        });

        graph.putRecord("User:u4", { __typename: "User", id: "u4" });
        graph.putRecord("User:u5", { __typename: "User", id: "u5" });

        const postsPageKey = '@.User:u4.posts({"after":null,"category":"tech","first":1})';
        const postsPageData = posts.buildConnection(
          [{ id: "p2", title: "Post 2", flags: [] }],
          { startCursor: "p2", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsPageKey, postsPageData);

        const commentsPageKey = '@.Post:p2.comments({"after":null,"first":2})';
        const commentsPageData = comments.buildConnection(
          [{ uuid: "c3", text: "Comment 3", author: { __ref: "User:u5" } }],
          { startCursor: "c3", endCursor: "c3", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsPageKey, commentsPageData);

        const pageUserView = views.getView({
          source: "User:u4",
          field: userField,
          variables: { postsCategory: "tech", postsFirst: 1, postsAfter: null, commentsFirst: 2, commentsAfter: null },
          canonical: false,
        });

        expect(pageUserView.posts.edges[0].node.id).toBe("p2");
        expect(pageUserView.posts.edges[0].node.comments.edges[0].node.text).toBe("Comment 3");

        graph.putRecord("Comment:c3", { text: "Comment 3 (Updated)" });
        await nextTick();
        expect(pageUserView.posts.edges[0].node.comments.edges[0].node.text).toBe("Comment 3 (Updated)");
      });

      it("materializes three-level nested connections (users.posts.comments)", async () => {
        const usersField = getField(USERS_POSTS_COMMENTS_QUERY, "users");
        const postsField = getField(USERS_POSTS_COMMENTS_QUERY, "users", "edges", "node", "posts");
        const commentsField = getField(USERS_POSTS_COMMENTS_QUERY, "users", "edges", "node", "posts", "edges", "node", "comments");

        const usersCanonicalKey = '@connection.users({"role":"admin"})';
        const usersCanonicalData = users.buildConnection(
          [{ id: "u1", email: "u1@example.com" }],
          { startCursor: "u1", endCursor: "u1", hasNextPage: true, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersCanonicalKey, usersCanonicalData);

        const postsCanonicalKey = '@connection.User:u1.posts({"category":"tech"})';
        const postsCanonicalData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsCanonicalKey, postsCanonicalData);

        const commentsCanonicalKey = "@connection.Post:p1.comments({})";
        const commentsCanonicalData = comments.buildConnection(
          [{ uuid: "c1", text: "Comment 1" }],
          { startCursor: "c1", endCursor: "c1", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsCanonicalKey, commentsCanonicalData);

        const canonicalUsersView = views.getView({
          source: usersCanonicalKey,
          field: usersField,
          variables: { usersRole: "admin", usersFirst: 2, usersAfter: null },
          canonical: true,
        });

        const canonicalPostsView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: {},
          canonical: true,
        });

        const canonicalCommentsView = views.getView({
          source: commentsCanonicalKey,
          field: commentsField,
          variables: {},
          canonical: true,
        });

        const usersPageInfoKey = `${usersCanonicalKey}.pageInfo`;
        graph.putRecord(usersPageInfoKey, { endCursor: "u3" });
        await nextTick();
        expect(canonicalUsersView.pageInfo.endCursor).toBe("u3");

        graph.putRecord("Comment:c1", { text: "Comment 1 (Updated)" });
        await nextTick();
        expect(canonicalCommentsView.edges[0].node).toEqual({ __typename: "Comment", uuid: "c1", text: "Comment 1 (Updated)" });
        expect(canonicalUsersView.edges[0].node).toEqual({ __typename: "User", id: "u1", email: "u1@example.com" });
        expect(canonicalPostsView.edges[0].node).toEqual({ __typename: "Post", id: "p1", title: "Post 1", flags: [] });

        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

        const usersPageKey = '@.users({"after":null,"first":2,"role":"admin"})';
        const usersPageData = users.buildConnection(
          [{ id: "u2", email: "u2@example.com" }],
          { startCursor: "u2", endCursor: "u2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, usersPageKey, usersPageData);

        const postsPageKey = '@.User:u2.posts({"after":null,"category":"tech","first":1})';
        const postsPageData = posts.buildConnection(
          [{ id: "p2", title: "Post 2", flags: [] }],
          { startCursor: "p2", endCursor: "p2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, postsPageKey, postsPageData);

        const commentsPageKey = '@.Post:p2.comments({"after":null,"first":1})';
        const commentsPageData = comments.buildConnection(
          [{ uuid: "c2", text: "Comment 2" }],
          { startCursor: "c2", endCursor: "c2", hasNextPage: false, hasPreviousPage: false },
        );
        writeConnectionPage(graph, commentsPageKey, commentsPageData);

        const pageUsersView = views.getView({
          source: usersPageKey,
          field: usersField,
          variables: {
            usersRole: "admin", usersFirst: 2, usersAfter: null,
            postsCategory: "tech", postsFirst: 1, postsAfter: null,
            commentsFirst: 1, commentsAfter: null,
          },
          canonical: false,
        });

        expect(pageUsersView.edges[0].node.email).toBe("u2@example.com");
        expect(pageUsersView.edges[0].node.posts.edges[0].node.title).toBe("Post 2");
        expect(pageUsersView.edges[0].node.posts.edges[0].node.comments.edges[0].node.text).toBe("Comment 2");

        graph.putRecord("Comment:c2", { text: "Comment 2 (Updated)" });
        await nextTick();
        expect(pageUsersView.edges[0].node.posts.edges[0].node.comments.edges[0].node.text).toBe("Comment 2 (Updated)");
      });

      it("handles connection with nested aggregations (posts with stats and tags)", () => {
        const postsField = getField(POSTS_WITH_AGGREGATIONS_QUERY, "posts");

        graph.putRecord("Tag:t1", { __typename: "Tag", id: "t1", name: "Tag 1" });
        graph.putRecord("Tag:t2", { __typename: "Tag", id: "t2", name: "Tag 2" });
        graph.putRecord("Tag:t3", { __typename: "Tag", id: "t3", name: "Tag 3" });

        const postsPageKey = '@.posts({"after":null,"category":"tech","first":1})';
        const postsPageData = posts.buildConnection(
          [{ id: "p1", title: "Post 1", flags: [] }],
          { startCursor: "p1", endCursor: "p1", hasNextPage: false },
        );
        postsPageData.totalCount = 1;
        writeConnectionPage(graph, postsPageKey, postsPageData);

        const pageAggregationsKey = `${postsPageKey}.aggregations`;
        graph.putRecord(pageAggregationsKey, {
          __typename: "Aggregations",
          scoring: 88,
          todayStat: { __ref: "Stat:today" },
          yesterdayStat: { __ref: "Stat:yesterday" },
        });

        graph.putRecord("Stat:today", { __typename: "Stat", key: "today", views: 1000 });
        graph.putRecord("Stat:yesterday", { __typename: "Stat", key: "yesterday", views: 850 });

        const pageTagsKey = `${pageAggregationsKey}.tags({})`;
        const pageTagsData = {
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

        graph.putRecord(`${pageTagsKey}.edges:0`, pageTagsData.edges[0]);
        graph.putRecord(`${pageTagsKey}.edges:1`, pageTagsData.edges[1]);
        graph.putRecord(`${pageTagsKey}.pageInfo`, pageTagsData.pageInfo);
        graph.putRecord(pageTagsKey, {
          __typename: "TagConnection",
          edges: { __refs: [`${pageTagsKey}.edges:0`, `${pageTagsKey}.edges:1`] },
          pageInfo: { __ref: `${pageTagsKey}.pageInfo` },
        });

        graph.putRecord(pageAggregationsKey, {
          tags: { __ref: pageTagsKey },
        });

        graph.putRecord(postsPageKey, { aggregations: { __ref: pageAggregationsKey } });

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

        const canonicalTagsKey = `${canonicalAggregationsKey}.tags({})`;
        const canonicalTagsData = {
          __typename: "TagConnection",
          edges: [
            { __typename: "TagEdge", cursor: "t1", node: { __ref: "Tag:t1" } },
            { __typename: "TagEdge", cursor: "t3", node: { __ref: "Tag:t3" } },
          ],
          pageInfo: {
            __typename: "PageInfo",
            startCursor: "t1",
            endCursor: "t3",
            hasNextPage: false,
            hasPreviousPage: false,
          },
        };

        graph.putRecord(`${canonicalTagsKey}.edges:0`, canonicalTagsData.edges[0]);
        graph.putRecord(`${canonicalTagsKey}.edges:1`, canonicalTagsData.edges[1]);
        graph.putRecord(`${canonicalTagsKey}.pageInfo`, canonicalTagsData.pageInfo);
        graph.putRecord(canonicalTagsKey, {
          __typename: "TagConnection",
          edges: { __refs: [`${canonicalTagsKey}.edges:0`, `${canonicalTagsKey}.edges:1`] },
          pageInfo: { __ref: `${canonicalTagsKey}.pageInfo` },
        });

        graph.putRecord(canonicalAggregationsKey, {
          tags: { __ref: canonicalTagsKey },
        });

        graph.putRecord(postsCanonicalKey, { aggregations: { __ref: canonicalAggregationsKey } });

        const canonicalView = views.getView({
          source: postsCanonicalKey,
          field: postsField,
          variables: { category: "tech", first: 1, after: null },
          canonical: true,
        });

        expect(canonicalView.aggregations.scoring).toBe(95);
        expect(canonicalView.aggregations.todayStat).toEqual({ __typename: "Stat", key: "today", views: 1000 });
        expect(canonicalView.aggregations.tags.edges).toHaveLength(2);
        expect(canonicalView.aggregations.tags.edges[0].node).toEqual({ __typename: "Tag", id: "t1", name: "Tag 1" });
        expect(canonicalView.aggregations.tags.edges[1].node).toEqual({ __typename: "Tag", id: "t3", name: "Tag 3" });
      });
    });
  });
});
