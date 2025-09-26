import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, hasTypenames, USER_QUERY, USERS_QUERY_COMPILER, USER_POSTS_QUERY_COMPILER, USERS_POSTS_COMMENTS_QUERY_COMPILER, ALIAS_QUERY, MULTI_TYPE_FRAGMENT_QUERY } from "@/test/helpers";
import type { CachePlanV1, PlanField } from "@/src/compiler/types";

const findField = (fields: PlanField[], responseKey: string): PlanField | null => {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].responseKey === responseKey) return fields[i];
  }

  return null;
};

describe("Compiler x Operations", () => {
  it("compiles USER_QUERY: flattens fragments and builds arg pickers", () => {
    const plan = compilePlan(USER_QUERY);
    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const userField = findField(plan.root, "user")!;
    expect(userField).toBeTruthy();
    expect(userField.fieldName).toBe("user");
    expect(userField.isConnection).toBe(false);

    const userArgs = userField.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    const id = findField(userField.selectionSet!, "id");
    const email = findField(userField.selectionSet!, "email");
    expect(id).toBeTruthy();
    expect(email).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_QUERY: marks users as connection; filters & default mode", () => {
    const plan = compilePlan(USERS_QUERY_COMPILER);

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);
    expect(users.connectionKey).toBe("users");
    expect(users.connectionFilters).toEqual(["role"]);
    expect(users.connectionMode).toBe("infinite");

    const usersArgs = users.buildArgs({ usersRole: "admin", usersFirst: 2, usersAfter: undefined });
    expect(usersArgs).toEqual({ role: "admin", first: 2 });

    const edges = findField(users.selectionSet!, "edges");
    const pageInfo = findField(users.selectionSet!, "pageInfo");
    expect(edges).toBeTruthy();
    expect(pageInfo).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USER_POSTS_QUERY: nested posts as connection with filters; default mode", () => {
    const plan = compilePlan(USER_POSTS_QUERY_COMPILER);

    const user = findField(plan.root, "user")!;
    const posts = findField(user.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    const userArgs = user.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 2, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 2, after: null });

    const edges = findField(posts.selectionSet!, "edges")!;
    const node = findField(edges.selectionSet!, "node")!;
    const id = findField(node.selectionSet!, "id");
    const title = findField(node.selectionSet!, "title");
    const tags = findField(node.selectionSet!, "tags");
    const author = findField(node.selectionSet!, "author");
    expect(id).toBeTruthy();
    expect(title).toBeTruthy();
    expect(tags).toBeTruthy();
    expect(author).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_POSTS_COMMENTS_QUERY: users, posts, comments marked with filters & default mode", () => {
    const plan: CachePlanV1 = compilePlan(USERS_POSTS_COMMENTS_QUERY_COMPILER);

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);
    expect(users.connectionKey).toBe("users");
    expect(users.connectionFilters).toEqual(["role"]);
    expect(users.connectionMode).toBe("infinite");

    const userEdges = findField(users.selectionSet!, "edges")!;
    const userNode = findField(userEdges.selectionSet!, "node")!;

    const posts = findField(userNode.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    const postEdges = findField(posts.selectionSet!, "edges")!;
    const postNode = findField(postEdges.selectionSet!, "node")!;

    const comments = findField(postNode.selectionSet!, "comments")!;
    expect(comments.isConnection).toBe(true);
    expect(comments.connectionKey).toBe("comments");
    expect(comments.connectionFilters).toEqual([]);
    expect(comments.connectionMode).toBe("infinite");

    const usersArgs = users.buildArgs({ usersRole: "dj", usersFirst: 2, usersAfter: "u1" });
    expect(usersArgs).toEqual({ role: "dj", first: 2, after: "u1" });

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 1, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 1, after: null });

    const commentsArgs = comments.buildArgs({ commentsFirst: 3, commentsAfter: "c2" });
    expect(commentsArgs).toEqual({ first: 3, after: "c2" });

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("preserves alias as responseKey and field name as fieldName", () => {
    const plan = compilePlan(ALIAS_QUERY);

    const currentUser = findField(plan.root, "currentUser")!;
    expect(currentUser.responseKey).toBe("currentUser");
    expect(currentUser.fieldName).toBe("user");
    expect(currentUser.buildArgs({ id: "u1" })).toEqual({ id: "u1" });

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("when multiple distinct type conditions exist, child parent inference falls back", () => {
    const plan = compilePlan(MULTI_TYPE_FRAGMENT_QUERY);

    const user = findField(plan.root, "user")!;
    const id = findField(user.selectionSet!, "id");
    const role = findField(user.selectionSet!, "role");
    expect(id).toBeTruthy();
    expect(role).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });
});
