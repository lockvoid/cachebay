// Mock documents module to inject performance counters
let normalizeCount = 0;
let materializeHotCount = 0;
let materializeColdCount = 0;
let watchFragmentCallCount = 0;

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

vi.mock("@/src/core/fragments", async () => {
  const actual = await vi.importActual<typeof import("@/src/core/fragments")>("@/src/core/fragments");

  return {
    ...actual,
    createFragments: (deps: any) => {
      const fragments = actual.createFragments(deps);

      // Wrap watchFragment to count calls
      const origWatchFragment = fragments.watchFragment;
      fragments.watchFragment = ((...args: any[]) => {
        watchFragmentCallCount++;
        return origWatchFragment.apply(fragments, args);
      }) as any;

      return fragments;
    },
  };
});

// Mock svelte context + onDestroy
const contextStore = new Map<unknown, unknown>();

vi.mock("svelte", async () => {
  const actual = await vi.importActual<typeof import("svelte")>("svelte");
  return {
    ...actual,
    setContext: (key: unknown, value: unknown) => {
      contextStore.set(key, value);
    },
    getContext: (key: unknown) => {
      return contextStore.get(key);
    },
    onDestroy: () => {},
  };
});

import { gql } from "graphql-tag";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { setCachebay } from "@/src/adapters/svelte/context";
import { createFragment } from "@/src/adapters/svelte/createFragment.svelte";
import { createCachebay } from "@/src/core/client";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

const USER_FRAGMENT = gql`
  fragment UserFragment on User {
    id
    email
  }
`;

