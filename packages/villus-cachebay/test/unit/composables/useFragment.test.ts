import { describe, it, expect, vi, afterEach } from "vitest";

// hoisted mock for useCache — we’ll decide its return value per test
const mockUseCache = vi.fn();
vi.mock("@/src/composables/useCache", () => ({
  useCache: () => mockUseCache(),
}));

// import after mocks are set
import { ref } from "vue";
import { useFragment } from "@/src/composables/useFragment";

afterEach(() => {
  mockUseCache.mockReset();
});

describe("useFragment", () => {
  it("reads immediately by default", () => {
    const readFragment = vi.fn(() => ({
      __typename: "User",
      id: "1",
      name: "Ada",
    }));
    const writeFragment = vi.fn();
    mockUseCache.mockReturnValue({ readFragment, writeFragment });

    const { data } = useFragment({
      id: "User:1",
      fragment: "fragment U on User { id name }",
    });

    expect(readFragment).toHaveBeenCalledWith({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      materialized: true,
      variables: undefined,
    });

    expect(data.value).toEqual({
      __typename: "User",
      id: "1",
      name: "Ada",
    });
  });

  it("supports lazy mode (immediate:false) and manual read()", () => {
    const readFragment = vi.fn(() => ({ __typename: "User", id: "1", name: "A" }));
    mockUseCache.mockReturnValue({ readFragment, writeFragment: vi.fn() });

    const frag = useFragment({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      immediate: false,
    });

    expect(readFragment).not.toHaveBeenCalled();
    expect(frag.data.value).toBe(undefined);

    frag.read();
    expect(readFragment).toHaveBeenCalledTimes(1);
    expect(frag.data.value).toMatchObject({ id: "1", name: "A" });
  });

  it("passes variables (including reactive Ref) to read/write", () => {
    const vars = ref<{ locale?: string }>({ locale: "en" });

    const readFragment = vi.fn(() => ({ __typename: "User", id: "1", name: "John" }));
    const writeFragment = vi.fn();
    mockUseCache.mockReturnValue({ readFragment, writeFragment });

    const frag = useFragment({
      id: ref("User:1"),
      fragment: "fragment U on User { id name }",
      variables: vars,
    });

    // initial read used { locale: 'en' }
    expect(readFragment).toHaveBeenCalledWith({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      materialized: true,
      variables: { locale: "en" },
    });

    // update variables and re-read
    vars.value = { locale: "de" };
    frag.read();
    expect(readFragment).toHaveBeenLastCalledWith({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      materialized: true,
      variables: { locale: "de" },
    });

    // write uses latest vars too
    frag.write({ __typename: "User", id: "1", name: "Hans" });
    expect(writeFragment).toHaveBeenCalledWith({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      data: { __typename: "User", id: "1", name: "Hans" },
      variables: { locale: "de" },
    });
  });

  it("works with changing id as a Ref", () => {
    const idRef = ref("User:1");
    const readFragment = vi
      .fn()
      .mockReturnValueOnce({ __typename: "User", id: "1", name: "A" })
      .mockReturnValueOnce({ __typename: "User", id: "2", name: "B" });

    mockUseCache.mockReturnValue({ readFragment, writeFragment: vi.fn() });

    const frag = useFragment({
      id: idRef,
      fragment: "fragment U on User { id name }",
      immediate: false,
    });

    // first id
    frag.read();
    expect(readFragment).toHaveBeenCalledWith({
      id: "User:1",
      fragment: "fragment U on User { id name }",
      materialized: true,
      variables: undefined,
    });
    expect(frag.data.value).toMatchObject({ id: "1", name: "A" });

    // switch id
    idRef.value = "User:2";
    frag.read();
    expect(readFragment).toHaveBeenLastCalledWith({
      id: "User:2",
      fragment: "fragment U on User { id name }",
      materialized: true,
      variables: undefined,
    });
    expect(frag.data.value).toMatchObject({ id: "2", name: "B" });
  });

  it("write() sends data straight through", () => {
    const writeFragment = vi.fn();
    mockUseCache.mockReturnValue({ readFragment: vi.fn(), writeFragment });

    const { write } = useFragment({
      id: "User:1",
      fragment: "fragment U on User { name }",
      immediate: false,
    });

    write({ __typename: "User", id: "1", name: "Zoe" });
    expect(writeFragment).toHaveBeenCalledWith({
      id: "User:1",
      fragment: "fragment U on User { name }",
      data: { __typename: "User", id: "1", name: "Zoe" },
      variables: undefined,
    });
  });
});
