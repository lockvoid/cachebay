import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, hasTypenames, operations } from "@/test/helpers";

describe("Compiler x Fragments", () => {
  it("compiles a simple User fragment (no args) with selectionMap", () => {
    const plan = compilePlan(operations.USER_FRAGMENT);

    expect(plan.kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");
    expect(Array.isArray(plan.root)).toBe(true);

    const user = plan.rootSelectionMap!;
    expect(user.get("id")?.fieldName).toBe("id");
    expect(user.get("email")?.fieldName).toBe("email");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles a fragment with a connection using @connection; builds selectionMap on nested sets", () => {
    const plan = compilePlan(operations.USER_POSTS_FRAGMENT, { fragmentName: "UserPosts" });

    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    const postsKey = `${posts.fieldName}(${posts.stringifyArgs({ postsCategory: "tech", postsFirst: 2, postsAfter: null })})`;
    expect(postsKey).toBe('posts({"after":null,"category":"tech","first":2})');

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("throws when doc has neither op nor exactly one fragment", () => {
    const DOC = gql`
      fragment A on User { id }
      fragment B on User { email }
    `;

    expect(() => compilePlan(DOC)).toThrowError();
  });

  it("fragment with explicit @connection(key: ...) captures the key", () => {
    const plan = compilePlan(operations.USER_POSTS_WITH_KEY_FRAGMENT, { fragmentName: "UserPosts" });

    const feed = plan.rootSelectionMap!.get("posts")!;
    expect(feed.isConnection).toBe(true);
    expect(feed.connectionKey).toBe("UserPosts");
    expect(feed.connectionFilters).toEqual(["category"]);
    expect(feed.connectionMode).toBe("infinite");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });
});
