import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { provideCachebay } from "@/src/core/plugin";
import { createCache } from "@/src/core/internals";
import { useCache } from "@/src/composables/useCache";

describe("useCache()", () => {
  it("throws if used without provider", () => {
    const Comp = defineComponent({
      setup() {
        useCache(); // should throw
        return () => h("div");
      },
    });

    expect(() => mount(Comp)).toThrowError(
      "[cachebay] useCache() called before provideCachebay()"
    );
  });

  it("returns the cache instance; writeFragment is shimmed to return tx-like object", () => {
    const cache = createCache();

    let apiFromSetup: any;
    const Comp = defineComponent({
      setup() {
        apiFromSetup = useCache();
        return () => h("div");
      },
    });

    const wrapper = mount(Comp, {
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

    expect(wrapper.exists()).toBe(true);
    expect(typeof apiFromSetup.identify).toBe("function");
    expect(typeof apiFromSetup.readFragment).toBe("function");
    expect(typeof apiFromSetup.writeFragment).toBe("function");

    const spy = vi.spyOn(cache as any, "writeFragment");

    const tx = apiFromSetup.writeFragment({
      id: "User:u1",
      fragment: `
        fragment UserFields on User { id email }
      `,
      data: { __typename: "User", id: "u1", email: "x@example.com" },
      variables: {},
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(typeof tx).toBe("object");
    expect(typeof tx.commit).toBe("function");
    expect(typeof tx.revert).toBe("function");
  });
});
