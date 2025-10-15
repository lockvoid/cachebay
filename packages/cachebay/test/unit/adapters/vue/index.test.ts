import { describe, it, expect } from "vitest";
import * as VueAdapter from "@/src/adapters/vue/index";

describe("Vue Adapter Exports", () => {
  describe("Plugin exports", () => {
    it("exports createCachebay function", () => {
      expect(typeof VueAdapter.createCachebay).toBe("function");
    });

    it("exports provideCachebay function", () => {
      expect(typeof VueAdapter.provideCachebay).toBe("function");
    });
  });

  describe("Hook exports", () => {
    it("exports useCachebay function", () => {
      expect(typeof VueAdapter.useCachebay).toBe("function");
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

    it("exports useFragment function", () => {
      expect(typeof VueAdapter.useFragment).toBe("function");
    });
  });
});
