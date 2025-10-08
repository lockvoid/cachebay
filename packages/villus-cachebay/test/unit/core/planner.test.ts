import type { DocumentNode } from "graphql";

vi.mock("@/src/compiler", () => {
  const compilePlan = vi.fn(() => Object.freeze({
    kind: "CachePlan" as const,
    operation: "query" as const,
    rootTypename: "Query",
    root: [],
    rootSelectionMap: undefined,
    networkQuery: {},
  }));

  const isCachePlan = (x: any) => !!x && x.kind === "CachePlan";

  return { compilePlan, isCachePlan };
});

import { createPlanner } from "@/src/core/planner";
import { compilePlan } from "@/src/compiler";

const compileSpy = vi.mocked(compilePlan);

describe("planner.getPlan (memo & routing)", () => {
  beforeEach(() => {
    compileSpy.mockClear();
  });

  it("returns a precompiled plan as-is (no compile call)", () => {
    const planner = createPlanner();

    const plan = Object.freeze({
      kind: "CachePlan" as const,
      operation: "query" as const,
      rootTypename: "Query",
      root: [],
      rootSelectionMap: undefined,
      networkQuery: {},
    });

    const result = planner.getPlan(plan);

    expect(result).toBe(plan);
    expect(compileSpy).not.toHaveBeenCalled();
  });

  describe("DocumentNode memoization", () => {
    it("memoizes by DocumentNode identity + fragmentName", () => {
      const planner = createPlanner();

      const docA = { kind: "Document", __name: "A", __id: 1 } as any as DocumentNode;
      const docB = { kind: "Document", __name: "B", __id: 2 } as any as DocumentNode;

      const p1 = planner.getPlan(docA, { fragmentName: "Frag" });
      const p2 = planner.getPlan(docA, { fragmentName: "Frag" });
      expect(p1).toBe(p2);

      const p3 = planner.getPlan(docA, { fragmentName: "Other" });
      expect(p3).not.toBe(p1);

      const p4 = planner.getPlan(docB, { fragmentName: "Frag" });
      expect(p4).not.toBe(p1);

      expect(compileSpy).toHaveBeenCalledTimes(3);
      expect(compileSpy).toHaveBeenNthCalledWith(1, docA, { fragmentName: "Frag" });
      expect(compileSpy).toHaveBeenNthCalledWith(2, docA, { fragmentName: "Other" });
      expect(compileSpy).toHaveBeenNthCalledWith(3, docB, { fragmentName: "Frag" });
    });
  });

  describe("string memoization", () => {
    it("memoizes by source string + fragmentName", () => {
      const planner = createPlanner();

      const src = "fragment X on Y { id }";

      const p1 = planner.getPlan(src, { fragmentName: "X" });
      const p2 = planner.getPlan(src, { fragmentName: "X" });
      const p3 = planner.getPlan(src, { fragmentName: "Z" });

      expect(p1).toBe(p2);
      expect(p3).not.toBe(p1);

      expect(compileSpy).toHaveBeenCalledTimes(2);
      expect(compileSpy).toHaveBeenNthCalledWith(1, src, { fragmentName: "X" });
      expect(compileSpy).toHaveBeenNthCalledWith(2, src, { fragmentName: "Z" });
    });
  });

  it("handles mixed inputs consistently (doc vs string)", () => {
    const planner = createPlanner();

    const src = "query Q { me { id } }";
    const doc = { kind: "Document", __name: "Q", __id: 99 } as any as DocumentNode;

    const a = planner.getPlan(src);
    const b = planner.getPlan(src);
    const c = planner.getPlan(doc);
    const d = planner.getPlan(doc);

    expect(a).toBe(b);
    expect(c).toBe(d);
    expect(a).not.toBe(c);

    expect(compileSpy).toHaveBeenCalledTimes(2);
    expect(compileSpy).toHaveBeenNthCalledWith(1, src, { fragmentName: undefined });
    expect(compileSpy).toHaveBeenNthCalledWith(2, doc, { fragmentName: undefined });
  });
});
