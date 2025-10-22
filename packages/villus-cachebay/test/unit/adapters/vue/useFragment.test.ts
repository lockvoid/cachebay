import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { useFragment } from "@/src/adapters/vue/useFragment";
import { createCache } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import { compilePlan } from "@/src/compiler";
import type { Transport } from "@/src/core/operations";

// Create a simple fragment for testing
const USER_FIELDS_FRAGMENT = compilePlan(/* GraphQL */ `
  fragment UserFields on User {
    id
    email
  }
`);

describe("useFragment", () => {
  let cache: ReturnType<typeof createCache>;
  let mockTransport: Transport;

  beforeEach(() => {
    mockTransport = {
      http: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    cache = createCache({ transport: mockTransport });
  });

  it("returns readonly ref with fragment data from cache", () => {
    // Mock watchFragment to call onData immediately
    const mockUnsubscribe = vi.fn();
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return { unsubscribe: mockUnsubscribe };
    });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT,
          variables: {},
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

    expect(watchFragmentSpy).toHaveBeenCalled();
    expect(fragmentData.value).toEqual({ id: "u1", email: "test@example.com" });
  });

  it("handles empty id by setting data to undefined", () => {
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment");

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "",
          fragment: USER_FIELDS_FRAGMENT,
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

    expect(watchFragmentSpy).not.toHaveBeenCalled();
    expect(fragmentData.value).toBeUndefined();
  });

  it("reacts to changes in reactive id parameter", async () => {
    const mockUnsubscribe = vi.fn();
    const watchFragmentSpy = vi.spyOn(cache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: opts.id.split(":")[1], email: "test@example.com" });
      return { unsubscribe: mockUnsubscribe };
    });

    const userId = ref("User:u1");

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: userId,
          fragment: USER_FIELDS_FRAGMENT,
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

    expect(watchFragmentSpy).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(0);

    // 1. Change the reactive id parameter
    userId.value = "User:u2";
    await nextTick();

    // 2. Verify old watcher was unsubscribed and new one created
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(watchFragmentSpy).toHaveBeenCalledTimes(2);
  });

  it("reacts to changes in reactive variables parameter", async () => {
    const testCache = createCache({ transport: mockTransport });

    const mockUnsubscribe = vi.fn();
    const watchFragmentSpy = vi.spyOn(testCache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return { unsubscribe: mockUnsubscribe };
    });

    const variables = ref({ first: 10 });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT,
          variables,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, testCache);
            },
          },
        ],
      },
    });

    expect(watchFragmentSpy).toHaveBeenCalledTimes(1);

    // 1. Change the reactive variables parameter
    variables.value = { first: 20 };
    await nextTick();

    // 2. Verify old watcher was unsubscribed and new one created
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(watchFragmentSpy).toHaveBeenCalledTimes(2);
  });

  it("handles undefined variables by defaulting to empty object", () => {
    const testCache = createCache({ transport: mockTransport });

    const watchFragmentSpy = vi.spyOn(testCache as any, "watchFragment").mockImplementation((opts: any) => {
      opts.onData({ id: "u1", email: "test@example.com" });
      return { unsubscribe: vi.fn() };
    });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, testCache);
            },
          },
        ],
      },
    });

    expect(watchFragmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "User:u1",
        fragment: USER_FIELDS_FRAGMENT,
        variables: {},
      })
    );
  });

  it("throws if cache doesn't have watchFragment method", () => {
    const invalidCache = {
      identify: vi.fn(),

      writeFragment: vi.fn(),

      install: (app: any) => {
        provideCachebay(app, { identify: vi.fn(), writeFragment: vi.fn() });
      },
    };

    const App = defineComponent({
      setup() {
        useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT,
        });
      },
      render: () => h("div"),
    });

    expect(() =>
      mount(App, {
        global: {
          plugins: [invalidCache],
        },
      }),
    ).toThrowError("[useFragment] cache must expose watchFragment()");
  });
});
