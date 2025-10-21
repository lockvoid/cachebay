import { compilePlan } from "@/src/compiler";
import type { CachePlan, PlanField } from "@/src/compiler/types";
import { operations, collectConnectionDirectives, hasTypenames } from "@/test/helpers";

const findField = (fields: PlanField[], responseKey: string): PlanField | null => {
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].responseKey === responseKey) return fields[i];
  }

  return null;
};

describe("Compiler x Operations", () => {
  it("compiles USER_QUERY: flattens fragments and builds arg pickers", () => {
    const plan = compilePlan(operations.USER_QUERY);
    expect(plan.kind).toBe("CachePlan");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const userField = findField(plan.root, "user")!;
    expect(userField).toBeTruthy();
    expect(userField.fieldName).toBe("user");
    expect(userField.isConnection).toBe(false);

    const userArgs = userField.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    // Check expectedArgNames is populated
    expect(userField.expectedArgNames).toEqual(["id"]);

    const id = findField(userField.selectionSet!, "id");
    const email = findField(userField.selectionSet!, "email");
    expect(id).toBeTruthy();
    expect(email).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_QUERY: marks users as connection; filters & default mode", () => {
    const plan = compilePlan(operations.USERS_QUERY);

    const users = findField(plan.root, "users")!;
    expect(users.isConnection).toBe(true);
    expect(users.connectionKey).toBe("users");
    expect(users.connectionFilters).toEqual(["role"]);
    expect(users.connectionMode).toBe("infinite");

    const usersArgs = users.buildArgs({ role: "admin", first: 2, after: undefined });
    expect(usersArgs).toEqual({ role: "admin", first: 2 });

    // Check expectedArgNames includes all args in order
    expect(users.expectedArgNames).toEqual(["role", "first", "after", "last", "before"]);

    const edges = findField(users.selectionSet!, "edges");
    const pageInfo = findField(users.selectionSet!, "pageInfo");
    expect(edges).toBeTruthy();
    expect(pageInfo).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USER_POSTS_QUERY: nested posts as connection with filters; default mode", () => {
    const plan = compilePlan(operations.USER_POSTS_QUERY);

    const user = findField(plan.root, "user")!;
    const posts = findField(user.selectionSet!, "posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category", "sort"]);
    expect(posts.connectionMode).toBe("infinite");

    const userArgs = user.buildArgs({ id: "u1" });
    expect(userArgs).toEqual({ id: "u1" });

    // Check expectedArgNames for user field
    expect(user.expectedArgNames).toEqual(["id"]);

    const postsArgs = posts.buildArgs({ postsCategory: "tech", postsFirst: 2, postsAfter: null });
    expect(postsArgs).toEqual({ category: "tech", first: 2, after: null });

    // Check expectedArgNames for posts connection
    expect(posts.expectedArgNames).toEqual(["category", "sort", "first", "after", "last", "before"]);

    const edges = findField(posts.selectionSet!, "edges")!;
    const node = findField(edges.selectionSet!, "node")!;
    const id = findField(node.selectionSet!, "id");
    const title = findField(node.selectionSet!, "title");
    const flags = findField(node.selectionSet!, "flags");
    const author = findField(node.selectionSet!, "author");
    expect(id).toBeTruthy();
    expect(title).toBeTruthy();
    expect(flags).toBeTruthy();
    expect(author).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles USERS_POSTS_COMMENTS_QUERY: users, posts, comments marked with filters & default mode", () => {
    const plan: CachePlan = compilePlan(operations.USERS_POSTS_COMMENTS_QUERY);

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
    const plan = compilePlan(operations.USER_WITH_ALIAS_QUERY);

    const currentUser = findField(plan.root, "currentUser")!;
    expect(currentUser.responseKey).toBe("currentUser");
    expect(currentUser.fieldName).toBe("user");
    expect(currentUser.buildArgs({ id: "u1" })).toEqual({ id: "u1" });

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("when multiple distinct type conditions exist, child parent inference falls back", () => {
    const plan = compilePlan(operations.MULTIPLE_USER_FRAGMENT);

    const user = findField(plan.root, "user")!;
    const id = findField(user.selectionSet!, "id");
    const role = findField(user.selectionSet!, "role");
    expect(id).toBeTruthy();
    expect(role).toBeTruthy();

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("inline fragments on implementors set typeCondition on fields", () => {
    const DOC = `
      query Query {
        posts(first: 10) @connection {
          edges {
            node {
              id
              title

              ... on VideoPost {
                video { key mediaUrl }
              }

              ... on AudioPost {
                audio { key mediaUrl }
              }
            }
          }
          pageInfo { hasNextPage }
          totalCount
        }
      }
    `;

    const plan = compilePlan(DOC);

    expect(plan.kind).toBe("CachePlan");
    expect(plan.operation).toBe("query");
    expect(hasTypenames(plan.networkQuery)).toBe(false);
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]); // stripped

    const posts = plan.rootSelectionMap!.get("posts")!;
    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    // Base fields must have no guard
    const id = node.selectionMap!.get("id")!;
    const title = node.selectionMap!.get("title")!;
    expect(id.typeCondition).toBeUndefined();
    expect(title.typeCondition).toBeUndefined();

    // Polymorphic children must be guarded
    const video = node.selectionMap!.get("video")!;
    const audio = node.selectionMap!.get("audio")!;
    expect(video.typeCondition).toBe("VideoPost");
    expect(audio.typeCondition).toBe("AudioPost");

    // And their own children inherit the guard (useful but not strictly required)
    const videoKey = video.selectionMap!.get("key")!;
    const videoUrl = video.selectionMap!.get("mediaUrl")!;
    expect(videoKey.typeCondition).toBe("VideoPost");
    expect(videoUrl.typeCondition).toBe("VideoPost");

    const audioKey = audio.selectionMap!.get("key")!;
    const audioUrl = audio.selectionMap!.get("mediaUrl")!;
    expect(audioKey.typeCondition).toBe("AudioPost");
    expect(audioUrl.typeCondition).toBe("AudioPost");
  });

  it("fragment spreads on implementors set typeCondition on fields", () => {
    const DOC = `
      fragment VideoFrag on VideoPost {
        video { key mediaUrl }
      }

      fragment AudioFrag on AudioPost {
        audio { key mediaUrl }
      }

      query Query {
        posts(first: 5) @connection {
          edges {
            node {
              id
              ...VideoFrag
              ...AudioFrag
            }
          }
        }
      }
    `;

    const plan = compilePlan(DOC);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);

    const posts = plan.rootSelectionMap!.get("posts")!;
    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;

    const id = node.selectionMap!.get("id")!;
    const video = node.selectionMap!.get("video")!;
    const audio = node.selectionMap!.get("audio")!;

    // Base vs guarded
    expect(id.typeCondition).toBeUndefined();
    expect(video.typeCondition).toBe("VideoPost");
    expect(audio.typeCondition).toBe("AudioPost");

    // Children inherit guard
    expect(video.selectionMap!.get("key")!.typeCondition).toBe("VideoPost");
    expect(audio.selectionMap!.get("key")!.typeCondition).toBe("AudioPost");
  });

  it("stringifyArgs produces stable keys using expectedArgNames order", () => {
    const plan = compilePlan(operations.USERS_QUERY);
    const users = findField(plan.root, "users")!;

    // Same args, different order in input object
    const key1 = users.stringifyArgs({ role: "admin", first: 10, after: "cursor1" });
    const key2 = users.stringifyArgs({ after: "cursor1", role: "admin", first: 10 });
    const key3 = users.stringifyArgs({ first: 10, after: "cursor1", role: "admin" });

    // All should produce identical keys because we use expectedArgNames order
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);

    // Key should follow expectedArgNames order: ["role", "first", "after"]
    expect(key1).toBe('("role":"admin","first":10,"after":"cursor1")');
  });
});