describe("createFragment Performance", () => {
  let client: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    // Reset counters
    normalizeCount = 0;
    materializeHotCount = 0;
    materializeColdCount = 0;
    watchFragmentCallCount = 0;
    contextStore.clear();

    client = createCachebay({
      transport: {
        http: vi.fn(),
        ws: vi.fn(),
      },
      keys: {
        User: (u: any) => u.id,
      },
    });

    setCachebay(client);
  });

  // Helper to run createFragment in $effect.root context
  // Must be async + flush microtasks so deferred materializations
  // settle before the helper returns (matches Vue's runInVueContext behaviour).
  const runInSvelteContext = async (testFn: () => any) => {
    let result: any;

    $effect.root(() => {
      result = testFn();
    });

    flushSync();
    await new Promise<void>((r) => queueMicrotask(r));

    return result;
  };

  describe("initial watch", () => {
    it("two-phase: COLD path (1 materialization) then HOT path (1 materialization)", async () => {
      // Pre-populate cache
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      await tick();

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 1: First watch - COLD path
      const dataRef1 = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(dataRef1.data?.id).toBe("1");

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second watch with same id - HOT path
      const dataRef2 = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should use HOT path (materializeCache)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
      expect(watchFragmentCallCount).toBe(2); // Second createFragment creates new watcher

      expect(dataRef2.data?.id).toBe("1");
    });
  });

  describe("reactive id changes", () => {
    it("update with new id: watcher reused, not remounted", async () => {
      // Pre-populate cache with multiple users
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });
      client.writeFragment({
        id: "User:2",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "2", email: "bob@example.com" },
      });

      await tick();

      let currentId = $state("User:1");

      let dataRef: any;

      $effect.root(() => {
        dataRef = createFragment({
          id: () => currentId,
          fragment: USER_FRAGMENT,
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      // PHASE 1: Initial watch
      expect(dataRef.data?.id).toBe("1");
      expect(watchFragmentCallCount).toBe(1);
      expect(normalizeCount).toBe(2); // writeFragment x2 (User:1, User:2)
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Update to different id - watcher reused
      currentId = "User:2";
      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1); // Watcher reused

      expect(dataRef.data?.id).toBe("2");
    });

    it("update to same id again: uses COLD path if no other watcher is mounted", async () => {
      // Pre-populate cache with multiple users
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });
      client.writeFragment({
        id: "User:2",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "2", email: "bob@example.com" },
      });

      await tick();

      // PHASE 1: Initial watch User:1
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      let currentId = $state("User:1");

      let dataRef: any;

      $effect.root(() => {
        dataRef = createFragment({
          id: () => currentId,
          fragment: USER_FRAGMENT,
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(dataRef.data?.id).toBe("1");
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);

      // PHASE 2: Change to User:2
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;
      currentId = "User:2";
      flushSync();

      await tick();
      await tick();

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);
      expect(dataRef.data?.id).toBe("2");

      // PHASE 3: Change back to User:1 - should be COLD
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;
      currentId = "User:1";
      flushSync();

      await tick();
      await tick();

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);

      expect(dataRef.data?.id).toBe("1");
    });

    it("update to same id again: uses HOT path if other watcher is mounted", async () => {
      // Pre-populate cache with multiple users
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });
      client.writeFragment({
        id: "User:2",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "2", email: "bob@example.com" },
      });

      await tick();

      // PHASE 1: Initial watch User:1
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      let currentId = $state("User:1");

      let dataRef: any;

      $effect.root(() => {
        dataRef = createFragment({
          id: () => currentId,
          fragment: USER_FRAGMENT,
        });
      });

      flushSync();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(dataRef.data?.id).toBe("1");
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);

      // Mount other watcher
      await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      // PHASE 2: Change to User:2
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;
      currentId = "User:2";
      flushSync();
      await new Promise<void>((r) => queueMicrotask(r));

      await tick();
      await tick();

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(2);
      expect(dataRef.data?.id).toBe("2");

      // PHASE 3: Change back to User:1 - should be HOT
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;
      currentId = "User:1";
      flushSync();

      await tick();
      await tick();

      // Should materialize HOT (already in materializeCache)
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);
      expect(watchFragmentCallCount).toBe(2);

      expect(dataRef.data?.id).toBe("1");
    });
  });

  describe("cache updates", () => {
    it("cache update triggers rematerialization", async () => {
      // Pre-populate cache
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      await tick();
      await tick();

      const dataRef = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await tick();
      await tick();

      // PHASE 1: Initial watch
      expect(dataRef.data?.email).toBe("alice@example.com");
      expect(watchFragmentCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);

      // PHASE 2: Update cache
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice.updated@example.com" },
      });

      await tick();

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);
      expect(dataRef.data?.email).toBe("alice.updated@example.com");
    });
  });

  describe("multiple watchers", () => {
    it("multiple watchers on same fragment: each creates new watcher", async () => {
      // Pre-populate cache
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      // PHASE 1: First watcher
      const dataRef1 = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchFragmentCallCount).toBe(1);
      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(2);
      expect(materializeHotCount).toBe(0);

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 2: Second watcher - HOT path
      const dataRef2 = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchFragmentCallCount).toBe(2);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);

      // Reset counts
      normalizeCount = 0;
      materializeHotCount = 0;
      materializeColdCount = 0;

      // PHASE 3: Third watcher - still HOT
      const dataRef3 = await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(watchFragmentCallCount).toBe(3);
      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(0);
      expect(materializeHotCount).toBe(1);

      // All refs should have same data
      expect(dataRef1.data?.id).toBe("1");
      expect(dataRef2.data?.id).toBe("1");
      expect(dataRef3.data?.id).toBe("1");
    });

    it("10 watchers on same fragment: normalize 0, materialize 1 COLD + 9 HOT", async () => {
      // Pre-populate cache
      client.writeFragment({
        id: "User:1",
        fragment: USER_FRAGMENT,
        data: { __typename: "User", id: "1", email: "alice@example.com" },
      });

      await tick();

      // PHASE 1: First watcher - COLD
      await runInSvelteContext(() => {
        return createFragment({
          id: "User:1",
          fragment: USER_FRAGMENT,
        });
      });

      await tick();

      expect(normalizeCount).toBe(1);
      expect(materializeColdCount).toBe(1);
      expect(materializeHotCount).toBe(0);
      expect(watchFragmentCallCount).toBe(1);

      // Reset normalize count (no more writes)
      normalizeCount = 0;
      const coldAfterFirst = materializeColdCount;
      const hotAfterFirst = materializeHotCount;

      // PHASE 2: Next 9 watchers - HOT
      for (let i = 0; i < 9; i++) {
        await runInSvelteContext(() => {
          return createFragment({
            id: "User:1",
            fragment: USER_FRAGMENT,
          });
        });
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(normalizeCount).toBe(0);
      expect(materializeColdCount).toBe(coldAfterFirst);
      expect(materializeHotCount).toBe(hotAfterFirst + 9);
      expect(watchFragmentCallCount).toBe(10);
    });
  });
});
