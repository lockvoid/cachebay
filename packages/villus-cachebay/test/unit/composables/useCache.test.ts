import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { provideCachebay } from "@/src/core/plugin";
import { createCache } from "@/src/core/internals";
import { useCache } from "@/src/composables/useCache";

describe("useCache", () => {
  it("throws if used without provider", () => {
    const App = defineComponent({
      setup() {
        useCache();
      },

      render: () => h("div"),
    });

    expect(() => mount(App)).toThrowError(
      "[cachebay] useCache() called before provideCachebay()"
    );
  });

  it("returns the cache instance directly by reference", () => {
    const cache = createCache();

    let cacheApi: any;
    
    const App = defineComponent({
      setup() {
        cacheApi = useCache();
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
    
    expect(cacheApi).toBe(cache);
    expect(cacheApi.identify).toBe(cache.identify);
    expect(cacheApi.readFragment).toBe(cache.readFragment);
    expect(cacheApi.writeFragment).toBe(cache.writeFragment);
  });
});
