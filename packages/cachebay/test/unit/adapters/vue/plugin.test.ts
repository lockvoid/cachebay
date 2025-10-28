import { describe, it, expect, vi } from "vitest";
import { createApp } from "vue";
import { CACHEBAY_KEY } from "@/src/adapters/vue/constants";
import { createCachebay, provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport } from "@/src/core/operations";

describe("Vue Plugin", () => {
  const mockTransport: Transport = {
    http: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  describe("createCachebay", () => {
    it("creates cachebay with install method", () => {
      const cachebay = createCachebay({ transport: mockTransport });

      expect(typeof cachebay.install).toBe("function");
    });

    it("provides cache instance to Vue app", () => {
      const cachebay = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      cachebay.install(app);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cachebay);
    });

    it("preserves all cache methods", () => {
      const cachebay = createCachebay({ transport: mockTransport });

      expect(typeof cachebay.identify).toBe("function");
      expect(typeof cachebay.readFragment).toBe("function");
      expect(typeof cachebay.writeFragment).toBe("function");
      expect(typeof cachebay.readQuery).toBe("function");
      expect(typeof cachebay.writeQuery).toBe("function");
      expect(typeof cachebay.executeQuery).toBe("function");
      expect(typeof cachebay.executeMutation).toBe("function");
      expect(typeof cachebay.executeSubscription).toBe("function");
    });

    it("can be used with app.use()", () => {
      const cachebay = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const useSpy = vi.spyOn(app, "use");

      app.use(cachebay);

      expect(useSpy).toHaveBeenCalledWith(cachebay);
    });
  });

  describe("provideCachebay", () => {
    it("provides cache instance to Vue app", () => {
      const cachebay = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      provideCachebay(app, cachebay);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cachebay);
    });

    it("works as alternative to app.use()", () => {
      const cachebay = createCachebay({ transport: mockTransport });
      const app = createApp({});
      const provideSpy = vi.spyOn(app, "provide");

      // Manual provide instead of app.use(cachebay)
      provideCachebay(app, cachebay);

      expect(provideSpy).toHaveBeenCalledWith(CACHEBAY_KEY, cachebay);
    });
  });
});
