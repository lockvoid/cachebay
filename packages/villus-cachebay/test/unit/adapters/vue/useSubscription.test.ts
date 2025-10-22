import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { useSubscription } from "@/src/adapters/vue/useSubscription";
import { createCachebay } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport, ObservableLike, OperationResult } from "@/src/core/operations";

const SUBSCRIPTION = `subscription OnMessage { messageAdded { id text } }`;

describe("useSubscription", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;
  let mockObservable: ObservableLike<OperationResult>;
  let capturedObserver: any;

  beforeEach(() => {
    mockObservable = {
      subscribe: vi.fn((observer) => {
        capturedObserver = observer;
        return { unsubscribe: vi.fn() };
      }),
    };

    mockTransport = {
      http: vi.fn().mockResolvedValue({ data: null, error: null }),
      ws: vi.fn().mockResolvedValue(mockObservable),
    };

    cache = createCachebay({ transport: mockTransport });
  });

  it("starts with loading state", () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    expect(subscriptionResult.loading.value).toBe(true);
    expect(subscriptionResult.data.value).toBeNull();
    expect(subscriptionResult.error.value).toBeNull();
  });

  it("subscribes to WebSocket transport", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          variables: { roomId: "1" },
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "subscription",
        variables: { roomId: "1" },
      })
    );
    expect(mockObservable.subscribe).toHaveBeenCalled();
  });

  it("updates data when subscription emits", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate subscription data
    capturedObserver.next({
      data: { messageAdded: { id: "1", text: "Hello" } },
      error: null,
    });

    await nextTick();

    expect(subscriptionResult.data.value).toEqual({
      messageAdded: { id: "1", text: "Hello" },
    });
    expect(subscriptionResult.loading.value).toBe(false);
    expect(subscriptionResult.error.value).toBeNull();
  });

  it("handles subscription errors", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate subscription error
    const error = new Error("Connection lost");
    capturedObserver.error(error);

    await nextTick();

    expect(subscriptionResult.error.value).toBe(error);
    expect(subscriptionResult.loading.value).toBe(false);
  });

  it("pauses subscription when pause is true", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          pause: true,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).not.toHaveBeenCalled();
    expect(subscriptionResult.loading.value).toBe(false);
  });

  it("reacts to reactive pause changes", async () => {
    const isPaused = ref(true);
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          pause: isPaused,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    expect(mockTransport.ws).not.toHaveBeenCalled();

    // Unpause
    isPaused.value = false;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalled();
  });

  it("reacts to reactive variables changes", async () => {
    const roomId = ref("1");
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          variables: () => ({ roomId: roomId.value }),
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledTimes(1);
    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { roomId: "1" },
      })
    );

    // Change variables - should trigger new subscription
    roomId.value = "2";
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledTimes(2);
    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { roomId: "2" },
      })
    );
  });

  it("unsubscribes on component unmount", async () => {
    let unsubscribeSpy: any;

    mockObservable = {
      subscribe: vi.fn((observer) => {
        capturedObserver = observer;
        unsubscribeSpy = vi.fn();
        return { unsubscribe: unsubscribeSpy };
      }),
    };
    mockTransport.ws = vi.fn().mockResolvedValue(mockObservable);

    const App = defineComponent({
      setup() {
        useSubscription({
          query: SUBSCRIPTION,
        });
        return () => h("div");
      },
    });

    const wrapper = mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Unmount component
    wrapper.unmount();

    expect(unsubscribeSpy).toHaveBeenCalled();
  });

  it("handles multiple data emissions", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
        });
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, cache);
            },
          },
        ],
      },
    });

    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // First message
    capturedObserver.next({
      data: { messageAdded: { id: "1", text: "Hello" } },
      error: null,
    });
    await nextTick();
    expect(subscriptionResult.data.value).toEqual({
      messageAdded: { id: "1", text: "Hello" },
    });

    // Second message
    capturedObserver.next({
      data: { messageAdded: { id: "2", text: "World" } },
      error: null,
    });
    await nextTick();
    expect(subscriptionResult.data.value).toEqual({
      messageAdded: { id: "2", text: "World" },
    });

    // Third message
    capturedObserver.next({
      data: { messageAdded: { id: "3", text: "!" } },
      error: null,
    });
    await nextTick();
    expect(subscriptionResult.data.value).toEqual({
      messageAdded: { id: "3", text: "!" },
    });
  });
});
