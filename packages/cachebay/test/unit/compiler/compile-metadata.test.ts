import { describe, it, expect } from "vitest";
import { compilePlan } from "../../../src/compiler";
import {
  USER_QUERY,
  USER_WITH_ALIAS_QUERY,
  POSTS_QUERY,
  POSTS_WITH_DEFAULTS_QUERY,
  POSTS_WITHOUT_CONNECTION_QUERY,
  POSTS_WITH_AGGREGATIONS_QUERY,
  USER_POSTS_QUERY,
  USER_POSTS_COMMENTS_QUERY,
  USERS_POSTS_COMMENTS_QUERY,
  USER_POSTS_FRAGMENT,
  POST_COMMENTS_QUERY,
} from "../../helpers/operations";

describe("Compiler metadata", () => {
  it("computes stable plan ID from selection shape", () => {
    const plan1 = compilePlan(USER_POSTS_QUERY);
    const plan2 = compilePlan(USER_POSTS_QUERY);
    const plan3 = compilePlan(USER_WITH_ALIAS_QUERY);

    // Same query -> same ID
    expect(plan1.id).toBe(plan2.id);
    // Different selection shape -> different ID
    expect(plan1.id).not.toBe(plan3.id);
  });

  it("collects window args from connection fields", () => {
    const plan = compilePlan(POSTS_QUERY);

    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    expect(plan.windowArgs.has("last")).toBe(true);
    expect(plan.windowArgs.has("before")).toBe(true);
    expect(plan.windowArgs.has("category")).toBe(false);
    expect(plan.windowArgs.has("sort")).toBe(false);
  });

  it("computes strict and canonical variable masks", () => {
    const plan = compilePlan(POSTS_QUERY);

    // Strict includes all variables
    expect(plan.varMask.strict).toContain("category");
    expect(plan.varMask.strict).toContain("sort");
    expect(plan.varMask.strict).toContain("first");
    expect(plan.varMask.strict).toContain("after");
    expect(plan.varMask.strict).toContain("last");
    expect(plan.varMask.strict).toContain("before");

    // Canonical excludes window args (first, after, last, before)
    expect(plan.varMask.canonical).toContain("category");
    expect(plan.varMask.canonical).toContain("sort");
    expect(plan.varMask.canonical).not.toContain("first");
    expect(plan.varMask.canonical).not.toContain("after");
    expect(plan.varMask.canonical).not.toContain("last");
    expect(plan.varMask.canonical).not.toContain("before");
  });

  it("makeVarsKey generates stable keys for strict mode", () => {
    const plan = compilePlan(POSTS_QUERY);

    const vars1 = { category: "tech", sort: "hot", first: 10, after: "c1" };
    const vars2 = { first: 10, category: "tech", after: "c1", sort: "hot" }; // different order
    const vars3 = { category: "tech", sort: "hot", first: 20, after: "c1" }; // different value

    const key1 = plan.makeVarsKey(false, vars1);
    const key2 = plan.makeVarsKey(false, vars2);
    const key3 = plan.makeVarsKey(false, vars3);

    // Same vars, different order -> same key
    expect(key1).toBe(key2);
    // Different values -> different key
    expect(key1).not.toBe(key3);
  });

  it("makeVarsKey generates stable keys for canonical mode", () => {
    const plan = compilePlan(POSTS_QUERY);

    const vars1 = { category: "tech", sort: "hot", first: 10, after: "cursor1" };
    const vars2 = { category: "tech", sort: "hot", first: 20, after: "cursor2" };
    const vars3 = { category: "news", sort: "hot", first: 10, after: "cursor1" };

    const key1 = plan.makeVarsKey(true, vars1);
    const key2 = plan.makeVarsKey(true, vars2);
    const key3 = plan.makeVarsKey(true, vars3);

    // Same category/sort, different pagination -> same key
    expect(key1).toBe(key2);
    // Different category -> different key
    expect(key1).not.toBe(key3);
  });

  it("computes selId for each field", () => {
    const plan = compilePlan(USER_POSTS_QUERY);

    const userField = plan.root.find(f => f.fieldName === "user");
    expect(userField?.selId).toBeDefined();
    expect(typeof userField?.selId).toBe("string");

    const postsField = userField?.selectionSet?.find(f => f.fieldName === "posts");
    expect(postsField?.selId).toBeDefined();
    expect(typeof postsField?.selId).toBe("string");
  });

  it("marks pageArgs on connection fields", () => {
    const plan = compilePlan(POST_COMMENTS_QUERY);

    const postField = plan.root.find(f => f.fieldName === "post");
    const commentsField = postField?.selectionSet?.find(f => f.fieldName === "comments");

    expect(commentsField?.isConnection).toBe(true);
    expect(commentsField?.pageArgs).toBeDefined();
    expect(commentsField?.pageArgs).toContain("first");
    expect(commentsField?.pageArgs).toContain("after");
    expect(commentsField?.pageArgs).toContain("last");
    expect(commentsField?.pageArgs).toContain("before");
  });

  it("generates selection fingerprint", () => {
    const plan = compilePlan(USER_QUERY);

    expect(plan.selectionFingerprint).toBeDefined();
    expect(typeof plan.selectionFingerprint).toBe("string");
    expect(plan.selectionFingerprint.length).toBeGreaterThan(0);
  });

  it("handles fragments correctly", () => {
    const plan = compilePlan(USER_POSTS_FRAGMENT, { fragmentName: "UserPosts" });

    expect(plan.id).toBeDefined();
    expect(plan.varMask).toBeDefined();
    expect(plan.makeVarsKey).toBeDefined();
    expect(plan.windowArgs).toBeDefined();
    expect(plan.selectionFingerprint).toBeDefined();
    
    // Fragment with connection should have window args
    expect(plan.windowArgs.size).toBeGreaterThan(0);
  });

  it("handles queries without connections", () => {
    const plan = compilePlan(POSTS_WITHOUT_CONNECTION_QUERY);

    expect(plan.id).toBeDefined();
    expect(plan.windowArgs.size).toBe(0);
    expect(plan.varMask.strict).toEqual(plan.varMask.canonical);
  });

  it("handles nested connections with aggregations", () => {
    const plan = compilePlan(POSTS_WITH_AGGREGATIONS_QUERY);

    expect(plan.id).toBeDefined();
    expect(plan.windowArgs).toBeDefined();
    expect(plan.varMask).toBeDefined();
    
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    const postsField = plan.root.find(f => f.fieldName === "posts");
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.selId).toBeDefined();
    
    const edgesField = postsField?.selectionSet?.find(f => f.fieldName === "edges");
    const nodeField = edgesField?.selectionSet?.find(f => f.fieldName === "node");
    const aggregationsField = nodeField?.selectionSet?.find(f => f.fieldName === "aggregations");
    const moderationTagsField = aggregationsField?.selectionSet?.find(f => f.responseKey === "moderationTags");
    
    expect(moderationTagsField?.fieldName).toBe("tags");
    expect(moderationTagsField?.responseKey).toBe("moderationTags");
    expect(moderationTagsField?.isConnection).toBe(true);
    expect(moderationTagsField?.connectionKey).toBe("ModerationTags");
    expect(moderationTagsField?.selId).toBeDefined();
    
    const topAggregationsField = postsField?.selectionSet?.find(f => f.fieldName === "aggregations");
    const baseTagsField = topAggregationsField?.selectionSet?.find(f => f.fieldName === "tags");
    
    expect(baseTagsField?.isConnection).toBe(true);
    expect(baseTagsField?.connectionKey).toBe("BaseTags");
    expect(baseTagsField?.selId).toBeDefined();
  });

  it("handles deeply nested connections (user -> posts -> comments)", () => {
    const plan = compilePlan(USER_POSTS_COMMENTS_QUERY);

    expect(plan.id).toBeDefined();
    expect(plan.windowArgs).toBeDefined();
    
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    const userField = plan.root.find(f => f.fieldName === "user");
    const postsField = userField?.selectionSet?.find(f => f.fieldName === "posts");
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.selId).toBeDefined();
    
    const postsEdgesField = postsField?.selectionSet?.find(f => f.fieldName === "edges");
    const postNodeField = postsEdgesField?.selectionSet?.find(f => f.fieldName === "node");
    const commentsField = postNodeField?.selectionSet?.find(f => f.fieldName === "comments");
    
    expect(commentsField?.isConnection).toBe(true);
    expect(commentsField?.selId).toBeDefined();
    expect(commentsField?.connectionFilters).toEqual([]);
  });

  it("handles multiple nested connections (users -> posts -> comments)", () => {
    const plan = compilePlan(USERS_POSTS_COMMENTS_QUERY);

    expect(plan.id).toBeDefined();
    expect(plan.windowArgs).toBeDefined();
    
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    const usersField = plan.root.find(f => f.fieldName === "users");
    expect(usersField?.isConnection).toBe(true);
    expect(usersField?.connectionFilters).toContain("role");
    expect(usersField?.selId).toBeDefined();
    
    const usersEdgesField = usersField?.selectionSet?.find(f => f.fieldName === "edges");
    const userNodeField = usersEdgesField?.selectionSet?.find(f => f.fieldName === "node");
    const postsField = userNodeField?.selectionSet?.find(f => f.fieldName === "posts");
    
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.connectionFilters).toContain("category");
    expect(postsField?.selId).toBeDefined();
    
    const postsEdgesField = postsField?.selectionSet?.find(f => f.fieldName === "edges");
    const postNodeField = postsEdgesField?.selectionSet?.find(f => f.fieldName === "node");
    const commentsField = postNodeField?.selectionSet?.find(f => f.fieldName === "comments");
    
    expect(commentsField?.isConnection).toBe(true);
    expect(commentsField?.selId).toBeDefined();
    
    // All three levels should have unique selIds
    const selIds = [usersField?.selId, postsField?.selId, commentsField?.selId];
    const uniqueSelIds = new Set(selIds);
    expect(uniqueSelIds.size).toBe(3);
  });

  it("produces same plan.id for queries differing only by field order", () => {
    const query1 = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
        }
      }
    `;

    const query2 = `
      query GetUser($id: ID!) {
        user(id: $id) {
          email
          id
          name
        }
      }
    `;

    const plan1 = compilePlan(query1);
    const plan2 = compilePlan(query2);

    // Same selection, different field order -> same ID
    expect(plan1.id).toBe(plan2.id);
    expect(plan1.selectionFingerprint).toBe(plan2.selectionFingerprint);
  });

  it("produces different plan.id for different operations with same fields", () => {
    const query = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const mutation = `
      mutation UpdateUser($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const plan1 = compilePlan(query);
    const plan2 = compilePlan(mutation);

    // Different operation -> different ID (even with same fields)
    expect(plan1.id).not.toBe(plan2.id);
  });

  it("makeSignature convenience helper works correctly", () => {
    const plan = compilePlan(POSTS_QUERY);

    const vars = { category: "tech", sort: "hot", first: 10, after: "c1" };

    const strictSig = plan.makeSignature(false, vars);
    const canonicalSig = plan.makeSignature(true, vars);

    expect(strictSig).toBe(`${plan.id}|strict|${plan.makeVarsKey(false, vars)}`);
    expect(canonicalSig).toBe(`${plan.id}|canonical|${plan.makeVarsKey(true, vars)}`);

    // Strict and canonical should differ (pagination args included vs excluded)
    expect(strictSig).not.toBe(canonicalSig);
  });

  it("canonical key is same for first/after vs last/before with same filters", () => {
    const plan = compilePlan(POSTS_QUERY);

    const vars1 = { category: "tech", sort: "hot", first: 10, after: "c1" };
    const vars2 = { category: "tech", sort: "hot", last: 10, before: "c2" };
    const vars3 = { category: "news", sort: "hot", first: 10, after: "c1" };

    const key1 = plan.makeVarsKey(true, vars1);
    const key2 = plan.makeVarsKey(true, vars2);
    const key3 = plan.makeVarsKey(true, vars3);

    // Same filters, different window direction -> same canonical key
    expect(key1).toBe(key2);
    // Different filters -> different key
    expect(key1).not.toBe(key3);
  });

  it("varMask.canonical equals varMask.strict when windowArgs is empty", () => {
    const plan = compilePlan(POSTS_WITHOUT_CONNECTION_QUERY);

    expect(plan.windowArgs.size).toBe(0);
    expect(plan.varMask.canonical).toEqual(plan.varMask.strict);
  });

  it("selId includes typeCondition for inline fragments", () => {
    const query = `
      query GetPosts($first: Int!) {
        posts(first: $first) @connection {
          edges {
            node {
              id
              title
              ... on VideoPost {
                video {
                  url
                }
              }
              ... on AudioPost {
                audio {
                  url
                }
              }
            }
          }
        }
      }
    `;

    const plan = compilePlan(query);

    const postsField = plan.root.find(f => f.fieldName === "posts");
    const edgesField = postsField?.selectionSet?.find(f => f.fieldName === "edges");
    const nodeField = edgesField?.selectionSet?.find(f => f.fieldName === "node");

    // Find inline fragments
    const videoFragment = nodeField?.selectionSet?.find(f => f.typeCondition === "VideoPost");
    const audioFragment = nodeField?.selectionSet?.find(f => f.typeCondition === "AudioPost");

    expect(videoFragment?.typeCondition).toBe("VideoPost");
    expect(audioFragment?.typeCondition).toBe("AudioPost");

    // Different type conditions should produce different selIds
    expect(videoFragment?.selId).toBeDefined();
    expect(audioFragment?.selId).toBeDefined();
    expect(videoFragment?.selId).not.toBe(audioFragment?.selId);
  });

  it("pageArgs includes all window args for connection field", () => {
    const query = `
      query GetPosts($first: Int, $after: String, $last: Int, $before: String) {
        posts(first: $first, after: $after, last: $last, before: $before) @connection {
          edges {
            node {
              id
            }
          }
        }
      }
    `;

    const plan = compilePlan(query);

    const postsField = plan.root.find(f => f.fieldName === "posts");

    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.pageArgs).toBeDefined();
    expect(postsField?.pageArgs).toContain("first");
    expect(postsField?.pageArgs).toContain("after");
    expect(postsField?.pageArgs).toContain("last");
    expect(postsField?.pageArgs).toContain("before");

    // All pageArgs should be in plan.windowArgs
    for (const arg of postsField?.pageArgs || []) {
      expect(plan.windowArgs.has(arg)).toBe(true);
    }
  });

  describe("getDependencies", () => {
    it("returns empty set for queries without arguments or connections", () => {
      const query = `
        query GetPosts {
          posts {
            id
            title
          }
        }
      `;

      const plan = compilePlan(query);
      const deps = plan.getDependencies(true, {});

      // No arguments or connections, so no dependencies
      expect(deps.size).toBe(0);
    });

    it("extracts field keys from id arguments", () => {
      const plan = compilePlan(USER_QUERY);
      const deps = plan.getDependencies(true, { id: "u123" });

      expect(deps.has('user({"id":"u123"})')).toBe(true);
      expect(deps.size).toBe(1);
    });

    it("handles multiple fields with id arguments", () => {
      const query = `
        query GetUserAndPost($userId: ID!, $postId: ID!) {
          user(id: $userId) {
            id
            name
          }
          post(id: $postId) {
            id
            title
          }
        }
      `;

      const plan = compilePlan(query);
      const deps = plan.getDependencies(true, { userId: "u1", postId: "p1" });

      expect(deps.has('user({"id":"u1"})')).toBe(true);
      expect(deps.has('post({"id":"p1"})')).toBe(true);
      expect(deps.size).toBe(2);
    });

    it("handles nested fields with id arguments and connections", () => {
      const plan = compilePlan(USER_POSTS_QUERY);
      const deps = plan.getDependencies(true, { id: "u1", first: 10 });

      expect(deps.has('user({"id":"u1"})')).toBe(true);
      // Nested posts connection should be included with proper parent context
      // Since posts is nested under user field (not entity), it should be at root level
      expect(deps.has('@connection.posts({})')).toBe(true);
      expect(deps.size).toBe(2);
    });

    it("tracks parent context for nested connections", () => {
      // This test should verify that nested connections track their parent properly
      // For now, connections at query root should use "@" as parent
      const plan = compilePlan(POSTS_QUERY);
      const deps = plan.getDependencies(true, { category: "tech", first: 10 });

      // Root-level connection should use @ as parent
      expect(deps.has('@connection.posts({"category":"tech"})')).toBe(true);
      expect(deps.size).toBe(1);
    });

    it("canonical mode excludes window args from connection keys", () => {
      const plan = compilePlan(POSTS_QUERY);
      
      const strictDeps = plan.getDependencies(false, { category: "tech", sort: "hot", first: 10, after: "c1" });
      const canonicalDeps = plan.getDependencies(true, { category: "tech", sort: "hot", first: 10, after: "c1" });

      // Strict mode: includes pagination args in connection key
      expect(strictDeps.has('@.posts({"category":"tech","sort":"hot","first":10,"after":"c1"})')).toBe(true);
      expect(strictDeps.size).toBe(1);
      
      // Canonical mode: excludes pagination args (filters only)
      expect(canonicalDeps.has('@connection.posts({"category":"tech","sort":"hot"})')).toBe(true);
      expect(canonicalDeps.size).toBe(1);
      
      // Keys should be different between strict and canonical
      expect(strictDeps.has('@connection.posts({"category":"tech","sort":"hot"})')).toBe(false);
      expect(canonicalDeps.has('@.posts({"category":"tech","sort":"hot","first":10,"after":"c1"})')).toBe(false);
    });

    it("includes fields even when arguments are null", () => {
      const plan = compilePlan(USER_QUERY);
      const deps = plan.getDependencies(true, { id: null });

      // Field with null id is still included (null is a valid value)
      expect(deps.has('user({"id":null})')).toBe(true);
      expect(deps.size).toBe(1);
    });

    it("handles fragments correctly", () => {
      const plan = compilePlan(USER_POSTS_FRAGMENT, { fragmentName: "UserPosts" });
      const deps = plan.getDependencies(true, { first: 10 });

      // Fragment has posts connection
      expect(deps.has('@connection.posts({})')).toBe(true);
      expect(deps.size).toBe(1);
    });
  });
});
