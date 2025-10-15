import { describe, it, expect, vi } from "vitest";
import { createCachebay } from "../../../src/core/client";
import type { Transport } from "../../../src/core/operations";

describe("createCachebay", () => {
  const mockTransport: Transport = {
    http: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  it("throws error when transport is not provided", () => {
    expect(() => createCachebay({} as any)).toThrow("Missing required 'transport' with 'http' function. Example: { transport: { http: async (ctx) => { ... } } }");
  });

  it("throws error when transport.http is not a function", () => {
    expect(() => createCachebay({ transport: { http: "not a function" } } as any)).toThrow(
      "transport.http' must be a function",
    );
  });

  it("throws error when transport.ws is provided but not a function", () => {
    expect(() =>
      createCachebay({ transport: { http: vi.fn(), ws: "not a function" } } as any),
    ).toThrow("transport.ws' must be a function");
  });

  it("exposes public APIs", () => {
    const cache = createCachebay({ transport: mockTransport });

    // Identity
    expect(typeof cache.identify).toBe("function");

    // Fragments API
    expect(typeof cache.readFragment).toBe("function");
    expect(typeof cache.writeFragment).toBe("function");
    expect(typeof cache.watchFragment).toBe("function");

    // Queries API
    expect(typeof cache.readQuery).toBe("function");
    expect(typeof cache.writeQuery).toBe("function");
    expect(typeof cache.watchQuery).toBe("function");

    // Optimistic API
    expect(typeof cache.modifyOptimistic).toBe("function");

    // Operations API
    expect(typeof cache.executeQuery).toBe("function");
    expect(typeof cache.executeMutation).toBe("function");
    expect(typeof cache.executeSubscription).toBe("function");

    // SSR API
    expect(typeof cache.dehydrate).toBe("function");
    expect(typeof cache.hydrate).toBe("function");

    // Inspect API
    expect(cache.inspect).toBeTruthy();
  });

  it("exposes internals for testing", () => {
    const cache = createCachebay({ transport: mockTransport });

    expect(cache.__internals.graph).toBeTruthy();
    expect(cache.__internals.optimistic).toBeTruthy();
    expect(cache.__internals.planner).toBeTruthy();
    expect(cache.__internals.canonical).toBeTruthy();
    expect(cache.__internals.documents).toBeTruthy();
    expect(cache.__internals.fragments).toBeTruthy();
    expect(cache.__internals.queries).toBeTruthy();
    expect(cache.__internals.operations).toBeTruthy();
    expect(cache.__internals.ssr).toBeTruthy();
    expect(cache.__internals.inspect).toBeTruthy();
  });

  it("accepts optional WebSocket transport", () => {
    const transport: Transport = {
      http: vi.fn().mockResolvedValue({
        data: null, error: null,
      }),
      ws: vi.fn().mockResolvedValue({
        subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
      }),
    };

    const cache = createCachebay({ transport });

    expect(cache.executeSubscription).toBeTruthy();
  });
});
