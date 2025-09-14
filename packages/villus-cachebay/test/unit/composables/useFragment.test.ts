// test/unit/composables/useFragment.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

// Hoisted mock for useCache — we control its return value per test
const mockUseCache = vi.fn();
vi.mock("@/src/composables/useCache", () => ({
  useCache: () => mockUseCache(),
}));

import { ref, reactive, isReactive } from "vue";
import { useFragment } from "@/src/composables/useFragment";

afterEach(() => {
  mockUseCache.mockReset();
});

describe("useFragment (LIVE)", () => {
  it("materializes and returns a reactive proxy; external writes flow through", () => {
    // Fake cache.materializeEntity that returns a stable reactive proxy per key
    const proxies = new Map<string, any>();
    const materializeEntity = vi.fn((key: string) => {
      let p = proxies.get(key);
      if (!p) {
        const [, id] = key.split(":");
        p = reactive({ __typename: "Post", id, title: undefined });
        proxies.set(key, p);
      }
      return p;
    });

    mockUseCache.mockReturnValue({ materializeEntity });

    const data = useFragment({
      id: "Post:1",
      fragment: /* GraphQL */ `fragment P on Post { id title }`,
    });

    // Immediately live
    expect(materializeEntity).toHaveBeenCalledWith("Post:1");
    expect(data.value).toBe(proxies.get("Post:1"));
    expect(isReactive(data.value)).toBe(true);
    expect(data.value.__typename).toBe("Post");
    expect(data.value.id).toBe("1");

    // Simulate a write into the live proxy → composable sees it
    proxies.get("Post:1").title = "Hello";
    expect(data.value.title).toBe("Hello");

    // Never goes through readFragment (this composable is live-only)
    expect((mockUseCache.mock.results[0].value as any).readFragment).toBeUndefined();
  });

  it("reacts to id (Ref) changes by swapping the live proxy", () => {
    const proxies = new Map<string, any>();
    const materializeEntity = vi.fn((key: string) => {
      let p = proxies.get(key);
      if (!p) {
        const [, id] = key.split(":");
        p = reactive({ __typename: "User", id, name: `User-${id}` });
        proxies.set(key, p);
      }
      return p;
    });
    mockUseCache.mockReturnValue({ materializeEntity });

    const idRef = ref("User:1");
    const data = useFragment({
      id: idRef,
      fragment: /* GraphQL */ `fragment U on User { id name }`,
    });

    // First key
    expect(data.value).toBe(proxies.get("User:1"));
    expect(data.value.name).toBe("User-1");

    // Switch key → ref now points to the other proxy
    idRef.value = "User:2";
    expect(materializeEntity).toHaveBeenLastCalledWith("User:2");
    expect(data.value).toBe(proxies.get("User:2"));
    expect(data.value.name).toBe("User-2");
  });

  it("sets data to null when id is missing/invalid; resumes when id becomes valid", () => {
    const materializeEntity = vi.fn((key: string) =>
      reactive({ __typename: "Thing", id: key.split(":")[1] }),
    );
    mockUseCache.mockReturnValue({ materializeEntity });

    const idRef = ref<string | undefined>(undefined);
    const data = useFragment({
      id: idRef as any,
      fragment: /* GraphQL */ `fragment T on Thing { id }`,
    });

    // No id → null
    expect(data.value).toBeNull();

    // Becomes valid → materialized
    idRef.value = "Thing:42";
    expect(materializeEntity).toHaveBeenCalledWith("Thing:42");
    expect(data.value?.id).toBe("42");
  });

  it("validates a single, non-empty fragment source", () => {
    mockUseCache.mockReturnValue({ materializeEntity: vi.fn() });

    // Empty string
    expect(() =>
      useFragment({ id: "X:1", fragment: "" }),
    ).toThrowError(/fragment.*non-empty/i);

    // No fragment definition inside
    expect(() =>
      useFragment({ id: "X:1", fragment: /* GraphQL */ `query Q { __typename }` }),
    ).toThrowError(/single valid fragment definition/i);

    // Correct single fragment → does not throw
    expect(() =>
      useFragment({ id: "X:1", fragment: /* GraphQL */ `fragment X on X { id }` }),
    ).not.toThrow();
  });
});
