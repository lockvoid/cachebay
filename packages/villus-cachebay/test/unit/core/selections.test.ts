// test/unit/core/selections.test.ts
import { describe, it, expect } from "vitest";
import { createSelections } from "@/src/core/selections";

function stableStringify(v: any): string {
  const S = (x: any): string => {
    if (x === undefined) return "{}";
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(S).join(",") + "]";
    const keys = Object.keys(x).filter(k => x[k] !== undefined).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + S(x[k])).join(",") + "}";
  };
  return S(v);
}

describe("selections.ts — selection keys + heuristic compiler", () => {
  const sel = createSelections({
    config: {},
    dependencies: {
      identify: (o: any) =>
        o && o.__typename && o.id != null ? `${o.__typename}:${String(o.id)}` : null,
      stableStringify,
    },
  });

  it("buildRootSelectionKey/buildFieldSelectionKey are stable and drop undefined", () => {
    const r = sel.buildRootSelectionKey("user", { id: "1", extra: undefined });
    expect(r).toBe('user({"id":"1"})');

    const f1 = sel.buildFieldSelectionKey("User:1", "posts", { first: 10, where: { a: 1, b: 2 } });
    const f2 = sel.buildFieldSelectionKey("User:1", "posts", { where: { b: 2, a: 1 }, first: 10 });
    expect(f1).toBe(f2);
    expect(f1).toBe('User:1.posts({"first":10,"where":{"a":1,"b":2}})');
  });

  it("compileSelections emits root key + nested connection keys", () => {
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
      },
    };

    const compiled = sel.compileSelections({ data });
    const keys = compiled.map((c) => c.key);
    expect(keys).toContain('user({})');
    expect(keys).toContain('User:1.posts({})');

    const connection = compiled.find(c => c.key === 'User:1.posts({})')!;
    expect(connection.subtree.edges.length).toBe(2);
  });
});
