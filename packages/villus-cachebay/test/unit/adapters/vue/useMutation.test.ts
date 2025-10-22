import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { useMutation } from "@/src/adapters/vue/useMutation";
import { createCachebay } from "@/src/core/client";
import { provideCachebay } from "@/src/adapters/vue/plugin";
import type { Transport } from "@/src/core/operations";

const MUTATION = `mutation CreateUser($name: String!) { createUser(name: $name) { id name } }`;

describe("useMutation", () => {
  let mockTransport: Transport;
  let cache: ReturnType<typeof createCachebay>;

  beforeEach(() => {
    mockTransport = {
      http: vi.fn().mockResolvedValue({
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      }),
    };
    cache = createCachebay({ transport: mockTransport });
  });

  it("provides execute function", () => {
    let mutationResult: any;

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    expect(typeof mutationResult.execute).toBe("function");
    expect(mutationResult.loading.value).toBe(false);
    expect(mutationResult.data.value).toBeNull();
    expect(mutationResult.error.value).toBeNull();
  });

  it("executes mutation and returns data", async () => {
    let mutationResult: any;

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    const result = await mutationResult.execute({ name: "Alice" });

    expect(mockTransport.http).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "mutation",
        variables: { name: "Alice" },
      })
    );
    expect(result.data).toEqual({ createUser: { id: "1", name: "Alice" } });
    expect(result.error).toBeNull();
    expect(mutationResult.data.value).toEqual({ createUser: { id: "1", name: "Alice" } });
  });

  it("sets loading state during execution", async () => {
    let mutationResult: any;
    let loadingDuringExecution = false;

    mockTransport.http = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      loadingDuringExecution = mutationResult.loading.value;
      return {
        data: { createUser: { id: "1", name: "Alice" } },
        error: null,
      };
    });

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    expect(mutationResult.loading.value).toBe(false);

    const promise = mutationResult.execute({ name: "Alice" });
    await nextTick();

    expect(mutationResult.loading.value).toBe(true);

    await promise;

    expect(loadingDuringExecution).toBe(true);
    expect(mutationResult.loading.value).toBe(false);
  });

  it("handles mutation errors", async () => {
    const errorTransport: Transport = {
      http: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("Validation failed"),
      }),
    };
    const errorCache = createCachebay({ transport: errorTransport });

    let mutationResult: any;

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
        return () => h("div");
      },
    });

    mount(App, {
      global: {
        plugins: [
          {
            install(app) {
              provideCachebay(app as any, errorCache);
            },
          },
        ],
      },
    });

    const result = await mutationResult.execute({ name: "Alice" });

    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
    expect(mutationResult.error.value).toBeTruthy();
    expect(mutationResult.data.value).toBeNull();
  });

  it("handles network errors during execution", async () => {
    mockTransport.http = vi.fn().mockRejectedValue(new Error("Network timeout"));

    let mutationResult: any;

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    const result = await mutationResult.execute({ name: "Alice" });

    expect(result.error).toBeTruthy();
    expect(result.data).toBeNull();
    expect(mutationResult.error.value).toBeTruthy();
  });

  it("can execute multiple times", async () => {
    let mutationResult: any;

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    await mutationResult.execute({ name: "Alice" });
    expect(mockTransport.http).toHaveBeenCalledTimes(1);

    await mutationResult.execute({ name: "Bob" });
    expect(mockTransport.http).toHaveBeenCalledTimes(2);

    await mutationResult.execute({ name: "Charlie" });
    expect(mockTransport.http).toHaveBeenCalledTimes(3);
  });

  it("clears error on successful execution", async () => {
    let mutationResult: any;
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

    const App = defineComponent({
      setup() {
        mutationResult = useMutation(MUTATION);
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

    // First call fails
    await mutationResult.execute({ name: "Alice" });
    expect(mutationResult.error.value).toBeTruthy();

    // Second call succeeds
    await mutationResult.execute({ name: "Alice" });
    expect(mutationResult.error.value).toBeNull();
    expect(mutationResult.data.value).toBeTruthy();
  });
});
