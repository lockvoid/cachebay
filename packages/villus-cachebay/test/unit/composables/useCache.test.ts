// test/unit/composables/useCache.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { CACHEBAY_KEY } from "@/src/core/plugin";

// 1) Hoisted module mock: keep a shared mocked `inject`
vi.mock("vue", async () => {
  const actual = await vi.importActual<any>("vue");
  const inject = vi.fn(); // per-test we'll .mockReturnValueOnce(...)
  return { ...actual, inject };
});

afterEach(() => {
  // reset only the mocked inject behavior between tests
  // (do not resetModules; we want the hoisted mock to persist)
  const vue = require("vue") as any;
  if (vue.inject?.mockReset) vue.inject.mockReset();
});

describe("useCache", () => {
  it("throws when not provided", async () => {
    const vue = await import("vue");
    (vue.inject as unknown as vi.Mock).mockReturnValueOnce(null);

    const { useCache } = await import("@/src/composables/useCache");
    expect(() => useCache()).toThrowError(
      "[cachebay] useCache() called before provideCachebay()"
    );
  });

  it("returns the injected API (minimum: identify / readFragment / writeFragment)", async () => {
    const fakeApi = {
      readFragment: vi.fn(({ id }: { id: string }) => ({
        __typename: "User",
        id: id.split(":")[1],
        name: "Ada",
      })),
      writeFragment: vi.fn(),
      identify: vi.fn((o: any) =>
        o && o.__typename && o.id != null ? `${o.__typename}:${String(o.id)}` : null
      ),
    };

    const vue = await import("vue");
    (vue.inject as unknown as vi.Mock).mockImplementation((key: unknown) => {
      expect(key).toBe(CACHEBAY_KEY);
      return fakeApi;
    });

    const { useCache } = await import("@/src/composables/useCache");
    const api = useCache();

    // identity passthrough
    expect(api.identify({ __typename: "User", id: "1" })).toBe("User:1");

    // readFragment passthrough
    const out = api.readFragment({
      id: "User:1",
      fragment: "fragment U on User { id name }",
    });
    expect(out).toMatchObject({ __typename: "User", id: "1", name: "Ada" });

    // writeFragment callable
    api.writeFragment({
      id: "User:1",
      fragment: "fragment U on User { name }",
      data: { name: "Ada" },
    });
    expect(fakeApi.writeFragment).toHaveBeenCalled();
  });

  it("exposes optional modifyOptimistic when provided", async () => {
    const commit = vi.fn();
    const revert = vi.fn();
    const fakeApi = {
      readFragment: vi.fn(),
      writeFragment: vi.fn(),
      identify: vi.fn(),
      modifyOptimistic: vi.fn((fn: (draft: any) => void) => {
        fn({});
        return { commit, revert };
      }),
    };

    const vue = await import("vue");
    (vue.inject as unknown as vi.Mock).mockReturnValue(fakeApi);

    const { useCache } = await import("@/src/composables/useCache");
    const api = useCache();

    const tx = api.modifyOptimistic?.(() => { });
    tx?.commit();
    tx?.revert();

    expect(fakeApi.modifyOptimistic).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("exposes optional inspect when provided", async () => {
    const inspect = {
      entities: vi.fn(() => ["User:1"]),
      entity: vi.fn(() => ({ name: "Ada" })),
    };
    const fakeApi = {
      readFragment: vi.fn(),
      writeFragment: vi.fn(),
      identify: vi.fn(),
      inspect,
    };

    const vue = await import("vue");
    (vue.inject as unknown as vi.Mock).mockReturnValue(fakeApi);

    const { useCache } = await import("@/src/composables/useCache");
    const api = useCache();

    expect(api.inspect?.entities?.()).toEqual(["User:1"]);
    expect(api.inspect?.entity?.("User:1")).toEqual({ name: "Ada" });
  });
});
