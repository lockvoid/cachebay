import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { createQueries } from "@/src/core/queries";
import { users } from "@/test/helpers/fixtures";
import { USER_QUERY } from "@/test/helpers/operations";

describe("queries - cache reference counting", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonicalLayer: ReturnType<typeof createCanonical>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let documents: ReturnType<typeof createDocuments>;
  let queries: ReturnType<typeof createQueries>;

  beforeEach(() => {
    planner = createPlanner();

    graph = createGraph({
      keys: {
        User: (u) => u.id,
      },
      onChange: () => {},
    });

    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    canonicalLayer = createCanonical({ graph });
    optimistic = createOptimistic({ graph, canonical: canonicalLayer });

    documents = createDocuments({
      graph,
      planner,
      canonical: canonicalLayer,
    });

    queries = createQueries({
      documents,
      planner,
    });
  });

  describe("reference counting", () => {
    it("increments cache ref count when watcher is created", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const state1 = queries.inspect();
      expect(state1.watchersCount).toBe(0);
      expect(state1.getQueryWatchers(QUERY, { id: "u1" })).toBe(0);

      // Create first watcher
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state2 = queries.inspect();
      expect(state2.watchersCount).toBe(1);
      expect(state2.getQueryWatchers(QUERY, { id: "u1" })).toBe(1);

      handle1.unsubscribe();
    });

    it("increments cache ref count for multiple watchers with same variables", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      // Create three watchers with same variables
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle3 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state = queries.inspect();
      expect(state.watchersCount).toBe(3);
      expect(state.getQueryWatchers(QUERY, { id: "u1" })).toBe(3); // All three watchers for same query

      handle1.unsubscribe();
      handle2.unsubscribe();
      handle3.unsubscribe();
    });

    it("tracks separate cache ref counts for different variables", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      documents.normalize({
        document: QUERY,
        variables: { id: "u2" },
        data: {
          user: users.buildNode({ id: "u2", email: "u2@example.com" }),
        },
      });

      graph.flush();

      // Create watchers with different variables
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u2" },
        onData: () => {},
      });

      const state = queries.inspect();
      expect(state.watchersCount).toBe(2);
      expect(state.getQueryWatchers(QUERY, { id: "u1" })).toBe(1); // One watcher for u1
      expect(state.getQueryWatchers(QUERY, { id: "u2" })).toBe(1); // One watcher for u2

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("decrements cache ref count on unsubscribe", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state1 = queries.inspect();
      expect(state1.watchersCount).toBe(2);
      expect(state1.getQueryWatchers(QUERY, { id: "u1" })).toBe(2);

      // Unsubscribe first watcher
      handle1.unsubscribe();

      const state2 = queries.inspect();
      expect(state2.watchersCount).toBe(1);
      expect(state2.getQueryWatchers(QUERY, { id: "u1" })).toBe(1);

      // Unsubscribe second watcher
      handle2.unsubscribe();

      const state3 = queries.inspect();
      expect(state3.watchersCount).toBe(0);
    });

    it("invalidates cache when last watcher unsubscribes", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      // Materialize to create cache
      const cached1 = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      // Verify cache works
      const cached2 = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(cached2).toBe(cached1); // Same reference = cached

      // Create watcher
      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      // Unsubscribe (should invalidate cache)
      handle.unsubscribe();

      // Materialize again - should return new reference
      const afterInvalidate = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(afterInvalidate).not.toBe(cached1); // Different reference = invalidated
    });

    it("does not invalidate cache while watchers remain", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      // Materialize to create cache
      const cached = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      // Create two watchers
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      // Unsubscribe first watcher
      handle1.unsubscribe();

      // Cache should still be valid (one watcher remains)
      const stillCached = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(stillCached).toBe(cached); // Same reference = still cached

      // Unsubscribe second watcher
      handle2.unsubscribe();

      // Now cache should be invalidated
      const afterInvalidate = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(afterInvalidate).not.toBe(cached); // Different reference = invalidated
    });
  });

  describe("update() with reference counting", () => {
    it("updates cache ref counts when variables change", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      documents.normalize({
        document: QUERY,
        variables: { id: "u2" },
        data: {
          user: users.buildNode({ id: "u2", email: "u2@example.com" }),
        },
      });

      graph.flush();

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state1 = queries.inspect();
      expect(state1.watchersCount).toBe(1);
      expect(state1.getQueryWatchers(QUERY, { id: "u1" })).toBe(1);

      // Update to different variables
      handle.update({ variables: { id: "u2" } });

      const state2 = queries.inspect();
      expect(state2.watchersCount).toBe(1);

      handle.unsubscribe();
    });

    it("invalidates old cache when update changes variables", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      documents.normalize({
        document: QUERY,
        variables: { id: "u2" },
        data: {
          user: users.buildNode({ id: "u2", email: "u2@example.com" }),
        },
      });

      graph.flush();

      // Cache u1
      const u1_cached = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      // Create watcher for u1
      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      // Update to u2 (should invalidate u1 cache)
      handle.update({ variables: { id: "u2" } });

      // u1 cache should be invalidated
      const u1_after = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(u1_after).not.toBe(u1_cached); // Different reference = invalidated

      handle.unsubscribe();
    });

    it("does not invalidate when multiple watchers share the same cache", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      documents.normalize({
        document: QUERY,
        variables: { id: "u2" },
        data: {
          user: users.buildNode({ id: "u2", email: "u2@example.com" }),
        },
      });

      graph.flush();

      // Cache u1
      const u1_cached = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      // Create two watchers for u1
      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state1 = queries.inspect();
      expect(state1.watchersCount).toBe(2);

      // Update first watcher to u2
      handle1.update({ variables: { id: "u2" } });

      const state2 = queries.inspect();
      expect(state2.watchersCount).toBe(2);

      // u1 cache should still be valid
      const u1_after = documents.materialize({
        document: QUERY,
        variables: { id: "u1" },
        canonical: true,
        fingerprint: true,
        force: false,
      });

      expect(u1_after).toBe(u1_cached); // Same reference = still cached

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("handles update to same variables (no-op)", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state1 = queries.inspect();
      expect(state1.watchersCount).toBe(1);

      // Update to same variables
      handle.update({ variables: { id: "u1" } });

      const state2 = queries.inspect();
      expect(state2.watchersCount).toBe(1);

      handle.unsubscribe();
    });
  });

  describe("inspect()", () => {
    it("returns empty state when no watchers", () => {
      const state = queries.inspect();

      expect(state.watchersCount).toBe(0);
    });

    it("returns watcher information", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const handle = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state = queries.inspect();

      expect(state.watchersCount).toBe(1);
      expect(state.getQueryWatchers(QUERY, { id: "u1" })).toBe(1);

      handle.unsubscribe();
    });

    it("returns cache ref counts", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state = queries.inspect();

      expect(state.watchersCount).toBe(2);
      expect(state.getQueryWatchers(QUERY, { id: "u1" })).toBe(2); // Both watchers for same query

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("returns signature watcher counts", () => {
      const QUERY = planner.getPlan(USER_QUERY);

      documents.normalize({
        document: QUERY,
        variables: { id: "u1" },
        data: {
          user: users.buildNode({ id: "u1", email: "u1@example.com" }),
        },
      });

      graph.flush();

      const handle1 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const handle2 = queries.watchQuery({
        query: QUERY,
        variables: { id: "u1" },
        onData: () => {},
      });

      const state = queries.inspect();

      expect(state.watchersCount).toBe(2);
      expect(state.getQueryWatchers(QUERY, { id: "u1" })).toBe(2); // Both watchers for same query

      handle1.unsubscribe();
      handle2.unsubscribe();
    });
  });
});
