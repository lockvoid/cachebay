import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createPlanField, createConnectionPlanField, seedConnectionPage } from "@/test/helpers/unit";
import type { PlanField } from "@/src/compiler";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph({});
    views = createViews({ graph });
  });

  describe("getEntityView", () => {
    it("dereferences __ref fields and arrays of refs (with selection), and lazily reads connection field", () => {
      graph.putRecord("User:alice", {
        __typename: "User",
        id: "alice",
        email: "alice@example.com",
        bestFriend: { __ref: "User:bob" },
        friends: [{ __ref: "User:bob" }],
      });
      graph.putRecord("User:bob", { __typename: "User", id: "bob", email: "bob@example.com" });

      const emailField = createPlanField("email");
      const friendsField = createPlanField("friends", false, [emailField]);
      const bestFriendField = createPlanField("bestFriend", false, [emailField]);
      const postsConnection = createConnectionPlanField("posts");
      const userFields: PlanField[] = [createPlanField("__typename"), createPlanField("id"), bestFriendField, friendsField, postsConnection];
      const fieldMap = new Map<string, PlanField>();
      userFields.forEach((field) => fieldMap.set(field.responseKey, field));

      const aliceProxy = graph.materializeRecord("User:alice")!;
      const userView = views.getEntityView(aliceProxy, userFields, fieldMap, {}, false);

      expect(userView.bestFriend.email).toBe("bob@example.com");
      expect(Array.isArray(userView.friends)).toBe(true);
      expect(userView.friends[0].email).toBe("bob@example.com");

      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "First Post" });
      seedConnectionPage(
        graph,
        '@.User:alice.posts({})',
        [{ nodeRef: "Post:1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
        {},
        "PostEdge",
        "PostConnection"
      );

      const postsView = userView.posts;
      expect(Array.isArray(postsView.edges)).toBe(true);
      expect(postsView.edges[0].node.__typename).toBe("Post");
      expect(postsView.edges[0].node.id).toBe("1");

      graph.putRecord("User:bob", { email: "bob.updated@example.com" });
      expect(userView.bestFriend.email).toBe("bob.updated@example.com");
      expect(userView.friends[0].email).toBe("bob.updated@example.com");
    });

    it("caches per (entityProxy, selection key) — different selections produce different view instances; canonical dimension separated", () => {
      graph.putRecord("User:charlie", { __typename: "User", id: "charlie", email: "charlie@example.com" });
      const charlieProxy = graph.materializeRecord("User:charlie")!;

      const idOnlyFields = [createPlanField("id")];
      const idOnlyMap = new Map<string, PlanField>([["id", idOnlyFields[0]]]);

      const idEmailFields = [createPlanField("id"), createPlanField("email")];
      const idEmailMap = new Map<string, PlanField>([
        ["id", idEmailFields[0]],
        ["email", idEmailFields[1]],
      ]);

      const view1 = views.getEntityView(charlieProxy, idOnlyFields, idOnlyMap, {}, false);
      const view2 = views.getEntityView(charlieProxy, idOnlyFields, idOnlyMap, {}, false);
      const view3 = views.getEntityView(charlieProxy, idEmailFields, idEmailMap, {}, false);
      const canonicalView = views.getEntityView(charlieProxy, idOnlyFields, idOnlyMap, {}, true);

      expect(view1).toBe(view2);
      expect(view1).not.toBe(view3);
      expect(view1).not.toBe(canonicalView);
    });
  });

  describe("getConnectionView", () => {
    it("returns a memoized edges array until refs change", () => {
      const postsConnectionField = createConnectionPlanField("posts");

      graph.putRecord("User:diana", { __typename: "User", id: "diana" });
      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "First Post" });
      seedConnectionPage(
        graph,
        '@.User:diana.posts({})',
        [{ nodeRef: "Post:1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
        {},
        "PostEdge",
        "PostConnection"
      );

      const connectionView = views.getConnectionView('@.User:diana.posts({})', postsConnectionField, {}, false);
      const firstEdgesArray = connectionView.edges;
      const secondEdgesArray = connectionView.edges;
      expect(firstEdgesArray).toBe(secondEdgesArray);

      graph.putRecord("Post:2", { __typename: "Post", id: "2", title: "Second Post" });
      const secondEdgeKey = '@.User:diana.posts({}).edges.1';
      graph.putRecord(secondEdgeKey, { __typename: "PostEdge", cursor: "p2", node: { __ref: "Post:2" } });

      const existingEdges = (graph.getRecord('@.User:diana.posts({})')?.edges ?? []).slice();
      graph.putRecord('@.User:diana.posts({})', { edges: [...existingEdges, { __ref: secondEdgeKey }] });

      const thirdEdgesArray = connectionView.edges;
      expect(thirdEdgesArray).not.toBe(firstEdgesArray);
      expect(thirdEdgesArray.length).toBe(2);
      expect(thirdEdgesArray[1].node.id).toBe("2");
    });
  });

  describe("getEdgeView", () => {
    it("node is an entity view; updates flow through", () => {
      const nodeField = createPlanField("node", false, [createPlanField("id"), createPlanField("title")]);

      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "First Post" });
      graph.putRecord("@.posts", { __typename: "PostConnection" });
      graph.putRecord("@.posts.edges.0", { __typename: "PostEdge", cursor: "c1", node: { __ref: "Post:1" } });

      const edgeView = views.getEdgeView("@.posts.edges.0", nodeField, {}, false);
      expect(edgeView.cursor).toBe("c1");
      expect(edgeView.node.title).toBe("First Post");

      graph.putRecord("Post:1", { title: "Updated First Post" });
      expect(edgeView.node.title).toBe("Updated First Post");
    });
  });
});
