import { mount } from "@vue/test-utils";
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { useFragment } from "@/src/composables/useFragment";
import { createCache } from "@/src/core/internals";
import { provideCachebay } from "@/src/core/plugin";
import { USER_FIELDS_FRAGMENT_COMPILER } from "@/test/helpers";

describe("useFragment", () => {
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    cache = createCache();
  });

  it("returns readonly ref with fragment data from cache", () => {
    const readFragmentSpy = vi.spyOn(cache as any, "readFragment").mockReturnValue({ id: "u1", email: "test@example.com" });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
          variables: {},
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [cache],
      },
    });

    expect(readFragmentSpy).toHaveBeenCalledWith({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT_COMPILER,
      variables: {},
    });
    expect(fragmentData.value).toEqual({ id: "u1", email: "test@example.com" });
  });

  it("handles empty id by setting data to undefined", () => {
    const readFragmentSpy = vi.spyOn(cache as any, "readFragment");

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "",
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [cache],
      },
    });

    expect(readFragmentSpy).not.toHaveBeenCalled();
    expect(fragmentData.value).toBeUndefined();
  });

  it("reacts to changes in reactive id parameter", async () => {
    const readFragmentSpy = vi.spyOn(cache as any, "readFragment").mockReturnValue({ id: "u1", email: "test@example.com" });

    const userId = ref("User:u1");

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: userId,
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [cache],
      },
    });

    expect(readFragmentSpy).toHaveBeenCalledTimes(1);

    // 1. Change the reactive id parameter
    userId.value = "User:u2";
    await nextTick();

    // 2. Verify useFragment reacted to the id change
    expect(readFragmentSpy).toHaveBeenCalledTimes(2);
    expect(readFragmentSpy).toHaveBeenLastCalledWith({
      id: "User:u2",
      fragment: USER_FIELDS_FRAGMENT_COMPILER,
      variables: {},
    });
  });

  it("reacts to changes in reactive variables parameter", async () => {
    const cache = createCache();

    const readFragmentSpy = vi.spyOn(cache as any, "readFragment").mockReturnValue({ id: "u1", email: "test@example.com" });

    const variables = ref({ first: 10 });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
          variables,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [cache],
      },
    });

    expect(readFragmentSpy).toHaveBeenCalledWith({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT_COMPILER,
      variables: { first: 10 },
    });

    // 1. Change the reactive variables parameter
    variables.value = { first: 20 };
    await nextTick();

    // 2. Verify useFragment reacted to the variables change
    expect(readFragmentSpy).toHaveBeenCalledTimes(2);
    expect(readFragmentSpy).toHaveBeenLastCalledWith({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT_COMPILER,
      variables: { first: 20 },
    });
  });

  it("handles undefined variables by defaulting to empty object", () => {
    const cache = createCache();

    const readFragmentSpy = vi.spyOn(cache as any, "readFragment").mockReturnValue({ id: "u1", email: "test@example.com" });

    let fragmentData: any;

    const App = defineComponent({
      setup() {
        fragmentData = useFragment({
          id: "User:u1",
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
        });

        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [cache],
      },
    });

    expect(readFragmentSpy).toHaveBeenCalledWith({
      id: "User:u1",
      fragment: USER_FIELDS_FRAGMENT_COMPILER,
      variables: {},
    });
  });

  it("throws if cache doesn't have readFragment method", () => {
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
          fragment: USER_FIELDS_FRAGMENT_COMPILER,
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
    ).toThrowError("[useFragment] cache must expose readFragment()");
  });
});
