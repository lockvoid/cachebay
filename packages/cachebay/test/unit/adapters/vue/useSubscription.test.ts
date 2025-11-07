import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { useSubscription } from "@/src/adapters/vue/useSubscription";
import { createCachebay } from "@/src/core/client";
import type { Transport, ObservableLike, OperationResult } from "@/src/core/operations";

const SUBSCRIPTION = "subscription OnMessage { messageAdded { id text } }";

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

    expect(subscriptionResult.isFetching.value).toBe(true);
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
      }),
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
    expect(subscriptionResult.isFetching.value).toBe(false);
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

    expect(subscriptionResult.error.value).toBeInstanceOf(Error);
    expect(subscriptionResult.isFetching.value).toBe(false);
  });

  it("does not start subscription when enabled is false", async () => {
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          enabled: false,
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
    expect(subscriptionResult.isFetching.value).toBe(false);
  });

  it("reacts to reactive enabled changes", async () => {
    const isEnabled = ref(false);
    let subscriptionResult: any;

    const App = defineComponent({
      setup() {
        subscriptionResult = useSubscription({
          query: SUBSCRIPTION,
          enabled: isEnabled,
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

    // Enable
    isEnabled.value = true;
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
      }),
    );

    // Change variables - should trigger new subscription
    roomId.value = "2";
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTransport.ws).toHaveBeenCalledTimes(2);
    expect(mockTransport.ws).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { roomId: "2" },
      }),
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

  describe("callbacks", () => {
    it("calls onData callback when new data arrives", async () => {
      const onDataMock = vi.fn();
      let subscriptionResult: any;

      const App = defineComponent({
        setup() {
          subscriptionResult = useSubscription({
            query: SUBSCRIPTION,
            onData: onDataMock,
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

      // Emit data
      capturedObserver.next({
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      });

      await nextTick();

      // onData should be called with the data
      expect(onDataMock).toHaveBeenCalledTimes(1);
      expect(onDataMock).toHaveBeenCalledWith({
        messageAdded: { id: "1", text: "Hello" },
      });

      // Reactive state should also update
      expect(subscriptionResult.data.value).toEqual({
        messageAdded: { id: "1", text: "Hello" },
      });
    });

    it("calls onError callback when error occurs", async () => {
      const onErrorMock = vi.fn();
      let subscriptionResult: any;

      const App = defineComponent({
        setup() {
          subscriptionResult = useSubscription({
            query: SUBSCRIPTION,
            onError: onErrorMock,
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

      // Emit error
      const testError = new Error("Subscription failed");
      capturedObserver.error(testError);

      await nextTick();

      // onError should be called
      expect(onErrorMock).toHaveBeenCalledTimes(1);
      expect(onErrorMock).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining("Subscription failed"),
      }));

      // Reactive error state should also update
      expect(subscriptionResult.error.value).toBeDefined();
    });

    it("calls onComplete callback when subscription completes", async () => {
      const onCompleteMock = vi.fn();
      let subscriptionResult: any;

      const App = defineComponent({
        setup() {
          subscriptionResult = useSubscription({
            query: SUBSCRIPTION,
            onComplete: onCompleteMock,
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

      // Complete subscription
      capturedObserver.complete();

      await nextTick();

      // onComplete should be called
      expect(onCompleteMock).toHaveBeenCalledTimes(1);

      // isFetching should be false
      expect(subscriptionResult.isFetching.value).toBe(false);
    });

    it("supports all callbacks together", async () => {
      const onDataMock = vi.fn();
      const onErrorMock = vi.fn();
      const onCompleteMock = vi.fn();

      const App = defineComponent({
        setup() {
          useSubscription({
            query: SUBSCRIPTION,
            onData: onDataMock,
            onError: onErrorMock,
            onComplete: onCompleteMock,
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

      // Emit data
      capturedObserver.next({
        data: { messageAdded: { id: "1", text: "Hello" } },
        error: null,
      });
      await nextTick();
      expect(onDataMock).toHaveBeenCalledTimes(1);

      // Complete
      capturedObserver.complete();
      await nextTick();
      expect(onCompleteMock).toHaveBeenCalledTimes(1);

      // Error should not be called
      expect(onErrorMock).not.toHaveBeenCalled();
    });
  });
});
