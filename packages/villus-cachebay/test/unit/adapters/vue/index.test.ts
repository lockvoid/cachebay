import { describe, it, expect } from "vitest";
import * as VueAdapter from "@/src/adapters/vue/index";

describe("Vue Adapter Exports", () => {
  describe("Plugin exports", () => {
    it("exports createCachebayPlugin function", () => {
      expect(typeof VueAdapter.createCachebayPlugin).toBe("function");
    });

    it("exports provideCachebay function", () => {
      expect(typeof VueAdapter.provideCachebay).toBe("function");
    });
  });

  describe("Hook exports", () => {
    it("exports useClient function", () => {
      expect(typeof VueAdapter.useClient).toBe("function");
    });

    it("exports useQuery function", () => {
      expect(typeof VueAdapter.useQuery).toBe("function");
    });

    it("exports useMutation function", () => {
      expect(typeof VueAdapter.useMutation).toBe("function");
    });

    it("exports useSubscription function", () => {
      expect(typeof VueAdapter.useSubscription).toBe("function");
    });
  });

  describe("Type exports", () => {
    it("has all expected exports", () => {
      const exports = Object.keys(VueAdapter);
      
      // Functions
      expect(exports).toContain("createCachebayPlugin");
      expect(exports).toContain("provideCachebay");
      expect(exports).toContain("useClient");
      expect(exports).toContain("useQuery");
      expect(exports).toContain("useMutation");
      expect(exports).toContain("useSubscription");
    });

    it("exports exactly 6 items", () => {
      const exports = Object.keys(VueAdapter);
      expect(exports).toHaveLength(6);
    });
  });
});
