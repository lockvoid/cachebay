import { describe, it, expect, vi } from "vitest";
import { createApp } from "vue";
import { createCachebay } from "@/src/core/client";
import { createCachebayPlugin, provideCachebay } from "@/src/adapters/vue/plugin";
import { CACHEBAY_KEY } from "@/src/adapters/vue/constants";
import type { Transport } from "@/src/core/operations";

describe("Vue Plugin", () => {
  const mockTransport: Transport = {
    http: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  describe("createCachebayPlugin", () => {
    it("creates plugin with install method", () => {
      const cache = createCachebay({ transport: mockTransport });
      const plugin = createCachebayPlugin(cache);

      expect(typeof plugin.install).toBe("function");
      expect(plugin).toBe(cache); // Plugin extends cache
    });

    it("provides cache instance to Vue app", () => {
      const cache = createCachebay({ transport: mockTransport });
      const plugin = createCachebayPlugin(cache);
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      plugin.install(app);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cache);
    });

    it("stores default suspensionTimeout option", () => {
      const cache = createCachebay({ transport: mockTransport });
      const plugin = createCachebayPlugin(cache);
      const app = createApp({});

      plugin.install(app);

      expect((cache as any).__vueOptions).toEqual({
        suspensionTimeout: 1000,
      });
    });

    it("stores custom suspensionTimeout option", () => {
      const cache = createCachebay({ transport: mockTransport });
      const plugin = createCachebayPlugin(cache, {
        suspensionTimeout: 5000,
      });
      const app = createApp({});

      plugin.install(app);

      expect((cache as any).__vueOptions).toEqual({
        suspensionTimeout: 5000,
      });
    });

    it("preserves all cache methods", () => {
      const cache = createCachebay({ transport: mockTransport });
      const plugin = createCachebayPlugin(cache);

      expect(plugin.identify).toBe(cache.identify);
      expect(plugin.readFragment).toBe(cache.readFragment);
      expect(plugin.writeFragment).toBe(cache.writeFragment);
      expect(plugin.readQuery).toBe(cache.readQuery);
      expect(plugin.writeQuery).toBe(cache.writeQuery);
      expect(plugin.executeQuery).toBe(cache.executeQuery);
      expect(plugin.executeMutation).toBe(cache.executeMutation);
      expect(plugin.executeSubscription).toBe(cache.executeSubscription);
    });
  });

  describe("provideCachebay", () => {
    it("provides cache instance to Vue app", () => {
      const cache = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      provideCachebay(app, cache);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cache);
    });

    it("stores default suspensionTimeout option", () => {
      const cache = createCachebay({ transport: mockTransport });
      const app = createApp({});

      provideCachebay(app, cache);

      expect((cache as any).__vueOptions).toEqual({
        suspensionTimeout: 1000,
      });
    });

    it("stores custom suspensionTimeout option", () => {
      const cache = createCachebay({ transport: mockTransport });
      const app = createApp({});

      provideCachebay(app, cache, {
        suspensionTimeout: 3000,
      });

      expect((cache as any).__vueOptions).toEqual({
        suspensionTimeout: 3000,
      });
    });

    it("works as alternative to plugin", () => {
      const cache = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      // Manual provide instead of app.use(plugin)
      provideCachebay(app, cache);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cache);
      expect((cache as any).__vueOptions).toBeDefined();
    });
  });
});
