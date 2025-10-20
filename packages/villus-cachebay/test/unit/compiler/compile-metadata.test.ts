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

    const key1 = plan.makeVarsKey("strict", vars1);
    const key2 = plan.makeVarsKey("strict", vars2);
    const key3 = plan.makeVarsKey("strict", vars3);

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

    const key1 = plan.makeVarsKey("canonical", vars1);
    const key2 = plan.makeVarsKey("canonical", vars2);
    const key3 = plan.makeVarsKey("canonical", vars3);

    // Same category/sort, different pagination -> same key
    expect(key1).toBe(key2);
    // Different category -> different key
    expect(key1).not.toBe(key3);
  });

  it("computes selId for each field", () => {
    const plan = compilePlan(USER_POSTS_QUERY);

    // Check that root fields have selId
    const userField = plan.root.find(f => f.fieldName === "user");
    expect(userField?.selId).toBeDefined();
    expect(typeof userField?.selId).toBe("string");

    // Check nested fields
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
    
    // Should collect window args from all nested connections
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    // Should have multiple connection fields with selId
    const postsField = plan.root.find(f => f.fieldName === "posts");
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.selId).toBeDefined();
    
    // Check nested connection in node aggregations (moderationTags is an alias for tags field)
    const edgesField = postsField?.selectionSet?.find(f => f.fieldName === "edges");
    const nodeField = edgesField?.selectionSet?.find(f => f.fieldName === "node");
    const aggregationsField = nodeField?.selectionSet?.find(f => f.fieldName === "aggregations");
    const moderationTagsField = aggregationsField?.selectionSet?.find(f => f.responseKey === "moderationTags");
    
    expect(moderationTagsField?.fieldName).toBe("tags");
    expect(moderationTagsField?.responseKey).toBe("moderationTags");
    expect(moderationTagsField?.isConnection).toBe(true);
    expect(moderationTagsField?.connectionKey).toBe("ModerationTags");
    expect(moderationTagsField?.selId).toBeDefined();
    
    // Check connection in top-level aggregations
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
    
    // Should collect window args from all levels
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    // Verify nested structure
    const userField = plan.root.find(f => f.fieldName === "user");
    const postsField = userField?.selectionSet?.find(f => f.fieldName === "posts");
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.selId).toBeDefined();
    
    // Check deeply nested comments connection
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
    
    // Should collect window args from all connection levels
    expect(plan.windowArgs.has("first")).toBe(true);
    expect(plan.windowArgs.has("after")).toBe(true);
    
    // Verify top-level users connection
    const usersField = plan.root.find(f => f.fieldName === "users");
    expect(usersField?.isConnection).toBe(true);
    expect(usersField?.connectionFilters).toContain("role");
    expect(usersField?.selId).toBeDefined();
    
    // Verify nested posts connection
    const usersEdgesField = usersField?.selectionSet?.find(f => f.fieldName === "edges");
    const userNodeField = usersEdgesField?.selectionSet?.find(f => f.fieldName === "node");
    const postsField = userNodeField?.selectionSet?.find(f => f.fieldName === "posts");
    
    expect(postsField?.isConnection).toBe(true);
    expect(postsField?.connectionFilters).toContain("category");
    expect(postsField?.selId).toBeDefined();
    
    // Verify deeply nested comments connection
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
});
