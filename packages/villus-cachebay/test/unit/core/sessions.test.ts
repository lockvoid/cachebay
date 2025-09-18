// test/unit/core/sessions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { isReactive } from "vue";
import { createGraph } from "@/src/core/graph";
import { createViews } from "@/src/core/views";
import { createSessions } from "@/src/core/sessions";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeGraph = () =>
  createGraph({
    interfaces: { Post: ["AudioPost", "VideoPost"] },
  });

const makeViews = (graph: ReturnType<typeof createGraph>) => createViews({ graph });
const makeSessions = (graph: ReturnType<typeof createGraph>, views: ReturnType<typeof makeViews>) =>
  createSessions({ graph, views });

/**
 * Seed a connection page into the graph.
 * - pageKey: '@.users({"after":null,"first":2,"role":"dj"})'
 * - edges: array of { nodeRef: string, cursor?: string, extra?: Record<string, any> }
 * - pageInfo: object to spread onto pageInfo
 * - extra: additional connection-level fields (e.g., totalCount)
 */
function seedPage(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection"
) {
  const edgeRefs: Array<{ __ref: string }> = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });
    edgeRefs.push({ __ref: edgeKey });
  }

  const snap: Record<string, any> = {
    __typename: connectionTypename,
    edges: edgeRefs,
  };

  if (pageInfo) {
    snap.pageInfo = { ...(pageInfo as any) };
  }

  if (extra) {
    for (const k of Object.keys(extra)) snap[k] = (extra as any)[k];
  }

  graph.putRecord(pageKey, snap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("sessions", () => {
  let graph: ReturnType<typeof createGraph>;
  let views: ReturnType<typeof makeViews>;
  let sessions: ReturnType<typeof makeSessions>;

  beforeEach(() => {
    graph = makeGraph();
    views = makeViews(graph);
    sessions = makeSessions(graph, views);
  });

  describe("createSession", () => {
    it("mount(entity) retains and returns reactive proxy", () => {
      const session = sessions.createSession();

      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

      const user = session.mount("User:u1");
      expect(isReactive(user)).toBe(true);
      expect(user.email).toBe("u1@example.com");

      graph.putRecord("User:u1", { email: "u1+updated@example.com" });
      expect(user.email).toBe("u1+updated@example.com");
    });
  });

  describe("mountConnection", () => {
    describe("infinit mode", () => {
      it("concatenates edges across pages; pageInfo mirrors latest", () => {
        const session = sessions.createSession();

        // entities
        graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "b@example.com" });
        graph.putRecord("User:u3", { __typename: "User", id: "u3", email: "c@example.com" });
        graph.putRecord("User:u4", { __typename: "User", id: "u4", email: "d@example.com" });

        // pages
        const page1 = '@.users({"after":null,"first":2,"role":"dj"})';
        const page2 = '@.users({"after":"u2","first":2,"role":"dj"})';

        seedPage(
          graph,
          page1,
          [
            { nodeRef: "User:u1", cursor: "u1" },
            { nodeRef: "User:u2", cursor: "u2" },
          ],
          { __typename: "PageInfo", startCursor: "u1", endCursor: "u2", hasNextPage: true }
        );
        seedPage(
          graph,
          page2,
          [{ nodeRef: "User:u3", cursor: "u3" }, { nodeRef: "User:u4", cursor: "u4" }],
          { __typename: "PageInfo", startCursor: "u3", endCursor: "u4", hasNextPage: false }
        );

        const identityKey = '@.users({"role":"dj"})#identity';
        const conn = session.mountConnection({ identityKey, mode: "infinite", dedupeBy: "cursor" });

        conn.addPage(page1);
        conn.addPage(page2);

        const view = conn.getView();

        expect(view.__typename).toBe("Connection");
        expect(Array.isArray(view.edges)).toBe(true);
        expect(view.edges.length).toBe(4);

        const node0 = view.edges[0].node;
        expect(isReactive(node0)).toBe(true);
        expect(node0.email).toBe("a@example.com");

        // mirrors latest page
        expect(view.pageInfo.endCursor).toBe("u4");
        graph.putRecord(page2, { pageInfo: { endCursor: "uX" } });
        expect(view.pageInfo.endCursor).toBe("uX");
      });

      it("dedupe by node: keeps first occurrence across pages", () => {
        const session = sessions.createSession();

        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });

        const page1 = '@.feed({"after":null,"first":2})';
        const page2 = '@.feed({"after":"p1","first":2})';

        seedPage(
          graph,
          page1,
          [{ nodeRef: "Post:p1", cursor: "p1", extra: { score: 10 } }],
          { __typename: "PageInfo", endCursor: "p1" },
          { totalCount: 1 },
          "PostEdge",
          "PostConnection"
        );
        seedPage(
          graph,
          page2,
          [{ nodeRef: "Post:p1", cursor: "p1b", extra: { score: 99 } }],
          { __typename: "PageInfo", endCursor: "p1b" },
          {},
          "PostEdge",
          "PostConnection"
        );

        const conn = session.mountConnection({
          identityKey: '@.feed({})#identity',
          mode: "infinite",
          dedupeBy: "node",
        });

        conn.addPage(page1);
        conn.addPage(page2);

        const view = conn.getView();
        expect(view.edges.length).toBe(1);
        expect(view.edges[0].cursor).toBe("p1");
        expect(view.edges[0].score).toBe(10);
      });

      it("removePage / clear update composed edges", () => {
        const session = sessions.createSession();

        graph.putRecord("User:u1", { __typename: "User", id: "u1" });
        graph.putRecord("User:u2", { __typename: "User", id: "u2" });

        const p1 = '@.users({"after":null,"first":2})';
        const p2 = '@.users({"after":"u1","first":2})';

        seedPage(graph, p1, [{ nodeRef: "User:u1", cursor: "u1" }], { __typename: "PageInfo", endCursor: "u1" }, {}, "UserEdge", "UserConnection");
        seedPage(graph, p2, [{ nodeRef: "User:u2", cursor: "u2" }], { __typename: "PageInfo", endCursor: "u2" }, {}, "UserEdge", "UserConnection");

        const conn = session.mountConnection({ identityKey: '@.users({})#identity', mode: "infinite" });
        conn.addPage(p1);
        conn.addPage(p2);

        let view = conn.getView();
        expect(view.edges.length).toBe(2);

        conn.removePage(p2);
        view = conn.getView();
        expect(view.edges.length).toBe(1);

        conn.clear();
        view = conn.getView();
        expect(view.edges.length).toBe(0);
      });

      it("edge.node views are reactive through graph updates", () => {
        const session = sessions.createSession();

        graph.putRecord("Comment:c1", { __typename: "Comment", id: "c1", text: "C1" });
        graph.putRecord("Comment:c2", { __typename: "Comment", id: "c2", text: "C2" });

        const page = '@.Post:p1.comments({"after":null,"first":2})';
        seedPage(
          graph,
          page,
          [{ nodeRef: "Comment:c1", cursor: "c1" }, { nodeRef: "Comment:c2", cursor: "c2" }],
          { __typename: "PageInfo", endCursor: "c2" },
          {},
          "CommentEdge",
          "CommentConnection"
        );

        const conn = session.mountConnection({ identityKey: '@.Post:p1.comments({})#identity', mode: "infinite" });
        conn.addPage(page);

        const view = conn.getView();
        const c1 = view.edges[0].node;
        expect(isReactive(c1)).toBe(true);
        expect(c1.text).toBe("C1");

        graph.putRecord("Comment:c1", { text: "C1 (Updated)" });
        expect(c1.text).toBe("C1 (Updated)");
      });
    });

    describe("page mode", () => {
      it("setPage switches the exposed page", () => {
        const session = sessions.createSession();

        graph.putRecord("Post:p1", { __typename: "Post", id: "p1", title: "P1" });
        graph.putRecord("Post:p2", { __typename: "Post", id: "p2", title: "P2" });

        const pageA = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
        const pageB = '@.User:u1.posts({"after":"p1","category":"tech","first":1})';

        seedPage(
          graph,
          pageA,
          [{ nodeRef: "Post:p1", cursor: "p1" }],
          { __typename: "PageInfo", endCursor: "p1", hasNextPage: true },
          { totalCount: 2 },
          "PostEdge",
          "PostConnection"
        );
        seedPage(
          graph,
          pageB,
          [{ nodeRef: "Post:p2", cursor: "p2" }],
          { __typename: "PageInfo", endCursor: "p2", hasNextPage: false },
          { totalCount: 2 },
          "PostEdge",
          "PostConnection"
        );

        const conn = session.mountConnection({
          identityKey: '@.User:u1.posts({"category":"tech"})#identity',
          mode: "page",
          dedupeBy: "cursor",
        });

        conn.addPage(pageA);
        conn.addPage(pageB);

        const view = conn.getView();

        // default to latest when not set
        expect(view.edges.length).toBe(1);
        expect(view.edges[0].node.title).toBe("P2");
        expect(view.pageInfo.endCursor).toBe("p2");

        // switch to A
        conn.setPage(pageA);
        expect(view.edges.length).toBe(1);
        expect(view.edges[0].node.title).toBe("P1");
        expect(view.pageInfo.endCursor).toBe("p1");

        // null resets to latest
        conn.setPage(null);
        expect(view.edges[0].node.title).toBe("P2");
      });
    });
  });
});
