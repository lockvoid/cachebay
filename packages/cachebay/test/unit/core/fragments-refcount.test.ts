import { describe, it, expect, beforeEach } from "vitest";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { users } from "@/test/helpers/fixtures";
import { USER_FRAGMENT } from "@/test/helpers/operations";

describe("fragments - cache reference counting", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonicalLayer: ReturnType<typeof createCanonical>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let documents: ReturnType<typeof createDocuments>;
  let fragments: ReturnType<typeof createFragments>;

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

    fragments = createFragments({
      graph,
      planner,
      documents,
    });
  });

  describe("reference counting", () => {
    it("increments cache ref count when watcher is created", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      const state1 = fragments.inspect();
      expect(state1.watchersCount).toBe(0);
      expect(state1.getFragmentWatchers("User:u1", FRAGMENT)).toBe(0);

      // Create first watcher
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state2 = fragments.inspect();
      expect(state2.watchersCount).toBe(1);
      expect(state2.getFragmentWatchers("User:u1", FRAGMENT)).toBe(1);

      handle1.unsubscribe();
    });

    it("increments cache ref count for multiple watchers with same fragment", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      // Create three watchers with same fragment
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle3 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state = fragments.inspect();
      expect(state.watchersCount).toBe(3);
      expect(state.getFragmentWatchers("User:u1", FRAGMENT)).toBe(3);

      handle1.unsubscribe();
      handle2.unsubscribe();
      handle3.unsubscribe();
    });

    it("tracks separate cache ref counts for different entities", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      fragments.writeFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u2", email: "u2@example.com" }),
      });

      graph.flush();

      // Create watchers with different entities
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state = fragments.inspect();
      expect(state.watchersCount).toBe(2);
      expect(state.getFragmentWatchers("User:u1", FRAGMENT)).toBe(1);
      expect(state.getFragmentWatchers("User:u2", FRAGMENT)).toBe(1);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("decrements cache ref count on unsubscribe", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state1 = fragments.inspect();
      expect(state1.watchersCount).toBe(2);
      expect(state1.getFragmentWatchers("User:u1", FRAGMENT)).toBe(2);

      // Unsubscribe first watcher
      handle1.unsubscribe();

      const state2 = fragments.inspect();
      expect(state2.watchersCount).toBe(1);
      expect(state2.getFragmentWatchers("User:u1", FRAGMENT)).toBe(1);

      // Unsubscribe second watcher
      handle2.unsubscribe();

      const state3 = fragments.inspect();
      expect(state3.watchersCount).toBe(0);
    });

    it("invalidates cache when last watcher unsubscribes", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      // Materialize to create cache
      const cached1 = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: false,
        updateCache: true,
      });

      // Verify cache works
      const cached2 = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(cached2).toBe(cached1); // Same reference = cached

      // Create watcher
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      // Unsubscribe (should invalidate cache)
      handle.unsubscribe();

      // Materialize again - should return new reference
      const afterInvalidate = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(afterInvalidate).not.toBe(cached1); // Different reference = invalidated
    });

    it("does not invalidate cache while watchers remain", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      // Materialize to create cache
      const cached = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: false,
        updateCache: true,
      });

      // Create two watchers
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      // Unsubscribe first watcher
      handle1.unsubscribe();

      // Cache should still be valid (one watcher remains)
      const stillCached = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(stillCached).toBe(cached); // Same reference = still cached

      // Unsubscribe second watcher
      handle2.unsubscribe();

      // Now cache should be invalidated
      const afterInvalidate = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(afterInvalidate).not.toBe(cached); // Different reference = invalidated
    });
  });

  describe("update() with reference counting", () => {
    it("updates cache ref counts when entity id changes", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      fragments.writeFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u2", email: "u2@example.com" }),
      });

      graph.flush();

      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state1 = fragments.inspect();
      expect(state1.watchersCount).toBe(1);

      // Update to different entity
      handle.update({ id: "User:u2" });

      const state2 = fragments.inspect();
      expect(state2.watchersCount).toBe(1);

      handle.unsubscribe();
    });

    it("invalidates old cache when update changes entity id", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      fragments.writeFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u2", email: "u2@example.com" }),
      });

      graph.flush();

      // Cache u1
      const u1_cached = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: false,
        updateCache: true,
      });

      // Create watcher for u1
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      // Update to u2 (should invalidate u1 cache)
      handle.update({ id: "User:u2" });

      // u1 cache should be invalidated
      const u1_after = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(u1_after).not.toBe(u1_cached); // Different reference = invalidated

      handle.unsubscribe();
    });

    it("does not invalidate when multiple watchers share the same cache", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      fragments.writeFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u2", email: "u2@example.com" }),
      });

      graph.flush();

      // Cache u1
      const u1_cached = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: false,
        updateCache: true,
      });

      // Create two watchers for u1
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state1 = fragments.inspect();
      expect(state1.watchersCount).toBe(2);

      // Update first watcher to u2
      handle1.update({ id: "User:u2" });

      const state2 = fragments.inspect();
      expect(state2.watchersCount).toBe(2);

      // u1 cache should still be valid
      const u1_after = documents.materialize({
        document: FRAGMENT,
        variables: {},
        canonical: true,
        entityId: "User:u1",
        fingerprint: true,
        preferCache: true,
        updateCache: true,
      });

      expect(u1_after).toBe(u1_cached); // Same reference = still cached

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("handles update to same entity (no-op)", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state1 = fragments.inspect();
      expect(state1.watchersCount).toBe(1);

      // Update to same entity
      handle.update({ id: "User:u1" });

      const state2 = fragments.inspect();
      expect(state2.watchersCount).toBe(1);

      handle.unsubscribe();
    });
  });

  describe("inspect()", () => {
    it("returns empty state when no watchers", () => {
      const state = fragments.inspect();

      expect(state.watchersCount).toBe(0);
    });

    it("returns watcher information", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state = fragments.inspect();

      expect(state.watchersCount).toBe(1);
      expect(state.getFragmentWatchers("User:u1", FRAGMENT)).toBe(1);

      handle.unsubscribe();
    });

    it("returns cache ref counts", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      graph.flush();

      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state = fragments.inspect();

      expect(state.watchersCount).toBe(2);
      expect(state.getFragmentWatchers("User:u1", FRAGMENT)).toBe(2);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });

    it("returns fragment watcher counts for different entities", () => {
      const FRAGMENT = planner.getPlan(USER_FRAGMENT);

      fragments.writeFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u1", email: "u1@example.com" }),
      });

      fragments.writeFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        data: users.buildNode({ id: "u2", email: "u2@example.com" }),
      });

      graph.flush();

      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const handle2 = fragments.watchFragment({
        id: "User:u2",
        fragment: FRAGMENT,
        onData: () => {},
      });

      const state = fragments.inspect();

      expect(state.watchersCount).toBe(2);
      expect(state.getFragmentWatchers("User:u1", FRAGMENT)).toBe(1);
      expect(state.getFragmentWatchers("User:u2", FRAGMENT)).toBe(1);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });
  });
});
