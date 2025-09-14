// test/unit/core/selections.test.ts
import { describe, it, expect } from "vitest";
import { createSelections } from "@/src/core/selections";

describe("selections.ts — selection keys + heuristic compiler", () => {
  // Minimal mock graph with identify()
  const graph = {
    identify: (o: any) =>
      o && typeof o === "object" && typeof o.__typename === "string" && o.id != null
        ? `${o.__typename}:${String(o.id)}`
        : null,
  };

  const selections = createSelections({
    config: {},
    dependencies: { graph },
  });

  it("buildRootSelectionKey/buildFieldSelectionKey are stable and drop undefined", () => {
    const r = selections.buildRootSelectionKey("user", { id: "1", extra: undefined });
    expect(r).toBe('user({"id":"1"})');

    const f1 = selections.buildFieldSelectionKey("User:1", "posts", {
      first: 10,
      where: { a: 1, b: 2 },
    });
    const f2 = selections.buildFieldSelectionKey("User:1", "posts", {
      where: { b: 2, a: 1 },
      first: 10,
    });
    expect(f1).toBe(f2);
    expect(f1).toBe('User:1.posts({"first":10,"where":{"a":1,"b":2}})');
  });

  it("compileSelections emits a root key and nested connection keys for entity subtrees", () => {
    const data = {
      user: {
        __typename: "User",
        id: "1",
        name: "John",
        posts: {
          __typename: "PostConnection",
          edges: [
            { cursor: "c1", node: { __typename: "Post", id: "p1", title: "A" } },
            { cursor: "c2", node: { __typename: "Post", id: "p2", title: "B" } },
          ],
          pageInfo: { hasNextPage: true, endCursor: "c2" },
        },
        // unrelated nested object (not a connection) shouldn't emit extra keys
        profile: {
          __typename: "Profile",
          id: "profile-1",
          bio: "dev",
        },
      },
      // non-entity root field still produces a root selection key
      stats: {
        totalUsers: 12,
      },
    };

    const compiled = selections.compileSelections({ data });
    const keys = compiled.map((c) => c.key);

    // root keys
    expect(keys).toContain('user({})');
    expect(keys).toContain('stats({})');

    // connection under User:1
    expect(keys).toContain('User:1.posts({})');

    const conn = compiled.find((c) => c.key === 'User:1.posts({})')!;
    expect(conn.subtree.edges.length).toBe(2);
    expect(conn.subtree.pageInfo.hasNextPage).toBe(true);
  });
});
