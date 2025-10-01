// TODO: Needs refactor

import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createPlanField, createConnectionPlanField, seedConnectionPage, createSelection } from "@/test/helpers/unit";

describe("Views", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof createViews>;

  beforeEach(() => {
    graph = createGraph();
    views = createViews({ graph });
  });

  describe("getEntityView", () => {
    it("dereferences __ref fields and arrays of refs (with selection), and lazily reads connection field", () => {
      graph.putRecord("User:u1", {
        __typename: "User",
        id: "u1",
        email: "u1@example.com",
        bestFriend: { __ref: "User:u2" },
        friends: [{ __ref: "User:u2" }],
      });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "u2@example.com" });

      const { fields: userFields, map: fieldMap } = createSelection({
        __typename: true,
        id: true,
        bestFriend: ["email"],
        friends: ["email"],
        posts: "connection",
      });

      const u1Proxy = graph.materializeRecord("User:u1")!;
      const userView = views.getEntityView(u1Proxy, userFields, fieldMap, {}, false);

      expect(userView.bestFriend.email).toBe("u2@example.com");
      expect(Array.isArray(userView.friends)).toBe(true);
      expect(userView.friends[0].email).toBe("u2@example.com");

      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "First Post" });
      seedConnectionPage(
        graph,
        "@.User:u1.posts({})",
        [{ nodeRef: "Post:1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
        {},
        "PostEdge",
        "PostConnection",
      );

      const postsView = userView.posts;
      expect(Array.isArray(postsView.edges)).toBe(true);
      expect(postsView.edges[0].node.__typename).toBe("Post");
      expect(postsView.edges[0].node.id).toBe("1");

      graph.putRecord("User:u2", { email: "u2.updated@example.com" });
      expect(userView.bestFriend.email).toBe("u2.updated@example.com");
      expect(userView.friends[0].email).toBe("u2.updated@example.com");
    });

    it("caches per (entityProxy, selection key) — different selections produce different view instances; canonical dimension separated", () => {
      graph.putRecord("User:u3", { __typename: "User", id: "u3", email: "u3@example.com" });
      const u3Proxy = graph.materializeRecord("User:u3")!;

      const { fields: idOnlyFields, map: idOnlyMap } = createSelection({ id: true });
      const { fields: idEmailFields, map: idEmailMap } = createSelection({ id: true, email: true });

      const view1 = views.getEntityView(u3Proxy, idOnlyFields, idOnlyMap, {}, false);
      const view2 = views.getEntityView(u3Proxy, idOnlyFields, idOnlyMap, {}, false);
      const view3 = views.getEntityView(u3Proxy, idEmailFields, idEmailMap, {}, false);
      const canonicalView = views.getEntityView(u3Proxy, idOnlyFields, idOnlyMap, {}, true);

      expect(view1).toBe(view2);
      expect(view1).not.toBe(view3);
      expect(view1).not.toBe(canonicalView);
    });
  });

  describe("getConnectionView", () => {
    it("returns a memoized edges array until refs change", () => {
      const postsConnectionField = createConnectionPlanField("posts");

      graph.putRecord("User:u4", { __typename: "User", id: "u4" });
      graph.putRecord("Post:1", { __typename: "Post", id: "1", title: "First Post" });
      seedConnectionPage(
        graph,
        "@.User:u4.posts({})",
        [{ nodeRef: "Post:1", cursor: "p1" }],
        { __typename: "PageInfo", startCursor: "p1", endCursor: "p1", hasNextPage: false },
        {},
        "PostEdge",
        "PostConnection",
      );

      const connectionView = views.getConnectionView("@.User:u4.posts({})", postsConnectionField, {}, false);
      const firstEdgesArray = connectionView.edges;
      const secondEdgesArray = connectionView.edges;
      expect(firstEdgesArray).toBe(secondEdgesArray);

      graph.putRecord("Post:2", { __typename: "Post", id: "2", title: "Second Post" });
      const secondEdgeKey = "@.User:u4.posts({}).edges.1";
      graph.putRecord(secondEdgeKey, { __typename: "PostEdge", cursor: "p2", node: { __ref: "Post:2" } });

      const existingEdges = (graph.getRecord("@.User:u4.posts({})")?.edges ?? []).slice();
      graph.putRecord("@.User:u4.posts({})", { edges: [...existingEdges, { __ref: secondEdgeKey }] });

      const thirdEdgesArray = connectionView.edges;
      expect(thirdEdgesArray).not.toBe(firstEdgesArray);
      expect(thirdEdgesArray.length).toBe(2);
      expect(thirdEdgesArray[1].node.id).toBe("2");
    });
  });

  describe("getEdgeView", () => {
    it("node is an entity view; updates flow through", () => {
      const { fields: nodeFields } = createSelection({ id: true, title: true });
      const nodeField = createPlanField("node", false, nodeFields);

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
