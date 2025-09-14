// test/unit/composables/useFragment.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

// Hoisted mock for useCache — we control its return value per test
const mockUseCache = vi.fn();
vi.mock("@/src/composables/useCache", () => ({
  useCache: () => mockUseCache(),
}));

import { ref, reactive, isReactive, nextTick } from "vue";
import { useFragment } from "@/src/composables/useFragment";

afterEach(() => {
  mockUseCache.mockReset();
});

describe("useFragment (LIVE)", () => {
  it("materializes and returns a reactive proxy; external writes flow through", () => {
    // Provide a watchFragment that returns a live reactive object
    const proxies = new Map<string, any>();
    const getProxy = (key: string) => {
      let p = proxies.get(key);
      if (!p) {
        const [, id] = key.split(":");
        p = reactive({ __typename: "Post", id, title: undefined });
        proxies.set(key, p);
      }
      return p;
    };
    const watchFragment = vi.fn(({ id }: { id: string }) => ({ value: getProxy(id) }));
    mockUseCache.mockReturnValue({ watchFragment });

    const data = useFragment({
      id: "Post:1",
      fragment: /* GraphQL */ `fragment P on Post { id title }`,
    });

    // Immediate live value
    expect(watchFragment).toHaveBeenCalledWith(expect.objectContaining({ id: "Post:1" }));
    expect(isReactive(data.value)).toBe(true);
    expect(data.value.__typename).toBe("Post");
    expect(data.value.id).toBe("1");

    // Mutating the underlying proxy is visible via composable
    proxies.get("Post:1").title = "Hello";
    expect(data.value.title).toBe("Hello");
  });

  it("reacts to id (Ref) changes by swapping the live proxy", async () => {
    const proxies = new Map<string, any>();
    const getProxy = (key: string) => {
      let p = proxies.get(key);
      if (!p) {
        const [, id] = key.split(":");
        p = reactive({ __typename: "User", id, name: `User-${id}` });
        proxies.set(key, p);
      }
      return p;
    };

    const watchFragment = vi.fn(({ id }: { id: string }) => ({ value: getProxy(id) }));
    mockUseCache.mockReturnValue({ watchFragment });

    const idRef = ref("User:1");
    const data = useFragment({
      id: idRef,
      fragment: /* GraphQL */ `fragment U on User { id name }`,
    });

    // First key
    expect(data.value.name).toBe("User-1");

    // Switch key
    idRef.value = "User:2";
    await nextTick();
    expect(watchFragment).toHaveBeenLastCalledWith(expect.objectContaining({ id: "User:2" }));
    expect(data.value.name).toBe("User-2");
  });

  it("sets data to null when id is missing/invalid; resumes when id becomes valid", async () => {
    const watchFragment = vi.fn(({ id }: { id: string }) => ({
      value: reactive({ __typename: "Thing", id: id.split(":")[1] }),
    }));
    mockUseCache.mockReturnValue({ watchFragment });

    const idRef = ref<string | undefined>(undefined);
    const data = useFragment({
      id: idRef as any,
      fragment: /* GraphQL */ `fragment T on Thing { id }`,
    });

    // No id → null and no subscription
    expect(data.value).toBeNull();
    expect(watchFragment).not.toHaveBeenCalled();

    // Becomes valid → subscribe and expose live proxy
    idRef.value = "Thing:42";
    await nextTick();
    expect(watchFragment).toHaveBeenCalledWith(expect.objectContaining({ id: "Thing:42" }));
    expect(data.value?.id).toBe("42");
  });

  it("accepts any fragment string (ignored for LIVE) — no validation errors", () => {
    const watchFragment = vi.fn(() => ({ value: reactive({ __typename: "X", id: "1" }) }));
    mockUseCache.mockReturnValue({ watchFragment });

    // Empty string → tolerated
    expect(() =>
      useFragment({ id: "X:1", fragment: "" }),
    ).not.toThrow();

    // Non-fragment (a query) → also tolerated
    expect(() =>
      useFragment({ id: "X:1", fragment: /* GraphQL */ `query Q { __typename }` }),
    ).not.toThrow();

    // Proper fragment → also fine, of course
    expect(() =>
      useFragment({ id: "X:1", fragment: /* GraphQL */ `fragment X on X { id }` }),
    ).not.toThrow();
  });
});
