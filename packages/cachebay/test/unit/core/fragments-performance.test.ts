// Mock documents module to inject performance counters
let normalizeCount = 0;
let materializeHotCount = 0;
let materializeColdCount = 0;

vi.mock("@/src/core/documents", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/documents")>("@/src/core/documents");

  return {
    ...actual,
    createDocuments: (deps: any) => {
      const documents = actual.createDocuments(deps);

      // Wrap normalize to count calls
      const origNormalize = documents.normalize;
      documents.normalize = ((...args: any[]) => {
        normalizeCount++;
        return origNormalize.apply(documents, args);
      }) as any;

      // Wrap materialize to count calls and track HOT vs COLD
      const origMaterialize = documents.materialize;
      documents.materialize = ((...args: any[]) => {
        const result = origMaterialize.apply(documents, args);

        // Track HOT vs COLD based on the hot field
        if (result.hot) {
          materializeHotCount++;
        } else {
          materializeColdCount++;
        }

        return result;
      }) as any;

      return documents;
    },
  };
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFragments } from "@/src/core/fragments";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createDocuments } from "@/src/core/documents";
import { createCanonical } from "@/src/core/canonical";
import { createOptimistic } from "@/src/core/optimistic";
import { operations, tick } from "@/test/helpers";

describe("Fragments Performance", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;
  let fragments: ReturnType<typeof createFragments>;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;

    graph = createGraph({
      interfaces: { Post: ["AudioPost", "VideoPost"] },
      onChange: (touchedIds) => {
        fragments.propagateData(touchedIds);
      },
    });
    planner = createPlanner();
    const optimistic = createOptimistic({ graph });
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, planner, canonical });
    fragments = createFragments({ graph, planner, documents });
  });

  describe("readFragment", () => {
    it("always COLD (uses force: true) - no caching", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "initial@example.com" });

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // First read - COLD (force: true)
      const read1 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });

      expect(read1).toMatchObject({
        __typename: "User",
        id: "u1",
        email: "initial@example.com",
      });
      expect(read1.__version).toBeDefined();

      // readFragment only materializes, doesn't normalize
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);

      // Update data directly in graph
      graph.putRecord("User:u1", { email: "updated@example.com" });

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // Second read - still COLD (force: true bypasses cache)
      const read2 = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });

      expect(read2).toMatchObject({
        __typename: "User",
        id: "u1",
        email: "updated@example.com",
      });
      expect(read2.__version).toBeDefined();
      expect(read2.__version).not.toBe(read1.__version);

      // Still COLD - force: true always bypasses cache
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
    });

    it("should include __version fields with fingerprint: true", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const result = fragments.readFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
      });

      expect(result).toBeDefined();
      expect(result.__version).toBeDefined();
      expect(typeof result.__version).toBe("number");
    });
  });

  describe("watchFragment with update method", () => {
    it("two-phase: COLD path (1 materialization) then HOT path (1 materialization)", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      const emissions: any[] = [];

      // PHASE 1: First watch - COLD path
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].id).toBe("u1");

      // watchFragment materializes once (immediate: true)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Update to same entity with immediate: true - HOT path
      handle.update({ id: "User:u1", immediate: true });

      // Should use HOT path (materializeCache)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);

      // No new emission (data unchanged)
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("should efficiently switch between entities without memory leaks", async () => {
      // Setup multiple users
      for (let i = 1; i <= 100; i++) {
        graph.putRecord(`User:u${i}`, {
          __typename: "User",
          id: `u${i}`,
          email: `user${i}@example.com`,
        });
      }

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);
      expect(emissions[0].id).toBe("u1");

      // Rapidly switch between entities
      const startTime = performance.now();
      for (let i = 2; i <= 100; i++) {
        handle.update({ id: `User:u${i}`, immediate: true });
      }
      const duration = performance.now() - startTime;

      // Should complete 99 updates in reasonable time (< 50ms)
      expect(duration).toBeLessThan(50);
      expect(emissions).toHaveLength(100);
      expect(emissions[99].id).toBe("u100");

      handle.unsubscribe();
    });

    it("should efficiently update variables without re-subscribing", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Rapidly update variables (even though USER_FRAGMENT doesn't use them)
      // This tests that update() itself is fast, not that it causes emissions
      const startTime = performance.now();
      for (let i = 1; i <= 100; i++) {
        handle.update({ variables: { limit: i }, immediate: true });
      }
      const duration = performance.now() - startTime;

      // Should complete 100 variable updates in reasonable time (< 20ms)
      expect(duration).toBeLessThan(20);

      // Since USER_FRAGMENT doesn't use variables, data doesn't change
      // So we still only have 1 emission (the initial one)
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });

    it("should handle immediate: false efficiently (no unnecessary emissions)", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "test2@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update with immediate: false should not emit
      handle.update({ id: "User:u2", immediate: false });
      expect(emissions).toHaveLength(1);

      // Only emit when data actually changes
      graph.putRecord("User:u2", { email: "updated@example.com" });
      await tick();

      expect(emissions).toHaveLength(2);
      expect(emissions[1].id).toBe("u2");
      expect(emissions[1].email).toBe("updated@example.com");

      handle.unsubscribe();
    });

    it("should not emit duplicate data when update doesn't change result", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      // Update to same entity should not emit (data unchanged)
      handle.update({ id: "User:u1", immediate: true });
      expect(emissions).toHaveLength(1);

      // Update to same variables should not emit
      handle.update({ variables: {}, immediate: true });
      expect(emissions).toHaveLength(1);

      handle.unsubscribe();
    });
  });

  describe("propagateData performance", () => {
    it("should efficiently update multiple watchers on same entity", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const watchers: Array<{ emissions: any[]; handle: any }> = [];

      // Create 100 watchers on the same entity
      for (let i = 0; i < 100; i++) {
        const emissions: any[] = [];
        const handle = fragments.watchFragment({
          id: "User:u1",
          fragment: operations.USER_FRAGMENT,
          variables: {},
          onData: (data) => {
            emissions.push(data);
          },
        });
        watchers.push({ emissions, handle });
      }

      // All watchers should have initial emission
      watchers.forEach(w => expect(w.emissions).toHaveLength(1));

      // Update the entity
      const startTime = performance.now();
      graph.putRecord("User:u1", { email: "updated@example.com" });
      await tick();
      const duration = performance.now() - startTime;

      // Should propagate to all 100 watchers efficiently (< 50ms)
      expect(duration).toBeLessThan(50);
      watchers.forEach(w => {
        expect(w.emissions).toHaveLength(2);
        expect(w.emissions[1].email).toBe("updated@example.com");
      });

      // Cleanup
      watchers.forEach(w => w.handle.unsubscribe());
    });

    it("should only update affected watchers (not all watchers)", async () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "user1@example.com" });
      graph.putRecord("User:u2", { __typename: "User", id: "u2", email: "user2@example.com" });

      const emissions1: any[] = [];
      const handle1 = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions1.push(data);
        },
      });

      const emissions2: any[] = [];
      const handle2 = fragments.watchFragment({
        id: "User:u2",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions2.push(data);
        },
      });

      expect(emissions1).toHaveLength(1);
      expect(emissions2).toHaveLength(1);

      // Update only User:u1
      graph.putRecord("User:u1", { email: "updated1@example.com" });
      await tick();

      // Only watcher for User:u1 should emit
      expect(emissions1).toHaveLength(2);
      expect(emissions2).toHaveLength(1);

      // Update only User:u2
      graph.putRecord("User:u2", { email: "updated2@example.com" });
      await tick();

      // Only watcher for User:u2 should emit
      expect(emissions1).toHaveLength(2);
      expect(emissions2).toHaveLength(2);

      handle1.unsubscribe();
      handle2.unsubscribe();
    });
  });

  describe("memory and cleanup", () => {
    it("should properly cleanup watchers on unsubscribe", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const emissions: any[] = [];
      const handle = fragments.watchFragment({
        id: "User:u1",
        fragment: operations.USER_FRAGMENT,
        variables: {},
        onData: (data) => {
          emissions.push(data);
        },
      });

      expect(emissions).toHaveLength(1);

      handle.unsubscribe();

      // After unsubscribe, updates should not trigger emissions
      graph.putRecord("User:u1", { email: "updated@example.com" });

      // Give time for any potential async updates
      setTimeout(() => {
        expect(emissions).toHaveLength(1); // Still only initial emission
      }, 10);
    });

    it("should handle rapid subscribe/unsubscribe cycles", () => {
      graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "test@example.com" });

      const startTime = performance.now();

      // Rapidly create and destroy 1000 watchers
      for (let i = 0; i < 1000; i++) {
        const handle = fragments.watchFragment({
          id: "User:u1",
          fragment: operations.USER_FRAGMENT,
          variables: {},
          onData: () => { },
        });
        handle.unsubscribe();
      }

      const duration = performance.now() - startTime;

      // Should handle 1000 subscribe/unsubscribe cycles efficiently (< 100ms)
      expect(duration).toBeLessThan(100);
    });
  });
});
