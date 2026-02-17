import { describe, it, expect } from "vitest";
import * as SvelteAdapter from "@/src/adapters/svelte/index";

describe("Svelte Adapter Exports", () => {
  describe("Context exports", () => {
    it("exports setCachebay function", () => {
      expect(typeof SvelteAdapter.setCachebay).toBe("function");
    });

    it("exports getCachebay function", () => {
      expect(typeof SvelteAdapter.getCachebay).toBe("function");
    });
  });

  describe("Composable exports", () => {
    it("exports createQuery function", () => {
      expect(typeof SvelteAdapter.createQuery).toBe("function");
    });

    it("exports createMutation function", () => {
      expect(typeof SvelteAdapter.createMutation).toBe("function");
    });

    it("exports createSubscription function", () => {
      expect(typeof SvelteAdapter.createSubscription).toBe("function");
    });

    it("exports createFragment function", () => {
      expect(typeof SvelteAdapter.createFragment).toBe("function");
    });
  });
});
