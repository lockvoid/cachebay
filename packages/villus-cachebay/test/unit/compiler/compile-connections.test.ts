import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, selectionSetHasTypename, hasTypenames, POSTS_PAGE_CONNECTION_QUERY, POSTS_DEFAULT_CONNECTION_QUERY, USERS_NO_CONNECTION_QUERY, POSTS_EXPLICIT_KEY_QUERY, POSTS_FIELD_KEY_QUERY, POST_COMMENTS_FRAGMENT_COMPILER, POSTS_SELECTION_MAPS_QUERY } from '@/test/helpers';

describe("Compiler x Connections", () => {
  it("marks connection only when @connection is present; attaches mode and args", () => {
    const plan = compilePlan(POSTS_PAGE_CONNECTION_QUERY);
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("page");
    expect(posts.connectionFilters).toEqual(["category"]);

    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    const postsArgs = posts.stringifyArgs({ postsCategory: "tech", postsFirst: 10, postsAfter: null });
    expect(postsArgs).toBe('{"after":null,"category":"tech","first":10}');

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("defaults mode to 'infinite' and args to all non-pagination args when omitted", () => {
    const plan = compilePlan(POSTS_DEFAULT_CONNECTION_QUERY);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("infinite");
    expect(posts.connectionFilters!.sort()).toEqual(["category", "sort"]);

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("does NOT mark as connection when directive is absent (no heuristic)", () => {
    const plan = compilePlan(USERS_NO_CONNECTION_QUERY);
    
    const users = plan.rootSelectionMap!.get("users")!;
    expect(users.isConnection).toBe(false);
    expect(users.connectionMode).toBeUndefined();
    expect(users.connectionFilters).toBeUndefined();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("uses explicit key when provided", () => {
    const plan = compilePlan(POSTS_EXPLICIT_KEY_QUERY);
    
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("ProjectsList");
    expect(posts.connectionFilters).toEqual(["category"]);

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("falls back to field name as key when key is omitted", () => {
    const plan = compilePlan(POSTS_FIELD_KEY_QUERY);
    
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("key + args also work inside a fragment", () => {
    const plan = compilePlan(POST_COMMENTS_FRAGMENT_COMPILER);
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("Post");

    const comments = plan.rootSelectionMap!.get("comments")!;
    expect(comments.isConnection).toBe(true);
    expect(comments.connectionKey).toBe("PostComments");
    expect(comments.connectionFilters).toEqual([]);
    expect(comments.connectionMode).toBe("infinite");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("builds selection maps for pageInfo and edges shape reliably", () => {
    const plan = compilePlan(POSTS_SELECTION_MAPS_QUERY);
    
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);

    const pageInfo = posts.selectionMap!.get("pageInfo")!;
    expect(pageInfo.responseKey).toBe("pageInfo");
    expect(Array.isArray(pageInfo.selectionSet)).toBe(true);

    const edges = posts.selectionMap!.get("edges")!;
    expect(edges.responseKey).toBe("edges");
    const node = edges.selectionMap!.get("node")!;
    expect(Array.isArray(node.selectionSet)).toBe(true);

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });
});
