import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";
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
import { createSubscription } from "@/src/adapters/svelte/createSubscription.svelte";

const SUBSCRIPTION = "subscription OnMessage { messageAdded { id text } }";

describe("createSubscription", () => {
  let cache: ReturnType<typeof createCachebay>;
  let mockTransport: Transport & { ws: ReturnType<typeof vi.fn> };
  let capturedObserver: any;
  let mockObservable: any;

  beforeEach(() => {
    contextStore.clear();
    destroyCallbacks.length = 0;

    mockObservable = {
      subscribe: vi.fn((observer: any) => {
        capturedObserver = observer;
        return { unsubscribe: vi.fn() };
      }),
    };

    mockTransport = {
      http: vi.fn().mockResolvedValue({ data: null, error: null }),
      ws: vi.fn().mockResolvedValue(mockObservable),
    };

    cache = createCachebay({ transport: mockTransport });
    setCachebay(cache);
  });

  it("starts with loading state", () => {
    let subResult: any;

    $effect.root(() => {
      subResult = createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();

    expect(subResult.isFetching).toBe(true);
    expect(subResult.data).toBeNull();
    expect(subResult.error).toBeNull();
  });

  it("subscribes to WebSocket transport", async () => {
    $effect.root(() => {
      createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalled();
  });

  it("updates data when subscription emits", async () => {
    let subResult: any;

    $effect.root(() => {
      subResult = createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate subscription data
    capturedObserver.next({
      data: { messageAdded: { id: "1", text: "Hello" } },
      error: null,
    });

    flushSync();

    expect(subResult.data).toEqual({
      messageAdded: { id: "1", text: "Hello" },
    });
    expect(subResult.isFetching).toBe(false);
    expect(subResult.error).toBeNull();
  });

  it("handles subscription errors", async () => {
    let subResult: any;

    $effect.root(() => {
      subResult = createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate subscription error
    const error = new Error("Connection lost");
    capturedObserver.error(error);

    flushSync();

    expect(subResult.error).toBeInstanceOf(Error);
    expect(subResult.isFetching).toBe(false);
  });

  it("does not start subscription when enabled is false", async () => {
    let subResult: any;

    $effect.root(() => {
      subResult = createSubscription({
        query: SUBSCRIPTION,
        enabled: () => false,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).not.toHaveBeenCalled();
    expect(subResult.isFetching).toBe(false);
  });

  it("reacts to reactive enabled changes", async () => {
    let isEnabled = $state(false);

    $effect.root(() => {
      createSubscription({
        query: SUBSCRIPTION,
        enabled: () => isEnabled,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockTransport.ws).not.toHaveBeenCalled();

    // Enable
    isEnabled = true;
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalled();
  });

  it("reacts to reactive variables changes", async () => {
    let currentRoomId = $state("1");

    $effect.root(() => {
      createSubscription({
        query: SUBSCRIPTION,
        variables: () => ({ roomId: currentRoomId }),
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledTimes(1);
    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { roomId: "1" },
      }),
    );

    // Change variables - should trigger new subscription
    currentRoomId = "2";
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledTimes(2);
    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { roomId: "2" },
      }),
    );
  });

  it("unsubscribes on dispose (simulates component unmount)", async () => {
    let unsubscribeSpy: any;

    mockObservable = {
      subscribe: vi.fn((observer: any) => {
        capturedObserver = observer;
        unsubscribeSpy = vi.fn();
        return { unsubscribe: unsubscribeSpy };
      }),
    };
    mockTransport.ws = vi.fn().mockResolvedValue(mockObservable);

    let dispose: (() => void) | undefined;

    dispose = $effect.root(() => {
      createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Simulate unmount by calling onDestroy callbacks
    for (const cb of destroyCallbacks) {
      cb();
    }

    expect(unsubscribeSpy).toHaveBeenCalled();
  });

  it("handles multiple data emissions", async () => {
    let subResult: any;

    $effect.root(() => {
      subResult = createSubscription({
        query: SUBSCRIPTION,
      });
    });

    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // First message
    capturedObserver.next({
      data: { messageAdded: { id: "1", text: "Hello" } },
      error: null,
    });
    flushSync();
    expect(subResult.data).toEqual({
      messageAdded: { id: "1", text: "Hello" },
    });

    // Second message
    capturedObserver.next({
      data: { messageAdded: { id: "2", text: "World" } },
      error: null,
    });
    flushSync();
    expect(subResult.data).toEqual({
      messageAdded: { id: "2", text: "World" },
    });

    // Third message
    capturedObserver.next({
      data: { messageAdded: { id: "3", text: "!" } },
      error: null,
    });
    flushSync();
    expect(subResult.data).toEqual({
      messageAdded: { id: "3", text: "!" },
    });
  });

  describe("callbacks", () => {
    it("calls onData callback when new data arrives", async () => {
      const onDataMock = vi.fn();
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
          onData: onDataMock,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Emit data
      capturedObserver.next({
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      });

      flushSync();

      // onData should be called with the data
      expect(onDataMock).toHaveBeenCalledTimes(1);
      expect(onDataMock).toHaveBeenCalledWith({
        messageAdded: { id: "1", text: "Hello" },
      });

      // Reactive state should also update
      expect(subResult.data).toEqual({
        messageAdded: { id: "1", text: "Hello" },
      });
    });

    it("calls onError callback when error occurs", async () => {
      const onErrorMock = vi.fn();
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
          onError: onErrorMock,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Emit error
      const testError = new Error("Subscription failed");
      capturedObserver.error(testError);

      flushSync();

      // onError should be called
      expect(onErrorMock).toHaveBeenCalledTimes(1);
      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Subscription failed"),
        }),
      );

      // Reactive error state should also update
      expect(subResult.error).toBeDefined();
    });

    it("calls onComplete callback when subscription completes", async () => {
      const onCompleteMock = vi.fn();
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
          onComplete: onCompleteMock,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Complete subscription
      capturedObserver.complete();

      flushSync();

      // onComplete should be called
      expect(onCompleteMock).toHaveBeenCalledTimes(1);

      // isFetching should be false
      expect(subResult.isFetching).toBe(false);
    });

    it("supports all callbacks together", async () => {
      const onDataMock = vi.fn();
      const onErrorMock = vi.fn();
      const onCompleteMock = vi.fn();

      $effect.root(() => {
        createSubscription({
          query: SUBSCRIPTION,
          onData: onDataMock,
          onError: onErrorMock,
          onComplete: onCompleteMock,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Emit data
      capturedObserver.next({
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      });
      flushSync();
      expect(onDataMock).toHaveBeenCalledTimes(1);

      // Complete
      capturedObserver.complete();
      flushSync();
      expect(onCompleteMock).toHaveBeenCalledTimes(1);

      // Error should not be called
      expect(onErrorMock).not.toHaveBeenCalled();
    });
  });

  describe("empty/null data handling", () => {
    it("silently skips null data (acknowledgment messages)", async () => {
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Server sends null data (acknowledgment)
      capturedObserver.next({
        data: null,
        error: null,
      });

      flushSync();

      // Should not error, data should remain null
      expect(subResult.data).toBeNull();
      expect(subResult.error).toBeNull();
      expect(subResult.isFetching).toBe(true); // Still waiting for real data
    });

    it("silently skips empty object data (acknowledgment messages)", async () => {
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Server sends empty object (acknowledgment)
      capturedObserver.next({
        data: {},
        error: null,
      });

      flushSync();

      // Should not error, data should remain null
      expect(subResult.data).toBeNull();
      expect(subResult.error).toBeNull();
      expect(subResult.isFetching).toBe(true); // Still waiting for real data
    });

    it("processes real data after acknowledgment", async () => {
      let subResult: any;

      $effect.root(() => {
        subResult = createSubscription({
          query: SUBSCRIPTION,
        });
      });

      flushSync();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 1. Server sends acknowledgment (null)
      capturedObserver.next({
        data: null,
        error: null,
      });
      flushSync();
      expect(subResult.data).toBeNull();

      // 2. Server sends acknowledgment (empty object)
      capturedObserver.next({
        data: {},
        error: null,
      });
      flushSync();
      expect(subResult.data).toBeNull();

      // 3. Server sends real data
      capturedObserver.next({
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      });
      flushSync();

      // Should have real data now
      expect(subResult.data).toEqual({
        messageAdded: { id: "1", text: "Hello" },
      });
      expect(subResult.error).toBeNull();
      expect(subResult.isFetching).toBe(false);
    });
  });
});
