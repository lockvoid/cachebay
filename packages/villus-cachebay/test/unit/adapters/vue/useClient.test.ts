import { mount } from "@vue/test-utils";
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { useClient } from "@/src/adapters/vue/useClient";
import { createCache } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport } from "@/src/core/operations";

describe("useClient", () => {
  const mockTransport: Transport = {
    http: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  it("throws if used without provider", () => {
    const App = defineComponent({
      setup() {
        useClient();
      },

      render: () => h("div"),
    });

    expect(() => mount(App)).toThrowError(
      "[cachebay] useClient() called before cache setup",
    );
  });

  it("returns the cache instance directly by reference", () => {
    const cache = createCache({ transport: mockTransport });

    let cacheApi: any;

    const App = defineComponent({
      setup() {
        cacheApi = useClient();
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

    expect(cacheApi).toBe(cache);
    expect(cacheApi.identify).toBe(cache.identify);
    expect(cacheApi.readFragment).toBe(cache.readFragment);
    expect(cacheApi.writeFragment).toBe(cache.writeFragment);
    expect(cacheApi.executeQuery).toBe(cache.executeQuery);
    expect(cacheApi.executeMutation).toBe(cache.executeMutation);
  });
});
