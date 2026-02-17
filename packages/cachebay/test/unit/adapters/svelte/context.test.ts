import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCachebay } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";

// Mock svelte context API
const contextStore = new Map<unknown, unknown>();

vi.mock("svelte", async () => {
  const actual = await vi.importActual<typeof import("svelte")>("svelte");
  return {
    ...actual,
    setContext: (key: unknown, value: unknown) => {
      contextStore.set(key, value);
    },
    getContext: (key: unknown) => {
      return contextStore.get(key);
    },
  };
});

// Import AFTER mock is set up
import { setCachebay, getCachebay } from "@/src/adapters/svelte/context";

describe("Svelte Context", () => {
  const mockTransport: Transport = {
    http: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  beforeEach(() => {
    contextStore.clear();
  });

  describe("setCachebay", () => {
    it("stores cache instance in Svelte context", () => {
      const cache = createCachebay({ transport: mockTransport });

      setCachebay(cache);

      // Context store should have one entry
      expect(contextStore.size).toBe(1);
    });

    it("preserves all cache methods on the instance", () => {
      const cache = createCachebay({ transport: mockTransport });

      setCachebay(cache);

      const stored = [...contextStore.values()][0] as any;

      expect(typeof stored.identify).toBe("function");
      expect(typeof stored.readFragment).toBe("function");
      expect(typeof stored.writeFragment).toBe("function");
      expect(typeof stored.readQuery).toBe("function");
      expect(typeof stored.writeQuery).toBe("function");
      expect(typeof stored.executeQuery).toBe("function");
      expect(typeof stored.executeMutation).toBe("function");
      expect(typeof stored.executeSubscription).toBe("function");
    });
  });

  describe("getCachebay", () => {
    it("throws if used before setCachebay", () => {
      expect(() => getCachebay()).toThrowError(
        "[cachebay] getCachebay() called before setCachebay(). Call setCachebay(instance) in a parent component first.",
      );
    });

    it("returns the cache instance directly by reference", () => {
      const cache = createCachebay({ transport: mockTransport });

      setCachebay(cache);
      const retrieved = getCachebay();

      expect(retrieved).toBe(cache);
      expect(retrieved.identify).toBe(cache.identify);
      expect(retrieved.readFragment).toBe(cache.readFragment);
      expect(retrieved.writeFragment).toBe(cache.writeFragment);
      expect(retrieved.executeQuery).toBe(cache.executeQuery);
      expect(retrieved.executeMutation).toBe(cache.executeMutation);
    });
  });
});
