import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { createCachebay } from "@/src/core/client";
import type { Transport } from "@/src/core/operations";

// Mock svelte context + onDestroy
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
    onDestroy: () => {},
  };
});

import { setCachebay } from "@/src/adapters/svelte/context";
import { createMutation } from "@/src/adapters/svelte/createMutation.svelte";

const MUTATION = "mutation CreateUser($name: String!) { createUser(name: $name) { id name } }";

describe("createMutation", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    contextStore.clear();

    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      }),
    };
    cache = createCachebay({ transport: mockTransport });
    setCachebay(cache);
  });

  it("provides execute function", () => {
    const mutation = createMutation({ query: MUTATION });

    expect(typeof mutation.execute).toBe("function");
    expect(mutation.isFetching).toBe(false);
    expect(mutation.data).toBeNull();
    expect(mutation.error).toBeNull();
  });

  it("executes mutation and returns data", async () => {
    const mutation = createMutation({ query: MUTATION });

    const result = await mutation.execute({ name: "Alice" });

    expect(mockTransport.http).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "mutation",
        variables: { name: "Alice" },
      }),
    );
    expect(result.data).toEqual({ createUser: { id: "1", name: "Alice" } });
    expect(result.error).toBeNull();
    expect(mutation.data).toEqual({ createUser: { id: "1", name: "Alice" } });
  });

  it("sets loading state during execution", async () => {
    let loadingDuringExecution = false;

    mockTransport.http = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      loadingDuringExecution = mutation.isFetching;
      return {
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      };
    });

    const mutation = createMutation({ query: MUTATION });

    expect(mutation.isFetching).toBe(false);

    const promise = mutation.execute({ name: "Alice" });

    // isFetching should be true immediately after execute
    expect(mutation.isFetching).toBe(true);

    await promise;

    expect(loadingDuringExecution).toBe(true);
    expect(mutation.isFetching).toBe(false);
  });

  it("handles mutation errors", async () => {
    const errorTransport: Transport = {
      http: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("Validation failed"),
      }),
    };
    const errorCache = createCachebay({ transport: errorTransport });
    contextStore.clear();
    setCachebay(errorCache);

    const mutation = createMutation({ query: MUTATION });

    const result = await mutation.execute({ name: "Alice" });

    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
    expect(mutation.error).toBeTruthy();
    expect(mutation.data).toBeNull();
  });

  it("handles network errors during execution", async () => {
    mockTransport.http = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const mutation = createMutation({ query: MUTATION });

    const result = await mutation.execute({ name: "Alice" });

    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
    expect(mutation.error).toBeTruthy();
  });

  it("can execute multiple times", async () => {
    const mutation = createMutation({ query: MUTATION });

    await mutation.execute({ name: "Alice" });
    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    await mutation.execute({ name: "Bob" });
    expect(mockTransport.http).toHaveBeenCalledTimes(2);

    await mutation.execute({ name: "Charlie" });
    expect(mockTransport.http).toHaveBeenCalledTimes(3);
  });

  it("clears error on successful execution", async () => {
    let callCount = 0;

    mockTransport.http = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: null,
          error: new Error("First call failed"),
        };
      }
      return {
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      };
    });

    const mutation = createMutation({ query: MUTATION });

    // First call fails
    await mutation.execute({ name: "Alice" });
    expect(mutation.error).toBeTruthy();

    // Second call succeeds
    await mutation.execute({ name: "Alice" });
    expect(mutation.error).toBeNull();
    expect(mutation.data).toBeTruthy();
  });
});
