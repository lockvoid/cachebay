import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { compilePlan } from "@/src/compiler";
import { createCachebay } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";

// Mock svelte context + onDestroy
const contextStore = new Map<unknown, unknown>();
const destroyCallbacks: Array<() => void> = [];

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
    onDestroy: (fn: () => void) => {
      destroyCallbacks.push(fn);
    },
  };
});

import { setCachebay } from "@/src/adapters/svelte/context";
import { createFragment } from "@/src/adapters/svelte/createFragment.svelte";

const USER_FIELDS_FRAGMENT = compilePlan(/* GraphQL */ `
  fragment UserFields on User {
    id
    email
  }
`);

describe("createFragment", () => {
  let cache: ReturnType<typeof createCachebay>;
  let mockTransport: Transport;

  beforeEach(() => {
    contextStore.clear();
    destroyCallbacks.length = 0;

    mockTransport = {
      http: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    cache = createCachebay({ transport: mockTransport });
    setCachebay(cache);
  });

  it("returns reactive object with fragment data from cache", async () => {
    const mockUnsubscribe = vi.fn();
    const mockUpdate = vi.fn();
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return {
        unsubscribe: mockUnsubscribe,
        update: mockUpdate,
      };
    });

    let fragmentResult: any;

    $effect.root(() => {
      fragmentResult = createFragment({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
        variables: () => ({}),
      });
    });

    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    expect(watchFragmentSpy).toHaveBeenCalled();
    expect(fragmentResult.data).toEqual({ id: "u1", email: "test@example.com" });
  });

  it("handles empty id by setting data to undefined", () => {
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment");

    let fragmentResult: any;

    $effect.root(() => {
      fragmentResult = createFragment({
        id: "",
        fragment: USER_FIELDS_FRAGMENT,
      });
    });

    flushSync();

    expect(watchFragmentSpy).not.toHaveBeenCalled();
    expect(fragmentResult.data).toBeUndefined();
  });

  it("reacts to changes in reactive id parameter", async () => {
    const mockUnsubscribe = vi.fn();
    const mockUpdate = vi.fn();
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: opts.id.split(":")[1], email: "test@example.com" });
      return {
        unsubscribe: mockUnsubscribe,
        update: mockUpdate,
      };
    });

    let currentId = $state("User:u1");
    let fragmentResult: any;

    $effect.root(() => {
      fragmentResult = createFragment({
        id: () => currentId,
        fragment: USER_FIELDS_FRAGMENT,
      });
    });

    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    expect(watchFragmentSpy).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(0);

    // Change the reactive id parameter
    currentId = "User:u2";
    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    // Verify watcher was updated (not recreated)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ id: "User:u2", variables: {} });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(0); // Should NOT unsubscribe
    expect(watchFragmentSpy).toHaveBeenCalledTimes(1); // Should NOT create new watcher
  });

  it("reacts to changes in reactive variables parameter", async () => {
    const mockUnsubscribe = vi.fn();
    const mockUpdate = vi.fn();
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return {
        unsubscribe: mockUnsubscribe,
        update: mockUpdate,
      };
    });

    let currentVars = $state<Record<string, unknown>>({ first: 10 });
    let fragmentResult: any;

    $effect.root(() => {
      fragmentResult = createFragment({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
        variables: () => currentVars,
      });
    });

    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    expect(watchFragmentSpy).toHaveBeenCalledTimes(1);

    // Change the reactive variables parameter
    currentVars = { first: 20 };
    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    // Verify watcher was updated (not recreated)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ id: "User:u1", variables: { first: 20 } });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(0); // Should NOT unsubscribe
    expect(watchFragmentSpy).toHaveBeenCalledTimes(1); // Should NOT create new watcher
  });

  it("handles undefined variables by defaulting to empty object", async () => {
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return { unsubscribe: vi.fn(), update: vi.fn() };
    });

    $effect.root(() => {
      createFragment({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
        // No variables parameter
      });
    });

    flushSync();
    await new Promise((r) => setTimeout(r, 10));

    expect(watchFragmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
        variables: {},
      }),
    );
  });

  it("throws if cache doesn't have watchFragment method", () => {
    contextStore.clear();

    const invalidCache = {
      identify: vi.fn(),
      writeFragment: vi.fn(),
    };
    setCachebay(invalidCache as any);

    expect(() => {
      $effect.root(() => {
        createFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT,
        });
      });
      flushSync();
    }).toThrowError("[cachebay] createFragment: cache.watchFragment() is required");
  });

  it("recycles unchanged data (stable references)", async () => {
    const testCache = createCachebay({ transport: mockTransport });
    contextStore.clear();
    setCachebay(testCache);

    // Write initial user data
    testCache.writeFragment({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT,
      data: { id: "u1", email: "alice@example.com" },
    });

    let fragmentResult: any;

    $effect.root(() => {
      fragmentResult = createFragment({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initial data should be present
    expect(fragmentResult.data).toMatchObject({ id: "u1", email: "alice@example.com" });
    const initialRef = fragmentResult.data;

    // Write same data again (should recycle - same fingerprint)
    testCache.writeFragment({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT,
      data: { id: "u1", email: "alice@example.com" },
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Data reference should be recycled (same object because fingerprint unchanged)
    expect(fragmentResult.data).toBe(initialRef);

    // Write different data (should create new object - different fingerprint)
    testCache.writeFragment({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT,
      data: { id: "u1", email: "alice.updated@example.com" },
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Data reference should be different (new fingerprint)
    expect(fragmentResult.data).not.toBe(initialRef);
    expect(fragmentResult.data?.email).toBe("alice.updated@example.com");
  });
});
