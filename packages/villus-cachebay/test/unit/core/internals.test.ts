// test/unit/core/internals.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";

import { createCache } from "@/src/core/internals";
import { ROOT_ID } from "@/src/core/constants";

const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

describe("createCache (internals)", () => {
  it("exposes identify, fragments, optimistic, ssr, and internals", async () => {
    const cache = createCache({
      keys: {
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Post: (o: any) => (o?.id != null ? String(o.id) : null),
      },
      interfaces: { Post: ["AudioPost", "VideoPost"] },
    });

    // identify
    expect(cache.identify({ __typename: "User", id: "u1" })).toBe("User:u1");

    // internals present
    const internals = (cache as any).__internals;
    expect(internals.graph).toBeTruthy();
    expect(internals.views).toBeTruthy();
    expect(internals.planner).toBeTruthy();
    expect(internals.documents).toBeTruthy();
    expect(internals.fragments).toBeTruthy();

    // seed: link + entity
    internals.graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    internals.graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    // reactive fragment read
    const view = cache.readFragment({ id: "User:u1", fragment: USER_FRAGMENT, variables: {} });
    expect(view.__typename).toBe("User");
    expect(view.id).toBe("u1");
    expect(view.email).toBe("a@example.com");

    // reactive update
    internals.graph.putRecord("User:u1", { email: "a+1@example.com" });
    expect(view.email).toBe("a+1@example.com");

    // ── Optimistic over CANONICAL connection ───────────────────────────────
    // canonical key we expect to be touched by the TX
    const canKey = '@connection.User:u1.posts({"category":"tech"})';

    const T = cache.modifyOptimistic((tx: any) => {
      const conn = tx.connection({
        parent: "User:u1",  // record id or "Query"
        key: "posts",       // field/key
        filters: { category: "tech" }, // identity filters (non-cursor)
      });

      // append a node and patch pageInfo
      conn.append({ __typename: "Post", id: "p1", title: "P1" }, { cursor: "p1" });
      conn.patch({ pageInfo: { endCursor: "p1", hasNextPage: false } });
    });
    T.commit?.();

    // verify canonical, not page
    const canon = internals.graph.getRecord(canKey);
    expect(canon?.pageInfo?.endCursor).toBe("p1");
    expect(Array.isArray(canon?.edges)).toBe(true);
    expect(canon.edges.length).toBe(1);

    const edgeRef = canon.edges[0].__ref as string;
    const edge = internals.graph.getRecord(edgeRef);
    expect(edge).toMatchObject({ __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" } });

    const post = internals.graph.getRecord("Post:p1");
    expect(post?.title).toBe("P1");

    // ── SSR roundtrip ─────────────────────────────────────────────────────
    const snapshot = cache.dehydrate();
    internals.graph.clear();
    expect(internals.graph.keys().length).toBe(0);

    cache.hydrate(snapshot);
    await Promise.resolve();

    expect(internals.graph.getRecord("User:u1")?.email).toBe("a+1@example.com");
    const restored = internals.graph.getRecord(canKey);
    expect(restored?.pageInfo?.endCursor).toBe("p1");
    expect(restored?.edges?.length).toBe(1);

    // hasDocument (operations only) → true for seeded link
    const hasUser = internals.documents.hasDocument({
      document: gql`query Q($id: ID!) { user(id:$id) { __typename id email } }`,
      variables: { id: "u1" },
    });
    expect(hasUser).toBe(true);
  });

  it("install wires provideCachebay (smoke)", () => {
    const cache = createCache();
    const provided: any[] = [];
    const app = {
      provide: (k: any, v: any) => { provided.push([k, v]); },
    } as any;

    cache.install(app);
    expect(provided.length).toBeGreaterThan(0);
  });
});
