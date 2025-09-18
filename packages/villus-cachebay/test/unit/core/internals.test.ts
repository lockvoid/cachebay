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
    expect(internals.sessions).toBeTruthy();
    expect(internals.fragments).toBeTruthy();

    // write a root link + entity and read fragment reactively
    internals.graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    internals.graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "a@example.com" });

    const view = cache.readFragment({ id: "User:u1", fragment: USER_FRAGMENT, variables: {} });
    expect(view.__typename).toBe("User");
    expect(view.id).toBe("u1");
    expect(view.email).toBe("a@example.com");

    // mutation-like graph write updates the reactive view
    internals.graph.putRecord("User:u1", { email: "a+1@example.com" });
    expect(view.email).toBe("a+1@example.com");

    // optimistic: add a Post to a page and patch pageInfo
    const pageKey = '@.User:u1.posts({"after":null,"category":"tech","first":1})';
    const tx = cache.modifyOptimistic((tx) => {
      const [conn] = tx.connection({ pageKey });
      conn.addNode({ __typename: "Post", id: "p1", title: "P1" }, { cursor: "p1" });
      conn.patch({ endCursor: "p1", hasNextPage: false });
    });
    tx.commit?.();

    const page = internals.graph.getRecord(pageKey);
    expect(page.pageInfo.endCursor).toBe("p1");
    const edgeRef = page.edges[0].__ref;
    const edgeRec = internals.graph.getRecord(edgeRef);
    expect(edgeRec.node.__ref).toBe("Post:p1");
    expect(internals.graph.getRecord("Post:p1")?.title).toBe("P1");

    // SSR: roundtrip snapshot
    const snapshot = cache.dehydrate();
    internals.graph.clear();
    expect(internals.graph.keys().length).toBe(0);
    cache.hydrate(snapshot);
    await Promise.resolve();
    expect(internals.graph.getRecord("User:u1")?.email).toBe("a+1@example.com");
    expect(internals.graph.getRecord(pageKey)?.pageInfo?.endCursor).toBe("p1");

    // documents: hasDocument check via internals
    const hasUser = internals.documents.hasDocument({
      document: gql`
      query Q($id: ID!) { user(id:$id) { __typename id email } }
    `, variables: { id: "u1" }
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
    // at least provided once; we don’t assert exact symbol equality here
    expect(provided.length).toBeGreaterThan(0);
  });
});
